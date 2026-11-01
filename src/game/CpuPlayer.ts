import { CONFIG, type ToolId } from '../config';
import { evaluateSupport, type FlagAnchor } from '../physics/FlagSupport';
import type { SandField } from '../terrain/SandField';
import { DEFAULT_PARAMS, makeBrush, TOOL_ORDER, type ToolParams } from '../tools/DigTools';

export type CpuLevel = 'easy' | 'normal' | 'hard';

export const CPU_LEVEL_LABEL: Record<CpuLevel, string> = { easy: 'よわい', normal: 'ふつう', hard: 'つよい' };

export interface CpuMove {
  tool: ToolId;
  params: ToolParams;
  x: number;
  z: number;
  /** 予想獲得量 [m³] */
  volume: number;
}

interface LevelSpec {
  /** 道具ごとに考える候補の数 */
  candidatesPerTool: number;
  /** 崩落まで試算する候補の上限 */
  maxSimulations: number;
  /** 試算後の旗の安定度がこれ以上なら採用 */
  margin: number;
  /** 安定度の読み違い（大きいほど危ない手を選びやすい） */
  misjudge: number;
}

const LEVELS: Record<CpuLevel, LevelSpec> = {
  easy: { candidatesPerTool: 6, maxSimulations: 8, margin: 0.08, misjudge: 0.4 },
  normal: { candidatesPerTool: 10, maxSimulations: 18, margin: 0.15, misjudge: 0.16 },
  hard: { candidatesPerTool: 16, maxSimulations: 40, margin: 0.22, misjudge: 0 },
};

interface Candidate extends CpuMove {
  simulated: boolean;
}

/**
 * CPU の思考。候補手を作り、獲得量の多い順に「砂山のコピーで実際に掘って崩落させ、
 * 旗が倒れないか」を試算する。最初に安全と判断できた手を選ぶ。
 * 1手の試算は数十ミリ秒かかることがあるので、work() で少しずつ進めて画面を止めない。
 */
export class CpuPlanner {
  private readonly spec: LevelSpec;
  private readonly queue: Candidate[];
  private simulations = 0;
  private chosen: CpuMove | null = null;
  private finished = false;
  /** 安全な手が無かった場合に使う、最も安定度が高かった手 */
  private safest: { move: CpuMove; stability: number } | null = null;

  constructor(
    private readonly field: SandField,
    private readonly anchor: FlagAnchor,
    uses: Record<ToolId, number>,
    level: CpuLevel,
    private readonly rand: () => number = Math.random,
  ) {
    this.spec = LEVELS[level];
    this.queue = this.generate(uses).sort((a, b) => b.volume - a.volume);
  }

  private generate(uses: Record<ToolId, number>): Candidate[] {
    const list: Candidate[] = [];
    const r = this.rand;
    for (const tool of TOOL_ORDER) {
      if (uses[tool] <= 0) continue;
      for (let i = 0; i < this.spec.candidatesPerTool; i++) {
        const radius = 0.08 + Math.sqrt(r()) * 1.0;
        const angle = r() * Math.PI * 2;
        const x = this.anchor.x + Math.cos(angle) * radius;
        const z = this.anchor.z + Math.sin(angle) * radius;
        const params: ToolParams = {
          ...DEFAULT_PARAMS,
          size: 0.3 + r() * 0.7,
          depth: 0.25 + r() * 0.75,
          angle: r() * Math.PI,
          reach: 0.3 + r() * 0.7,
        };
        const volume = this.field.previewDig(makeBrush(tool, params, x, z));
        if (volume > 0.0002) list.push({ tool, params, x, z, volume, simulated: false });
      }
    }
    return list;
  }

  /** 思考を進める。終わったら true */
  work(budgetMs: number): boolean {
    if (this.finished) return true;
    const start = performance.now();
    while (performance.now() - start < budgetMs) {
      const next = this.queue.shift();
      if (!next || this.simulations >= this.spec.maxSimulations) {
        // 安全な手が見つからなければ、最も安定していた手（それも危険ならパス）
        this.chosen = this.safest && this.safest.stability > 0 ? this.safest.move : null;
        this.finished = true;
        return true;
      }
      const stability = this.simulate(next);
      if (stability >= this.spec.margin) {
        this.chosen = next;
        this.finished = true;
        return true;
      }
      if (!this.safest || stability > this.safest.stability) this.safest = { move: next, stability };
    }
    return false;
  }

  /** 砂山のコピーで掘って崩落させ、旗の安定度（読み違い込み）を返す。倒れるなら負の値 */
  private simulate(c: Candidate): number {
    this.simulations++;
    c.simulated = true;
    const copy = this.field.clone();
    copy.dig(makeBrush(c.tool, c.params, c.x, c.z));
    copy.settle(CONFIG.sand.maxSettleSteps);
    const s = evaluateSupport(copy, this.anchor);
    const truth = s.fallen ? -0.1 : s.stability;
    return truth + (this.rand() - 0.5) * 2 * this.spec.misjudge;
  }

  /** 選んだ手。null はパス */
  get move(): CpuMove | null {
    return this.chosen;
  }

  get done(): boolean {
    return this.finished;
  }
}
