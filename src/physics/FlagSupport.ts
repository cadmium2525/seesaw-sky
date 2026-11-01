import { CONFIG } from '../config';
import type { SandField } from '../terrain/SandField';

export interface FlagAnchor {
  x: number;
  z: number;
  /** 旗竿の下端の高さ */
  baseY: number;
  /** 埋まっている深さ */
  burial: number;
  /** 立てた時点の各サンプル点の埋まり具合（基準値） */
  initial: number[];
}

export interface SupportState {
  /** 支持率 0..1（1=最初と同じだけ砂に埋まっている） */
  support: number;
  /** 傾き [度] */
  leanDeg: number;
  /** 倒れる方向（砂が少ない側） [rad]、xz平面 */
  leanDir: number;
  /** 安定度 0..1（UI表示用。0で倒れる） */
  stability: number;
  fallen: boolean;
}

interface Sample {
  dx: number;
  dz: number;
  radius: number;
  weight: number;
}

function samples(): Sample[] {
  const cfg = CONFIG.flag;
  const list: Sample[] = [];
  cfg.supportRadii.forEach((radius, r) => {
    const count = radius === 0 ? 1 : cfg.supportAngles;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2;
      list.push({ dx: Math.cos(a), dz: Math.sin(a), radius, weight: cfg.supportWeights[r] / count });
    }
  });
  return list;
}

const SAMPLES = samples();

function embedment(field: SandField, anchor: Omit<FlagAnchor, 'initial'>, s: Sample): number {
  const h = field.heightAt(anchor.x + s.dx * s.radius, anchor.z + s.dz * s.radius);
  return Math.min(Math.max((h - anchor.baseY) / anchor.burial, 0), 1.25);
}

/** 頂上の砂面に旗を立てる */
export function plantFlag(field: SandField, x = 0, z = 0): FlagAnchor {
  const burial = CONFIG.flag.burial;
  const base = { x, z, baseY: field.heightAt(x, z) - burial, burial };
  return { ...base, initial: SAMPLES.map((s) => Math.max(embedment(field, base, s), 0.05)) };
}

/**
 * 旗竿の根元付近の砂の残り具合から、支持率と傾きを計算する。
 * 周囲を同心円状にサンプルし、立てた時点と比べて砂が減った側へ傾く。
 */
export function evaluateSupport(field: SandField, anchor: FlagAnchor): SupportState {
  const cfg = CONFIG.flag;
  let wSum = 0;
  let sSum = 0;
  let ax = 0;
  let az = 0;
  SAMPLES.forEach((s, i) => {
    const e0 = anchor.initial[i];
    const ratio = Math.min(embedment(field, anchor, s) / e0, 1);
    const w = s.weight * e0;
    wSum += w;
    sSum += w * ratio;
    if (s.radius > 0) {
      ax += w * (1 - ratio) * s.dx;
      az += w * (1 - ratio) * s.dz;
    }
  });
  const support = sSum / wSum;
  const asym = Math.hypot(ax, az) / wSum;
  const loss = 1 - support;
  const leanDeg = cfg.leanPerAsymmetry * asym * 2.2 + cfg.leanPerLoss * loss * loss;
  const leanDir = asym > 1e-9 ? Math.atan2(az, ax) : 0;
  const bySupport = (support - cfg.minSupport) / (1 - cfg.minSupport);
  const byLean = 1 - leanDeg / cfg.maxLeanDeg;
  const stability = Math.max(0, Math.min(1, Math.min(bySupport, byLean)));
  const fallen = support < cfg.minSupport || leanDeg > cfg.maxLeanDeg;
  return { support, leanDeg, leanDir, stability, fallen };
}
