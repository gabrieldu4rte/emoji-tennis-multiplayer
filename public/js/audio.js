// Áudio: toca os WAVs gerados (SFX + música) via Web Audio API.
// Os eventos de som continuam trafegando pela rede no mesmo formato de antes
// ({ freq, type, duration }); aqui eles são traduzidos para os samples.
const NET_SOUNDS = {
    wall: { freq: 300, type: 'sine', duration: 0.08 },
    hit: { freq: 450, type: 'triangle', duration: 0.12 },
    point_p2: { freq: 150, type: 'sawtooth', duration: 0.3 },
    point_p1: { freq: 600, type: 'sine', duration: 0.3 }
};

function netEventFromSound(freq, type) {
    for (const [name, s] of Object.entries(NET_SOUNDS)) {
        if (s.freq === freq && s.type === type) return name;
    }
    return null;
}

const Sound = {
    ctx: null,
    buffers: {},
    master: null,
    sfxGain: null,
    musicGain: null,
    musicSource: null,
    musicWanted: false,
    muted: false,

    init() {
        if (this.ctx) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = 0.7;
        this.sfxGain.connect(this.master);
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0.28;
        this.musicGain.connect(this.master);
        try { this.muted = localStorage.getItem('et-muted') === '1'; } catch (e) {}
        this.master.gain.value = this.muted ? 0 : 1;
    },

    async load(sounds) {
        this.init();
        if (!this.ctx) return;
        await Promise.all(Object.entries(sounds).map(async ([name, file]) => {
            try {
                const data = await fetch('assets/' + file).then(r => r.arrayBuffer());
                this.buffers[name] = await new Promise((res, rej) => this.ctx.decodeAudioData(data, res, rej));
            } catch (e) { /* sem o sample, usamos o oscilador como fallback */ }
        }));
        if (this.musicWanted) this.startMusic();
    },

    // navegadores só liberam o áudio após um gesto do usuário
    unlock() {
        this.init();
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },

    play(name, { volume = 1, rate = 1 } = {}) {
        if (!this.ctx || !this.buffers[name]) return false;
        this.unlock();
        const src = this.ctx.createBufferSource();
        src.buffer = this.buffers[name];
        src.playbackRate.value = rate;
        const g = this.ctx.createGain();
        g.gain.value = volume;
        src.connect(g);
        g.connect(this.sfxGain);
        src.start();
        return true;
    },

    // fallback com oscilador (comportamento original do jogo)
    beep(freq, type = 'sine', duration = 0.1) {
        this.init();
        if (!this.ctx) return;
        try {
            const t = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, t);
            gain.gain.setValueAtTime(0.12, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + duration);
            osc.connect(gain);
            gain.connect(this.sfxGain);
            osc.start();
            osc.stop(t + duration);
        } catch (e) {}
    },

    startMusic() {
        this.musicWanted = true;
        if (!this.ctx || !this.buffers.music || this.musicSource) return;
        this.unlock();
        const src = this.ctx.createBufferSource();
        src.buffer = this.buffers.music;
        src.loop = true;
        src.connect(this.musicGain);
        src.start();
        this.musicSource = src;
    },

    setMusicVolume(v) {
        if (this.musicGain) this.musicGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.2);
    },

    toggleMute() {
        this.init();
        this.muted = !this.muted;
        try { localStorage.setItem('et-muted', this.muted ? '1' : '0'); } catch (e) {}
        if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.05);
        return this.muted;
    }
};
