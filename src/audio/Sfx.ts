/**
 * 効果音（Web Audio でその場で合成。音声ファイル不要）。
 * ブラウザの制約により、最初のタップ／クリックで unlock() してから鳴らす。
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private pourGain: GainNode | null = null;
  muted = false;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.startPourLoop();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  private noiseBurst(duration: number, freq: number, q: number, gain: number, delay = 0, type: BiquadFilterType = 'bandpass'): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.min(0.03, duration * 0.2));
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + duration + 0.05);
  }

  private tone(freq: number, duration: number, gain: number, delay = 0, type: OscillatorType = 'sine', slideTo?: number): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  /** 崩落中のザーッという音（量に応じて音量が変わる） */
  private startPourLoop(): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2600;
    filter.Q.value = 0.6;
    this.pourGain = this.ctx.createGain();
    this.pourGain.gain.value = 0;
    src.connect(filter).connect(this.pourGain).connect(this.master);
    src.start();
  }

  /** 崩落量（m³/秒）に合わせて流れる砂の音量を変える */
  pour(rate: number): void {
    if (!this.ctx || !this.pourGain) return;
    const v = Math.min(0.35, Math.sqrt(Math.max(0, rate)) * 1.6);
    this.pourGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.08);
  }

  dig(size: number): void {
    const s = Math.min(1, size);
    this.noiseBurst(0.18 + s * 0.3, 900 - s * 400, 0.9, 0.5 + s * 0.4);
    this.noiseBurst(0.12, 3200, 1.2, 0.18, 0.05);
  }

  dump(size: number): void {
    const s = Math.min(1, size);
    this.noiseBurst(0.4 + s * 0.5, 1800, 0.5, 0.35 + s * 0.2);
  }

  engine(): void {
    if (!this.ctx) return;
    for (let i = 0; i < 8; i++) this.tone(55 + (i % 2) * 6, 0.22, 0.12, i * 0.2, 'sawtooth');
  }

  thud(): void {
    this.tone(140, 0.45, 0.6, 0, 'sine', 45);
    this.noiseBurst(0.5, 400, 0.7, 0.5, 0.02);
  }

  click(): void {
    this.tone(880, 0.06, 0.08, 0, 'triangle');
  }

  turn(): void {
    this.tone(660, 0.12, 0.12, 0, 'triangle');
    this.tone(990, 0.16, 0.1, 0.09, 'triangle');
  }

  win(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, 0.16, i * 0.12, 'triangle'));
  }

  lose(): void {
    [392, 330, 262].forEach((f, i) => this.tone(f, 0.4, 0.15, i * 0.16, 'triangle'));
  }
}
