/** 固定シードの擬似乱数（mulberry32）。同じシードなら同じ砂山になる。 */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 格子状の値ノイズ（滑らかに補間） */
export function createValueNoise(seed: number, gridSize: number): (u: number, v: number) => number {
  const rand = createRandom(seed);
  const n = gridSize + 2;
  const values = new Float64Array(n * n);
  for (let i = 0; i < values.length; i++) values[i] = rand() * 2 - 1;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (u: number, v: number) => {
    const x = Math.min(Math.max(u, 0), 0.9999) * gridSize;
    const y = Math.min(Math.max(v, 0), 0.9999) * gridSize;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const a = values[iy * n + ix];
    const b = values[iy * n + ix + 1];
    const c = values[(iy + 1) * n + ix];
    const d = values[(iy + 1) * n + ix + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}
