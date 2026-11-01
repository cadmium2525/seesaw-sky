import type { ToolId } from '../config';

/**
 * 掘削範囲。線分（中心 cx,cz・向き angle・半長 halfLength）の周りを
 * 楕円半径 ru（線分方向）/ rv（直交方向）で膨らませた形。
 *   円     : halfLength=0, ru=rv
 *   楕円   : halfLength=0, ru≠rv
 *   カプセル: halfLength>0
 */
export interface Brush {
  cx: number;
  cz: number;
  angle: number;
  halfLength: number;
  ru: number;
  rv: number;
  depth: number;
}

export interface ToolParams {
  /** スコップ：範囲 0..1 */
  size: number;
  /** シャベル：深さ 0..1 */
  depth: number;
  /** シャベル：角度 [rad] */
  angle: number;
  /** ショベルカー：アームの引き量 0..1 */
  reach: number;
}

export interface ToolDef {
  id: ToolId;
  name: string;
  short: string;
  /** 1試合で1人が使える回数（Infinity=無制限） */
  uses: number;
  scale: '小' | '小〜中' | '中' | '大';
  description: string;
  params: Array<keyof ToolParams>;
}

export const TOOLS: Record<ToolId, ToolDef> = {
  hand: {
    id: 'hand',
    name: '素手',
    short: '手',
    uses: Infinity,
    scale: '小',
    description: '少しだけ。細かい微調整に。',
    params: [],
  },
  scoop: {
    id: 'scoop',
    name: 'スコップ',
    short: 'ス',
    uses: Infinity,
    scale: '小〜中',
    description: '範囲を決めて縁から安全に稼ぐ。',
    params: ['size'],
  },
  shovel: {
    id: 'shovel',
    name: 'シャベル',
    short: 'シ',
    uses: 6,
    scale: '中',
    description: '角度と深さを調整。効率と危険のバランス。',
    params: ['angle', 'depth'],
  },
  excavator: {
    id: 'excavator',
    name: 'ショベルカー',
    short: '重',
    uses: 2,
    scale: '大',
    description: '一気に大量獲得。ただし崩落の危険大。',
    params: ['reach'],
  },
};

export const TOOL_ORDER: ToolId[] = ['hand', 'scoop', 'shovel', 'excavator'];

export const DEFAULT_PARAMS: ToolParams = { size: 0.5, depth: 0.4, angle: 0, reach: 0.5 };

/**
 * 道具・パラメータ・狙った地点から掘削範囲を作る。
 * ショベルカーは狙った地点から砂山の外側へ向かって砂を掻き出す。
 */
export function makeBrush(tool: ToolId, params: ToolParams, x: number, z: number): Brush {
  switch (tool) {
    case 'hand':
      return { cx: x, cz: z, angle: 0, halfLength: 0, ru: 0.075, rv: 0.075, depth: 0.055 };
    case 'scoop': {
      const r = 0.1 + 0.08 * params.size;
      return { cx: x, cz: z, angle: 0, halfLength: 0, ru: r, rv: r, depth: 0.085 };
    }
    case 'shovel':
      return {
        cx: x,
        cz: z,
        angle: params.angle,
        halfLength: 0,
        ru: 0.2,
        rv: 0.12,
        depth: 0.07 + 0.14 * params.depth,
      };
    case 'excavator': {
      const len = 0.12 + 0.32 * params.reach;
      const out = Math.hypot(x, z) > 1e-4 ? Math.atan2(z, x) : 0;
      return {
        cx: x + Math.cos(out) * len * 0.5,
        cz: z + Math.sin(out) * len * 0.5,
        angle: out,
        halfLength: len * 0.5,
        ru: 0.21,
        rv: 0.21,
        depth: 0.24,
      };
    }
  }
}

/** 掘削の深さの分布（0=中心, 1=縁）。中心が深いお椀型。 */
export function brushWeight(brush: Brush, x: number, z: number): number {
  const dx = x - brush.cx;
  const dz = z - brush.cz;
  const c = Math.cos(brush.angle);
  const s = Math.sin(brush.angle);
  const u = dx * c + dz * s;
  const v = -dx * s + dz * c;
  const du = Math.max(Math.abs(u) - brush.halfLength, 0) / brush.ru;
  const dv = v / brush.rv;
  const d2 = du * du + dv * dv;
  if (d2 >= 1) return 0;
  return Math.pow(1 - d2, 0.8);
}

/** 掘削範囲を包む矩形 */
export function brushBounds(brush: Brush): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const r = Math.max(brush.ru, brush.rv) + brush.halfLength;
  return { minX: brush.cx - r, maxX: brush.cx + r, minZ: brush.cz - r, maxZ: brush.cz + r };
}

/** 掘削範囲の輪郭点（プレビュー表示用） */
export function brushOutline(brush: Brush, segments = 64): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const c = Math.cos(brush.angle);
  const s = Math.sin(brush.angle);
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    let u = Math.cos(t) * brush.ru;
    const v = Math.sin(t) * brush.rv;
    u += Math.sign(Math.cos(t)) * brush.halfLength;
    pts.push([brush.cx + u * c - v * s, brush.cz + u * s + v * c]);
  }
  return pts;
}
