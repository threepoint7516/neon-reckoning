import type { WeaponDef } from "@neon/shared";
import { settingsStore } from "../state/settings";

type Vec = { x: number; y: number; z: number };

/**
 * Fully synthesized audio (Web Audio API) — no sample files, no licensing
 * questions. If audio is unavailable the game simply runs silently.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private sfx!: GainNode;
  private ambient!: GainNode;
  private ui!: GainNode;
  private muffle!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private ambientNodes: AudioNode[] = [];
  private musicTimer: number | null = null;
  private musicStep = 0;
  private nextNoteTime = 0;
  private musicMode: "menu" | "match" | "off" = "off";
  private voices = 0;
  private reverb: ConvolverNode | null = null;

  /** Must be called from a user gesture (autoplay policy). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx({ latencyHint: "interactive" });
    } catch {
      this.ctx = null;
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.muffle = c.createBiquadFilter();
    this.muffle.type = "lowpass";
    this.muffle.frequency.value = 20000;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(this.muffle).connect(comp).connect(c.destination);
    this.music = c.createGain();
    this.sfx = c.createGain();
    this.ambient = c.createGain();
    this.ui = c.createGain();
    for (const g of [this.music, this.sfx, this.ambient, this.ui]) g.connect(this.master);
    // White noise buffer reused by every percussive sound.
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // Small synthetic reverb impulse.
    const len = c.sampleRate * 1.6;
    const ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    this.reverb = c.createConvolver();
    this.reverb.buffer = ir;
    const rv = c.createGain();
    rv.gain.value = 0.25;
    this.reverb.connect(rv).connect(this.sfx);
    this.applyVolumes();
    settingsStore.subscribe(() => this.applyVolumes());
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const s = settingsStore.get();
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.masterVol, t, 0.05);
    this.music.gain.setTargetAtTime(s.musicVol * 0.5, t, 0.05);
    this.sfx.gain.setTargetAtTime(s.sfxVol, t, 0.05);
    this.ambient.gain.setTargetAtTime(s.ambientVol * 0.6, t, 0.05);
    this.ui.gain.setTargetAtTime(s.uiVol * 0.7, t, 0.05);
  }

  setListener(pos: Vec, yaw: number): void {
    const c = this.ctx;
    if (!c) return;
    const l = c.listener;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    if (l.positionX) {
      l.positionX.value = pos.x;
      l.positionY.value = pos.y;
      l.positionZ.value = pos.z;
      l.forwardX.value = fx;
      l.forwardY.value = 0;
      l.forwardZ.value = fz;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  /** Flashbang/EMP: muffle everything for a moment. */
  muffleFor(seconds: number, amount = 1): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.muffle.frequency.cancelScheduledValues(t);
    this.muffle.frequency.setValueAtTime(400 + (1 - amount) * 3000, t);
    this.muffle.frequency.exponentialRampToValueAtTime(20000, t + seconds);
    this.tone(3100, 0.06 * amount, seconds * 0.8, "sine", this.sfx);
  }

  // -------------------------------------------------------------------------
  // Building blocks
  // -------------------------------------------------------------------------

  private out(bus: GainNode, pos?: Vec, refDist = 6): AudioNode {
    if (!pos || !this.ctx) return bus;
    const p = this.ctx.createPanner();
    p.panningModel = "HRTF";
    p.distanceModel = "inverse";
    p.refDistance = refDist;
    p.maxDistance = 300;
    p.rolloffFactor = 1.1;
    if (p.positionX) {
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
    } else p.setPosition(pos.x, pos.y, pos.z);
    p.connect(bus);
    return p;
  }

  private budget(): boolean {
    if (this.voices > 48) return false;
    this.voices++;
    setTimeout(() => this.voices--, 600);
    return true;
  }

  private noiseBurst(dest: AudioNode, o: { dur: number; gain: number; type: BiquadFilterType; freq: number; q?: number; sweepTo?: number; delay?: number; attack?: number }): void {
    const c = this.ctx!;
    const t = c.currentTime + (o.delay ?? 0);
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = o.type;
    f.frequency.setValueAtTime(o.freq, t);
    if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + o.dur);
    f.Q.value = o.q ?? 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack ?? 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5, o.dur + 0.05);
  }

  private osc(dest: AudioNode, o: { type: OscillatorType; f0: number; f1?: number; dur: number; gain: number; delay?: number; attack?: number }): void {
    const c = this.ctx!;
    const t = c.currentTime + (o.delay ?? 0);
    const s = c.createOscillator();
    s.type = o.type;
    s.frequency.setValueAtTime(o.f0, t);
    if (o.f1) s.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    s.connect(g).connect(dest);
    s.start(t);
    s.stop(t + o.dur + 0.05);
  }

  private tone(freq: number, gain: number, dur: number, type: OscillatorType, bus: GainNode, delay = 0): void {
    if (!this.ctx) return;
    this.osc(bus, { type, f0: freq, dur, gain, delay, attack: 0.01 });
  }

  // -------------------------------------------------------------------------
  // Game sounds
  // -------------------------------------------------------------------------

  gunshot(def: WeaponDef, pos?: Vec, local = false): void {
    if (!this.ctx || !this.budget()) return;
    const s = def.sound;
    const dest = this.out(this.sfx, pos, 10);
    const k = local ? 1 : 0.85;
    if (s.kind === "energy") {
      this.osc(dest, { type: "sawtooth", f0: 1800 * s.pitch, f1: 160 * s.pitch, dur: 0.12 + s.tail * 0.18, gain: 0.22 * k });
      this.osc(dest, { type: "square", f0: 900 * s.pitch, f1: 90, dur: 0.08 + s.body * 0.1, gain: 0.12 * k });
      this.noiseBurst(dest, { dur: 0.06 + s.crack * 0.06, gain: 0.25 * k, type: "highpass", freq: 3000 });
    } else {
      this.noiseBurst(dest, { dur: 0.05 + s.crack * 0.05, gain: 0.6 * s.crack * k, type: "highpass", freq: 2200 * s.pitch });
      this.noiseBurst(dest, { dur: 0.12 + s.body * 0.15, gain: 0.7 * s.body * k, type: "lowpass", freq: 2400 * s.pitch, sweepTo: 300 });
      this.osc(dest, { type: "sine", f0: 160 * s.pitch, f1: 38, dur: 0.12 + s.body * 0.1, gain: 0.7 * s.body * k });
      if (s.kind === "heavy") this.osc(dest, { type: "triangle", f0: 90, f1: 30, dur: 0.3, gain: 0.5 * k });
    }
    if (this.reverb && s.tail > 0.3) this.noiseBurst(this.reverb, { dur: 0.25 * s.tail + 0.1, gain: 0.25 * s.tail * k, type: "lowpass", freq: 1400 });
    if (local) {
      // Mechanical action click.
      this.noiseBurst(this.sfx, { dur: 0.02, gain: 0.15, type: "bandpass", freq: 4200, q: 6, delay: 0.035 });
    }
  }

  explosion(pos: Vec, size = 1): void {
    if (!this.ctx) return;
    const dest = this.out(this.sfx, pos, 14);
    this.noiseBurst(dest, { dur: 1.4 * size, gain: 1.0, type: "lowpass", freq: 2200, sweepTo: 120, attack: 0.005 });
    this.osc(dest, { type: "sine", f0: 110, f1: 25, dur: 0.9 * size, gain: 1.0 });
    this.noiseBurst(dest, { dur: 0.15, gain: 0.5, type: "highpass", freq: 1500 });
    if (this.reverb) this.noiseBurst(this.reverb, { dur: 1.2, gain: 0.5, type: "lowpass", freq: 900 });
  }

  pop(pos: Vec, kind: "smoke" | "flash" | "emp"): void {
    if (!this.ctx) return;
    const dest = this.out(this.sfx, pos, 8);
    if (kind === "smoke") this.noiseBurst(dest, { dur: 1.6, gain: 0.35, type: "bandpass", freq: 900, sweepTo: 300, attack: 0.05 });
    else if (kind === "flash") {
      this.noiseBurst(dest, { dur: 0.5, gain: 0.9, type: "highpass", freq: 2500 });
      this.osc(dest, { type: "sine", f0: 140, f1: 50, dur: 0.3, gain: 0.6 });
    } else {
      this.osc(dest, { type: "sawtooth", f0: 60, f1: 2400, dur: 0.5, gain: 0.25 });
      this.osc(dest, { type: "square", f0: 2400, f1: 80, dur: 0.6, gain: 0.15, delay: 0.1 });
      this.noiseBurst(dest, { dur: 0.6, gain: 0.3, type: "bandpass", freq: 1800, q: 3 });
    }
  }

  footstep(pos?: Vec, loud = 1, metal = false): void {
    if (!this.ctx || !this.budget()) return;
    const dest = this.out(this.sfx, pos, 3);
    this.noiseBurst(dest, { dur: 0.07, gain: 0.18 * loud, type: "bandpass", freq: metal ? 2600 : 900 + Math.random() * 300, q: metal ? 4 : 1.2 });
    this.osc(dest, { type: "sine", f0: 90, f1: 50, dur: 0.06, gain: 0.12 * loud });
  }

  land(intensity: number): void {
    if (!this.ctx) return;
    this.noiseBurst(this.sfx, { dur: 0.12, gain: Math.min(0.5, 0.1 + intensity * 0.02), type: "lowpass", freq: 700 });
    this.osc(this.sfx, { type: "sine", f0: 110, f1: 40, dur: 0.12, gain: Math.min(0.6, 0.15 + intensity * 0.03) });
  }

  jump(): void {
    if (!this.ctx) return;
    this.noiseBurst(this.sfx, { dur: 0.08, gain: 0.08, type: "bandpass", freq: 1200 });
  }

  slide(): void {
    if (!this.ctx) return;
    this.noiseBurst(this.sfx, { dur: 0.6, gain: 0.18, type: "bandpass", freq: 600, sweepTo: 250, attack: 0.03 });
  }

  reload(stage: number): void {
    if (!this.ctx) return;
    const base = stage === 1 ? [0] : [0, 0.25, 0.55];
    base.forEach((d, i) => this.noiseBurst(this.sfx, { dur: 0.035, gain: 0.25, type: "bandpass", freq: 2200 + i * 900, q: 5, delay: d }));
    if (stage === 0) this.osc(this.sfx, { type: "triangle", f0: 400, f1: 900, dur: 0.12, gain: 0.05, delay: 0.5 });
  }

  swap(): void {
    if (!this.ctx) return;
    this.noiseBurst(this.sfx, { dur: 0.15, gain: 0.12, type: "bandpass", freq: 1500, sweepTo: 3000 });
    this.noiseBurst(this.sfx, { dur: 0.03, gain: 0.2, type: "bandpass", freq: 3500, q: 6, delay: 0.12 });
  }

  dry(): void {
    if (!this.ctx) return;
    this.noiseBurst(this.sfx, { dur: 0.025, gain: 0.25, type: "bandpass", freq: 5000, q: 8 });
  }

  throwSound(pos?: Vec): void {
    if (!this.ctx) return;
    this.noiseBurst(this.out(this.sfx, pos, 4), { dur: 0.2, gain: 0.15, type: "bandpass", freq: 700, sweepTo: 1600, attack: 0.04 });
  }

  bounce(pos: Vec): void {
    if (!this.ctx || !this.budget()) return;
    this.noiseBurst(this.out(this.sfx, pos, 4), { dur: 0.04, gain: 0.25, type: "bandpass", freq: 2600, q: 4 });
  }

  impact(pos: Vec): void {
    if (!this.ctx || !this.budget()) return;
    this.noiseBurst(this.out(this.sfx, pos, 3), { dur: 0.05, gain: 0.2, type: "bandpass", freq: 2000 + Math.random() * 2000, q: 3 });
  }

  hitmarker(head: boolean, kill: boolean, shieldBreak = false): void {
    if (!this.ctx) return;
    if (kill) {
      this.tone(880, 0.2, 0.12, "triangle", this.ui);
      this.tone(1320, 0.18, 0.18, "triangle", this.ui, 0.06);
      this.tone(1760, 0.14, 0.25, "sine", this.ui, 0.12);
    } else if (head) {
      this.tone(2400, 0.18, 0.08, "sine", this.ui);
      this.tone(3200, 0.1, 0.06, "sine", this.ui, 0.03);
    } else this.tone(1600, 0.12, 0.05, "square", this.ui);
    if (shieldBreak) this.noiseBurst(this.ui, { dur: 0.25, gain: 0.3, type: "highpass", freq: 3000 });
  }

  hurt(amount: number): void {
    if (!this.ctx) return;
    this.osc(this.sfx, { type: "sine", f0: 120, f1: 50, dur: 0.18, gain: Math.min(0.6, 0.15 + amount / 80) });
    this.noiseBurst(this.sfx, { dur: 0.1, gain: 0.2, type: "lowpass", freq: 600 });
  }

  heal(): void {
    if (!this.ctx) return;
    this.osc(this.sfx, { type: "sine", f0: 500, f1: 1200, dur: 0.6, gain: 0.1, attack: 0.1 });
  }

  pickup(): void {
    if (!this.ctx) return;
    this.tone(660, 0.12, 0.08, "triangle", this.ui);
    this.tone(990, 0.12, 0.12, "triangle", this.ui, 0.06);
  }

  medal(): void {
    if (!this.ctx) return;
    [523, 659, 784].forEach((f, i) => this.tone(f, 0.08, 0.2, "triangle", this.ui, i * 0.05));
  }

  alert(kind: "good" | "bad" | "neutral" | "start" | "end"): void {
    if (!this.ctx) return;
    const seqs: Record<string, number[]> = {
      good: [523, 659, 784, 1047], bad: [784, 622, 523, 392], neutral: [660, 880], start: [392, 523, 659, 784, 1047], end: [1047, 784, 659, 523, 392, 262],
    };
    seqs[kind]!.forEach((f, i) => this.tone(f, 0.1, 0.25, "sawtooth", this.ui, i * 0.09));
  }

  uiHover(): void {
    if (!this.ctx) return;
    this.tone(1800, 0.03, 0.03, "sine", this.ui);
  }

  uiClick(): void {
    if (!this.ctx) return;
    this.tone(900, 0.08, 0.05, "square", this.ui);
    this.tone(1400, 0.05, 0.05, "sine", this.ui, 0.03);
  }

  beep(pos: Vec): void {
    if (!this.ctx || !this.budget()) return;
    this.osc(this.out(this.sfx, pos, 3), { type: "square", f0: 1900, dur: 0.06, gain: 0.12 });
  }

  // -------------------------------------------------------------------------
  // Ambience & music
  // -------------------------------------------------------------------------

  startAmbient(rain: boolean): void {
    if (!this.ctx) return;
    this.stopAmbient();
    const c = this.ctx;
    // City hum.
    const hum = c.createOscillator();
    hum.type = "sawtooth";
    hum.frequency.value = 55;
    const humF = c.createBiquadFilter();
    humF.type = "lowpass";
    humF.frequency.value = 140;
    const humG = c.createGain();
    humG.gain.value = 0.06;
    hum.connect(humF).connect(humG).connect(this.ambient);
    hum.start();
    this.ambientNodes.push(hum, humF, humG);
    // Wind / distant traffic bed.
    const bed = c.createBufferSource();
    bed.buffer = this.noise;
    bed.loop = true;
    const bedF = c.createBiquadFilter();
    bedF.type = "lowpass";
    bedF.frequency.value = rain ? 3500 : 500;
    const bedG = c.createGain();
    bedG.gain.value = rain ? 0.12 : 0.06;
    bed.connect(bedF).connect(bedG).connect(this.ambient);
    bed.start();
    this.ambientNodes.push(bed, bedF, bedG);
    if (rain) {
      const drip = c.createBufferSource();
      drip.buffer = this.noise;
      drip.loop = true;
      drip.playbackRate.value = 0.5;
      const df = c.createBiquadFilter();
      df.type = "highpass";
      df.frequency.value = 6000;
      const dg = c.createGain();
      dg.gain.value = 0.05;
      drip.connect(df).connect(dg).connect(this.ambient);
      drip.start();
      this.ambientNodes.push(drip, df, dg);
    }
  }

  stopAmbient(): void {
    for (const n of this.ambientNodes) {
      try {
        if (n instanceof AudioScheduledSourceNode) n.stop();
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.ambientNodes = [];
  }

  /** Occasional distant city events (sirens, drones). */
  distantEvent(): void {
    if (!this.ctx) return;
    const r = Math.random();
    if (r < 0.5) this.osc(this.ambient, { type: "sine", f0: 700, f1: 950, dur: 1.4, gain: 0.025, attack: 0.4 });
    else this.osc(this.ambient, { type: "sawtooth", f0: 80, f1: 60, dur: 2.5, gain: 0.03, attack: 0.8 });
  }

  playMusic(mode: "menu" | "match" | "off"): void {
    if (!this.ctx || mode === this.musicMode) return;
    this.musicMode = mode;
    if (this.musicTimer !== null) clearInterval(this.musicTimer);
    this.musicTimer = null;
    if (mode === "off") return;
    this.musicStep = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 25);
  }

  /** Tiny synthwave sequencer: bass arpeggio, pads, drums. */
  private scheduleMusic(): void {
    const c = this.ctx;
    if (!c) return;
    const bpm = this.musicMode === "menu" ? 96 : 112;
    const stepDur = 60 / bpm / 4;
    const chords = [
      [45, 52, 57, 60], // Am
      [41, 48, 53, 57], // F
      [43, 50, 55, 59], // G
      [40, 47, 52, 55], // Em
    ];
    const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
    while (this.nextNoteTime < c.currentTime + 0.12) {
      const step = this.musicStep;
      const t0 = this.nextNoteTime - c.currentTime;
      const bar = Math.floor(step / 16) % 4;
      const chord = chords[bar]!;
      const s = step % 16;
      const intense = this.musicMode === "match";
      // Bass: driving eighths.
      if (s % 2 === 0) {
        const note = chord[0]! + (s % 8 === 6 ? 12 : 0) - 12;
        this.osc(this.music, { type: "sawtooth", f0: mtof(note), dur: stepDur * 1.8, gain: 0.08, delay: t0, attack: 0.005 });
      }
      // Arpeggio.
      if (s % 1 === 0 && (intense || s % 2 === 0)) {
        const n = chord[(s * 3) % 4]! + 12;
        this.osc(this.music, { type: "square", f0: mtof(n), dur: stepDur * 0.9, gain: 0.025, delay: t0, attack: 0.003 });
      }
      // Pad at the start of each bar.
      if (s === 0)
        for (const n of chord.slice(1)) {
          this.osc(this.music, { type: "sawtooth", f0: mtof(n) * 1.003, dur: stepDur * 15, gain: 0.018, delay: t0, attack: 0.6 });
          this.osc(this.music, { type: "sawtooth", f0: mtof(n) * 0.997, dur: stepDur * 15, gain: 0.018, delay: t0, attack: 0.6 });
        }
      // Drums.
      if (s % 4 === 0) this.osc(this.music, { type: "sine", f0: 140, f1: 40, dur: 0.18, gain: intense ? 0.35 : 0.22, delay: t0 });
      if (s % 8 === 4) this.noiseBurst(this.music, { dur: 0.15, gain: 0.12, type: "bandpass", freq: 1800, delay: t0 });
      if (intense && s % 2 === 1) this.noiseBurst(this.music, { dur: 0.03, gain: 0.04, type: "highpass", freq: 8000, delay: t0 });
      this.musicStep++;
      this.nextNoteTime += stepDur;
    }
  }
}

export const audio = new AudioEngine();
