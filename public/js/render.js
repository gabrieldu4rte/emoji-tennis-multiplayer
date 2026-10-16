const VIEW_W = 960, VIEW_H = 600;
const FIELD_X = 80, FIELD_Y = 80;
const WORLD_SCALE = 4;
const SPRITE_SCALE = 3;

const FAST_BALL = 7;
const PLAYER_COLORS = { p1: '#4dff9e', p2: '#ff6b9d' };
const DUST_COLORS = {
    grass: ['#2f7d2f', '#6ab85a', '#8fd07a'],
    clay: ['#e8956a', '#b85a32', '#f0b090'],
    hard: ['#c8d0e0', '#8a9ab8', '#ffffff'],
    night: ['#6ff8ff', '#ff4fd8', '#ffffff']
};

function makeAnim() {
    return { lastY: null, movingUntil: 0, swingUntil: 0, cheerUntil: 0, sadUntil: 0, stepTimer: 0 };
}

const Scene = {
    arena: null,
    silent: true,
    showHud: false,
    anim: { p1: makeAnim(), p2: makeAnim() },
    trail: [],
    lastBall: { x: 400, y: 250 },
    ballSpin: 0,
    ballSpeed: 0,
    lastScore: { p1: 0, p2: 0 },
    scorePop: { p1: 0, p2: 0 },
    rally: 0,
    crowdCheerUntil: 0,
    camFlashes: [],
    countdown: null,
    banner: null,
    winner: null,
    youMarkerUntil: 0,
    nextConfetti: 0,

    setArena(index) {
        const list = Assets.manifest.arenas;
        this.arena = list[((index % list.length) + list.length) % list.length];
    },

    reset() {
        this.anim = { p1: makeAnim(), p2: makeAnim() };
        this.trail.length = 0;
        this.lastBall = { x: ball.x, y: ball.y };
        this.syncScores();
        this.rally = 0;
        this.banner = null;
        this.winner = null;
        this.countdown = null;
        this.crowdCheerUntil = 0;
        FX.clear();
    },

    syncScores() {
        this.lastScore = { p1: p1.score, p2: p2.score };
    },

    startCountdown(delay = 0) {
        const start = performance.now() + delay;
        this.countdown = { start, lastStep: -1 };
        if (!delay) this.youMarkerUntil = start + COUNTDOWN_MS + 2000;
    },

    countdownStep(now) {
        if (!this.countdown) return -1;
        const step = Math.floor((now - this.countdown.start) / COUNTDOWN_STEP_MS);
        return step > 3 ? -1 : step;
    },

    onHit(side) {
        const now = performance.now();
        const a = this.anim[side];
        a.swingUntil = now + 220;
        const p = side === 'p1' ? p1 : p2;
        const dir = side === 'p1' ? 1 : -1;
        const bx = FIELD_X + ball.x + ballSize / 2, by = FIELD_Y + ball.y + ballSize / 2;
        const cx = FIELD_X + p.x + paddleWidth / 2;
        const feet = FIELD_Y + p.y + paddleHeight + 3;
        FX.sprite(cx + dir * 36, feet - 33, Assets.manifest.fx.swoosh, { frameTime: 4, flip: side === 'p2' });
        FX.sprite(bx, by, Assets.manifest.fx.ring, { frameTime: 3 });
        const fast = this.ballSpeed > FAST_BALL;
        FX.burst(bx, by, {
            count: fast ? 18 : 10, speed: fast ? 7 : 5, life: 22, gravity: 0.05,
            angle: side === 'p1' ? 0 : Math.PI, spread: Math.PI * 0.9,
            colors: fast ? ['#ffffff', '#fff27a', '#ffb347', '#ff5a3a'] : ['#ffffff', '#fff27a', '#e6ff6a']
        });
        FX.shake(fast ? 5 : 3, fast ? 160 : 100);
        this.rally++;
        if (this.rally > 0 && this.rally % 5 === 0) {
            FX.popup(`RALLY ${this.rally}!`, VIEW_W / 2, FIELD_Y + 70, { color: '#ffd447', scale: 3, life: 60 });
        }
    },

    onWall() {
        const top = ball.y < FIELD_H / 2;
        const x = FIELD_X + ball.x + ballSize / 2;
        const y = top ? FIELD_Y + 6 : FIELD_Y + FIELD_H - 6;
        FX.sprite(x, y + (top ? 6 : -6), Assets.manifest.fx.puff, { frameTime: 5 });
        FX.burst(x, y, {
            count: 8, speed: 3.5, life: 20, gravity: top ? 0.12 : -0.05,
            angle: top ? Math.PI / 2 : -Math.PI / 2, spread: Math.PI * 0.9,
            colors: DUST_COLORS[this.arena.id]
        });
        FX.shake(2, 70);
    },

    onPoint(scorer, exitBall) {
        const now = performance.now();
        const loser = scorer === 'p1' ? 'p2' : 'p1';
        const color = PLAYER_COLORS[scorer];
        const exitX = scorer === 'p1' ? FIELD_X + FIELD_W : FIELD_X;
        const exitY = FIELD_Y + Math.max(0, Math.min(FIELD_H, exitBall.y + ballSize / 2));

        FX.burst(exitX, exitY, {
            count: 42, speed: 10, life: 48, gravity: 0.18, angle: scorer === 'p1' ? Math.PI : 0, spread: Math.PI * 1.1,
            colors: [color, '#ffffff', '#ffd447']
        });
        FX.sprite(exitX, exitY, Assets.manifest.fx.ring, { frameTime: 4, scale: 6 });
        const side = scorer === 'p1' ? FIELD_X + 160 : FIELD_X + FIELD_W - 160;
        FX.confetti(side, FIELD_Y + 40, 36);
        FX.shake(8, 350);
        FX.flash(color, 0.22);

        this.anim[scorer].cheerUntil = now + 1500;
        this.anim[loser].sadUntil = now + 1500;
        const lp = loser === 'p1' ? p1 : p2;
        FX.sprite(FIELD_X + lp.x + paddleWidth / 2 + 18, FIELD_Y + lp.y - 2, Assets.manifest.fx.drop, { frameTime: 30, vy: 0.4 });
        const sp = scorer === 'p1' ? p1 : p2;
        FX.sprite(FIELD_X + sp.x + paddleWidth / 2, FIELD_Y + sp.y - 14, Assets.manifest.fx.heart, { frameTime: 45, vy: -0.6 });

        this.scorePop[scorer] = now + 400;
        this.crowdCheerUntil = now + 1800;
        this.rally = 0;

        let sub = scorer === 'p1' ? 'JOGADOR 1' : 'JOGADOR 2';
        if (mode === 'game') sub = scorer === myRole ? 'SEU PONTO!' : 'PONTO DO OPONENTE';
        this.banner = { text: 'PONTO!', sub, color, start: now, dur: POINT_BANNER_MS };

        if (mode === 'game' && p1.score < maxPoints && p2.score < maxPoints) this.startCountdown(POINT_BANNER_MS);

        if (!this.silent) Sound.play('crowd', { volume: 0.6 });
    },

    setWinner(role) {
        this.winner = role;
        this.crowdCheerUntil = Infinity;
        this.banner = null;
        this.countdown = null;
    },

    update(now) {
        const dx = ball.x - this.lastBall.x, dy = ball.y - this.lastBall.y;
        const dist = Math.hypot(dx, dy);
        const jumped = dist > 150;

        if (p1.score > this.lastScore.p1) this.onPoint('p1', this.lastBall);
        else if (p2.score > this.lastScore.p2) this.onPoint('p2', this.lastBall);
        this.syncScores();

        if (jumped) {
            this.trail.length = 0;
        } else {
            this.ballSpin += dist / 7;
            this.ballSpeed = this.ballSpeed * 0.7 + dist * 0.3;
        }
        this.trail.push({ x: ball.x, y: ball.y });
        if (this.trail.length > 9) this.trail.shift();
        this.lastBall = { x: ball.x, y: ball.y };

        if (this.ballSpeed > FAST_BALL && !jumped && dist > 0.5) {
            const bx = FIELD_X + ball.x + ballSize / 2, by = FIELD_Y + ball.y + ballSize / 2;
            for (let i = 0; i < 2; i++) {
                FX.add({
                    x: bx - dx * Math.random(), y: by - dy * Math.random() + (Math.random() - 0.5) * 12,
                    vx: -dx * 0.08, vy: -0.6 - Math.random(), life: 16, max: 16, size: PX * 2,
                    color: ['#fff27a', '#ffb347', '#ff5a3a', '#ff2f45'][Math.floor(Math.random() * 4)]
                });
            }
        }

        for (const side of ['p1', 'p2']) {
            const p = side === 'p1' ? p1 : p2;
            const a = this.anim[side];
            if (a.lastY !== null && Math.abs(p.y - a.lastY) > 0.5) {
                a.movingUntil = now + 100;
                if (++a.stepTimer % 9 === 0) {
                    FX.add({
                        x: FIELD_X + p.x + paddleWidth / 2 + (Math.random() - 0.5) * 18,
                        y: FIELD_Y + p.y + paddleHeight + 1, vx: (Math.random() - 0.5) * 1.2, vy: -0.5,
                        life: 18, max: 18, size: PX * 2, color: DUST_COLORS[this.arena.id][0]
                    });
                }
            }
            a.lastY = p.y;
        }

        const flashChance = (now < this.crowdCheerUntil ? 0.35 : 0.03) * (this.arena.night ? 1.6 : 1);
        if (Math.random() < flashChance) {
            const top = Math.random() < 0.6;
            this.camFlashes.push({
                x: top ? 8 + Math.random() * 940 : (Math.random() < 0.5 ? 4 + Math.random() * 52 : 900 + Math.random() * 52),
                y: top ? 4 + Math.random() * 36 : 48 + Math.random() * 540,
                life: 4
            });
        }
        this.camFlashes = this.camFlashes.filter(f => --f.life > 0);

        if (this.countdown) {
            const step = this.countdownStep(now);
            if (step !== this.countdown.lastStep && step >= 0) {
                this.countdown.lastStep = step;
                if (!this.silent) Sound.play(step === 3 ? 'go' : 'count');
            }
            if (step < 0 && now - this.countdown.start > COUNTDOWN_STEP_MS * 4) this.countdown = null;
        }

        if (this.winner && now > this.nextConfetti) {
            this.nextConfetti = now + 350;
            FX.confetti(FIELD_X + Math.random() * FIELD_W, FIELD_Y - 10, 14);
        }

        FX.update();
    },

    draw(ctx, now) {
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = '#100c24';
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        if (!this.arena) return;

        const [sx, sy] = FX.shakeOffset();
        ctx.save();
        ctx.translate(sx, sy);

        ctx.drawImage(Assets.img('arena_' + this.arena.id), 0, 0, VIEW_W, VIEW_H);
        if (this.arena.clouds) this.drawClouds(ctx, now);
        this.drawCrowd(ctx, now);

        this.drawPlayerGround(ctx, p1, 'p1');
        this.drawPlayerGround(ctx, p2, 'p2');
        this.drawBallShadow(ctx);

        const order = p1.y <= p2.y ? [[p1, 'p1'], [p2, 'p2']] : [[p2, 'p2'], [p1, 'p1']];
        for (const [p, side] of order) this.drawPlayer(ctx, p, side, now);

        this.drawTrail(ctx);
        Assets.drawBall(ctx, Math.floor(this.ballSpin), FIELD_X + ball.x, FIELD_Y + ball.y, SPRITE_SCALE);

        FX.draw(ctx);
        if (this.arena.night) this.drawNightLights(ctx, now);
        ctx.restore();

        FX.drawFlash(ctx, VIEW_W, VIEW_H);
        if (this.showHud) this.drawHud(ctx, now);
        this.drawCountdown(ctx, now);
        this.drawBanner(ctx, now);
    },

    drawClouds(ctx, now) {
        const img = Assets.img('clouds');
        if (!img) return;
        const w = img.width * WORLD_SCALE, h = img.height * WORLD_SCALE;
        const off = (now * 0.012) % w;
        ctx.save();
        ctx.beginPath();
        ctx.rect(FIELD_X - 16, FIELD_Y - 36, FIELD_W + 32, FIELD_H + 56);
        ctx.clip();
        ctx.globalAlpha = 0.1;
        for (let i = -1; i <= 1; i++) ctx.drawImage(img, FIELD_X + off + i * w - 40, FIELD_Y - 20, w, h);
        ctx.restore();
    },

    drawCrowd(ctx, now) {
        const img = Assets.img('crowd');
        if (!img) return;
        const m = Assets.manifest.crowd;
        const cheering = now < this.crowdCheerUntil;
        const frame = cheering ? (Math.floor(now / 160) % 2 ? 2 : 0) : (Math.floor(now / 700) % 2);
        ctx.drawImage(img, frame * m.w, 0, m.w, m.h, 0, 0, VIEW_W, VIEW_H);

        if (this.arena.night) {
            ctx.fillStyle = 'rgba(8, 4, 26, 0.45)';
            ctx.fillRect(0, 0, VIEW_W, 44);
            ctx.fillRect(0, 44, 64, VIEW_H - 44);
            ctx.fillRect(896, 44, 64, VIEW_H - 44);
        }
        for (const f of this.camFlashes) {
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.fillRect(Math.round(f.x / 4) * 4 - 4, Math.round(f.y / 4) * 4 - 4, 12, 12);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(Math.round(f.x / 4) * 4, Math.round(f.y / 4) * 4, 4, 4);
        }
    },

    drawNightLights(ctx, now) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const flicker = 0.9 + Math.sin(now / 90) * 0.03;
        for (const [x, y] of [[26, 14], [934, 14]]) {
            const g = ctx.createRadialGradient(x, y, 10, x, y, 720);
            g.addColorStop(0, `rgba(160, 220, 255, ${0.16 * flicker})`);
            g.addColorStop(0.4, `rgba(110, 120, 255, ${0.06 * flicker})`);
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        }
        const bx = FIELD_X + ball.x + ballSize / 2, by = FIELD_Y + ball.y + ballSize / 2;
        const g = ctx.createRadialGradient(bx, by, 4, bx, by, 60);
        g.addColorStop(0, 'rgba(220, 255, 120, 0.25)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(bx - 60, by - 60, 120, 120);
        ctx.restore();
    },

    drawPlayerGround(ctx, p, side) {
        const cx = Math.round(FIELD_X + p.x + paddleWidth / 2);
        const feet = Math.round(FIELD_Y + p.y + paddleHeight + 3);
        ctx.fillStyle = 'rgba(10, 0, 30, 0.3)';
        ctx.beginPath();
        ctx.rect(cx - 18, feet - 6, 36, 6);
        ctx.rect(cx - 12, feet - 9, 24, 12);
        ctx.fill();
        if (mode !== 'game') return;
        ctx.fillStyle = PLAYER_COLORS[side];
        ctx.globalAlpha = side === myRole ? 0.85 : 0.45;
        const rx = 24, ry = 9;
        const seen = new Set();
        for (let a = 0; a < Math.PI * 2; a += 0.08) {
            const x = Math.round((cx + Math.cos(a) * rx) / 3) * 3;
            const y = Math.round((feet - 3 + Math.sin(a) * ry) / 3) * 3;
            const k = x + ',' + y;
            if (seen.has(k)) continue;
            seen.add(k);
            ctx.fillRect(x - 1, y - 1, 3, 3);
        }
        ctx.globalAlpha = 1;
    },

    drawPlayer(ctx, p, side, now) {
        const a = this.anim[side];
        const cx = FIELD_X + p.x + paddleWidth / 2;
        const feet = FIELD_Y + p.y + paddleHeight + 3;
        const celebrating = this.winner === side;
        const tick = Math.floor(now / 110) % 2;
        let pose = 'idle', dy = 0;
        if (celebrating || now < a.cheerUntil) {
            pose = 'cheer';
            dy = Math.floor(now / 150) % 2 ? -9 : 0;
        } else if (now < a.swingUntil) {
            pose = 'swing';
        } else if (now < a.movingUntil) {
            pose = tick ? 'run1' : 'run2';
            dy = tick ? -3 : 0;
        } else if (now < a.sadUntil || (this.winner && this.winner !== side)) {
            pose = 'idle';
            dy = 3;
        } else {
            pose = (now + (side === 'p2' ? 1700 : 0)) % 3400 < 130 ? 'blink' : 'idle';
            dy = Math.floor(now / 600) % 2 ? -3 : 0;
        }
        Assets.drawCharacter(ctx, p.emoji, pose, cx, feet + dy, SPRITE_SCALE, side === 'p2');

        if (mode === 'game' && side === myRole && now < this.youMarkerUntil) {
            const bob = Math.floor(now / 200) % 2 ? 3 : 0;
            const top = feet - 66 - 30 + bob;
            Assets.text(ctx, 'VOCÊ', cx, top - 18, { scale: 2, color: PLAYER_COLORS[side], align: 'center', outline: '#1a1022' });
            Assets.drawUI(ctx, 'arrow', cx - 10, top, 3);
        }
    },

    drawBallShadow(ctx) {
        const t = Math.max(0, Math.min(1, (ball.x - 70) / (FIELD_W - 140 - ballSize)));
        const h = Math.sin(Math.PI * t);
        const cx = FIELD_X + ball.x + ballSize / 2 + 4 + h * 10;
        const cy = FIELD_Y + ball.y + ballSize - 2 + h * 18;
        const w = Math.round((18 - h * 6) / 3) * 3;
        ctx.fillStyle = 'rgba(10, 0, 30, 0.28)';
        ctx.beginPath();
        ctx.rect(Math.round(cx - w / 2), Math.round(cy - 3), w, 6);
        ctx.rect(Math.round(cx - w / 2 + 3), Math.round(cy - 6), w - 6, 12);
        ctx.fill();
    },

    drawTrail(ctx) {
        const n = this.trail.length;
        if (n < 2) return;
        const fast = this.ballSpeed > FAST_BALL;
        for (let i = 0; i < n - 1; i++) {
            const t = this.trail[i];
            const k = (i + 1) / n;
            const size = Math.max(3, Math.round((ballSize * 0.7 * k) / 3) * 3);
            ctx.globalAlpha = k * (fast ? 0.75 : 0.4);
            ctx.fillStyle = fast ? (k > 0.6 ? '#fff27a' : k > 0.3 ? '#ffb347' : '#ff5a3a') : '#f6ffb0';
            const x = Math.round((FIELD_X + t.x + ballSize / 2 - size / 2) / 3) * 3;
            const y = Math.round((FIELD_Y + t.y + ballSize / 2 - size / 2) / 3) * 3;
            ctx.fillRect(x, y, size, size);
        }
        ctx.globalAlpha = 1;
    },

    drawHud(ctx, now) {
        const ui = Assets.manifest.ui;
        const S = 3;
        const x0 = Math.round(VIEW_W / 2 - (ui.scoreboard[2] * S) / 2), y0 = 4;
        Assets.drawUI(ctx, 'scoreboard', x0, y0, S);
        Assets.drawPortrait(ctx, p1.emoji, x0 + ui.portraitLeft[0] * S, y0 + ui.portraitLeft[1] * S, S);
        Assets.drawPortrait(ctx, p2.emoji, x0 + ui.portraitRight[0] * S, y0 + ui.portraitRight[1] * S, S, true);

        for (const side of ['p1', 'p2']) {
            const p = side === 'p1' ? p1 : p2;
            const led = side === 'p1' ? ui.ledLeft : ui.ledRight;
            const pop = now < this.scorePop[side];
            const scale = pop ? 4 : 3;
            const cx = x0 + (led[0] + led[2] / 2) * S;
            const cy = y0 + (led[1] + led[3] / 2) * S;
            Assets.text(ctx, p.score, cx, Math.round(cy - (7 * scale) / 2), {
                scale, color: pop ? '#ffffff' : PLAYER_COLORS[side], align: 'center', shadow: 'rgba(0,0,0,0.6)'
            });
            const pips = side === 'p1' ? ui.pipsLeft : ui.pipsRight;
            for (let i = 0; i < maxPoints; i++) {
                Assets.drawUI(ctx, i < p.score ? 'pipOn' : 'pipOff', x0 + (pips[0] + i * 4) * S, y0 + pips[1] * S, S);
            }
        }

        if (myRole) {
            const lx = myRole === 'p1' ? x0 + 14 * S : x0 + 90 * S;
            Assets.text(ctx, 'VOCÊ', lx, y0 + 22 * S + 4, { scale: 2, color: PLAYER_COLORS[myRole], align: 'center', outline: '#1a1022' });
        }

        if (this.rally >= 3) {
            const hot = this.rally >= 8;
            const color = hot ? ['#ffd447', '#ffb347', '#ff5a3a'][Math.floor(now / 90) % 3] : '#ffffff';
            Assets.text(ctx, `RALLY x${this.rally}`, VIEW_W / 2, y0 + 22 * S + 6, { scale: 2, color, align: 'center', outline: '#1a1022' });
        }
    },

    drawCountdown(ctx, now) {
        const step = this.countdownStep(now);
        if (step < 0) return;
        const frac = ((now - this.countdown.start) % COUNTDOWN_STEP_MS) / COUNTDOWN_STEP_MS;
        const text = step === 3 ? 'JÁ!' : String(3 - step);
        const scale = frac < 0.12 ? 16 : frac < 0.25 ? 13 : 12;
        const color = step === 3 ? '#4dff9e' : '#ffd447';
        ctx.fillStyle = 'rgba(16, 10, 40, 0.35)';
        ctx.fillRect(0, VIEW_H / 2 - 70, VIEW_W, 140);
        Assets.text(ctx, text, VIEW_W / 2, Math.round(VIEW_H / 2 - (7 * scale) / 2), {
            scale, color, align: 'center', outline: '#1a1022', shadow: '#3a1a6a'
        });
    },

    drawBanner(ctx, now) {
        const b = this.banner;
        if (!b) return;
        const t = (now - b.start) / b.dur;
        if (t >= 1) { this.banner = null; return; }
        const ease = x => 1 - Math.pow(1 - x, 3);
        let offset;
        if (t < 0.18) offset = (1 - ease(t / 0.18)) * -VIEW_W;
        else if (t > 0.82) offset = ease((t - 0.82) / 0.18) * VIEW_W;
        else offset = 0;
        const bandH = 120, y = VIEW_H / 2 - bandH / 2;
        ctx.save();
        ctx.translate(Math.round(offset), 0);
        ctx.fillStyle = 'rgba(16, 10, 40, 0.75)';
        ctx.fillRect(0, y, VIEW_W, bandH);
        ctx.fillStyle = b.color;
        ctx.fillRect(0, y, VIEW_W, 6);
        ctx.fillRect(0, y + bandH - 6, VIEW_W, 6);
        for (let x = (now / 4) % 48 - 48; x < VIEW_W; x += 48) {
            ctx.globalAlpha = 0.12;
            ctx.fillRect(Math.round(x), y + 6, 24, bandH - 12);
        }
        ctx.globalAlpha = 1;
        Assets.text(ctx, b.text, VIEW_W / 2, y + 16, { scale: 9, color: b.color, align: 'center', outline: '#1a1022', shadow: '#000000' });
        Assets.text(ctx, b.sub, VIEW_W / 2, y + 16 + 63 + 14, { scale: 3, color: '#ffffff', align: 'center', outline: '#1a1022' });
        ctx.restore();
    }
};

const Preview = {
    drawPedestal(ctx, cx, y, w, color) {
        ctx.fillStyle = 'rgba(10, 0, 30, 0.35)';
        ctx.fillRect(cx - w / 2, y, w, 8);
        ctx.fillRect(cx - w / 2 + 8, y - 4, w - 16, 16);
        ctx.fillStyle = color;
        ctx.fillRect(cx - w / 2 + 8, y - 8, w - 16, 4);
    },

    menu(canvas, emoji, now) {
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const cx = canvas.width / 2 - 8, feet = canvas.height - 18;
        this.drawPedestal(ctx, cx + 8, feet, 120, Assets.charInfo(emoji).color);
        const t = now % 4000;
        let pose = 'idle', dy = 0;
        if (t < 1600) { pose = t % 1600 > 1450 ? 'blink' : 'idle'; dy = Math.floor(now / 500) % 2 ? -4 : 0; }
        else if (t < 2600) { pose = Math.floor(now / 110) % 2 ? 'run1' : 'run2'; dy = Math.floor(now / 110) % 2 ? -4 : 0; }
        else if (t < 2900) pose = 'swing';
        else { pose = 'cheer'; dy = Math.floor(now / 150) % 2 ? -8 : 0; }
        Assets.drawCharacter(ctx, emoji, pose, cx, feet + dy, 4);
        if (t >= 2600 && t < 3300) {
            const k = (t - 2600) / 700;
            Assets.drawBall(ctx, Math.floor(now / 40), cx + 60 + k * 60, feet - 70 - Math.sin(k * Math.PI) * 30, 3);
        }
    },

    waiting(canvas, emoji, now) {
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const cx = canvas.width / 2, feet = canvas.height - 10;
        const tick = Math.floor(now / 110) % 2;
        ctx.fillStyle = 'rgba(10, 0, 30, 0.35)';
        ctx.fillRect(cx - 27, feet - 6, 54, 9);
        Assets.drawCharacter(ctx, emoji, tick ? 'run1' : 'run2', cx, feet + (tick ? -4 : 0), 4);
        const k = (now % 700) / 700;
        const by = feet - 100 - Math.sin(k * Math.PI) * 50;
        Assets.drawBall(ctx, Math.floor(now / 50), cx + 30, by, 3);
    },

    winner(canvas, emoji, now) {
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const cx = canvas.width / 2 - 8, feet = canvas.height - 18;
        this.drawPedestal(ctx, cx + 8, feet, 120, '#ffd447');
        Assets.drawCharacter(ctx, emoji, 'cheer', cx, feet + (Math.floor(now / 150) % 2 ? -10 : 0), 4);
    }
};
