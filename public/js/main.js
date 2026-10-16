const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let socket;

const emojisList = ['🦊', '🤖', '🦁', '🐸', '👽', '👻', '💀', '🤡', '🐼', '🐱', '🦖', '🦄'];
let myEmoji = '🦊';

let myRole = '';
let currentRoomId = '';
let gameRunning = false;
let mode = 'demo';

const FIELD_W = Physics.FIELD_W;
const FIELD_H = Physics.FIELD_H;
const paddleWidth = Physics.PADDLE_W;
const paddleHeight = Physics.PADDLE_H;
const ballSize = Physics.BALL_SIZE;
const maxPoints = Physics.MAX_POINTS;
const PADDLE_SPEED = Physics.PADDLE_SPEED;

const BALL_INITIAL = { x: 400, y: 250, vx: 3.2, vy: 2.4, speed: Physics.BALL_START_SPEED };

const STEP_MS = Physics.STEP_MS;

const COUNTDOWN_STEP_MS = Physics.COUNTDOWN_STEP_MS;
const COUNTDOWN_MS = Physics.COUNTDOWN_MS;
const SERVE_PAUSE_MS = Physics.SERVE_PAUSE_MS;
const POINT_BANNER_MS = Physics.POINT_BANNER_MS;

const SMOOTHING = 0.82;
const MAX_SMOOTH_ERROR = 120;
const MAX_RESIM_STEPS = 45;
const TIME_SYNC_INTERVAL_MS = 2000;
const TIME_SYNC_SAMPLES = 10;

const p1 = { x: Physics.P1_X, y: 220, score: 0, emoji: '🦊' };
const p2 = { x: Physics.P2_X, y: 220, score: 0, emoji: '🤖' };
const ball = { ...BALL_INITIAL };

const net = {
    ball: { ...BALL_INITIAL },
    time: 0,
    serveAt: Infinity,
    out: false,
    error: { x: 0, y: 0 },
    fxHits: 0,
    lastServeAt: null,
    firstServe: true,
    clockSamples: [],
    clockOffset: 0,
    syncTimer: null,
    myHistory: []
};

const keys = {};
window.addEventListener('keydown', e => {
    keys[e.key] = true;
    if (mode === 'game' && ['ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
});
window.addEventListener('keyup', e => keys[e.key] = false);
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

const $ = id => document.getElementById(id);

function showScreen(id) {
    for (const s of ['loading-screen', 'menu-screen', 'waiting-screen', 'game-over-screen']) {
        $(s).classList.toggle('hidden', s !== id);
    }
}

function showBanner(text) {
    const el = $('connection-banner');
    el.textContent = text;
    el.classList.remove('hidden');
}
function hideBanner() {
    $('connection-banner').classList.add('hidden');
}

let toastTimer = null;
function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

function selectEmoji(emoji, playSfx = true) {
    myEmoji = emoji;
    document.querySelectorAll('.emoji-btn').forEach(b => b.classList.toggle('selected', b.dataset.emoji === emoji));
    const info = Assets.charInfo(emoji);
    $('char-name').textContent = info.name;
    $('char-name').style.color = info.color;
    if (playSfx) Sound.play('select', { volume: 0.7 });
}

function buildPicker() {
    const picker = $('emojis-picker');
    picker.innerHTML = '';
    emojisList.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'emoji-btn';
        btn.dataset.emoji = emoji;
        btn.title = Assets.charInfo(emoji).name;
        const c = document.createElement('canvas');
        c.width = 48;
        c.height = 42;
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = false;
        Assets.drawPortrait(g, emoji, 0, 0, 3);
        btn.appendChild(c);
        btn.onclick = () => selectEmoji(emoji);
        picker.appendChild(btn);
    });
    selectEmoji(myEmoji, false);
}

function updateMuteButton() {
    const c = $('mute-canvas');
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    Assets.drawUI(g, Sound.muted ? 'soundOff' : 'soundOn', 0, 0, 3);
}

function fitToScreen() {
    const wrapper = $('game-wrapper');
    const s = Math.min(1.5, (window.innerWidth - 16) / VIEW_W, (window.innerHeight - 16) / VIEW_H);
    wrapper.style.width = VIEW_W * s + 'px';
    wrapper.style.height = VIEW_H * s + 'px';
    $('game-container').style.transform = `scale(${s})`;
}
window.addEventListener('resize', fitToScreen);

let pointerTargetY = null;
function pointerToField(e) {
    const rect = canvas.getBoundingClientRect();
    return ((e.clientY - rect.top) / rect.height) * VIEW_H - FIELD_Y - paddleHeight / 2;
}
canvas.addEventListener('pointerdown', e => { if (mode === 'game') pointerTargetY = pointerToField(e); });
canvas.addEventListener('pointermove', e => { if (pointerTargetY !== null) pointerTargetY = pointerToField(e); });
window.addEventListener('pointerup', () => { pointerTargetY = null; });
window.addEventListener('pointercancel', () => { pointerTargetY = null; });

function playEventSound(name) {
    let sample = name;
    if (name === 'point_p1' || name === 'point_p2') {
        const scorer = name === 'point_p1' ? 'p1' : 'p2';
        sample = scorer === myRole ? 'point_win' : 'point_lose';
    }
    if (!Sound.play(sample)) {
        const s = NET_SOUNDS[name];
        Sound.beep(s.freq, s.type, s.duration);
    }
}

function gameEventVisual(name) {
    if (name === 'hit') Scene.onHit(ball.x < FIELD_W / 2 ? 'p1' : 'p2');
    else if (name === 'wall') Scene.onWall();
}

function triggerGameEvent(name) {
    playEventSound(name);
    gameEventVisual(name);
}

function serverNow() {
    return performance.now() + net.clockOffset;
}

function sendTimePing() {
    if (socket && socket.connected) socket.emit('time_ping', performance.now());
}

function onTimePong({ c, s }) {
    const arrived = performance.now();
    net.clockSamples.push({ rtt: arrived - c, offset: s - (c + arrived) / 2 });
    if (net.clockSamples.length > TIME_SYNC_SAMPLES) net.clockSamples.shift();
    const best = net.clockSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    net.clockOffset = best.offset;
}

function startTimeSync() {
    clearInterval(net.syncTimer);
    net.clockSamples = [];
    for (let i = 0; i < 5; i++) setTimeout(sendTimePing, i * 60);
    net.syncTimer = setInterval(sendTimePing, TIME_SYNC_INTERVAL_MS);
}

function myPaddleAt(t) {
    const h = net.myHistory;
    for (let i = h.length - 1; i >= 0; i--) {
        if (h[i].t <= t) return h[i].y;
    }
    return (myRole === 'p1' ? p1 : p2).y;
}

function predictedPaddleY(side, t) {
    if (side === myRole) return myPaddleAt(t);
    return (side === 'p1' ? p1 : p2).y;
}

function advanceNetBall(target, live) {
    net.time = Math.max(net.time, target - MAX_RESIM_STEPS * STEP_MS);
    while (net.time + STEP_MS <= target) {
        net.time += STEP_MS;
        if (net.out || net.time < net.serveAt) continue;
        const t = net.time;
        Physics.step(net.ball, side => predictedPaddleY(side, t), (name) => {
            if (name === 'out') {
                net.out = true;
                net.ball.vx = net.ball.vy = 0;
            } else if (live) {
                if (name === 'hit') net.fxHits++;
                triggerGameEvent(name);
            }
        });
    }
}

function applySnapshot(snap) {
    const before = { x: ball.x, y: ball.y };
    const scoredP1 = snap.p1Score > p1.score;
    const scoredP2 = snap.p2Score > p2.score;
    if (net.clockSamples.length === 0) net.clockOffset = snap.t - performance.now();

    net.ball = { x: snap.x, y: snap.y, vx: snap.vx, vy: snap.vy, speed: snap.speed };
    net.time = snap.t;
    net.serveAt = snap.serveAt;
    net.out = false;
    advanceNetBall(serverNow(), false);

    p1.score = snap.p1Score;
    p2.score = snap.p2Score;
    if (scoredP1 || scoredP2) {
        playEventSound(scoredP1 ? 'point_p1' : 'point_p2');
        net.fxHits = snap.hits;
    } else if (snap.hits > net.fxHits) {
        net.fxHits = snap.hits;
        playEventSound('hit');
        Scene.onHit(snap.vx > 0 ? 'p1' : 'p2');
    }

    const ex = before.x - net.ball.x;
    const ey = before.y - net.ball.y;
    if (scoredP1 || scoredP2 || Math.hypot(ex, ey) > MAX_SMOOTH_ERROR) {
        net.error.x = net.error.y = 0;
    } else {
        net.error.x = ex;
        net.error.y = ey;
    }
    updateDisplayBall();

    if (snap.serveAt !== net.lastServeAt) {
        net.lastServeAt = snap.serveAt;
        const countdownStart = snap.serveAt - COUNTDOWN_MS;
        if (snap.serveAt > serverNow()) {
            Scene.startCountdown(countdownStart - serverNow(), net.firstServe);
        }
        net.firstServe = false;
    }
}

function updateDisplayBall() {
    ball.x = net.ball.x + net.error.x;
    ball.y = net.ball.y + net.error.y;
    ball.vx = net.ball.vx;
    ball.vy = net.ball.vy;
}

function updateNetBall() {
    advanceNetBall(serverNow(), true);
    net.error.x *= SMOOTHING;
    net.error.y *= SMOOTHING;
    if (Math.abs(net.error.x) < 0.1) net.error.x = 0;
    if (Math.abs(net.error.y) < 0.1) net.error.y = 0;
    updateDisplayBall();
}

function connectToServer() {
    Sound.unlock();
    Sound.startMusic();
    showScreen('waiting-screen');
    $('status-text').innerText = "Conectando ao servidor...";

    socket = io({
        transports: ['websocket'],
        auth: (cb) => cb({ rejoin: currentRoomId && myRole ? { roomId: currentRoomId, role: myRole } : null })
    });

    socket.on('connect', () => {
        hideBanner();
        startTimeSync();
    });

    socket.on('time_pong', onTimePong);

    socket.on('disconnect', () => {
        if (gameRunning) showBanner('Conexão perdida. Tentando reconectar...');
    });

    socket.on('waiting', () => {
        $('status-text').innerText = "Procurando um oponente disponível...";
    });

    socket.on('game_start', ({ role, roomId }) => {
        myRole = role;
        currentRoomId = roomId;

        socket.emit('choose_emoji', { roomId, role, emoji: myEmoji });

        showScreen(null);

        p1.score = 0;
        p2.score = 0;
        p1.y = 220;
        p2.y = 220;
        p1.emoji = role === 'p1' ? myEmoji : '🦊';
        p2.emoji = role === 'p2' ? myEmoji : '🤖';
        Object.assign(ball, BALL_INITIAL);
        net.ball = { ...BALL_INITIAL };
        net.serveAt = Infinity;
        net.out = false;
        net.error.x = net.error.y = 0;
        net.fxHits = 0;
        net.lastServeAt = null;
        net.firstServe = true;
        net.myHistory = [];

        mode = 'game';
        Scene.silent = false;
        Scene.showHud = true;
        Scene.setArena(hashString(roomId));
        Scene.reset();
        Sound.play('found');
        Sound.setMusicVolume(0.16);
        gameRunning = true;
    });

    socket.on('emoji_update', ({ p1Emoji, p2Emoji }) => {
        p1.emoji = p1Emoji;
        p2.emoji = p2Emoji;
    });

    socket.on('opponent_move', ({ y }) => {
        if (myRole === 'p1') p2.y = y;
        else p1.y = y;
    });

    socket.on('state', (snap) => {
        if (mode === 'game') applySnapshot(snap);
    });

    socket.on('opponent_disconnected', () => {
        showBanner('Oponente desconectado. Aguardando reconexão...');
    });

    socket.on('opponent_reconnected', () => {
        hideBanner();
    });

    socket.on('rejoin_ack', ({ p1Emoji, p2Emoji, p1Score, p2Score }) => {
        p1.emoji = p1Emoji;
        p2.emoji = p2Emoji;
        p1.score = p1Score;
        p2.score = p2Score;
        Scene.syncScores();
        hideBanner();
    });

    socket.on('rejoin_failed', () => {
        backToMenu();
        toast("Não foi possível retomar a partida anterior.");
    });

    socket.on('game_over', ({ winnerRole, p1Score, p2Score }) => {
        gameRunning = false;
        p1.score = p1Score;
        p2.score = p2Score;
        Scene.syncScores();
        Scene.setWinner(winnerRole);

        const winnerLabel = winnerRole === 'p1' ? 'Jogador 1' : 'Jogador 2';
        const winnerEmoji = winnerRole === 'p1' ? p1.emoji : p2.emoji;
        const iWon = winnerRole === myRole;
        $('winner-title').textContent = iWon ? 'VITÓRIA!' : 'DERROTA';
        $('winner-title').className = iWon ? 'win' : 'lose';
        $('winner-text').innerText = `${winnerLabel} (${Assets.charInfo(winnerEmoji).name}) venceu!`;
        $('final-score').innerHTML =
            `<span class="p1">${p1Score}</span> <span class="dash">-</span> <span class="p2">${p2Score}</span>`;
        winnerPreviewEmoji = winnerEmoji;
        Sound.play(iWon ? 'victory' : 'defeat');
        Sound.play('crowd', { volume: 0.7 });
        setTimeout(() => { if (mode === 'game' && !gameRunning) showScreen('game-over-screen'); }, 900);
    });

    socket.on('opponent_left', () => {
        backToMenu();
        toast("Seu oponente se desconectou.");
    });
}

function hashString(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
}

function moveLocalPaddle() {
    const myPaddle = myRole === 'p1' ? p1 : p2;
    const up = keys['w'] || keys['W'] || keys['ArrowUp'];
    const down = keys['s'] || keys['S'] || keys['ArrowDown'];

    if (up) {
        myPaddle.y = Math.max(0, myPaddle.y - PADDLE_SPEED);
    }
    if (down) {
        myPaddle.y = Math.min(FIELD_H - paddleHeight, myPaddle.y + PADDLE_SPEED);
    }
    if (!up && !down && pointerTargetY !== null) {
        const diff = Math.max(-PADDLE_SPEED, Math.min(PADDLE_SPEED, pointerTargetY - myPaddle.y));
        if (Math.abs(diff) >= 1) {
            myPaddle.y = Math.max(0, Math.min(FIELD_H - paddleHeight, myPaddle.y + diff));
            }
    }

    const t = serverNow();
    net.myHistory.push({ t, y: myPaddle.y });
    if (net.myHistory.length > 90) net.myHistory.shift();

    if (socket && socket.connected) {
        socket.emit('move_paddle', { roomId: currentRoomId, y: myPaddle.y, t });
    }
}

function demoPaddleY(side) {
    return (side === 'p1' ? p1 : p2).y;
}

const demoAI = { p1: { offset: 0 }, p2: { offset: 0 } };
let demoHoldUntil = 0;

function startDemo() {
    mode = 'demo';
    Scene.silent = true;
    Scene.showHud = false;
    const pick = () => emojisList[Math.floor(Math.random() * emojisList.length)];
    p1.emoji = pick();
    do { p2.emoji = pick(); } while (p2.emoji === p1.emoji);
    p1.score = 0;
    p2.score = 0;
    p1.y = p2.y = 220;
    Object.assign(ball, BALL_INITIAL);
    Scene.setArena(Math.floor(Math.random() * 1000));
    Scene.reset();
    demoHoldUntil = performance.now() + 800;
}

function updateDemo(now) {
    for (const [p, side, coming] of [[p1, 'p1', ball.vx < 0], [p2, 'p2', ball.vx > 0]]) {
        const target = (coming ? ball.y + ballSize / 2 : FIELD_H / 2) - paddleHeight / 2 + demoAI[side].offset;
        const diff = target - p.y;
        if (Math.abs(diff) > 2) p.y += Math.max(-4.5, Math.min(4.5, diff));
        p.y = Math.max(0, Math.min(FIELD_H - paddleHeight, p.y));
    }
    if (now < demoHoldUntil) return;
    Physics.step(ball, demoPaddleY, (name, side) => {
        if (name === 'out') {
            if (side === 'p1') p1.score++;
            else p2.score++;
            Physics.serveBall(ball, side === 'p1' ? -1 : 1, (Math.random() * 2 - 1) * 2);
            demoHoldUntil = now + SERVE_PAUSE_MS + 400;
            return;
        }
        gameEventVisual(name);
        if (name === 'hit') {
            demoAI.p1.offset = (Math.random() - 0.5) * 50;
            demoAI.p2.offset = (Math.random() - 0.5) * 50;
            if (ball.speed > 9) demoAI[ball.vx > 0 ? 'p2' : 'p1'].offset = (Math.random() < 0.5 ? -1 : 1) * 70;
        }
    });
    if (p1.score >= maxPoints || p2.score >= maxPoints) {
        p1.score = 0;
        p2.score = 0;
        Scene.syncScores();
    }
}

let winnerPreviewEmoji = '🦊';

let lastFrameTime = null;
let stepAccumulator = 0;

function tick(now) {
    if (mode === 'game') {
        if (gameRunning) {
            moveLocalPaddle();
            updateNetBall();
        }
    } else {
        updateDemo(now);
    }
    Scene.update(now);
}

function frame(now) {
    if (Assets.ready) {
        if (lastFrameTime === null) lastFrameTime = now;
        stepAccumulator += Math.min(250, now - lastFrameTime);
        lastFrameTime = now;
        while (stepAccumulator >= STEP_MS) {
            tick(now);
            stepAccumulator -= STEP_MS;
        }
        Scene.draw(ctx, now);

        if (!$('menu-screen').classList.contains('hidden')) Preview.menu($('preview-canvas'), myEmoji, now);
        if (!$('waiting-screen').classList.contains('hidden')) Preview.waiting($('waiting-canvas'), myEmoji, now);
        if (!$('game-over-screen').classList.contains('hidden')) Preview.winner($('winner-canvas'), winnerPreviewEmoji, now);
    }
    requestAnimationFrame(frame);
}

function backToMenu() {
    if (socket) {
        if (currentRoomId) {
            socket.emit('leave_room', { roomId: currentRoomId });
        }
        socket.disconnect();
    }
    clearInterval(net.syncTimer);
    myRole = '';
    currentRoomId = '';
    gameRunning = false;
    hideBanner();
    showScreen('menu-screen');
    Sound.setMusicVolume(0.28);
    startDemo();
}

$('mute-btn').addEventListener('click', () => {
    Sound.unlock();
    Sound.toggleMute();
    if (!Sound.muted) Sound.startMusic();
    updateMuteButton();
});
window.addEventListener('pointerdown', () => { Sound.unlock(); Sound.startMusic(); }, { once: true });
window.addEventListener('keydown', () => { Sound.unlock(); Sound.startMusic(); }, { once: true });

(async function init() {
    fitToScreen();
    showScreen('loading-screen');
    requestAnimationFrame(frame);
    await Assets.load(p => { $('loading-bar').style.width = Math.round(p * 100) + '%'; });
    Sound.load(Assets.manifest.sounds);
    buildPicker();
    updateMuteButton();
    startDemo();
    showScreen('menu-screen');
})();
