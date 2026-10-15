// Carregamento dos assets gerados por tools/generate-assets.js e helpers de desenho
const Assets = {
    manifest: null,
    images: {},
    ready: false,
    _tinted: {},

    async load(onProgress) {
        const res = await fetch('assets/manifest.json');
        this.manifest = await res.json();
        const entries = Object.entries(this.manifest.images);
        let done = 0;
        await Promise.all(entries.map(([key, file]) => new Promise(resolve => {
            const img = new Image();
            img.onload = () => { this.images[key] = img; done++; onProgress && onProgress(done / entries.length); resolve(); };
            img.onerror = () => { done++; resolve(); };
            img.src = 'assets/' + file;
        })));
        this.ready = true;
    },

    img(key) { return this.images[key]; },

    charIndex(emoji) {
        const i = this.manifest.characters.list.findIndex(c => c.emoji === emoji);
        return i < 0 ? 0 : i;
    },
    charInfo(emoji) { return this.manifest.characters.list[this.charIndex(emoji)]; },

    // desenha o personagem com os pés em (x, feetY); flip espelha para olhar à esquerda
    drawCharacter(ctx, emoji, pose, x, feetY, scale = 3, flip = false) {
        const m = this.manifest.characters;
        const img = this.images.characters;
        if (!img) return;
        const col = m.frames[pose] ?? 0;
        const row = this.charIndex(emoji);
        ctx.save();
        ctx.translate(Math.round(x), Math.round(feetY));
        if (flip) ctx.scale(-1, 1);
        ctx.drawImage(img, col * m.frameW, row * m.frameH, m.frameW, m.frameH,
            -m.anchorX * scale, -m.feetY * scale, m.frameW * scale, m.frameH * scale);
        ctx.restore();
    },

    drawPortrait(ctx, emoji, x, y, scale = 3, flip = false) {
        const p = this.manifest.portraits;
        const img = this.images.portraits;
        if (!img) return;
        const i = this.charIndex(emoji);
        ctx.save();
        ctx.translate(Math.round(x), Math.round(y));
        if (flip) { ctx.translate(p.w * scale, 0); ctx.scale(-1, 1); }
        ctx.drawImage(img, i * p.w, 0, p.w, p.h, 0, 0, p.w * scale, p.h * scale);
        ctx.restore();
    },

    drawBall(ctx, frame, x, y, scale = 3, big = false) {
        const m = big ? this.manifest.ballBig : this.manifest.ball;
        const img = this.images[big ? 'ballBig' : 'ball'];
        if (!img) return;
        const f = ((frame % m.frames) + m.frames) % m.frames;
        ctx.drawImage(img, f * m.size, 0, m.size, m.size, Math.round(x), Math.round(y), m.size * scale, m.size * scale);
    },

    // desenha um frame da folha de efeitos centralizado em (x, y)
    drawFx(ctx, frame, x, y, scale = 3, flip = false) {
        const s = this.manifest.fx.size;
        const img = this.images.fx;
        if (!img) return;
        ctx.save();
        ctx.translate(Math.round(x), Math.round(y));
        if (flip) ctx.scale(-1, 1);
        ctx.drawImage(img, frame * s, 0, s, s, -s * scale / 2, -s * scale / 2, s * scale, s * scale);
        ctx.restore();
    },

    drawUI(ctx, key, x, y, scale = 3) {
        const r = this.manifest.ui[key];
        const img = this.images.ui;
        if (!img || !r) return;
        ctx.drawImage(img, r[0], r[1], r[2], r[3], Math.round(x), Math.round(y), r[2] * scale, r[3] * scale);
    },

    // ---- texto com a fonte bitmap ----
    _fontFor(color) {
        if (this._tinted[color]) return this._tinted[color];
        const src = this.images.font;
        const c = document.createElement('canvas');
        c.width = src.width;
        c.height = src.height;
        const g = c.getContext('2d');
        g.drawImage(src, 0, 0);
        g.globalCompositeOperation = 'source-in';
        g.fillStyle = color;
        g.fillRect(0, 0, c.width, c.height);
        this._tinted[color] = c;
        return c;
    },

    textWidth(text, scale = 3) {
        const f = this.manifest.font;
        return [...String(text)].length * f.cellW * scale - scale;
    },

    // opts: scale, color, align ('left'|'center'|'right'), outline (cor), shadow (cor)
    text(ctx, text, x, y, opts = {}) {
        if (!this.images.font) return;
        const f = this.manifest.font;
        const scale = opts.scale || 3;
        const str = String(text).toUpperCase();
        const w = this.textWidth(str, scale);
        let x0 = x;
        if (opts.align === 'center') x0 = x - w / 2;
        else if (opts.align === 'right') x0 = x - w;
        x0 = Math.round(x0);
        // y é o topo da letra maiúscula (sem acento)
        const y0 = Math.round(y - f.top * scale);
        const draw = (color, dx, dy) => {
            const sheet = this._fontFor(color);
            [...str].forEach((ch, i) => {
                let idx = f.chars.indexOf(ch);
                if (idx < 0) idx = f.chars.indexOf(' ');
                ctx.drawImage(sheet, idx * f.cellW, 0, f.cellW, f.cellH,
                    x0 + i * f.cellW * scale + dx, y0 + dy, f.cellW * scale, f.cellH * scale);
            });
        };
        if (opts.shadow) draw(opts.shadow, 0, scale * 2);
        if (opts.outline) {
            for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
                draw(opts.outline, dx * scale, dy * scale);
            }
        }
        draw(opts.color || '#ffffff', 0, 0);
        return w;
    }
};
