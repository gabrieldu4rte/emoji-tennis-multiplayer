const PX = 3;

const FX = {
    particles: [],
    sprites: [],
    popups: [],
    shakeMag: 0,
    shakeUntil: 0,
    flashAlpha: 0,
    flashColor: '#ffffff',

    clear() {
        this.particles.length = 0;
        this.sprites.length = 0;
        this.popups.length = 0;
        this.shakeMag = 0;
        this.flashAlpha = 0;
    },

    shake(mag, ms) {
        const now = performance.now();
        if (mag >= this.shakeMag || now > this.shakeUntil) {
            this.shakeMag = mag;
            this.shakeUntil = now + ms;
            this.shakeDur = ms;
        }
    },

    shakeOffset() {
        const now = performance.now();
        if (now > this.shakeUntil) return [0, 0];
        const m = this.shakeMag * ((this.shakeUntil - now) / this.shakeDur);
        return [Math.round((Math.random() - 0.5) * 2 * m), Math.round((Math.random() - 0.5) * 2 * m)];
    },

    flash(color = '#ffffff', alpha = 0.35) {
        this.flashColor = color;
        this.flashAlpha = alpha;
    },

    add(p) {
        this.particles.push(Object.assign({
            x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0.98, life: 30, max: 30,
            size: PX, color: '#ffffff', shrink: true, layer: 'top'
        }, p));
    },

    burst(x, y, { count = 12, colors = ['#ffffff'], speed = 4, life = 30, gravity = 0.15, size = PX, spread = Math.PI * 2, angle = 0, drag = 0.96 } = {}) {
        for (let i = 0; i < count; i++) {
            const a = angle + (Math.random() - 0.5) * spread;
            const s = speed * (0.35 + Math.random() * 0.65);
            const l = life * (0.6 + Math.random() * 0.4);
            this.add({
                x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: gravity, life: l, max: l, drag,
                size: size * (Math.random() < 0.3 ? 2 : 1),
                color: colors[Math.floor(Math.random() * colors.length)]
            });
        }
    },

    confetti(x, y, count = 40, colors) {
        const pal = colors || ['#ff4f7b', '#4dff9e', '#5fc8ff', '#ffd447', '#b46bff', '#ffffff'];
        for (let i = 0; i < count; i++) {
            const l = 70 + Math.random() * 60;
            this.add({
                x: x + (Math.random() - 0.5) * 40, y,
                vx: (Math.random() - 0.5) * 8, vy: -4 - Math.random() * 7,
                g: 0.18, drag: 0.985, life: l, max: l, shrink: false,
                size: PX * (Math.random() < 0.5 ? 1 : 2),
                color: pal[Math.floor(Math.random() * pal.length)],
                wobble: Math.random() * Math.PI * 2
            });
        }
    },

    sprite(x, y, frames, { frameTime = 4, scale = 3, flip = false, vy = 0 } = {}) {
        this.sprites.push({ x, y, frames: Array.isArray(frames) ? frames : [frames], t: 0, frameTime, scale, flip, vy });
    },

    popup(text, x, y, { color = '#ffffff', scale = 3, life = 50, vy = -1.2 } = {}) {
        this.popups.push({ text, x, y, color, scale, life, max: life, vy });
    },

    update() {
        for (const p of this.particles) {
            p.vx *= p.drag;
            p.vy = p.vy * p.drag + p.g;
            p.x += p.vx + (p.wobble !== undefined ? Math.sin((p.wobble += 0.2)) * 0.8 : 0);
            p.y += p.vy;
            p.life--;
        }
        this.particles = this.particles.filter(p => p.life > 0);
        for (const s of this.sprites) { s.t++; s.y += s.vy; }
        this.sprites = this.sprites.filter(s => s.t < s.frames.length * s.frameTime);
        for (const p of this.popups) { p.y += p.vy; p.vy *= 0.95; p.life--; }
        this.popups = this.popups.filter(p => p.life > 0);
        this.flashAlpha = Math.max(0, this.flashAlpha - 0.03);
    },

    draw(ctx) {
        for (const p of this.particles) {
            const t = p.life / p.max;
            const size = p.shrink ? Math.max(PX, Math.round((p.size * t) / PX) * PX) : p.size;
            ctx.globalAlpha = p.shrink ? 1 : Math.min(1, t * 3);
            ctx.fillStyle = p.color;
            ctx.fillRect(Math.round(p.x / PX) * PX, Math.round(p.y / PX) * PX, size, size);
        }
        ctx.globalAlpha = 1;
        for (const s of this.sprites) {
            const f = s.frames[Math.min(s.frames.length - 1, Math.floor(s.t / s.frameTime))];
            Assets.drawFx(ctx, f, s.x, s.y, s.scale, s.flip);
        }
        for (const p of this.popups) {
            ctx.globalAlpha = Math.min(1, (p.life / p.max) * 3);
            Assets.text(ctx, p.text, p.x, p.y, { scale: p.scale, color: p.color, align: 'center', outline: '#1a1022' });
        }
        ctx.globalAlpha = 1;
    },

    drawFlash(ctx, w, h) {
        if (this.flashAlpha <= 0) return;
        ctx.globalAlpha = this.flashAlpha;
        ctx.fillStyle = this.flashColor;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
    }
};
