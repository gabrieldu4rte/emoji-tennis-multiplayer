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

let waitingPlayer = null;
let rooms = {};

io.on('connection', (socket) => {
    console.log('Jogador conectado:', socket.id);

    if (waitingPlayer && waitingPlayer.id !== socket.id) {
        const roomId = waitingPlayer.id + '#' + socket.id;
        const p1 = waitingPlayer;
        const p2 = socket;

        rooms[roomId] = {
            p1: p1.id,
            p2: p2.id,
            p1Emoji: '🦊',
            p2Emoji: '🤖'
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

    socket.on('choose_emoji', ({ roomId, role, emoji }) => {
        if (rooms[roomId]) {
            if (role === 'p1') rooms[roomId].p1Emoji = emoji;
            else rooms[roomId].p2Emoji = emoji;
            io.to(roomId).emit('emoji_update', { 
                p1Emoji: rooms[roomId].p1Emoji, 
                p2Emoji: rooms[roomId].p2Emoji 
            });
        }
    });

    socket.on('move_paddle', ({ roomId, y }) => {
        socket.to(roomId).emit('opponent_move', { y });
    });

    socket.on('sync_ball', ({ roomId, x, y, p1Score, p2Score }) => {
        socket.to(roomId).emit('ball_update', { x, y, p1Score, p2Score });
    });

    socket.on('sound_trigger', ({ roomId, freq, type, duration }) => {
        socket.to(roomId).emit('opponent_sound', { freq, type, duration });
    });

    socket.on('disconnect', () => {
        console.log('Jogador desconectado:', socket.id);
        if (waitingPlayer === socket) {
            waitingPlayer = null;
        }

        for (const roomId in rooms) {
            if (rooms[roomId].p1 === socket.id || rooms[roomId].p2 === socket.id) {
                io.to(roomId).emit('opponent_left');
                delete rooms[roomId];
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});