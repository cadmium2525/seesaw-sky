import { CONFIG } from '../config';
import { brushBounds, brushWeight, type Brush } from '../tools/DigTools';
import { createRandom, createValueNoise } from '../util/random';

export interface FieldOptions {
  size: number;
  resolution: number;
  reposeAngleDeg: number;
  flowRate: number;
}

const NEIGHBORS: Array<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * 砂の高さマップ。掘削（体積の減算）と、安息角を超えた斜面の崩落を近似する。
 * 描画には依存しない純粋なデータ構造なので、テストからも直接使える。
 */
export class SandField {
  readonly size: number;
  readonly resolution: number;
  /** 一辺の頂点数 */
  readonly n: number;
  readonly cell: number;
  readonly cellArea: number;
  readonly heights: Float64Array;
  /** 見た目用：掘られて湿った砂が見えている度合い 0..1 */
  readonly moisture: Float32Array;
  private readonly delta: Float64Array;
  private readonly maxSlope: number;
  private readonly flowRate: number;
  private readonly options: FieldOptions;
  /** 前回の崩落ステップで大きく動いた頂点（砂煙の演出用） */
  readonly flowing: number[] = [];
  /** 崩落を計算する範囲（変化のあった頂点の外接矩形）。安定した場所は計算しない */
  private active = { x0: 0, x1: -1, z0: 0, z1: -1 };

  constructor(options: Partial<FieldOptions> = {}) {
    this.size = options.size ?? CONFIG.fieldSize;
    this.resolution = options.resolution ?? CONFIG.resolution;
    this.n = this.resolution + 1;
    this.cell = this.size / this.resolution;
    this.cellArea = this.cell * this.cell;
    this.heights = new Float64Array(this.n * this.n);
    this.moisture = new Float32Array(this.n * this.n);
    this.delta = new Float64Array(this.n * this.n);
    this.maxSlope = Math.tan(((options.reposeAngleDeg ?? CONFIG.sand.reposeAngleDeg) * Math.PI) / 180);
    this.flowRate = options.flowRate ?? CONFIG.sand.flowRate;
    this.options = {
      size: this.size,
      resolution: this.resolution,
      reposeAngleDeg: options.reposeAngleDeg ?? CONFIG.sand.reposeAngleDeg,
      flowRate: this.flowRate,
    };
    this.activateAll();
  }

  /** 全域を崩落計算の対象にする（高さを直接書き換えた後に呼ぶ） */
  activateAll(): void {
    this.active = { x0: 0, x1: this.resolution, z0: 0, z1: this.resolution };
  }

  private activateRect(x0: number, x1: number, z0: number, z1: number): void {
    const a = this.active;
    if (a.x1 < a.x0) {
      this.active = { x0, x1, z0, z1 };
    } else {
      a.x0 = Math.min(a.x0, x0);
      a.x1 = Math.max(a.x1, x1);
      a.z0 = Math.min(a.z0, z0);
      a.z1 = Math.max(a.z1, z1);
    }
  }

  /** 安定したとみなし、崩落計算を止める（ごく僅かな移動が続くのを打ち切る） */
  sleep(): void {
    this.active = { x0: 0, x1: -1, z0: 0, z1: -1 };
  }

  /** 崩落がまだ続く可能性があるか */
  get isActive(): boolean {
    return this.active.x1 >= this.active.x0;
  }

  /** 固定シードで初期の砂山を作り、崩れない形まで落ち着かせる */
  static createMound(seed: number, options: Partial<FieldOptions> = {}): SandField {
    const field = new SandField(options);
    const { radius, height, roughness } = CONFIG.mound;
    const rand = createRandom(seed);
    const noiseA = createValueNoise(seed ^ 0x9e3779b9, 9);
    const noiseB = createValueNoise(seed ^ 0x85ebca6b, 23);
    const skewX = (rand() - 0.5) * 0.06;
    const skewZ = (rand() - 0.5) * 0.06;
    for (let iz = 0; iz < field.n; iz++) {
      for (let ix = 0; ix < field.n; ix++) {
        const x = field.xOf(ix);
        const z = field.zOf(iz);
        const u = ix / field.resolution;
        const v = iz / field.resolution;
        const wobble = 1 + 0.05 * noiseA(u, v);
        const t = Math.hypot(x - skewX * (1 - Math.hypot(x, z) / radius), z - skewZ) / (radius * wobble);
        let h = t < 1 ? height * (1 - Math.pow(t, 1.1)) : 0;
        if (h > 0) {
          h += roughness * (0.7 * noiseA(u * 1.7, v * 1.7) + 0.3 * noiseB(u, v)) * Math.min(1, h / 0.08);
        }
        field.heights[field.index(ix, iz)] = Math.max(0, h);
      }
    }
    field.settle(2000);
    return field;
  }

  index(ix: number, iz: number): number {
    return iz * this.n + ix;
  }

  xOf(ix: number): number {
    return -this.size / 2 + ix * this.cell;
  }

  zOf(iz: number): number {
    return -this.size / 2 + iz * this.cell;
  }

  /** 双一次補間した高さ */
  heightAt(x: number, z: number): number {
    const fx = (x + this.size / 2) / this.cell;
    const fz = (z + this.size / 2) / this.cell;
    const ix = Math.min(Math.max(Math.floor(fx), 0), this.resolution - 1);
    const iz = Math.min(Math.max(Math.floor(fz), 0), this.resolution - 1);
    const tx = Math.min(Math.max(fx - ix, 0), 1);
    const tz = Math.min(Math.max(fz - iz, 0), 1);
    const h = this.heights;
    const a = h[this.index(ix, iz)];
    const b = h[this.index(ix + 1, iz)];
    const c = h[this.index(ix, iz + 1)];
    const d = h[this.index(ix + 1, iz + 1)];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }

  /** 砂の総体積 [m³] */
  totalVolume(): number {
    let sum = 0;
    for (let i = 0; i < this.heights.length; i++) sum += this.heights[i];
    return sum * this.cellArea;
  }

  private forBrush(brush: Brush, fn: (i: number, w: number) => void): [number, number, number, number] {
    const b = brushBounds(brush);
    const ix0 = Math.max(0, Math.floor((b.minX + this.size / 2) / this.cell));
    const ix1 = Math.min(this.resolution, Math.ceil((b.maxX + this.size / 2) / this.cell));
    const iz0 = Math.max(0, Math.floor((b.minZ + this.size / 2) / this.cell));
    const iz1 = Math.min(this.resolution, Math.ceil((b.maxZ + this.size / 2) / this.cell));
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const w = brushWeight(brush, this.xOf(ix), this.zOf(iz));
        if (w > 0) fn(this.index(ix, iz), w);
      }
    }
    return [ix0, ix1, iz0, iz1];
  }

  /** 実際には掘らずに、掘れる体積 [m³] を見積もる */
  previewDig(brush: Brush): number {
    let removed = 0;
    this.forBrush(brush, (i, w) => {
      removed += Math.min(this.heights[i], brush.depth * w);
    });
    return removed * this.cellArea;
  }

  /**
   * 掘削して取り除いた体積 [m³] を返す。fraction で一部だけ掘ると、
   * 何回かに分けた合計が一度に掘った量と一致する（アニメーション用）。
   */
  dig(brush: Brush, fraction = 1): number {
    let removed = 0;
    const [x0, x1, z0, z1] = this.forBrush(brush, (i, w) => {
      const take = Math.min(this.heights[i], brush.depth * w * fraction);
      if (take <= 0) return;
      this.heights[i] -= take;
      removed += take;
      this.moisture[i] = Math.min(1, this.moisture[i] + take * 30);
    });
    this.activateRect(x0, x1, z0, z1);
    return removed * this.cellArea;
  }

  /**
   * 崩落を1ステップ進め、移動した砂の体積 [m³] を返す。
   * 全頂点の流出量を先に計算してから一斉に反映するため、処理順に依存せず砂の総量は保存される。
   */
  step(): number {
    const { n, heights: h, delta, cell, maxSlope, flowRate } = this;
    this.flowing.length = 0;
    if (!this.isActive) return 0;
    const last = n - 1;
    // 変化した頂点の隣までが崩れうる範囲
    const x0 = Math.max(0, this.active.x0 - 1);
    const x1 = Math.min(last, this.active.x1 + 1);
    const z0 = Math.max(0, this.active.z0 - 1);
    const z1 = Math.min(last, this.active.z1 + 1);
    for (let iz = Math.max(0, z0 - 1); iz <= Math.min(last, z1 + 1); iz++) {
      delta.fill(0, iz * n + Math.max(0, x0 - 1), iz * n + Math.min(last, x1 + 1) + 1);
    }
    let moved = 0;
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const i = iz * n + ix;
        const hi = h[i];
        if (hi <= 0) continue;
        let sum = 0;
        let maxDiff = 0;
        for (let k = 0; k < 8; k++) {
          const nx = ix + NEIGHBORS[k][0];
          const nz = iz + NEIGHBORS[k][1];
          if (nx < 0 || nz < 0 || nx > last || nz > last) continue;
          const diff = hi - h[nz * n + nx] - maxSlope * cell * NEIGHBORS[k][2];
          if (diff > 0) {
            sum += diff;
            if (diff > maxDiff) maxDiff = diff;
          }
        }
        if (maxDiff <= 0) continue;
        const total = Math.min(hi, maxDiff * 0.5 * flowRate);
        for (let k = 0; k < 8; k++) {
          const nx = ix + NEIGHBORS[k][0];
          const nz = iz + NEIGHBORS[k][1];
          if (nx < 0 || nz < 0 || nx > last || nz > last) continue;
          const j = nz * n + nx;
          const diff = hi - h[j] - maxSlope * cell * NEIGHBORS[k][2];
          if (diff > 0) delta[j] += (total * diff) / sum;
        }
        delta[i] -= total;
        moved += total;
        if (total > 0.0015) this.flowing.push(i);
      }
    }
    // 反映しつつ、次のステップで計算する範囲を求める
    let nx0 = n;
    let nx1 = -1;
    let nz0 = n;
    let nz1 = -1;
    const minChange = 1e-9;
    for (let iz = Math.max(0, z0 - 1); iz <= Math.min(last, z1 + 1); iz++) {
      for (let ix = Math.max(0, x0 - 1); ix <= Math.min(last, x1 + 1); ix++) {
        const i = iz * n + ix;
        const d = delta[i];
        if (d === 0) continue;
        h[i] = Math.max(0, h[i] + d);
        if (d > 0) this.moisture[i] *= 0.985;
        if (Math.abs(d) > minChange) {
          if (ix < nx0) nx0 = ix;
          if (ix > nx1) nx1 = ix;
          if (iz < nz0) nz0 = iz;
          if (iz > nz1) nz1 = iz;
        }
      }
    }
    this.active = { x0: nx0, x1: nx1, z0: nz0, z1: nz1 };
    return moved * this.cellArea;
  }

  /** 安定するまで崩落を進める。移動した合計体積を返す。 */
  settle(maxSteps: number = CONFIG.sand.maxSettleSteps): number {
    let total = 0;
    for (let s = 0; s < maxSteps; s++) {
      const moved = this.step();
      total += moved;
      if (moved < CONFIG.sand.settleEpsilon) {
        this.sleep();
        break;
      }
    }
    return total;
  }

  /** 最も急な斜面の勾配（tan）。テスト・検証用 */
  maxGradient(): number {
    let max = 0;
    const { n, heights: h } = this;
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n - 1; ix++) {
        max = Math.max(max, Math.abs(h[iz * n + ix] - h[iz * n + ix + 1]) / this.cell);
      }
    }
    for (let iz = 0; iz < n - 1; iz++) {
      for (let ix = 0; ix < n; ix++) {
        max = Math.max(max, Math.abs(h[iz * n + ix] - h[(iz + 1) * n + ix]) / this.cell);
      }
    }
    return max;
  }

  clone(): SandField {
    const copy = new SandField(this.options);
    copy.heights.set(this.heights);
    copy.moisture.set(this.moisture);
    copy.active = { ...this.active };
    return copy;
  }
}
