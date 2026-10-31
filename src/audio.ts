export class GameAudio {
  enabled = true;
  private context: AudioContext | null = null;

  unlock() {
    try {
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch { /* Audio is optional. */ }
  }

  play(kind: 'start' | 'launch' | 'miss', quality = 0.5) {
    if (!this.enabled || !this.context) return;
    const ctx = this.context;
    const notes = kind === 'miss' ? [220, 164, 110] : kind === 'start' ? [330, 440, 660] : [340 + quality * 180, 510 + quality * 300];
    notes.forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const time = ctx.currentTime + index * 0.075;
      oscillator.type = kind === 'miss' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, time);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * (kind === 'miss' ? 0.65 : 1.12), time + 0.22);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.09, time + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.32);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(time);
      oscillator.stop(time + 0.34);
    });
  }
}
