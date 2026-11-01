import type { Quality } from './scene/Stage';

/** 端末内（localStorage）に保存する設定とハイスコア。サーバーには送らない。 */
export interface Settings {
  quality: Quality | 'auto';
  muted: boolean;
}

export interface BestRecord {
  /** 獲得量 [L] */
  liters: number;
  date: string;
}

const SETTINGS_KEY = 'sand-flag-battle.settings.v1';
const BEST_KEY = 'sand-flag-battle.best.v1';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // プライベートモード等で保存できなくても遊べるようにする
  }
}

export function loadSettings(): Settings {
  return read<Settings>(SETTINGS_KEY, { quality: 'auto', muted: false });
}

export function saveSettings(s: Settings): void {
  write(SETTINGS_KEY, s);
}

export function loadBest(): BestRecord | null {
  const b = read<BestRecord | null>(BEST_KEY, null);
  return b && typeof b.liters === 'number' ? b : null;
}

/** 自己ベストを更新したら true */
export function submitBest(liters: number): boolean {
  const best = loadBest();
  if (best && best.liters >= liters) return false;
  write(BEST_KEY, { liters, date: new Date().toISOString().slice(0, 10) });
  return true;
}
