const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 500;
const PADDLE_HEIGHT = 60;
const BALL_SIZE = 24;
const MAX_POINTS = 5;
const RECONNECT_GRACE_MS = 20000;
const ALLOWED_EMOJIS = ['🦊', '🤖', '🦁', '🐸', '👽', '👻', '💀', '🤡', '🐼', '🐱', '🦖', '🦄'];
const ALLOWED_SOUND_TYPES = ['sine', 'triangle', 'sawtooth', 'square'];

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

            rooms[roomId] = {
                p1: p1.id,
                p2: p2.id,
                p1Emoji: '🦊',
                p2Emoji: '🤖',
                p1Score: 0,
                p2Score: 0,
                removalTimer: null
            };

            p1.join(roomId);
            p2.join(roomId);

            p1.emit('game_start', { role: 'p1', roomId, oppId: p2.id });
            p2.emit('game_start', { role: 'p2', roomId, oppId: p1.id });

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

    socket.on('move_paddle', ({ roomId, y }) => {
        const room = rooms[roomId];
        if (!roleOfSocket(room, socket.id)) return;
        if (typeof y !== 'number' || Number.isNaN(y)) return;

        const safeY = clamp(y, 0, CANVAS_HEIGHT - PADDLE_HEIGHT);
        socket.to(roomId).emit('opponent_move', { y: safeY });
    });

    socket.on('sync_ball', ({ roomId, x, y, p1Score, p2Score }) => {
        const room = rooms[roomId];
        // apenas a autoridade da física (p1) pode ditar a posição da bola e o placar
        if (!room || room.p1 !== socket.id) return;
        if ([x, y, p1Score, p2Score].some(v => typeof v !== 'number' || Number.isNaN(v))) return;

        const bothIncreased = p1Score > room.p1Score && p2Score > room.p2Score;
        const validP1 = Number.isInteger(p1Score) && p1Score >= room.p1Score && p1Score <= room.p1Score + 1 && p1Score <= MAX_POINTS;
        const validP2 = Number.isInteger(p2Score) && p2Score >= room.p2Score && p2Score <= room.p2Score + 1 && p2Score <= MAX_POINTS;
        if (!validP1 || !validP2 || bothIncreased) return;

        room.p1Score = p1Score;
        room.p2Score = p2Score;

        const safeX = clamp(x, -BALL_SIZE * 2, CANVAS_WIDTH + BALL_SIZE * 2);
        const safeY = clamp(y, 0, CANVAS_HEIGHT - BALL_SIZE);

        socket.to(roomId).emit('ball_update', { x: safeX, y: safeY, p1Score: room.p1Score, p2Score: room.p2Score });

        if (room.p1Score >= MAX_POINTS || room.p2Score >= MAX_POINTS) {
            const winnerRole = room.p1Score >= MAX_POINTS ? 'p1' : 'p2';
            io.to(roomId).emit('game_over', { winnerRole, p1Score: room.p1Score, p2Score: room.p2Score });
        }
    });

    socket.on('sound_trigger', ({ roomId, freq, type, duration }) => {
        const room = rooms[roomId];
        if (!roleOfSocket(room, socket.id)) return;
        if (typeof freq !== 'number' || freq < 50 || freq > 2000) return;
        if (!ALLOWED_SOUND_TYPES.includes(type)) return;
        if (typeof duration !== 'number' || duration <= 0 || duration > 1) return;

        socket.to(roomId).emit('opponent_sound', { freq, type, duration });
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
            // ambos os jogadores já saíram, não há ninguém para aguardar reconexão
            clearTimeout(room.removalTimer);
            delete rooms[roomId];
            return;
        }

        io.to(roomId).emit('opponent_disconnected');
        room.removalTimer = setTimeout(() => finalizeRoomRemoval(roomId), RECONNECT_GRACE_MS);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
