// Lógica do jogo e comunicação em tempo real.
// O protocolo com o servidor é o mesmo da versão original: mesmos eventos,
// mesmos payloads, p1 continua sendo a autoridade da física da bola.
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let socket;

const emojisList = ['🦊', '🤖', '🦁', '🐸', '👽', '👻', '💀', '🤡', '🐼', '🐱', '🦖', '🦄'];
let myEmoji = '🦊';

let myRole = '';
let currentRoomId = '';
let gameRunning = false;
let mode = 'demo'; // 'demo' (partida de exibição atrás do menu) ou 'game'

// dimensões da quadra (coordenadas da física, iguais às do servidor)
const FIELD_W = 800;
const FIELD_H = 500;
const paddleWidth = 40;
const paddleHeight = 60;
const ballSize = 24;
const maxPoints = 5;
const PADDLE_SPEED = 6;

// velocidade da bola: começa lenta e acelera um pouco a cada rebatida
const BALL_START_SPEED = 4;
const BALL_SPEED_STEP = 0.25;
const BALL_MAX_SPEED = 12;
const BALL_INITIAL = { x: 400, y: 250, vx: 3.2, vy: 2.4, speed: BALL_START_SPEED };

// a física roda em passo fixo (60x por segundo), independente da taxa de
// atualização do monitor; antes, em telas de 120/144 Hz a bola ficava 2x mais rápida
const STEP_MS = 1000 / 60;

const COUNTDOWN_STEP_MS = 650;
const COUNTDOWN_MS = COUNTDOWN_STEP_MS * 3; // a bola sai no "JÁ!"
const SERVE_PAUSE_MS = 900;

const p1 = { x: 30, y: 220, score: 0, emoji: '🦊' };
const p2 = { x: 730, y: 220, score: 0, emoji: '🤖' };
const ball = { ...BALL_INITIAL };

let physicsHoldUntil = 0; // pausa da bola (contagem inicial / após ponto), só na autoridade

const keys = {};
window.addEventListener('keydown', e => {
    keys[e.key] = true;
    if (mode === 'game' && ['ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
});
window.addEventListener('keyup', e => keys[e.key] = false);
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------
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

// controle por toque/arrasto: o personagem segue o dedo na mesma velocidade do teclado
let pointerTargetY = null;
function pointerToField(e) {
    const rect = canvas.getBoundingClientRect();
    return ((e.clientY - rect.top) / rect.height) * VIEW_H - FIELD_Y - paddleHeight / 2;
}
canvas.addEventListener('pointerdown', e => { if (mode === 'game') pointerTargetY = pointerToField(e); });
canvas.addEventListener('pointermove', e => { if (pointerTargetY !== null) pointerTargetY = pointerToField(e); });
window.addEventListener('pointerup', () => { pointerTargetY = null; });
window.addEventListener('pointercancel', () => { pointerTargetY = null; });

// ---------------------------------------------------------------------------
// Sons de jogo (mesmo formato de evento de rede de antes)
// ---------------------------------------------------------------------------
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

// substitui o antigo playSound(freq, type, duration, shouldEmit) da física
function triggerGameEvent(name, shouldEmit) {
    playEventSound(name);
    gameEventVisual(name);
    if (shouldEmit && socket) {
        const s = NET_SOUNDS[name];
        socket.emit('sound_trigger', { roomId: currentRoomId, freq: s.freq, type: s.type, duration: s.duration });
    }
}

// ---------------------------------------------------------------------------
// Rede
// ---------------------------------------------------------------------------
function connectToServer() {
    Sound.unlock();
    Sound.startMusic();
    showScreen('waiting-screen');
    $('status-text').innerText = "Conectando ao servidor...";

    socket = io({
        auth: (cb) => cb({ rejoin: currentRoomId && myRole ? { roomId: currentRoomId, role: myRole } : null })
    });

    socket.on('connect', () => {
        hideBanner();
    });

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

        // estado inicial da partida (idêntico ao original)
        p1.score = 0;
        p2.score = 0;
        p1.y = 220;
        p2.y = 220;
        p1.emoji = role === 'p1' ? myEmoji : '🦊';
        p2.emoji = role === 'p2' ? myEmoji : '🤖';
        Object.assign(ball, BALL_INITIAL);

        mode = 'game';
        Scene.silent = false;
        Scene.showHud = true;
        Scene.setArena(hashString(roomId));
        Scene.reset();
        Scene.startCountdown();
        physicsHoldUntil = performance.now() + COUNTDOWN_MS;
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

    socket.on('ball_update', ({ x, y, p1Score, p2Score }) => {
        if (myRole === 'p2') {
            ball.x = x;
            ball.y = y;
            p1.score = p1Score;
            p2.score = p2Score;
        }
    });

    socket.on('opponent_sound', ({ freq, type, duration }) => {
        const name = netEventFromSound(freq, type);
        if (name) {
            playEventSound(name);
            gameEventVisual(name);
        } else {
            Sound.beep(freq, type, duration);
        }
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

// ---------------------------------------------------------------------------
// Movimento e física (mesmas regras da versão original)
// ---------------------------------------------------------------------------
function moveLocalPaddle() {
    const myPaddle = myRole === 'p1' ? p1 : p2;
    let moved = false;
    const up = keys['w'] || keys['W'] || keys['ArrowUp'];
    const down = keys['s'] || keys['S'] || keys['ArrowDown'];

    if (up) {
        myPaddle.y = Math.max(0, myPaddle.y - PADDLE_SPEED);
        moved = true;
    }
    if (down) {
        myPaddle.y = Math.min(FIELD_H - paddleHeight, myPaddle.y + PADDLE_SPEED);
        moved = true;
    }
    if (!up && !down && pointerTargetY !== null) {
        const diff = Math.max(-PADDLE_SPEED, Math.min(PADDLE_SPEED, pointerTargetY - myPaddle.y));
        if (Math.abs(diff) >= 1) {
            myPaddle.y = Math.max(0, Math.min(FIELD_H - paddleHeight, myPaddle.y + diff));
            moved = true;
        }
    }

    if (moved && socket) {
        socket.emit('move_paddle', { roomId: currentRoomId, y: myPaddle.y });
    }
}

// um passo da simulação da bola; onEvent recebe 'wall' | 'hit' | 'point_p1' | 'point_p2'
function stepBall(onEvent) {
    ball.x += ball.vx;
    ball.y += ball.vy;

    if (ball.y <= 0 || ball.y >= FIELD_H - ballSize) {
        ball.vy = -ball.vy;
        onEvent('wall');
    }

    if (ball.vx < 0 && ball.x <= p1.x + paddleWidth && ball.x >= p1.x) {
        if (ball.y + ballSize >= p1.y && ball.y <= p1.y + paddleHeight) {
            let collidePoint = (ball.y + ballSize / 2) - (p1.y + paddleHeight / 2);
            collidePoint = collidePoint / (paddleHeight / 2);
            const angleRad = (Math.PI / 4) * collidePoint;

            ball.speed = Math.min(BALL_MAX_SPEED, ball.speed + BALL_SPEED_STEP);
            ball.vx = Math.cos(angleRad) * ball.speed;
            ball.vy = Math.sin(angleRad) * ball.speed;
            onEvent('hit');
        }
    }

    if (ball.vx > 0 && ball.x + ballSize >= p2.x && ball.x <= p2.x + paddleWidth) {
        if (ball.y + ballSize >= p2.y && ball.y <= p2.y + paddleHeight) {
            let collidePoint = (ball.y + ballSize / 2) - (p2.y + paddleHeight / 2);
            collidePoint = collidePoint / (paddleHeight / 2);
            const angleRad = (Math.PI / 4) * collidePoint;

            ball.speed = Math.min(BALL_MAX_SPEED, ball.speed + BALL_SPEED_STEP);
            ball.vx = -Math.cos(angleRad) * ball.speed;
            ball.vy = Math.sin(angleRad) * ball.speed;
            onEvent('hit');
        }
    }

    if (ball.x < 0) {
        p2.score++;
        onEvent('point_p2');
        resetBall(1);
    } else if (ball.x > FIELD_W) {
        p1.score++;
        onEvent('point_p1');
        resetBall(-1);
    }
}

function updatePhysics() {
    if (myRole !== 'p1') return;

    if (performance.now() >= physicsHoldUntil) {
        stepBall(name => {
            triggerGameEvent(name, true);
            if (name === 'point_p1' || name === 'point_p2') physicsHoldUntil = performance.now() + SERVE_PAUSE_MS;
        });
    }

    if (p1.score >= maxPoints || p2.score >= maxPoints) {
        gameRunning = false; // a tela de vitória é exibida quando o servidor confirmar via 'game_over'
    }

    socket.emit('sync_ball', {
        roomId: currentRoomId,
        x: ball.x,
        y: ball.y,
        p1Score: p1.score,
        p2Score: p2.score
    });
}

function resetBall(direction) {
    ball.x = FIELD_W / 2;
    ball.y = FIELD_H / 2;
    ball.speed = BALL_START_SPEED;
    ball.vx = direction * ball.speed;
    ball.vy = (Math.random() * 2 - 1) * 2;
}

// ---------------------------------------------------------------------------
// Modo demonstração: dois bots jogando atrás do menu (apenas local, sem rede)
// ---------------------------------------------------------------------------
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
    stepBall(name => {
        gameEventVisual(name);
        if (name === 'hit') {
            // varia o ponto de contato para a troca de bolas ficar interessante
            demoAI.p1.offset = (Math.random() - 0.5) * 50;
            demoAI.p2.offset = (Math.random() - 0.5) * 50;
            if (ball.speed > 9) demoAI[ball.vx > 0 ? 'p2' : 'p1'].offset = (Math.random() < 0.5 ? -1 : 1) * 70;
        }
        if (name === 'point_p1' || name === 'point_p2') demoHoldUntil = now + SERVE_PAUSE_MS + 400;
    });
    if (p1.score >= maxPoints || p2.score >= maxPoints) {
        p1.score = 0;
        p2.score = 0;
        Scene.syncScores();
    }
}

// ---------------------------------------------------------------------------
// Loop principal
// ---------------------------------------------------------------------------
let winnerPreviewEmoji = '🦊';

let lastFrameTime = null;
let stepAccumulator = 0;

function tick(now) {
    if (mode === 'game') {
        if (gameRunning) {
            moveLocalPaddle();
            updatePhysics();
        }
    } else {
        updateDemo(now);
    }
    Scene.update(now);
}

function frame(now) {
    if (Assets.ready) {
        if (lastFrameTime === null) lastFrameTime = now;
        // limita o acúmulo (ex.: aba em segundo plano) para não "teleportar" a bola
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
    myRole = '';
    currentRoomId = '';
    gameRunning = false;
    hideBanner();
    showScreen('menu-screen');
    Sound.setMusicVolume(0.28);
    startDemo();
}

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------
$('mute-btn').addEventListener('click', () => {
    Sound.unlock();
    Sound.toggleMute();
    if (!Sound.muted) Sound.startMusic();
    updateMuteButton();
});
// a música começa no primeiro gesto do usuário (exigência dos navegadores)
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
