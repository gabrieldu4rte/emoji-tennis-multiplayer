const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { performance } = require('perf_hooks');
const Physics = require('./public/js/physics.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, 'public')));

const CANVAS_HEIGHT = Physics.FIELD_H;
const PADDLE_HEIGHT = Physics.PADDLE_H;
const MAX_POINTS = Physics.MAX_POINTS;
const STEP_MS = Physics.STEP_MS;
const RECONNECT_GRACE_MS = 20000;
const ALLOWED_EMOJIS = ['🦊', '🤖', '🦁', '🐸', '👽', '👻', '💀', '🤡', '🐼', '🐱', '🦖', '🦄'];
const MAX_LAG_COMP_MS = 200;
const PADDLE_HISTORY_MS = 1000;
const SNAPSHOT_INTERVAL_MS = 100;
const PADDLE_START_Y = 220;
const PAUSED_SERVE_AT = Number.MAX_SAFE_INTEGER;

const now = () => performance.now();

let waitingPlayer = null;
let rooms = {};

function roleOfSocket(room, socketId) {
    if (!room) return null;
    if (room.p1 === socketId) return 'p1';
    if (room.p2 === socketId) return 'p2';
    return null;
}

function findRoomIdBySocket(socketId) {
    for (const roomId in rooms) {
        if (rooms[roomId].p1 === socketId || rooms[roomId].p2 === socketId) return roomId;
    }
    return null;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function createRoom(p1Id, p2Id) {
    const t = now();
    const room = {
        p1: p1Id,
        p2: p2Id,
        p1Emoji: '🦊',
        p2Emoji: '🤖',
        p1Score: 0,
        p2Score: 0,
        removalTimer: null,
        over: false,
        paused: false,
        ball: { x: 400, y: 250, vx: 0, vy: 0, speed: Physics.BALL_START_SPEED },
        simTime: t,
        serveAt: t + Physics.COUNTDOWN_MS,
        hits: 0,
        lastSnapshot: 0,
        relayedY: { p1: PADDLE_START_Y, p2: PADDLE_START_Y },
        paddles: {
            p1: [{ t: -Infinity, y: PADDLE_START_Y }],
            p2: [{ t: -Infinity, y: PADDLE_START_Y }]
        }
    };
    Physics.serveBall(room.ball, Math.random() < 0.5 ? 1 : -1, randomServeVy());
    return room;
}

function randomServeVy() {
    return (Math.random() * 2 - 1) * 2;
}

function snapshotOf(room) {
    const b = room.ball;
    return {
        t: room.simTime,
        x: b.x, y: b.y, vx: b.vx, vy: b.vy, speed: b.speed,
        p1Score: room.p1Score,
        p2Score: room.p2Score,
        serveAt: room.serveAt,
        hits: room.hits
    };
}

function sendSnapshot(roomId, room) {
    room.lastSnapshot = now();
    io.to(roomId).emit('state', snapshotOf(room));
}

function recordPaddle(room, role, y, t) {
    const history = room.paddles[role];
    const current = now();
    const stamp = clamp(typeof t === 'number' && !Number.isNaN(t) ? t : current, current - MAX_LAG_COMP_MS, current);
    const last = history[history.length - 1];
    history.push({ t: Math.max(stamp, last.t), y });
    while (history.length > 2 && history[1].t < current - PADDLE_HISTORY_MS) history.shift();
}

function paddleAt(room, role, t, current) {
    const history = room.paddles[role];
    const last = history[history.length - 1];
    const waitingForInput = last.t < t && current - t < MAX_LAG_COMP_MS && room[role] !== null;
    if (waitingForInput) return undefined;
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].t <= t) return history[i].y;
    }
    return history[0].y;
}

function scorePoint(roomId, room, scorer) {
    if (scorer === 'p1') room.p1Score++;
    else room.p2Score++;

    if (room.p1Score >= MAX_POINTS || room.p2Score >= MAX_POINTS) {
        room.over = true;
        room.ball.vx = room.ball.vy = 0;
        sendSnapshot(roomId, room);
        io.to(roomId).emit('game_over', { winnerRole: scorer, p1Score: room.p1Score, p2Score: room.p2Score });
        return;
    }

    Physics.serveBall(room.ball, scorer === 'p1' ? -1 : 1, randomServeVy());
    room.serveAt = room.simTime + Physics.POINT_PAUSE_MS;
}

function simulateRoom(roomId, room, current) {
    if (room.over) return;
    if (room.paused) {
        room.simTime = current;
        return;
    }

    let changed = false;
    while (room.simTime + STEP_MS <= current) {
        const t = room.simTime + STEP_MS;
        if (t < room.serveAt) {
            room.simTime = t;
            continue;
        }

        const next = { ...room.ball };
        const events = [];
        const done = Physics.step(next, side => paddleAt(room, side, t, current), (name, side) => events.push({ name, side }));
        if (!done) break;

        room.ball = next;
        room.simTime = t;

        const out = events.find(e => e.name === 'out');
        if (events.some(e => e.name === 'hit')) {
            room.hits++;
            changed = true;
        }
        if (out) {
            scorePoint(roomId, room, out.side);
            changed = true;
            if (room.over) return;
        }
    }

    if (changed || current - room.lastSnapshot >= SNAPSHOT_INTERVAL_MS) sendSnapshot(roomId, room);
}

function resumeRoom(roomId, room) {
    room.paused = false;
    room.simTime = now();
    Physics.serveBall(room.ball, Math.random() < 0.5 ? 1 : -1, randomServeVy());
    room.serveAt = room.simTime + Physics.COUNTDOWN_MS;
    sendSnapshot(roomId, room);
}

setInterval(() => {
    const current = now();
    for (const roomId in rooms) simulateRoom(roomId, rooms[roomId], current);
}, STEP_MS);

function finalizeRoomRemoval(roomId) {
    if (!rooms[roomId]) return;
    io.to(roomId).emit('opponent_left');
    delete rooms[roomId];
}

function tryRejoin(socket, roomId, role) {
    const room = rooms[roomId];
    if (!room || (role !== 'p1' && role !== 'p2') || room[role] !== null) {
        socket.emit('rejoin_failed');
        return false;
    }

    clearTimeout(room.removalTimer);
    room.removalTimer = null;
    room[role] = socket.id;
    socket.join(roomId);

    socket.emit('rejoin_ack', {
        p1Emoji: room.p1Emoji,
        p2Emoji: room.p2Emoji,
        p1Score: room.p1Score,
        p2Score: room.p2Score
    });
    socket.to(roomId).emit('opponent_reconnected');
    if (room.p1 && room.p2 && !room.over) resumeRoom(roomId, room);
    return true;
}

io.on('connection', (socket) => {
    console.log('Jogador conectado:', socket.id);

    const rejoin = socket.handshake.auth && socket.handshake.auth.rejoin;
    const rejoined = rejoin && rejoin.roomId && rejoin.role
        ? tryRejoin(socket, rejoin.roomId, rejoin.role)
        : false;

    if (!rejoined) {
        if (waitingPlayer && waitingPlayer.id !== socket.id) {
            const roomId = waitingPlayer.id + '#' + socket.id;
            const p1 = waitingPlayer;
            const p2 = socket;

            rooms[roomId] = createRoom(p1.id, p2.id);

            p1.join(roomId);
            p2.join(roomId);

            p1.emit('game_start', { role: 'p1', roomId, oppId: p2.id });
            p2.emit('game_start', { role: 'p2', roomId, oppId: p1.id });
            sendSnapshot(roomId, rooms[roomId]);

            waitingPlayer = null;
        } else {
            waitingPlayer = socket;
            socket.emit('waiting');
        }
    }

    socket.on('choose_emoji', ({ roomId, role, emoji }) => {
        const room = rooms[roomId];
        if (!room || roleOfSocket(room, socket.id) !== role) return;
        if (!ALLOWED_EMOJIS.includes(emoji)) return;

        if (role === 'p1') room.p1Emoji = emoji;
        else room.p2Emoji = emoji;

        io.to(roomId).emit('emoji_update', {
            p1Emoji: room.p1Emoji,
            p2Emoji: room.p2Emoji
        });
    });

    socket.on('time_ping', (clientTime) => {
        if (typeof clientTime !== 'number') return;
        socket.emit('time_pong', { c: clientTime, s: now() });
    });

    socket.on('move_paddle', ({ roomId, y, t }) => {
        const room = rooms[roomId];
        const role = roleOfSocket(room, socket.id);
        if (!role) return;
        if (typeof y !== 'number' || Number.isNaN(y)) return;

        const safeY = clamp(y, 0, CANVAS_HEIGHT - PADDLE_HEIGHT);
        recordPaddle(room, role, safeY, t);
        if (room.relayedY[role] !== safeY) {
            room.relayedY[role] = safeY;
            socket.to(roomId).emit('opponent_move', { y: safeY });
        }
    });

    socket.on('leave_room', ({ roomId }) => {
        const room = rooms[roomId];
        if (!roleOfSocket(room, socket.id)) return;

        clearTimeout(room.removalTimer);
        io.to(roomId).emit('opponent_left');
        delete rooms[roomId];
    });

    socket.on('disconnect', () => {
        console.log('Jogador desconectado:', socket.id);
        if (waitingPlayer === socket) {
            waitingPlayer = null;
        }

        const roomId = findRoomIdBySocket(socket.id);
        if (!roomId) return;

        const room = rooms[roomId];
        const role = roleOfSocket(room, socket.id);
        room[role] = null;

        const otherRole = role === 'p1' ? 'p2' : 'p1';
        if (!room[otherRole]) {
            clearTimeout(room.removalTimer);
            delete rooms[roomId];
            return;
        }

        if (!room.over) {
            room.paused = true;
            room.serveAt = PAUSED_SERVE_AT;
            sendSnapshot(roomId, room);
        }

        io.to(roomId).emit('opponent_disconnected');
        room.removalTimer = setTimeout(() => finalizeRoomRemoval(roomId), RECONNECT_GRACE_MS);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
