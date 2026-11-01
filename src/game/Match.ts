import { CONFIG, type ToolId } from '../config';
import { TOOLS, TOOL_ORDER } from '../tools/DigTools';

/** solo: ひとりで練習 / cpu: CPUと対戦 / versus: 同じ端末で2人対戦 */
export type Mode = 'solo' | 'cpu' | 'versus';
export type EndReason = 'flag' | 'turns' | 'sand' | 'pass';

export interface PlayerState {
  name: string;
  /** 獲得した砂 [m³] */
  score: number;
  /** 一手で最も多く取った量 [m³] */
  bestMove: number;
  /** 道具ごとの残り使用回数 */
  uses: Record<ToolId, number>;
  digs: number;
}

export interface MatchResult {
  reason: EndReason;
  /** 勝者のインデックス。引き分けは null（ひとり練習では常に 0 か null） */
  winner: number | null;
  /** 旗を倒したプレイヤー */
  toppledBy: number | null;
  /** ひとり練習の記録として有効か（旗を倒さずに終了した場合のみ） */
  validRecord: boolean;
}

export interface MatchOptions {
  mode: Mode;
  initialVolume: number;
  maxTurns?: number;
  names?: string[];
}

/** 引き分けとみなす差 [m³]（0.05L） */
const DRAW_EPSILON = 0.00005;

/**
 * 試合の進行と勝敗判定。描画や物理には依存しない。
 * 1ターン = 1アクション（掘る or パス）で、崩落と旗判定のあとに resolveTurn を呼ぶ。
 */
export class Match {
  readonly mode: Mode;
  readonly players: PlayerState[];
  readonly maxTurns: number;
  readonly initialVolume: number;
  current = 0;
  /** 完了したターン数（両者合計） */
  turn = 0;
  passesInRow = 0;
  result: MatchResult | null = null;
  private pendingAction: 'dig' | 'pass' | null = null;
  private pendingVolume = 0;

  constructor(options: MatchOptions) {
    this.mode = options.mode;
    this.initialVolume = options.initialVolume;
    this.maxTurns =
      options.maxTurns ?? (options.mode === 'solo' ? CONFIG.match.maxTurnsSolo : CONFIG.match.maxTurnsVersus);
    const count = options.mode === 'solo' ? 1 : 2;
    const defaults =
      options.mode === 'solo' ? ['あなた'] : options.mode === 'cpu' ? ['あなた', 'CPU'] : ['プレイヤー1', 'プレイヤー2'];
    this.players = Array.from({ length: count }, (_, i) => ({
      name: options.names?.[i] ?? defaults[i],
      score: 0,
      bestMove: 0,
      uses: Object.fromEntries(TOOL_ORDER.map((t) => [t, TOOLS[t].uses])) as Record<ToolId, number>,
      digs: 0,
    }));
  }

  get isOver(): boolean {
    return this.result !== null;
  }

  get currentPlayer(): PlayerState {
    return this.players[this.current];
  }

  /** 現在のプレイヤーの残りターン数（自分の手番の数） */
  get turnsLeft(): number {
    return Math.ceil((this.maxTurns - this.turn) / this.players.length);
  }

  canUse(tool: ToolId): boolean {
    return !this.isOver && this.pendingAction === null && this.currentPlayer.uses[tool] > 0;
  }

  /** 掘った結果を記録する（ターンはまだ終わらない） */
  recordDig(tool: ToolId, volume: number): void {
    if (!this.canUse(tool)) throw new Error(`cannot use ${tool}`);
    const p = this.currentPlayer;
    p.uses[tool] -= 1;
    p.digs += 1;
    this.pendingAction = 'dig';
    this.pendingVolume = 0;
    this.addToPending(volume);
  }

  /** 掘削量を後から加算する（アニメーションで分割して掘る場合） */
  addToPending(volume: number): void {
    if (this.pendingAction !== 'dig') throw new Error('no pending dig');
    const p = this.currentPlayer;
    p.score += volume;
    this.pendingVolume += volume;
    p.bestMove = Math.max(p.bestMove, this.pendingVolume);
  }

  recordPass(): void {
    if (this.isOver || this.pendingAction !== null) throw new Error('cannot pass now');
    this.pendingAction = 'pass';
  }

  /**
   * 崩落が落ち着いた後にターンを締める。
   * @param flagFallen この手番で旗が倒れたか
   * @param remainingVolume 残りの砂の体積 [m³]
   */
  resolveTurn(flagFallen: boolean, remainingVolume: number): MatchResult | null {
    if (this.isOver) return this.result;
    if (this.pendingAction === null) throw new Error('no action this turn');
    const action = this.pendingAction;
    this.pendingAction = null;
    this.turn += 1;

    if (flagFallen) {
      const toppledBy = this.current;
      const winner = this.mode === 'solo' ? null : 1 - toppledBy;
      return this.finish({ reason: 'flag', winner, toppledBy, validRecord: false });
    }

    this.passesInRow = action === 'pass' ? this.passesInRow + 1 : 0;
    if (this.mode === 'solo' && action === 'pass') return this.finishByScore('pass');
    if (this.players.length === 2 && this.passesInRow >= 2) return this.finishByScore('pass');
    if (remainingVolume <= this.initialVolume * CONFIG.match.endSandRatio) return this.finishByScore('sand');
    if (this.turn >= this.maxTurns) return this.finishByScore('turns');

    this.current = (this.current + 1) % this.players.length;
    return null;
  }

  private finishByScore(reason: EndReason): MatchResult {
    let winner: number | null = 0;
    if (this.players.length === 2) {
      const diff = this.players[0].score - this.players[1].score;
      winner = Math.abs(diff) < DRAW_EPSILON ? null : diff > 0 ? 0 : 1;
    }
    return this.finish({ reason, winner, toppledBy: null, validRecord: true });
  }

  private finish(result: MatchResult): MatchResult {
    this.result = result;
    return result;
  }
}

/** m³ → 表示用のL */
export function toLiters(volume: number): number {
  return Math.round(volume * 10000) / 10;
}
