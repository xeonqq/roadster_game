// Procedural audio: engine, sirens, weapons and a synthwave loop.
// Everything is generated with WebAudio, so the game ships with zero assets.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.muted = false;
    this.started = false;
    this._musicTimer = null;
    this._nextNote = 0;
    this._step = 0;
    this._noiseBuffer = null;
    this._distCurve = null;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 18;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0.65;
    this.master.connect(comp);

    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.11;
    this.musicGain.connect(this.master);

    this._makeNoise();
    this._makeEngine();
    this._makeSiren();
    this._makeBoost();

    this.started = true;
    const t = ctx.currentTime + 0.15;
    this._nextNote = t;
    this._musicTimer = setInterval(() => this._schedule(), 40);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.65, this.ctx.currentTime, 0.05);
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  _makeNoise() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noiseBuffer = buf;
  }

  _noiseSource(loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this._noiseBuffer;
    s.loop = loop;
    return s;
  }

  _makeEngine() {
    const ctx = this.ctx;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 420;
    this.engineFilter.Q.value = 3;
    this.engineGain.connect(this.engineFilter);
    this.engineFilter.connect(this.sfxGain);

    this.engineOsc1 = ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc1.frequency.value = 55;
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineOsc2.frequency.value = 55.7;
    const g2 = ctx.createGain();
    g2.gain.value = 0.36;
    this.engineOsc1.connect(this.engineGain);
    this.engineOsc2.connect(g2);
    g2.connect(this.engineGain);
    this.engineOsc1.start();
    this.engineOsc2.start();

    // turbo whine
    this.whineOsc = ctx.createOscillator();
    this.whineOsc.type = 'triangle';
    this.whineOsc.frequency.value = 300;
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whineOsc.connect(this.whineGain);
    this.whineGain.connect(this.sfxGain);
    this.whineOsc.start();
  }

  setEngine(speed, boosting, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = Math.min(1, Math.abs(speed) / 95);
    const freq = 42 + s * 105 + (boosting ? 25 : 0);
    this.engineOsc1.frequency.setTargetAtTime(freq, t, 0.08);
    this.engineOsc2.frequency.setTargetAtTime(freq * 1.012, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(300 + s * 950, t, 0.1);
    this.engineGain.gain.setTargetAtTime(active ? 0.055 + s * 0.05 : 0, t, 0.15);
    this.whineGain.gain.setTargetAtTime(active ? 0.012 + s * 0.02 : 0, t, 0.1);
    this.whineOsc.frequency.setTargetAtTime(180 + s * 520 + (boosting ? 220 : 0), t, 0.1);
  }

  _makeSiren() {
    const ctx = this.ctx;
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenGain.connect(this.sfxGain);
    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 720;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 1.35;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 190;
    lfo.connect(lfoGain);
    lfoGain.connect(this.sirenOsc.frequency);
    this.sirenOsc.connect(this.sirenGain);
    this.sirenOsc.start();
    lfo.start();
  }

  setSiren(intensity) {
    if (!this.ctx) return;
    this.sirenGain.gain.setTargetAtTime(Math.min(0.055, intensity * 0.055), this.ctx.currentTime, 0.2);
  }

  _makeBoost() {
    const ctx = this.ctx;
    const src = this._noiseSource(true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.8;
    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0;
    src.connect(bp);
    bp.connect(this.boostGain);
    this.boostGain.connect(this.sfxGain);
    src.start();
    this.boostFilter = bp;
  }

  setBoost(on, strength = 1) {
    if (!this.ctx) return;
    this.boostGain.gain.setTargetAtTime(on ? 0.11 * strength : 0, this.ctx.currentTime, on ? 0.04 : 0.15);
    this.boostFilter.frequency.setTargetAtTime(on ? 1500 : 700, this.ctx.currentTime, 0.1);
  }

  // ── one-shots ───────────────────────────────────────────────────────
  _env(node, t0, a, d, peak = 0.3) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    node.connect(g);
    g.connect(this.sfxGain);
    return g;
  }

  _noiseHit({ dur = 0.16, type = 'bandpass', f0 = 1000, f1 = 220, q = 1, gain = 0.25, delay = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this._noiseSource();
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    src.connect(filt);
    this._env(filt, t, 0.003, dur, gain);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  _tone({ f0 = 440, f1 = 440, dur = 0.15, type = 'sine', gain = 0.15, delay = 0, at = null }) {
    if (!this.ctx) return;
    const t = at ?? this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, f0), t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this._env(osc, t, 0.004, dur, gain);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  gun(type) {
    switch (type) {
      case 'smg':
        this._noiseHit({ dur: 0.07, f0: 2400, f1: 500, q: 0.7, gain: 0.14 });
        this._tone({ f0: 190, f1: 80, dur: 0.05, type: 'square', gain: 0.05 });
        break;
      case 'shotgun':
        this._noiseHit({ dur: 0.25, f0: 1400, f1: 120, q: 0.5, gain: 0.34 });
        this._tone({ f0: 120, f1: 45, dur: 0.22, type: 'sawtooth', gain: 0.12 });
        break;
      case 'rocket':
        this._noiseHit({ dur: 0.5, type: 'lowpass', f0: 1600, f1: 200, q: 0.5, gain: 0.28 });
        this._tone({ f0: 170, f1: 70, dur: 0.35, type: 'sawtooth', gain: 0.08 });
        break;
      case 'rail':
        this._tone({ f0: 1800, f1: 240, dur: 0.28, type: 'sawtooth', gain: 0.12 });
        this._noiseHit({ dur: 0.2, type: 'highpass', f0: 3000, f1: 800, q: 0.8, gain: 0.16 });
        break;
      case 'emp':
        this._tone({ f0: 240, f1: 1400, dur: 0.35, type: 'sine', gain: 0.12 });
        this._tone({ f0: 900, f1: 300, dur: 0.4, type: 'triangle', gain: 0.06, delay: 0.05 });
        break;
      default:
        this._noiseHit({ dur: 0.08, f0: 1800, f1: 300, gain: 0.12 });
    }
  }

  copGun() {
    this._noiseHit({ dur: 0.09, f0: 1700, f1: 300, q: 0.8, gain: 0.08 });
  }

  explosion(big = false) {
    if (!this.ctx) return;
    const dur = big ? 1.1 : 0.7;
    this._noiseHit({ dur, type: 'lowpass', f0: 1200, f1: 45, q: 0.4, gain: big ? 0.5 : 0.34 });
    this._tone({ f0: big ? 90 : 130, f1: 28, dur: dur * 0.9, type: 'sine', gain: big ? 0.32 : 0.2 });
    this._noiseHit({ dur: 0.18, type: 'highpass', f0: 5000, f1: 1200, q: 0.4, gain: 0.12 });
  }

  impact(force = 1) {
    this._noiseHit({ dur: 0.14, f0: 600, f1: 70, q: 0.6, gain: 0.12 * Math.min(2, force) });
    this._tone({ f0: 130, f1: 52, dur: 0.12, type: 'triangle', gain: 0.08 * Math.min(2, force) });
  }

  jump() {
    this._noiseHit({ dur: 0.35, type: 'highpass', f0: 500, f1: 3200, q: 0.6, gain: 0.22 });
    this._tone({ f0: 160, f1: 500, dur: 0.25, type: 'triangle', gain: 0.09 });
  }

  land() {
    this._noiseHit({ dur: 0.2, type: 'lowpass', f0: 500, f1: 60, q: 1, gain: 0.24 });
    this._tone({ f0: 90, f1: 38, dur: 0.18, type: 'sine', gain: 0.13 });
  }

  pickup(kind = 'gun') {
    if (kind === 'turbo') {
      this._tone({ f0: 520, f1: 1200, dur: 0.2, type: 'sine', gain: 0.1 });
      return;
    }
    if (kind === 'repair') {
      this._tone({ f0: 440, f1: 880, dur: 0.12, type: 'triangle', gain: 0.1 });
      this._tone({ f0: 660, f1: 1320, dur: 0.16, type: 'sine', gain: 0.08, delay: 0.08 });
      return;
    }
    this._tone({ f0: 620, f1: 930, dur: 0.1, type: 'sine', gain: 0.09 });
    this._tone({ f0: 930, f1: 1390, dur: 0.14, type: 'sine', gain: 0.07, delay: 0.07 });
  }

  empBlast() {
    this._tone({ f0: 120, f1: 40, dur: 0.7, type: 'sine', gain: 0.25 });
    this._noiseHit({ dur: 0.5, type: 'bandpass', f0: 2200, f1: 180, q: 2, gain: 0.2 });
  }

  ui() {
    this._tone({ f0: 880, f1: 1320, dur: 0.07, type: 'square', gain: 0.03 });
  }

  alert() {
    this._tone({ f0: 300, f1: 300, dur: 0.12, type: 'square', gain: 0.045 });
    this._tone({ f0: 300, f1: 300, dur: 0.12, type: 'square', gain: 0.045, delay: 0.18 });
  }

  // ── music ───────────────────────────────────────────────────────────
  _schedule() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const stepDur = 60 / 104 / 4;
    while (this._nextNote < ctx.currentTime + 0.14) {
      this._playStep(this._step, this._nextNote, stepDur);
      this._step = (this._step + 1) % 64;
      this._nextNote += stepDur;
    }
  }

  _playStep(step, t, stepDur) {
    const ctx = this.ctx;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const roots = [55, 43.65, 65.41, 49]; // A1, F1, C2, G1
    const root = roots[bar];

    // kick
    if (s === 0 || s === 6 || s === 10) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(120, t);
      osc.frequency.exponentialRampToValueAtTime(38, t + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(g); g.connect(this.musicGain);
      osc.start(t); osc.stop(t + 0.25);
    }
    // hats
    if (s % 2 === 1) {
      const src = this._noiseSource();
      const filt = ctx.createBiquadFilter();
      filt.type = 'highpass'; filt.frequency.value = 7000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(s % 4 === 1 ? 0.10 : 0.05, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      src.connect(filt); filt.connect(g); g.connect(this.musicGain);
      src.start(t); src.stop(t + 0.08);
    }
    // bass pulse
    if (s % 2 === 0) {
      const seq = [0, 0, 0, 12, 0, 0, 7, 0];
      const semi = seq[(s / 2) % 8];
      const f = root * Math.pow(2, semi / 12);
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.setValueAtTime(240 + (s === 0 ? 500 : 0), t);
      filt.frequency.exponentialRampToValueAtTime(130, t + stepDur * 1.6);
      filt.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.13, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + stepDur * 1.7);
      osc.connect(filt); filt.connect(g); g.connect(this.musicGain);
      osc.start(t); osc.stop(t + stepDur * 1.8);
    }
    // pad at the top of each bar
    if (s === 0) {
      const chord = bar === 0 ? [0, 3, 7] : bar === 1 ? [0, 4, 7] : bar === 2 ? [0, 4, 7] : [0, 4, 7];
      chord.forEach((semi, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = root * 2 * Math.pow(2, semi / 12);
        const g = ctx.createGain();
        const dur = stepDur * 14;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.022, t + 0.5);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g); g.connect(this.musicGain);
        osc.start(t); osc.stop(t + dur + 0.1);
      });
    }
    // sparse arp
    if (s === 2 || s === 7 || s === 11 || s === 14) {
      const seq = [12, 19, 24, 19];
      const f = root * 4 * Math.pow(2, seq[(s + bar) % 4] / 12);
      this._tone({ f0: f, f1: f, dur: 0.12, type: 'square', gain: 0.015, at: t });
    }
  }
}
