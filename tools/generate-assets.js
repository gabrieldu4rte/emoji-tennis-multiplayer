'use strict';
/*
 * Gerador procedural de todos os assets do jogo: sprites em pixel art,
 * cenários, fonte bitmap, efeitos, interface e áudio (SFX + música chiptune).
 *
 * Não usa nenhuma dependência externa: os PNGs e WAVs são codificados aqui
 * mesmo. A saída vai para public/assets/ e é versionada, então o deploy
 * (Render) não precisa rodar este script. Para regenerar: `npm run assets`.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public', 'assets');

// ---------------------------------------------------------------------------
// Utilidades de cor e RNG
// ---------------------------------------------------------------------------
function hex(h, a = 255) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}
function mix(c1, c2, t) {
    return [
        Math.round(c1[0] + (c2[0] - c1[0]) * t),
        Math.round(c1[1] + (c2[1] - c1[1]) * t),
        Math.round(c1[2] + (c2[2] - c1[2]) * t),
        c1[3] === undefined ? 255 : c1[3]
    ];
}
const SHADOW_TINT = hex('#2a1450');
const LIGHT_TINT = hex('#fff6d8');
const darken = (c, t) => mix(c, SHADOW_TINT, t);
const lighten = (c, t) => mix(c, LIGHT_TINT, t);
const INK = hex('#1a1022');

function rng(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------------------------------------------------------------------------
// Imagem RGBA mínima
// ---------------------------------------------------------------------------
class Img {
    constructor(w, h) {
        this.w = w;
        this.h = h;
        this.data = new Uint8ClampedArray(w * h * 4);
    }
    inside(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
    get(x, y) {
        if (!this.inside(x, y)) return [0, 0, 0, 0];
        const i = (y * this.w + x) * 4, d = this.data;
        return [d[i], d[i + 1], d[i + 2], d[i + 3]];
    }
    a(x, y) { return this.inside(x, y) ? this.data[(y * this.w + x) * 4 + 3] : 0; }
    put(x, y, c) {
        x = Math.floor(x); y = Math.floor(y);
        if (!c || !this.inside(x, y)) return;
        const i = (y * this.w + x) * 4, d = this.data;
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3] === undefined ? 255 : c[3];
    }
    // desenha com alpha blending
    set(x, y, c) {
        x = Math.floor(x); y = Math.floor(y);
        if (!c || !this.inside(x, y)) return;
        const sa = (c[3] === undefined ? 255 : c[3]) / 255;
        if (sa >= 1) return this.put(x, y, c);
        if (sa <= 0) return;
        const i = (y * this.w + x) * 4, d = this.data;
        const da = d[i + 3] / 255;
        const oa = sa + da * (1 - sa);
        for (let k = 0; k < 3; k++) d[i + k] = (c[k] * sa + d[i + k] * da * (1 - sa)) / oa;
        d[i + 3] = oa * 255;
    }
    rect(x, y, w, h, c) {
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
    }
    pixels(list, c) { for (const [x, y] of list) this.set(x, y, c); }
    blit(src, dx, dy, o = {}) {
        const sx = o.sx || 0, sy = o.sy || 0;
        const sw = o.sw || src.w, sh = o.sh || src.h, s = o.scale || 1;
        for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) {
            const c = src.get(sx + i, sy + j);
            if (c[3] === 0) continue;
            const tx = o.flip ? dx + (sw - 1 - i) * s : dx + i * s;
            for (let v = 0; v < s; v++) for (let u = 0; u < s; u++) this.set(tx + u, dy + j * s + v, c);
        }
    }
    clone() {
        const o = new Img(this.w, this.h);
        o.data.set(this.data);
        return o;
    }
}

// contorno de 1px ao redor de todos os pixels opacos
function outline(img, color = INK, diagonal = false) {
    const src = img.clone();
    const dirs = diagonal
        ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
        : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
        if (src.a(x, y) > 0) continue;
        if (dirs.some(([dx, dy]) => src.a(x + dx, y + dy) > 128)) img.put(x, y, color);
    }
}

// sombreamento procedural: borda inferior/direita mais escura, superior/esquerda mais clara
function autoShade(img, amount = 0.3) {
    const src = img.clone();
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
        if (src.a(x, y) === 0) continue;
        const c = src.get(x, y);
        if (src.a(x + 1, y) === 0 || src.a(x, y + 1) === 0) img.put(x, y, darken(c, amount));
        else if (src.a(x - 1, y) === 0 || src.a(x, y - 1) === 0) img.put(x, y, lighten(c, amount * 0.6));
    }
}

function ellipse(img, cx, cy, rx, ry, fn) {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
        for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
            const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
            const d = dx * dx + dy * dy;
            if (d <= 1) fn(x, y, d);
        }
    }
}

// ---------------------------------------------------------------------------
// Codificador PNG (RGBA 8 bits, filtro 0)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();
function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}
function encodePNG(img) {
    const stride = img.w * 4 + 1;
    const raw = Buffer.alloc(stride * img.h);
    for (let y = 0; y < img.h; y++) {
        raw[y * stride] = 0;
        Buffer.from(img.data.buffer, y * img.w * 4, img.w * 4).copy(raw, y * stride + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(img.w, 0);
    ihdr.writeUInt32BE(img.h, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        pngChunk('IEND', Buffer.alloc(0))
    ]);
}
function savePNG(name, img) {
    fs.writeFileSync(path.join(OUT, name), encodePNG(img));
    console.log(`  ${name.padEnd(22)} ${img.w}x${img.h}`);
}

// ---------------------------------------------------------------------------
// Fonte bitmap 5x7 (com espaço para acentos e cedilha)
// ---------------------------------------------------------------------------
const GLYPHS = {
    '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
    '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
    '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
    '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
    '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
    '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
    '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
    'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'B': ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
    'C': ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
    'D': ['###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..'],
    'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    'F': ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    'G': ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
    'H': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'I': ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    'J': ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
    'K': ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
    'L': ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    'M': ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    'N': ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
    'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'P': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    'Q': ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
    'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    'S': ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    'U': ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'V': ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
    'W': ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
    'X': ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    'Y': ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
    'Z': ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
    '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
    '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
    ':': ['.....', '..#..', '..#..', '.....', '..#..', '..#..', '.....'],
    '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
    '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
    ',': ['.....', '.....', '.....', '.....', '.##..', '..#..', '.#...'],
    '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
    '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
    "'": ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....'],
    '#': ['.#.#.', '#####', '.#.#.', '.#.#.', '.#.#.', '#####', '.#.#.'],
    'x': ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
    ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....']
};
const ACCENTS = {
    acute: ['...#.', '..#..'],
    grave: ['.#...', '..#..'],
    circ: ['..#..', '.#.#.'],
    tilde: ['.##.#', '#..#.']
};
const ACCENTED = {
    'Á': ['A', 'acute'], 'À': ['A', 'grave'], 'Â': ['A', 'circ'], 'Ã': ['A', 'tilde'],
    'É': ['E', 'acute'], 'Ê': ['E', 'circ'], 'Í': ['I', 'acute'],
    'Ó': ['O', 'acute'], 'Ô': ['O', 'circ'], 'Õ': ['O', 'tilde'], 'Ú': ['U', 'acute'],
    'Ç': ['C', 'cedilla']
};
const FONT_CHARS = Object.keys(GLYPHS).join('') + Object.keys(ACCENTED).join('');
const FONT_CELL_W = 6, FONT_CELL_H = 10, FONT_TOP = 2;

function glyphRows(ch) {
    // retorna 10 linhas (2 de acento + 7 de glifo + 1 de descendente)
    const rows = Array(FONT_CELL_H).fill('.....');
    let base = GLYPHS[ch], accent = null, cedilla = false;
    if (!base && ACCENTED[ch]) {
        base = GLYPHS[ACCENTED[ch][0]];
        if (ACCENTED[ch][1] === 'cedilla') cedilla = true;
        else accent = ACCENTS[ACCENTED[ch][1]];
    }
    base.forEach((r, i) => { rows[FONT_TOP + i] = r; });
    if (accent) { rows[0] = accent[0]; rows[1] = accent[1]; }
    if (cedilla) rows[9] = '..##.';
    return rows;
}

function buildFont() {
    const img = new Img(FONT_CHARS.length * FONT_CELL_W, FONT_CELL_H);
    const white = hex('#ffffff');
    [...FONT_CHARS].forEach((ch, i) => {
        glyphRows(ch).forEach((row, y) => {
            [...row].forEach((p, x) => { if (p === '#') img.put(i * FONT_CELL_W + x, y, white); });
        });
    });
    return img;
}

// desenha texto com a fonte bitmap dentro de uma imagem (usado em logo/placas)
function textMask(text, scale = 1) {
    const chars = [...text];
    const w = chars.length * FONT_CELL_W * scale - scale;
    const mask = new Img(Math.max(1, w), FONT_CELL_H * scale);
    const white = hex('#ffffff');
    chars.forEach((ch, i) => {
        glyphRows(GLYPHS[ch] || ACCENTED[ch] ? ch : ' ').forEach((row, y) => {
            [...row].forEach((p, x) => {
                if (p !== '#') return;
                mask.rect((i * FONT_CELL_W + x) * scale, y * scale, scale, scale, white);
            });
        });
    });
    return mask;
}
function drawText(img, text, x, y, color, scale = 1) {
    const m = textMask(text, scale);
    for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
        if (m.a(i, j)) img.set(x + i, y + j - FONT_TOP * scale, color);
    }
    return m.w;
}
const textWidth = (text, scale = 1) => [...text].length * FONT_CELL_W * scale - scale;

// ---------------------------------------------------------------------------
// Personagens
// ---------------------------------------------------------------------------
const CHAR_W = 28, CHAR_H = 23;
const CHAR_ANCHOR_X = 12, CHAR_FEET_Y = 20;
const POSES = ['idle', 'blink', 'run1', 'run2', 'swing', 'cheer'];

// Cabeças 12x10. Letras são chaves da paleta do personagem; '.' é transparente.
// E = olho que pisca, F = olho escuro que não pisca, w = branco, N = nariz, M = boca
const CHARACTERS = [
    {
        emoji: '🦊', id: 'fox', name: 'Raposa', shirt: '#3b7bff', shorts: '#f4f4ff', racket: '#ff3b5c',
        pal: { A: '#f07b2a', a: '#c2561a', B: '#fff3dc', C: '#5a2a3a' },
        head: [
            '.A........A.',
            '.AA......AA.',
            '.ACA....ACA.',
            '.AAAAAAAAAA.',
            'AAAAAAAAAAAA',
            'AAEAAAAAAEAA',
            'AAEAAAAAAEAA',
            'BBBBBNNBBBBB',
            '.BBBBBBBBBB.',
            '...BBBBBB...'
        ]
    },
    {
        emoji: '🤖', id: 'robot', name: 'Robô', shirt: '#ff4d6d', shorts: '#2a3448', racket: '#45d0ff',
        shoes: '#4a5468',
        pal: { A: '#aab6c6', a: '#7c889c', B: '#2a3448', D: '#5ff0ff', C: '#ff4757', N: '#d8e2ee' },
        head: [
            '.....CC.....',
            '......a.....',
            '.AAAAAAAAAA.',
            'AABBBBBBBBAA',
            'aBBDDBBDDBBa',
            'aBBDDBBDDBBa',
            'ABBBBBBBBBBA',
            'ABBBNNNNBBBA',
            'AABBBBBBBBAA',
            '.aaaaaaaaaa.'
        ]
    },
    {
        emoji: '🦁', id: 'lion', name: 'Leão', shirt: '#7a4cff', shorts: '#ffffff', racket: '#ffd447',
        pal: { A: '#f7c24a', a: '#d99a2a', B: '#fff1c4', C: '#c8601e', D: '#e88a2c', N: '#5a2a1a' },
        head: [
            '..CDCDCDCC..',
            '.CDCCDCCDCC.',
            'CDAAAAAAAADC',
            'CCAEAAAAEACC',
            'DCAEAAAAEACD',
            'CCAABNNBAACC',
            'DCABBBBBBACD',
            'CCCABBBBACCC',
            '.CDCAAAACDC.',
            '..CCDCCDCC..'
        ]
    },
    {
        emoji: '🐸', id: 'frog', name: 'Sapo', shirt: '#ffd23a', shorts: '#2a5a2a', racket: '#ff5aa8',
        pal: { A: '#62c94e', a: '#3f9a38', B: '#d8f5a8', C: '#e8536b', N: '#2a5a2a' },
        head: [
            '.aAa....aAa.',
            'AwEEA..AwEEA',
            'AwEEAAAAwEEA',
            'AAAAAAAAAAAA',
            'AAAAAAAAAAAA',
            'AAAANAANAAAA',
            'CAAAAAAAAAAC',
            'aCCCCCCCCCCa',
            '.aBBBBBBBBa.',
            '..aaaaaaaa..'
        ]
    },
    {
        emoji: '👽', id: 'alien', name: 'Alien', shirt: '#ff7a2f', shorts: '#2b2b3d', racket: '#b46bff',
        pal: { A: '#9ee870', a: '#6cbf4f' },
        head: [
            '..AAAAAAAA..',
            '.AAAAAAAAAA.',
            'AAAAAAAAAAAA',
            'AFFFAAAAFFFA',
            'AFwFFAAFFwFA',
            'AAFFFAAFFFAA',
            '.AAFAAAAFAA.',
            '..AAAAAAAA..',
            '...AAMMAA...',
            '....aaaa....'
        ]
    },
    {
        emoji: '👻', id: 'ghost', name: 'Fantasma', shirt: '#35c8ff', shorts: '#35c8ff', racket: '#ff7a2f',
        ghost: true,
        pal: { A: '#f6f6ff', a: '#cdd0ee', C: '#ff9ec0', E: '#2a2440', M: '#3a2040' },
        head: [
            '...AAAAAA...',
            '..AAAAAAAA..',
            '.AAAAAAAAAA.',
            '.AAEAAAAEAA.',
            '.AAEAAAAEAA.',
            '.ACAAMMAACA.',
            '.AAAACCAAAA.',
            '.AAAAAAAAAA.',
            '.AAAAAAAAAA.',
            '.AAAAAAAAAA.'
        ]
    },
    {
        emoji: '💀', id: 'skull', name: 'Caveira', shirt: '#3d2f6a', shorts: '#1a1422', racket: '#4dff9e',
        pal: { A: '#f2eedf', a: '#c4bea8' },
        head: [
            '..AAAAAAAA..',
            '.AAAAAAAAAA.',
            'AAAAAAAAAAAA',
            'AFFFAAAAFFFA',
            'AFFFAAAAFFFA',
            'AAFAAAAAAFAA',
            '.AAAAFFAAAA.',
            '..aAAAAAAa..',
            '..AaAaAaAa..',
            '...aaaaaa...'
        ]
    },
    {
        emoji: '🤡', id: 'clown', name: 'Palhaço', shirt: '#ffe23a', shorts: '#ff2f45', racket: '#47b6ff',
        pal: { A: '#fff7ef', a: '#e8d8cc', C: '#ff2f45', D: '#ff9a1f', B: '#47b6ff' },
        head: [
            'DDD.AAAA.DDD',
            'DDDAAAAAADDD',
            'DDAAAAAAAADD',
            '.AABAAAABAA.',
            '.AAEAAAAEAA.',
            '.AAEACCAEAA.',
            '.AAAACCAAAA.',
            '.ACAAAAAACA.',
            '..ACCCCCCA..',
            '...AAAAAA...'
        ]
    },
    {
        emoji: '🐼', id: 'panda', name: 'Panda', shirt: '#2fd07a', shorts: '#25222c', racket: '#ff3b5c',
        limb: '#25222c',
        pal: { A: '#f7f7fa', a: '#cfd1dc', C: '#25222c', N: '#25222c' },
        head: [
            'CC........CC',
            'CCCAAAAAACCC',
            '.CAAAAAAAAC.',
            'AAAAAAAAAAAA',
            'ACCAAAAAACCA',
            'ACwCAAAACwCA',
            'ACCCAAAACCCA',
            'AAAAANNAAAAA',
            '.AAAAMMAAAA.',
            '..AAAAAAAA..'
        ]
    },
    {
        emoji: '🐱', id: 'cat', name: 'Gato', shirt: '#ff5aa8', shorts: '#ffffff', racket: '#3b7bff',
        pal: { A: '#ffc94a', a: '#e3a032', B: '#fff1c8', C: '#ff8fb0', N: '#ff6a98' },
        head: [
            'A..........A',
            'AA........AA',
            'ACA......ACA',
            'AAAaAaaAaAAA',
            'AAAAAAAAAAAA',
            'AAEAAAAAAEAA',
            'AAEAAAAAAEAA',
            'aAAABNNBAAAa',
            '.AAABBBBAAA.',
            '..AAAAAAAA..'
        ]
    },
    {
        emoji: '🦖', id: 'dino', name: 'Dino', shirt: '#ff8a2a', shorts: '#2a3448', racket: '#ffd447',
        pal: { A: '#55c46c', a: '#358a4a', B: '#d6f0a4', M: '#7a1c2c' },
        head: [
            '....AAAAAA..',
            '...AAAAAAAA.',
            '..aAAAAAEAAA',
            '.aAAAAAAEAAA',
            '.AAAAAAAAAAA',
            '.AAAAAAAAAAa',
            '.AAAAwMwMwM.',
            '.AAAABBBBBB.',
            '..aAAABBBa..',
            '...aAAAAa...'
        ]
    },
    {
        emoji: '🦄', id: 'unicorn', name: 'Unicórnio', shirt: '#9b5cff', shorts: '#ffd447', racket: '#ff74c8',
        pal: { A: '#fff4fb', a: '#e6d2ec', C: '#ffd447', D: '#ff74c8', G: '#8f7bff', N: '#c48aa8' },
        head: [
            '........C...',
            '.DG....CC...',
            'DGDAAAACAA..',
            'GDAAAAAAAAA.',
            'DGAAAAAEAAA.',
            'GDAAAAAEAAAA',
            'DGAAAAAAAAAA',
            'GDAAAAAAAANa',
            '.DAAAAAAAAa.',
            '..DAAAAAAa..'
        ]
    }
];

const DEFAULT_PAL = {
    E: '#1d1426', F: '#141020', w: '#ffffff', N: '#1d1426', M: '#6a1c2a'
};

function charPalette(ch) {
    const p = {};
    for (const [k, v] of Object.entries({ ...DEFAULT_PAL, ...ch.pal })) p[k] = hex(v);
    p.shirt = hex(ch.shirt);
    p.shirtLight = lighten(p.shirt, 0.45);
    p.shorts = hex(ch.shorts);
    p.limb = ch.limb ? hex(ch.limb) : p.A;
    p.shoe = hex(ch.shoes || '#f4f4ff');
    p.sole = darken(p.shoe, 0.45);
    p.racket = hex(ch.racket);
    return p;
}

function paintHead(img, ch, pal, ox, oy, blink) {
    const rows = ch.head;
    rows.forEach((row, y) => {
        [...row].forEach((k, x) => {
            if (k === '.') return;
            let c = pal[k];
            if (blink && k === 'E' && rows[y + 1] && rows[y + 1][x] === 'E') c = pal.A;
            if (blink && k === 'E' && !(rows[y + 1] && rows[y + 1][x] === 'E')) c = darken(pal.A, 0.55);
            img.put(ox + x, oy + y, c);
        });
    });
}

const LEGS = {
    idle: { legs: [[9, 17, 2, 2], [13, 17, 2, 2]], shoes: [[9, 19, 3], [13, 19, 3]] },
    run1: { legs: [[8, 17, 2, 1], [7, 18, 2, 1], [14, 17, 2, 1], [15, 18, 2, 1]], shoes: [[6, 19, 3], [15, 19, 3]] },
    run2: { legs: [[10, 17, 2, 2], [12, 17, 2, 1]], shoes: [[10, 19, 3], [12, 18, 3]] },
    swing: { legs: [[8, 17, 2, 2], [14, 17, 2, 2]], shoes: [[8, 19, 3], [14, 19, 3]] },
    cheer: { legs: [[8, 17, 2, 1], [7, 18, 2, 1], [14, 17, 2, 1], [15, 18, 2, 1]], shoes: [[6, 19, 3], [15, 19, 3]] }
};

function drawRacket(img, cx, cy, rx, ry, frameColor) {
    const strA = hex('#f4f8ff'), strB = hex('#b8c8e0');
    ellipse(img, cx, cy, rx, ry, (x, y, d) => {
        if (d > 0.42) img.put(x, y, frameColor);
        else img.put(x, y, (x + y) % 2 === 0 ? strA : strB);
    });
}

function buildCharacterFrame(ch, pose) {
    const img = new Img(CHAR_W, CHAR_H);
    const P = charPalette(ch);
    const legsKey = pose === 'blink' ? 'idle' : pose;
    const L = LEGS[legsKey];

    // braço de trás
    if (pose === 'cheer') img.pixels([[7, 11], [6, 10], [5, 9], [5, 8]], P.limb);
    else if (pose === 'swing') img.pixels([[7, 12], [6, 13], [5, 14]], P.limb);
    else if (pose === 'run1') img.pixels([[7, 12], [7, 13], [8, 14]], P.limb);
    else img.pixels([[7, 12], [7, 13], [7, 14]], P.limb);

    if (ch.ghost) {
        // fantasma flutua: cauda ondulada no lugar das pernas
        img.rect(8, 15, 8, 2, P.A);
        const phase = pose === 'run1' || pose === 'cheer' ? 1 : 0;
        for (let x = 8; x < 16; x++) if ((x + phase) % 3 !== 0) img.put(x, 17, P.A);
        for (let x = 9; x < 15; x++) if ((x + phase) % 3 === 1) img.put(x, 18, P.A);
    } else {
        for (const [x, y, w, h] of L.legs) img.rect(x, y, w, h, P.limb);
        for (const [x, y, w] of L.shoes) {
            img.rect(x, y, w, 1, P.shoe);
            img.put(x + w - 1, y, P.sole);
        }
        img.rect(8, 15, 8, 2, P.shorts);
        img.put(11, 16, darken(P.shorts, 0.35));
        img.put(12, 16, darken(P.shorts, 0.35));
    }

    // camisa com ombros, faixa e gola
    img.rect(8, 11, 8, 4, P.shirt);
    img.put(7, 11, P.shirt);
    img.put(16, 11, P.shirt);
    img.rect(8, 13, 8, 1, P.shirtLight);
    img.put(11, 11, darken(P.shirt, 0.35));
    img.put(12, 11, darken(P.shirt, 0.35));

    paintHead(img, ch, P, 6, 1, pose === 'blink');
    autoShade(img, 0.28);

    // braço da frente + raquete
    if (pose === 'swing') {
        img.pixels([[16, 12], [17, 12], [18, 12]], P.limb);
        img.put(19, 12, darken(P.limb, 0.15));
        img.put(20, 12, hex('#5a3a2a'));
        drawRacket(img, 24, 12, 3.2, 2.7, P.racket);
    } else if (pose === 'cheer') {
        img.pixels([[16, 11], [17, 10], [18, 9]], P.limb);
        img.put(18, 8, darken(P.limb, 0.15));
        img.put(18, 7, hex('#5a3a2a'));
        drawRacket(img, 18.5, 3.5, 2.6, 3.2, P.racket);
    } else {
        const dy = pose === 'run2' ? 1 : 0;
        img.pixels([[16, 12], [16, 13]], P.limb);
        img.put(17, 13, darken(P.limb, 0.15));
        img.put(18, 12, hex('#5a3a2a'));
        drawRacket(img, 20.5, 7.5 + dy, 2.6, 3.6, P.racket);
    }

    outline(img);
    return img;
}

function buildCharacters() {
    const sheet = new Img(CHAR_W * POSES.length, CHAR_H * CHARACTERS.length);
    const portraits = new Img(16 * CHARACTERS.length, 14);
    CHARACTERS.forEach((ch, row) => {
        POSES.forEach((pose, col) => {
            sheet.blit(buildCharacterFrame(ch, pose), col * CHAR_W, row * CHAR_H);
        });
        const head = new Img(16, 14);
        paintHead(head, ch, charPalette(ch), 2, 2, false);
        autoShade(head, 0.28);
        outline(head);
        portraits.blit(head, row * 16, 0);
    });
    return { sheet, portraits };
}

// ---------------------------------------------------------------------------
// Bola de tênis (frames de rotação)
// ---------------------------------------------------------------------------
function buildBallFrame(size, angle) {
    const img = new Img(size, size);
    const R = size / 2;
    const light = hex('#f6ff8a'), mid = hex('#d4ef3a'), dark = hex('#98bc20');
    const seam = hex('#ffffff'), seamDark = hex('#d8e0c8'), ink = hex('#33400e');
    const L = (() => { const v = [-0.5, -0.65, 0.58]; const m = Math.hypot(...v); return v.map(n => n / m); })();
    const ca = Math.cos(angle), sa = Math.sin(angle);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const dx = x + 0.5 - R, dy = y + 0.5 - R;
        const dist = Math.hypot(dx, dy);
        if (dist > R - 0.15) continue;
        if (dist > R - 1.1) { img.put(x, y, ink); continue; }
        const u = dx / (R - 1), v = dy / (R - 1);
        const nz = Math.sqrt(Math.max(0, 1 - u * u - v * v));
        const lambert = u * L[0] + v * L[1] + nz * L[2];
        let c = lambert > 0.72 ? light : lambert > 0.3 ? mid : dark;
        // costura da bola: curva em S rotacionando em torno do eixo vertical
        const px = u * ca + nz * sa;
        const pz = -u * sa + nz * ca;
        const g = v - 0.62 * Math.sin(Math.atan2(pz, px) * 2);
        if (Math.abs(g) < (size > 10 ? 0.17 : 0.24)) c = lambert > 0.3 ? seam : seamDark;
        img.put(x, y, c);
    }
    return img;
}
function buildBallSheet(size, frames) {
    const sheet = new Img(size * frames, size);
    for (let i = 0; i < frames; i++) sheet.blit(buildBallFrame(size, (i / frames) * Math.PI), i * size, 0);
    return sheet;
}

// ---------------------------------------------------------------------------
// Efeitos (frames 16x16)
// ---------------------------------------------------------------------------
function buildFx() {
    const S = 16, frames = [];
    const white = hex('#ffffff'), yellow = hex('#fff27a'), orange = hex('#ffb347');
    const ring = (r, thick, color, dotted) => {
        const img = new Img(S, S);
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
            if (d <= r && d > r - thick && (!dotted || (x + y) % 2 === 0)) img.put(x, y, color);
        }
        return img;
    };
    // 0-3: anel de impacto
    const r0 = new Img(S, S);
    ellipse(r0, 8, 8, 3.5, 3.5, (x, y) => r0.put(x, y, white));
    frames.push(r0);
    frames.push(ring(5.5, 2, white));
    frames.push(ring(7, 1.2, yellow));
    frames.push(ring(7.8, 1, orange, true));
    // 4: estrela grande, 5: estrela pequena
    const star = (len) => {
        const img = new Img(S, S);
        img.rect(7, 7, 2, 2, white);
        for (let i = 1; i <= len; i++) {
            const c = i === len ? yellow : white;
            img.rect(7, 7 - i, 2, 1, c); img.rect(7, 8 + i, 2, 1, c);
            img.rect(7 - i, 7, 1, 2, c); img.rect(8 + i, 7, 1, 2, c);
        }
        if (len > 3) { img.put(5, 5, yellow); img.put(10, 5, yellow); img.put(5, 10, yellow); img.put(10, 10, yellow); }
        return img;
    };
    frames.push(star(5));
    frames.push(star(2));
    // 6-8: nuvem de poeira
    const dust = hex('#f4ead6'), dustDark = hex('#cbbd9e');
    [[3, 0], [4.5, 1], [5.5, 2]].forEach(([r, stage]) => {
        const img = new Img(S, S);
        const blobs = [[8, 9, r], [5.5, 10, r * 0.7], [10.5, 10, r * 0.75], [8, 7, r * 0.6]];
        for (const [bx, by, br] of blobs) {
            ellipse(img, bx, by, br, br * 0.85, (x, y) => {
                if (stage === 2 && (x + y) % 2 === 0) return;
                if (stage === 1 && (x * 3 + y) % 5 === 0) return;
                img.put(x, y, y > by ? dustDark : dust);
            });
        }
        frames.push(img);
    });
    // 9-10: arco de swing (golpe da raquete)
    [0, 1].forEach(stage => {
        const img = new Img(S, S);
        for (let a = -1.25; a <= 1.25; a += 0.04) {
            const r = 6.8;
            const x = Math.round(3 + Math.cos(a) * r), y = Math.round(8 + Math.sin(a) * r);
            const t = (a + 1.25) / 2.5;
            if (stage === 1 && t < 0.45) continue;
            img.put(x, y, t > 0.5 ? white : yellow);
            if (stage === 0 && t > 0.3) img.put(x - 1, y, hex('#ffffff', 150));
        }
        frames.push(img);
    });
    // 11: coração (vitória) / 12: gota de suor
    const heart = new Img(S, S);
    ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'].forEach((r, y) =>
        [...r].forEach((p, x) => { if (p === '#') heart.put(x + 4, y + 5, hex('#ff4f7b')); }));
    heart.put(5, 6, white);
    outline(heart);
    frames.push(heart);
    const drop = new Img(S, S);
    ['..#..', '.###.', '#####', '#####', '.###.'].forEach((r, y) =>
        [...r].forEach((p, x) => { if (p === '#') drop.put(x + 5, y + 5, hex('#7fd8ff')); }));
    drop.put(6, 7, white);
    outline(drop);
    frames.push(drop);

    const sheet = new Img(S * frames.length, S);
    frames.forEach((f, i) => sheet.blit(f, i * S, 0));
    return {
        sheet,
        meta: {
            size: S,
            ring: [0, 1, 2, 3], starBig: 4, starSmall: 5, puff: [6, 7, 8], swoosh: [9, 10], heart: 11, drop: 12
        }
    };
}

// ---------------------------------------------------------------------------
// Interface: placar, pips, seta, ícones de som
// ---------------------------------------------------------------------------
function buildUI() {
    const img = new Img(128, 48);
    const meta = {};
    // placar 104x22
    const sb = new Img(104, 22);
    const gold = hex('#ffd447'), goldDark = hex('#c98a1a'), panel = hex('#1d1840'), panelLight = hex('#2c2560');
    const led = hex('#08060f'), slot = hex('#120e2a');
    sb.rect(0, 0, 104, 22, INK);
    sb.rect(1, 1, 102, 20, goldDark);
    sb.rect(1, 1, 102, 1, gold);
    sb.rect(1, 1, 1, 19, gold);
    sb.rect(2, 2, 100, 18, panel);
    sb.rect(2, 2, 100, 1, panelLight);
    // parafusos
    for (const [x, y] of [[3, 3], [100, 3], [3, 18], [100, 18]]) { sb.put(x, y, gold); }
    // slots dos retratos
    sb.rect(5, 3, 18, 16, slot); sb.rect(5, 18, 18, 1, panelLight);
    sb.rect(81, 3, 18, 16, slot); sb.rect(81, 18, 18, 1, panelLight);
    // displays de LED
    sb.rect(26, 3, 20, 12, led); sb.rect(58, 3, 20, 12, led);
    for (let x = 26; x < 46; x += 2) sb.put(x, 3, hex('#14102a'));
    for (let x = 58; x < 78; x += 2) sb.put(x, 3, hex('#14102a'));
    // "VS" central
    drawText(sb, '-', 49, 6, gold);
    img.blit(sb, 0, 0);
    meta.scoreboard = [0, 0, 104, 22];
    meta.portraitLeft = [6, 4];
    meta.portraitRight = [82, 4];
    meta.ledLeft = [26, 3, 20, 12];
    meta.ledRight = [58, 3, 20, 12];
    meta.pipsLeft = [27, 16];
    meta.pipsRight = [59, 16];

    // pips de ponto 3x3 (aceso/apagado)
    const pipOn = [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]];
    img.rect(0, 24, 3, 3, hex('#4a3a1a'));
    img.pixels(pipOn, gold); img.put(1, 25, hex('#fff8c8'));
    meta.pipOn = [0, 24, 3, 3];
    img.rect(4, 24, 3, 3, hex('#2a2550'));
    img.put(5, 25, hex('#3a3470'));
    meta.pipOff = [4, 24, 3, 3];

    // seta "VOCÊ" 7x6
    const arrow = new Img(7, 6);
    ['#####', '#####', '.###.', '..#..'].forEach((r, y) =>
        [...r].forEach((p, x) => { if (p === '#') arrow.put(x + 1, y + 1, hex('#ffffff')); }));
    outline(arrow);
    img.blit(arrow, 8, 24);
    meta.arrow = [8, 24, 7, 6];

    // ícones de som 11x9
    const speaker = (on) => {
        const s = new Img(11, 9);
        const c = hex('#f4f0ff');
        ['...#', '..##', '####', '####', '####', '..##', '...#'].forEach((r, y) =>
            [...r].forEach((p, x) => { if (p === '#') s.put(x + 1, y + 1, c); }));
        if (on) {
            s.pixels([[6, 3], [6, 5], [7, 4], [8, 2], [8, 6], [9, 3], [9, 4], [9, 5]], hex('#4dff9e'));
            s.put(7, 4, hex('#4dff9e', 0));
        } else {
            s.pixels([[6, 2], [7, 3], [8, 4], [9, 5], [6, 5], [7, 4], [8, 3], [9, 2]].map(([x, y]) => [x, y + 1]), hex('#ff6b9d'));
        }
        return s;
    };
    img.blit(speaker(true), 16, 24);
    meta.soundOn = [16, 24, 11, 9];
    img.blit(speaker(false), 28, 24);
    meta.soundOff = [28, 24, 11, 9];
    return { img, meta };
}

// ---------------------------------------------------------------------------
// Cenários (arenas) 240x150, desenhados em 4x no jogo (960x600)
// ---------------------------------------------------------------------------
const AW = 240, AH = 150;
const FIELD = { x: 20, y: 20, w: 200, h: 125 };

const ARENAS = [
    {
        id: 'grass', name: 'Grama Real', seed: 11, clouds: true, night: false,
        surface: ['#4aa043', '#3f9139'], noise: '#367f31', line: '#f6f8ef', apron: null,
        wear: '#b9a865', stands: ['#3a6b46', '#2d5638', '#21422b'], seat: '#2a5a3a',
        wall: '#3b2a6a', wallLight: '#5a46a0', adBg: '#2a1d55', adText: '#e8d27a', adText2: '#ffffff',
        ads: ['EMOJI CUP', 'GAME ON!']
    },
    {
        id: 'clay', name: 'Saibro', seed: 23, clouds: true, night: false,
        surface: ['#cc6a3c', '#c46236'], noise: '#b5592f', line: '#f8efe4', apron: null,
        stands: ['#7a4a33', '#663c29', '#4f2e20'], seat: '#5a3424',
        wall: '#1f5a3a', wallLight: '#2f8a5a', adBg: '#174a2e', adText: '#ffe7b0', adText2: '#ffffff',
        ads: ['PIXEL OPEN', 'TERRA!']
    },
    {
        id: 'hard', name: 'Quadra Dura', seed: 37, clouds: true, night: false,
        surface: ['#3266b8', '#2e5fae'], noise: '#2a58a2', line: '#ffffff', apron: ['#3f8f62', '#3a875c'],
        stands: ['#3a4a6a', '#2e3b56', '#232d42'], seat: '#2a3a5a',
        wall: '#1a2a4a', wallLight: '#3a5a9a', adBg: '#121c38', adText: '#5fc8ff', adText2: '#ffffff',
        ads: ['HARD COURT', 'SMASH!']
    },
    {
        id: 'night', name: 'Neon Noturno', seed: 51, clouds: false, night: true,
        surface: ['#2b2672', '#28236a'], noise: '#241f60', line: '#6ff8ff', apron: ['#17133e', '#15113a'],
        lineGlow: '#2fb8e0',
        stands: ['#1f1a3a', '#18142e', '#100d22'], seat: '#1a1630',
        wall: '#2a0f3a', wallLight: '#ff4fd8', adBg: '#12061e', adText: '#ff4fd8', adText2: '#6ff8ff',
        ads: ['NEON CUP', 'NIGHT SET']
    }
];

// posições do público (usadas tanto para cadeiras quanto para a camada animada)
function crowdSeats() {
    const seats = [];
    for (const y of [1, 6]) for (let x = 1; x < AW - 3; x += 4) seats.push([x, y]);
    for (const x of [0, 4, 8, 12]) for (let y = 12; y < AH - 3; y += 4) seats.push([x, y]);
    for (const x of [225, 229, 233, 237]) for (let y = 12; y < AH - 3; y += 4) seats.push([x, y]);
    return seats;
}

function buildArena(cfg) {
    const img = new Img(AW, AH);
    const r = rng(cfg.seed);
    const C = k => hex(cfg[k]);
    const [s0, s1, s2] = cfg.stands.map(c => hex(c));

    // arquibancadas: faixas de degraus
    for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) {
        let c;
        if (y <= 10) c = y % 5 === 4 ? s2 : (y < 5 ? s1 : s0);
        else if (x < 16) c = x % 4 === 3 ? s2 : (x < 8 ? s1 : s0);
        else if (x >= 224) c = (x - 224) % 4 === 0 ? s2 : (x >= 232 ? s1 : s0);
        else continue;
        if (r() < 0.06) c = darken(c, 0.15);
        img.put(x, y, c);
    }
    // corredores/escadas
    for (let x = 30; x < AW - 20; x += 48) {
        for (let y = 0; y <= 10; y++) { img.put(x, y, s2); img.put(x + 1, y, y % 2 ? s2 : s1); }
    }
    // cadeiras vazias
    const seat = C('seat');
    for (const [x, y] of crowdSeats()) { img.rect(x, y + 1, 3, 2, seat); img.put(x + 1, y + 1, lighten(seat, 0.15)); }
    // grade da arquibancada superior
    img.rect(0, 10, AW, 1, darken(s2, 0.3));

    // placas de publicidade (topo)
    const adBg = C('adBg');
    img.rect(16, 11, 208, 9, adBg);
    img.rect(16, 11, 208, 1, lighten(adBg, 0.25));
    img.rect(16, 19, 208, 1, darken(adBg, 0.4));
    for (let x = 16; x < 224; x += 52) img.rect(x, 12, 1, 7, darken(adBg, 0.5));
    const [adL, adR] = cfg.ads;
    drawText(img, adL, 50 - Math.floor(textWidth(adL) / 2), 12, C('adText'));
    drawText(img, adR, 190 - Math.floor(textWidth(adR) / 2), 12, C('adText2'));

    // muretas laterais e inferior
    const wall = C('wall'), wallLight = C('wallLight');
    for (const wx of [16, 220]) {
        img.rect(wx, 11, 4, AH - 11, wall);
        img.rect(wx + (wx === 16 ? 3 : 0), 20, 1, AH - 20, darken(wall, 0.35));
        for (let y = 24; y < AH; y += 18) {
            img.rect(wx + 1, y, 2, 10, wallLight);
            img.rect(wx + 1, y, 2, 1, lighten(wallLight, 0.3));
        }
    }
    img.rect(16, 145, 208, 5, wall);
    img.rect(16, 145, 208, 1, lighten(wall, 0.25));
    for (let x = 22; x < 220; x += 14) img.rect(x, 147, 8, 1, wallLight);

    // superfície da quadra
    const surf = cfg.surface.map(c => hex(c));
    const noise = C('noise');
    const apron = cfg.apron ? cfg.apron.map(c => hex(c)) : null;
    const inCourt = (x, y) => x >= 26 && x <= 213 && y >= 24 && y <= 140;
    for (let y = FIELD.y; y < FIELD.y + FIELD.h; y++) for (let x = FIELD.x; x < FIELD.x + FIELD.w; x++) {
        let c;
        if (apron && !inCourt(x, y)) c = apron[(Math.floor((x - FIELD.x) / 10)) % 2];
        else if (cfg.id === 'grass') c = surf[Math.floor((x - FIELD.x) / 10) % 2];
        else c = surf[(x + y) % 2 === 0 ? 0 : 1];
        const n = r();
        if (n < 0.07) c = noise;
        else if (n < 0.1) c = lighten(c, 0.08);
        img.put(x, y, c);
    }

    // desgaste da grama perto das linhas de fundo
    if (cfg.wear) {
        const wear = C('wear');
        for (const cx of [32, 207]) {
            for (let y = FIELD.y + 6; y < FIELD.y + FIELD.h - 6; y++) for (let x = cx - 10; x <= cx + 10; x++) {
                const d = Math.hypot((x - cx) / 10, (y - 82) / 48);
                if (d < 1 && r() < (1 - d) * 0.75) img.put(x, y, mix(img.get(x, y), wear, 0.45 + r() * 0.3));
            }
        }
    }
    // marcas de deslizamento no saibro
    if (cfg.id === 'clay') {
        for (let i = 0; i < 40; i++) {
            const x0 = 24 + Math.floor(r() * 190), y0 = 24 + Math.floor(r() * 115);
            const len = 3 + Math.floor(r() * 7), light = r() < 0.6;
            for (let k = 0; k < len; k++) img.put(x0 + k, y0, mix(img.get(x0 + k, y0), light ? hex('#e8956a') : hex('#a44e28'), 0.6));
        }
    }

    // linhas da quadra (vista de cima, rede vertical no centro)
    const line = C('line');
    const lines = [];
    const hline = (y, x0, x1) => { for (let x = x0; x <= x1; x++) lines.push([x, y]); };
    const vline = (x, y0, y1) => { for (let y = y0; y <= y1; y++) lines.push([x, y]); };
    hline(24, 26, 213); hline(140, 26, 213);      // laterais de duplas
    hline(38, 26, 213); hline(126, 26, 213);      // laterais de simples
    vline(26, 24, 140); vline(213, 24, 140);      // linhas de fundo
    vline(69, 38, 126); vline(171, 38, 126);      // linhas de saque
    hline(82, 69, 171);                            // linha central de saque
    hline(82, 27, 29); hline(82, 210, 212);        // marcas centrais
    if (cfg.lineGlow) {
        const glow = C('lineGlow');
        for (const [x, y] of lines) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            img.put(x + dx, y + dy, mix(img.get(x + dx, y + dy), glow, 0.4));
        }
    }
    for (const [x, y] of lines) {
        let c = line;
        if (cfg.id === 'clay' && r() < 0.15) c = mix(line, hex('#d9a888'), 0.6);
        if (cfg.id === 'grass' && r() < 0.08) c = mix(line, surf[0], 0.35);
        img.put(x, y, c);
    }

    // sombra da rede
    for (let y = 23; y <= 143; y++) for (const x of [121, 122]) img.put(x, y, darken(img.get(x, y), x === 121 ? 0.35 : 0.2));
    // rede: fita branca + malha
    const tape = hex('#f8f8f8'), mesh = hex('#2a2a36'), meshLight = hex('#6a6a7a');
    for (let y = 21; y <= 143; y++) {
        img.put(119, y, y % 6 === 0 ? hex('#d8d8e0') : tape);
        img.put(120, y, y % 2 === 0 ? mesh : meshLight);
    }
    // postes
    const post = hex('#3a3a48'), postLight = hex('#9a9aae');
    for (const py of [19, 143]) {
        img.rect(118, py, 4, 3, post);
        img.rect(118, py, 4, 1, postLight);
    }

    // torres de iluminação (noturno) nos cantos
    if (cfg.night) {
        for (const [lx, ly] of [[4, 2], [232, 2]]) {
            img.rect(lx, ly, 5, 3, hex('#3a3550'));
            img.rect(lx + 1, ly + 1, 3, 1, hex('#fffbe0'));
        }
    }
    return img;
}

function buildCrowd() {
    const frames = 3;
    const img = new Img(AW * frames, AH);
    const r = rng(777);
    const skins = ['#f9d4b4', '#e8b48a', '#c98a5e', '#8a5a3a', '#5a3a24'].map(c => hex(c));
    const shirts = ['#ff4f7b', '#4dff9e', '#5fc8ff', '#ffd447', '#ff8a2a', '#b46bff', '#ffffff', '#ff3b5c', '#3b7bff', '#2fd07a'].map(c => hex(c));
    const people = crowdSeats().filter(() => r() > 0.12).map(([x, y]) => ({
        x, y,
        skin: skins[Math.floor(r() * skins.length)],
        shirt: shirts[Math.floor(r() * shirts.length)],
        hair: r() < 0.5 ? hex(['#2a1a10', '#5a3a1a', '#d8b040', '#1a1020'][Math.floor(r() * 4)]) : null,
        bob: r() < 0.3,
        cheer: r() < 0.85,
        sign: r() < 0.06 ? shirts[Math.floor(r() * shirts.length)] : null
    }));
    for (let f = 0; f < frames; f++) {
        const ox = f * AW;
        for (const p of people) {
            const up = (f === 1 && p.bob) || (f === 2 && p.cheer) ? 1 : 0;
            const x = ox + p.x, y = p.y - up;
            img.put(x + 1, y, p.skin);
            if (p.hair) img.put(x + 1, y, mix(p.skin, p.hair, 0.6));
            img.rect(x, y + 1, 3, 2, p.shirt);
            img.put(x + 2, y + 2, darken(p.shirt, 0.3));
            if (f === 2 && p.cheer) {
                img.put(x, y, p.skin);
                img.put(x + 2, y, p.skin);
                if (p.sign) { img.rect(x - 1, y - 3, 5, 2, p.sign); img.rect(x, y - 2, 3, 1, hex('#ffffff')); }
            }
        }
    }
    return img;
}

function buildClouds() {
    const img = new Img(220, 130);
    const r = rng(99);
    const black = hex('#000000');
    for (let i = 0; i < 4; i++) {
        const cx = 30 + i * 52 + r() * 10, cy = 25 + r() * 80;
        for (let k = 0; k < 6; k++) {
            const bx = cx + (r() - 0.5) * 30, by = cy + (r() - 0.5) * 14, br = 6 + r() * 9;
            ellipse(img, bx, by, br, br * 0.75, (x, y) => img.put(x, y, black));
        }
    }
    return img;
}

// fundo da página: céu estrelado pixelado, tileável 64x64
function buildBgTile() {
    const img = new Img(64, 64);
    const r = rng(5);
    const base = hex('#140f2e'), alt = hex('#17113a');
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        img.put(x, y, (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? alt : base);
    }
    for (let i = 0; i < 18; i++) img.put(Math.floor(r() * 64), Math.floor(r() * 64), hex('#5a4fa0'));
    for (let i = 0; i < 3; i++) {
        const x = 4 + Math.floor(r() * 56), y = 4 + Math.floor(r() * 56);
        img.pixels([[x, y - 1], [x - 1, y], [x + 1, y], [x, y + 1]], hex('#8a7fe0'));
        img.put(x, y, hex('#e8e4ff'));
    }
    return img;
}

// logo do jogo
function buildLogo() {
    const s = 2;
    const top = 'EMOJI', bottom = 'TENNIS';
    const w = 100, h = 42;
    const img = new Img(w, h);
    const grad = y => {
        const t = y / 30;
        return t < 0.5 ? mix(hex('#fff27a'), hex('#ffb347'), t * 2) : mix(hex('#ffb347'), hex('#ff3d6e'), (t - 0.5) * 2);
    };
    const letters = new Img(w, h);
    const place = (text, y) => {
        const m = textMask(text, s);
        const x0 = Math.floor((w - m.w) / 2) - (text === top ? 8 : 0);
        for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) if (m.a(i, j)) letters.put(x0 + i, y + j - FONT_TOP * s, grad(y + j - FONT_TOP * s));
        return x0 + m.w;
    };
    const endTop = place(top, 3);
    place(bottom, 22);
    // brilho na parte de cima de cada letra
    const shine = letters.clone();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (shine.a(x, y) && !shine.a(x, y - 1)) letters.put(x, y, lighten(letters.get(x, y), 0.6));
    }
    // sombra projetada
    const shadow = new Img(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (letters.a(x, y)) {
        shadow.put(x + 2, y + 2, hex('#3a1a6a'));
        shadow.put(x + 1, y + 2, hex('#3a1a6a'));
    }
    outline(letters, INK, true);
    outline(shadow, INK);
    img.blit(shadow, 0, 0);
    img.blit(letters, 0, 0);
    // bolinha com rastro ao lado de "EMOJI"
    const ball = buildBallFrame(14, 0.6);
    const bx = endTop + 4, by = 2;
    for (let i = 0; i < 3; i++) img.rect(bx - 6 - i * 4, by + 5 + i, 3, 1, hex('#fff27a', 200 - i * 60));
    img.blit(ball, bx, by);
    return img;
}

// ---------------------------------------------------------------------------
// Áudio: sintetizador chiptune simples -> WAV 16 bits mono
// ---------------------------------------------------------------------------
const SR = 22050;
function encodeWAV(samples) {
    const buf = Buffer.alloc(44 + samples.length * 2);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
    buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
    buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
    for (let i = 0; i < samples.length; i++) {
        const v = Math.tanh(samples[i] * 1.1);
        buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32000), 44 + i * 2);
    }
    return buf;
}
function saveWAV(name, samples) {
    fs.writeFileSync(path.join(OUT, 'sfx', name), encodeWAV(samples));
    console.log(`  sfx/${name.padEnd(18)} ${(samples.length / SR).toFixed(2)}s`);
}
const NOTE_INDEX = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
function noteFreq(name) {
    const m = /^([A-G][#b]?)(-?\d)$/.exec(name);
    const midi = (parseInt(m[2], 10) + 1) * 12 + NOTE_INDEX[m[1]];
    return 440 * Math.pow(2, (midi - 69) / 12);
}
function wave(type, p, duty = 0.5) {
    p -= Math.floor(p);
    switch (type) {
        case 'square': return p < duty ? 0.8 : -0.8;
        case 'tri': return 4 * Math.abs(p - 0.5) - 1;
        case 'saw': return 2 * p - 1;
        default: return Math.sin(2 * Math.PI * p);
    }
}
function tone(buf, t0, dur, o) {
    const { type = 'square', f0, f1 = f0, vol = 0.3, duty = 0.5, attack = 0.004, release = 0.6, vibrato = 0, slide = 'exp' } = o;
    const start = Math.floor(t0 * SR), n = Math.floor(dur * SR);
    let phase = 0;
    for (let i = 0; i < n && start + i < buf.length; i++) {
        const t = i / n;
        const f = slide === 'exp' ? f0 * Math.pow(f1 / f0, t) : f0 + (f1 - f0) * t;
        const vib = vibrato ? 1 + Math.sin(i / SR * 2 * Math.PI * 6) * vibrato * Math.min(1, t * 3) : 1;
        phase += (f * vib) / SR;
        const time = i / SR;
        let env = time < attack ? time / attack : 1;
        if (t > 1 - release) env *= Math.max(0, (1 - t) / release);
        buf[start + i] += wave(type, phase, duty) * vol * env;
    }
}
function noise(buf, t0, dur, o) {
    const { vol = 0.3, lp = 0.5, seed = 1, decay = true, attack = 0.002 } = o;
    const r = rng(seed);
    const start = Math.floor(t0 * SR), n = Math.floor(dur * SR);
    let last = 0;
    for (let i = 0; i < n && start + i < buf.length; i++) {
        const t = i / n;
        last += (r() * 2 - 1 - last) * lp;
        const time = i / SR;
        let env = time < attack ? time / attack : 1;
        if (decay) env *= Math.pow(1 - t, 2);
        buf[start + i] += last * vol * env;
    }
}
const makeBuf = sec => new Float32Array(Math.ceil(sec * SR));

function buildSounds() {
    const sfx = {};
    let b;

    b = makeBuf(0.16);
    tone(b, 0, 0.12, { f0: 980, f1: 420, duty: 0.25, vol: 0.35, release: 0.9 });
    tone(b, 0, 0.09, { type: 'sine', f0: 200, f1: 70, vol: 0.6, release: 0.9 });
    noise(b, 0, 0.03, { vol: 0.5, lp: 0.9, seed: 3 });
    sfx.hit = b;

    b = makeBuf(0.1);
    tone(b, 0, 0.09, { type: 'tri', f0: 620, f1: 360, vol: 0.55, release: 0.9 });
    noise(b, 0, 0.02, { vol: 0.2, lp: 0.6, seed: 4 });
    sfx.wall = b;

    b = makeBuf(0.75);
    ['C5', 'E5', 'G5'].forEach((n, i) => tone(b, i * 0.07, 0.09, { f0: noteFreq(n), duty: 0.25, vol: 0.28 }));
    tone(b, 0.21, 0.45, { f0: noteFreq('C6'), duty: 0.25, vol: 0.28, vibrato: 0.012 });
    tone(b, 0.21, 0.45, { f0: noteFreq('G5'), duty: 0.5, vol: 0.12 });
    tone(b, 0, 0.66, { type: 'tri', f0: noteFreq('C4'), vol: 0.35 });
    sfx.point_win = b;

    b = makeBuf(0.7);
    ['G4', 'Eb4'].forEach((n, i) => tone(b, i * 0.13, 0.13, { f0: noteFreq(n), duty: 0.5, vol: 0.25 }));
    tone(b, 0.26, 0.4, { f0: noteFreq('C4'), f1: noteFreq('A3'), duty: 0.5, vol: 0.25, vibrato: 0.02 });
    tone(b, 0, 0.66, { type: 'tri', f0: noteFreq('C3'), f1: noteFreq('A2'), vol: 0.3 });
    sfx.point_lose = b;

    b = makeBuf(1.6);
    noise(b, 0, 1.6, { vol: 0.35, lp: 0.12, seed: 9, decay: true, attack: 0.25 });
    noise(b, 0, 1.4, { vol: 0.12, lp: 0.5, seed: 10, decay: true, attack: 0.2 });
    {
        const r = rng(12);
        for (let i = 0; i < 40; i++) noise(b, r() * 1.2, 0.025, { vol: 0.18 * (1 - i / 50), lp: 0.8, seed: 20 + i });
    }
    sfx.crowd = b;

    b = makeBuf(0.08);
    tone(b, 0, 0.07, { f0: 660, f1: 1320, duty: 0.25, vol: 0.25 });
    sfx.select = b;

    b = makeBuf(0.16);
    tone(b, 0, 0.14, { f0: noteFreq('A5'), duty: 0.5, vol: 0.25, release: 0.3 });
    sfx.count = b;

    b = makeBuf(0.45);
    tone(b, 0, 0.4, { f0: noteFreq('A6'), duty: 0.25, vol: 0.22, release: 0.5 });
    tone(b, 0, 0.4, { f0: noteFreq('E6'), duty: 0.5, vol: 0.14, release: 0.5 });
    tone(b, 0, 0.4, { type: 'tri', f0: noteFreq('A4'), vol: 0.35, release: 0.5 });
    sfx.go = b;

    b = makeBuf(0.5);
    tone(b, 0, 0.12, { f0: noteFreq('E5'), duty: 0.25, vol: 0.25 });
    tone(b, 0.12, 0.3, { f0: noteFreq('B5'), duty: 0.25, vol: 0.25, vibrato: 0.01 });
    sfx.found = b;

    b = makeBuf(2.0);
    const fan = [['G4', 0, 0.1], ['C5', 0.1, 0.1], ['E5', 0.2, 0.1], ['G5', 0.3, 0.25], ['E5', 0.55, 0.1], ['G5', 0.65, 0.9]];
    fan.forEach(([n, t, d]) => {
        tone(b, t, d, { f0: noteFreq(n), duty: 0.25, vol: 0.26, vibrato: d > 0.5 ? 0.012 : 0 });
        tone(b, t, d, { f0: noteFreq(n) / 2, duty: 0.5, vol: 0.1 });
    });
    [['C3', 0, 0.3], ['C3', 0.3, 0.25], ['G2', 0.55, 0.1], ['C3', 0.65, 1.2]].forEach(([n, t, d]) =>
        tone(b, t, d, { type: 'tri', f0: noteFreq(n), vol: 0.4 }));
    noise(b, 0.65, 0.4, { vol: 0.25, lp: 0.7, seed: 31 });
    sfx.victory = b;

    b = makeBuf(1.4);
    [['E4', 0], ['Eb4', 0.25], ['D4', 0.5]].forEach(([n, t]) => tone(b, t, 0.24, { f0: noteFreq(n), duty: 0.5, vol: 0.22 }));
    tone(b, 0.75, 0.6, { f0: noteFreq('Db4'), f1: noteFreq('C4'), duty: 0.5, vol: 0.22, vibrato: 0.03 });
    tone(b, 0, 1.35, { type: 'tri', f0: noteFreq('C3'), f1: noteFreq('G2'), vol: 0.3 });
    sfx.defeat = b;

    return sfx;
}

function buildMusic() {
    const bpm = 140, eighth = 60 / bpm / 2, bar = eighth * 8, bars = 8;
    const buf = makeBuf(bar * bars);
    const chords = [
        ['C3', ['C4', 'E4', 'G4']], ['A2', ['A3', 'C4', 'E4']], ['F2', ['F3', 'A3', 'C4']], ['G2', ['G3', 'B3', 'D4']],
        ['C3', ['C4', 'E4', 'G4']], ['A2', ['A3', 'C4', 'E4']], ['F2', ['F3', 'A3', 'C4']], ['G2', ['G3', 'B3', 'D4']]
    ];
    const melody = [
        'E5 - G5 - C6 - B5 A5',
        'G5 - E5 - C5 - D5 E5',
        'F5 - A5 - C6 - A5 G5',
        'G5 - - - D5 - B4 -',
        'E5 - G5 - C6 - D6 E6',
        'D6 - C6 - A5 - G5 E5',
        'F5 - A5 - G5 - F5 D5',
        'G5 - - - . . G4 B4'
    ];
    chords.forEach(([root, triad], bi) => {
        const t0 = bi * bar;
        // baixo: oitavas em colcheias
        for (let i = 0; i < 8; i++) {
            const f = noteFreq(root) * (i % 2 ? 2 : 1);
            tone(buf, t0 + i * eighth, eighth * 0.9, { type: 'tri', f0: f, vol: 0.38, release: 0.3 });
        }
        // arpejo em semicolcheias, bem baixinho
        for (let i = 0; i < 16; i++) {
            const n = triad[i % 3];
            tone(buf, t0 + i * eighth / 2, eighth / 2 * 0.8, { f0: noteFreq(n) * 2, duty: 0.125, vol: 0.06, release: 0.5 });
        }
        // bateria: bumbo, caixa e chimbal
        for (let i = 0; i < 8; i++) {
            const t = t0 + i * eighth;
            if (i % 4 === 0) tone(buf, t, 0.12, { type: 'sine', f0: 150, f1: 45, vol: 0.7, release: 0.9 });
            if (i % 4 === 2) noise(buf, t, 0.12, { vol: 0.28, lp: 0.7, seed: 100 + bi * 8 + i });
            noise(buf, t, 0.03, { vol: 0.08, lp: 0.95, seed: 200 + bi * 8 + i });
        }
        // melodia
        const tokens = melody[bi].split(' ');
        tokens.forEach((tok, i) => {
            if (tok === '-' || tok === '.') return;
            let len = 1;
            while (tokens[i + len] === '-') len++;
            const d = eighth * len * 0.92;
            tone(buf, t0 + i * eighth, d, { f0: noteFreq(tok), duty: 0.25, vol: 0.17, release: 0.35, vibrato: len > 2 ? 0.008 : 0 });
            tone(buf, t0 + i * eighth + eighth * 0.75, d, { f0: noteFreq(tok), duty: 0.25, vol: 0.05, release: 0.35 });
        });
    });
    return buf;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
    fs.mkdirSync(path.join(OUT, 'sfx'), { recursive: true });
    console.log('Gerando imagens...');

    const { sheet, portraits } = buildCharacters();
    savePNG('characters.png', sheet);
    savePNG('portraits.png', portraits);
    savePNG('ball.png', buildBallSheet(8, 8));
    savePNG('ball_big.png', buildBallSheet(16, 8));
    const fx = buildFx();
    savePNG('fx.png', fx.sheet);
    const ui = buildUI();
    savePNG('ui.png', ui.img);
    savePNG('font.png', buildFont());
    savePNG('crowd.png', buildCrowd());
    savePNG('clouds.png', buildClouds());
    savePNG('bg.png', buildBgTile());
    savePNG('logo.png', buildLogo());
    for (const a of ARENAS) savePNG(`arena_${a.id}.png`, buildArena(a));

    console.log('Gerando áudio...');
    const sfx = buildSounds();
    for (const [k, v] of Object.entries(sfx)) saveWAV(`${k}.wav`, v);
    saveWAV('music.wav', buildMusic());

    const manifest = {
        version: 1,
        images: {
            characters: 'characters.png', portraits: 'portraits.png', ball: 'ball.png', ballBig: 'ball_big.png',
            fx: 'fx.png', ui: 'ui.png', font: 'font.png', crowd: 'crowd.png', clouds: 'clouds.png',
            logo: 'logo.png', bg: 'bg.png',
            ...Object.fromEntries(ARENAS.map(a => [`arena_${a.id}`, `arena_${a.id}.png`]))
        },
        characters: {
            frameW: CHAR_W, frameH: CHAR_H, anchorX: CHAR_ANCHOR_X, feetY: CHAR_FEET_Y,
            frames: Object.fromEntries(POSES.map((p, i) => [p, i])),
            list: CHARACTERS.map(c => ({ emoji: c.emoji, id: c.id, name: c.name, color: c.shirt }))
        },
        portraits: { w: 16, h: 14 },
        ball: { size: 8, frames: 8 },
        ballBig: { size: 16, frames: 8 },
        fx: fx.meta,
        ui: ui.meta,
        font: { cellW: FONT_CELL_W, cellH: FONT_CELL_H, top: FONT_TOP, glyphH: 7, chars: FONT_CHARS },
        crowd: { frames: 3, w: AW, h: AH },
        clouds: { w: 220, h: 130 },
        arena: { w: AW, h: AH, field: FIELD },
        arenas: ARENAS.map(a => ({ id: a.id, name: a.name, clouds: a.clouds, night: a.night })),
        sounds: Object.fromEntries([...Object.keys(sfx), 'music'].map(k => [k, `sfx/${k}.wav`]))
    };
    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log('  manifest.json');
}

main();
