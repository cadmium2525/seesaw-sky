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

/** 試合の状況（CPU から見た値） */
export interface CpuContext {
  /** CPU の獲得量 [m³] */
  myScore: number;
  /** 相手の獲得量 [m³] */
  oppScore: number;
  /** この手を含む残りの手数（両者合計） */
  turnsRemaining: number;
}

interface LevelSpec {
  /** 道具ごとに作る候補の数 */
  candidatesPerTool: number;
  /** 最初の候補から崩落まで試算する数の上限 */
  maxSimulations: number;
  /** 安全と判断した候補をいくつ集めたら探索をやめるか */
  keepSafe: number;
  /** 見つけた最良手の周りを少しずつ変えて、さらに多く取れる手を探す回数 */
  refineSteps: number;
  /** 相手の次の一手まで読む候補の数（0 なら読まない） */
  replyCandidates: number;
  /** 相手の手を読むときの試算数 */
  replySimulations: number;
  /** 試算後の旗の安定度がこれ以上なら採用（リードしている時の慎重さ） */
  margin: number;
  /** 安定度の読み違い（大きいほど危ない手を選びやすい） */
  misjudge: number;
  /** 負けている時にどれだけ慎重さを捨てて攻めるか 0..1 */
  aggression: number;
  /** 1手の思考に使う計算時間の上限 [ms] */
  thinkBudgetMs: number;
  /** 取れる量の多い順に候補を見るか（false なら思いつきの順＝弱い） */
  greedy: boolean;
}

const LEVELS: Record<CpuLevel, LevelSpec> = {
  easy: {
    candidatesPerTool: 6,
    maxSimulations: 8,
    keepSafe: 1,
    refineSteps: 0,
    replyCandidates: 0,
    replySimulations: 0,
    margin: 0.1,
    misjudge: 0.4,
    aggression: 0.8,
    thinkBudgetMs: 600,
    greedy: false,
  },
  normal: {
    candidatesPerTool: 12,
    maxSimulations: 18,
    keepSafe: 2,
    refineSteps: 4,
    replyCandidates: 0,
    replySimulations: 0,
    margin: 0.14,
    misjudge: 0.12,
    aggression: 1,
    thinkBudgetMs: 1200,
    greedy: true,
  },
  hard: {
    candidatesPerTool: 24,
    maxSimulations: 30,
    keepSafe: 4,
    refineSteps: 14,
    replyCandidates: 3,
    replySimulations: 8,
    // 試算は本番と同じ計算なので、倒れないと分かればギリギリまで攻めてよい
    margin: 0.02,
    misjudge: 0,
    aggression: 0,
    thinkBudgetMs: 2000,
    greedy: true,
  },
};

/** 1手で取れる量の目安 [m³]。点差が「何手分か」を測るのに使う */
const TYPICAL_MOVE = 0.02;

interface Sim {
  move: CpuMove;
  /** 読み違いを含めた安定度（倒れるなら負） */
  judged: number;
  /** 本当に倒れるか（読み違い無し） */
  fallen: boolean;
  /** 掘って崩落させた後の砂山（相手の手を読むのに使う） */
  after: SandField;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * CPU の思考。
 * 1. 候補手を作り、取れる量の多い順に「砂山のコピーで掘って崩落させ、旗が倒れないか」を試算する。
 * 2. 見つけた最良手の位置や深さを少しずつ変えて、倒れないギリギリまで量を増やす（ふつう・つよい）。
 * 3. 相手の次の一手で取られる量まで読み、「自分が取る量 − 相手に取られる量」が最大の手を選ぶ（つよい）。
 * 負けていて残りが少ないほど慎重さを捨てて攻める。最後の一手なら倒れない範囲で最大量を取る。
 * 試算は重いので generator で細かく区切り、work() で少しずつ進めて画面を止めない。
 */
export class CpuPlanner {
  private readonly spec: LevelSpec;
  private readonly marginEff: number;
  private readonly oppTurnsAfter: number;
  private readonly search: Generator<void, CpuMove | null>;
  private chosen: CpuMove | null = null;
  private finished = false;
  private spentMs = 0;

  constructor(
    private readonly field: SandField,
    private readonly anchor: FlagAnchor,
    private readonly uses: Record<ToolId, number>,
    level: CpuLevel,
    private readonly rand: () => number = Math.random,
    context: CpuContext = { myScore: 0, oppScore: 0, turnsRemaining: CONFIG.match.maxTurnsVersus },
  ) {
    this.spec = LEVELS[level];
    const remaining = Math.max(1, context.turnsRemaining);
    const myTurnsLeft = Math.ceil(remaining / 2);
    this.oppTurnsAfter = Math.floor(remaining / 2);
    // 負けている量が「残りの自分の手数で普通に取れる量」に比べてどれだけ大きいか
    const deficit = context.oppScore - context.myScore;
    const urgency = deficit > 0 ? clamp01(deficit / (myTurnsLeft * TYPICAL_MOVE)) : 0;
    const lastChance = deficit > 0 && myTurnsLeft <= 2;
    this.marginEff = this.spec.margin * (1 - this.spec.aggression * (lastChance ? 1 : urgency));
    this.search = this.run();
  }

  /** 思考を進める。終わったら true */
  work(budgetMs: number): boolean {
    if (this.finished) return true;
    const start = performance.now();
    while (performance.now() - start < budgetMs) {
      const r = this.search.next();
      if (r.done) {
        this.chosen = r.value;
        this.finished = true;
        break;
      }
    }
    this.spentMs += performance.now() - start;
    return this.finished;
  }

  /** 選んだ手。null はパス */
  get move(): CpuMove | null {
    return this.chosen;
  }

  get done(): boolean {
    return this.finished;
  }

  private get outOfTime(): boolean {
    return this.spentMs > this.spec.thinkBudgetMs;
  }

  // ------------------------------------------------------------------ 探索

  private *run(): Generator<void, CpuMove | null> {
    const spec = this.spec;
    const candidates = this.generate(this.field, spec.candidatesPerTool, false, spec.greedy);
    const safe: Sim[] = [];
    let safest: Sim | null = null;
    let sims = 0;

    // 1. 量の多い順に試算し、安全な手を集める
    for (const move of candidates) {
      if (sims >= spec.maxSimulations || safe.length >= spec.keepSafe || this.outOfTime) break;
      sims++;
      const sim = yield* this.simulate(this.field, move, true);
      if (sim.judged >= this.marginEff) safe.push(sim);
      else if (!safest || sim.judged > safest.judged) safest = sim;
      yield;
    }

    // 2. 最良手の周りを探して、倒れないギリギリまで量を増やす
    if (safe.length > 0 && spec.refineSteps > 0) {
      let best = safe.reduce((a, b) => (b.move.volume > a.move.volume ? b : a));
      for (let i = 0; i < spec.refineSteps && !this.outOfTime; i++) {
        const tweak = this.perturb(best.move);
        if (!tweak || tweak.volume <= best.move.volume * 1.01) continue;
        const sim = yield* this.simulate(this.field, tweak, true);
        if (sim.judged >= this.marginEff) {
          best = sim;
          safe.push(sim);
        }
        yield;
      }
    }

    if (safe.length === 0) {
      // 安全な手が無い：倒れないと読めた手があればそれ、無ければパス
      return safest && safest.judged >= 0 ? safest.move : null;
    }

    // 3. 相手の次の一手まで読む
    safe.sort((a, b) => b.move.volume - a.move.volume);
    if (spec.replyCandidates > 0 && this.oppTurnsAfter > 0 && !this.outOfTime) {
      let bestValue = -Infinity;
      let bestMove = safe[0].move;
      for (const sim of safe.slice(0, spec.replyCandidates)) {
        const reply = yield* this.bestSafeReply(sim.after);
        const value = sim.move.volume - reply;
        if (value > bestValue) {
          bestValue = value;
          bestMove = sim.move;
        }
        if (this.outOfTime) break;
      }
      return bestMove;
    }
    return safe[0].move;
  }

  /** 相手が次の一手で安全に取れる最大量の見積もり（相手は正確に読む前提） */
  private *bestSafeReply(field: SandField): Generator<void, number> {
    const candidates = this.generate(field, 10, true);
    let sims = 0;
    for (const move of candidates) {
      if (sims >= this.spec.replySimulations) break;
      sims++;
      const sim = yield* this.simulate(field, move, false);
      if (!sim.fallen) return move.volume;
      yield;
    }
    return 0;
  }

  /** 候補手を作り、取れる量の多い順に並べる */
  private generate(field: SandField, perTool: number, unlimited = false, greedy = true): CpuMove[] {
    const r = this.rand;
    const list: CpuMove[] = [];
    for (const tool of TOOL_ORDER) {
      if (!unlimited && this.uses[tool] <= 0) continue;
      for (let i = 0; i < perTool; i++) {
        // よわいCPUは砂の多い頂上付近（＝旗の近く）を狙いがち
        const radius = 0.06 + Math.pow(r(), greedy ? 0.5 : 1.4) * 1.05;
        const angle = r() * Math.PI * 2;
        const x = this.anchor.x + Math.cos(angle) * radius;
        const z = this.anchor.z + Math.sin(angle) * radius;
        // パラメータは大きめに寄せる（たくさん取れる手を優先して探す）
        const big = greedy ? () => 1 - Math.pow(r(), 1.6) * 0.75 : () => 0.25 + r() * 0.75;
        const params: ToolParams = { ...DEFAULT_PARAMS, size: big(), depth: big(), angle: r() * Math.PI, reach: big() };
        const volume = field.previewDig(makeBrush(tool, params, x, z));
        if (volume > 0.0002) list.push({ tool, params, x, z, volume });
      }
    }
    if (greedy) return list.sort((a, b) => b.volume - a.volume);
    // 思いつきの順：量の多い手ほど先に考えるが、ばらつきが大きい
    return list
      .map((m) => ({ m, key: m.volume * (0.2 + r()) }))
      .sort((a, b) => b.key - a.key)
      .map((e) => e.m);
  }

  /** 位置・パラメータを少し変えた手（旗に近づける・深くするなど） */
  private perturb(m: CpuMove): CpuMove | null {
    const r = this.rand;
    const params = { ...m.params };
    let { x, z } = m;
    const kind = r();
    if (kind < 0.4) {
      // 旗の方へ少し寄せる（砂が高いので多く取れるが危ない）
      const dx = this.anchor.x - x;
      const dz = this.anchor.z - z;
      const d = Math.hypot(dx, dz) || 1;
      const step = 0.02 + r() * 0.06;
      x += (dx / d) * step;
      z += (dz / d) * step;
    } else if (kind < 0.7) {
      x += (r() - 0.5) * 0.12;
      z += (r() - 0.5) * 0.12;
    } else {
      const k = (['size', 'depth', 'reach'] as const)[Math.floor(r() * 3)];
      params[k] = Math.min(1, params[k] + 0.1 + r() * 0.2);
      params.angle = (params.angle + (r() - 0.5) * 0.6 + Math.PI) % Math.PI;
    }
    const volume = this.field.previewDig(makeBrush(m.tool, params, x, z));
    return volume > 0 ? { tool: m.tool, params, x, z, volume } : null;
  }

  /**
   * 砂山のコピーで掘って崩落させる。崩落の途中でも旗を確認し、一度でも倒れる状態になれば倒れたとみなす
   * （本番も崩落中に毎フレーム判定しているため）。数十ステップごとに区切って画面を止めない。
   */
  private *simulate(field: SandField, move: CpuMove, withMisjudge: boolean): Generator<void, Sim> {
    const copy = field.clone();
    copy.dig(makeBrush(move.tool, move.params, move.x, move.z));
    let fallen = evaluateSupport(copy, this.anchor).fallen;
    let steps = 0;
    while (!fallen && copy.isActive && steps < CONFIG.sand.maxSettleSteps) {
      for (let i = 0; i < 40 && copy.isActive && steps < CONFIG.sand.maxSettleSteps; i++, steps++) {
        if (copy.step() < CONFIG.sand.settleEpsilon) copy.sleep();
      }
      fallen = evaluateSupport(copy, this.anchor).fallen;
      yield;
    }
    const s = evaluateSupport(copy, this.anchor);
    fallen ||= s.fallen;
    const truth = fallen ? -0.1 : s.stability;
    const noise = withMisjudge ? (this.rand() - 0.5) * 2 * this.spec.misjudge : 0;
    return { move, judged: truth + noise, fallen, after: copy };
  }
}
