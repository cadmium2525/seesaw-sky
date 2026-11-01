/**
 * ゲームの調整値。企画書「仕様として後から決める項目」は全てここに集約し、
 * 試遊の結果に合わせて変更しやすくしている。単位はメートル（1L = 0.001m³）。
 */
export const CONFIG = {
  /** 砂場（高さマップ）の一辺の長さ [m] */
  fieldSize: 3.2,
  /** 高さマップの分割数（頂点は resolution+1 個） */
  resolution: 128,

  mound: {
    /** 砂山の半径 [m] */
    radius: 1.25,
    /** 砂山の高さ [m] */
    height: 0.66,
    /** 表面の凸凹の強さ [m] */
    roughness: 0.018,
  },

  sand: {
    /** 安息角 [度]。これを超える斜面は崩れる */
    reposeAngleDeg: 35,
    /** 1回の崩落ステップで余剰分のうち移動させる割合 */
    flowRate: 0.45,
    /** 1秒あたりの崩落ステップ数（フレームレートに依存しない） */
    stepsPerSecond: 600,
    /** 1フレームで計算する崩落ステップの上限（低性能端末で固まらないように） */
    maxStepsPerFrame: 24,
    /** これ以下の移動量 [m³] になったら安定とみなす */
    settleEpsilon: 1e-6,
    /** 1ターンあたりの崩落シミュレーション上限ステップ */
    maxSettleSteps: 900,
  },

  flag: {
    /** 旗竿の長さ [m] */
    poleLength: 0.5,
    /** 旗竿の半径 [m] */
    poleRadius: 0.009,
    /** 砂に埋まっている深さ [m] */
    burial: 0.16,
    /** 支持判定のサンプル半径 [m] */
    supportRadii: [0.0, 0.03, 0.06, 0.1, 0.15],
    supportWeights: [3, 3, 2.2, 1.4, 0.8],
    supportAngles: 16,
    /** 支持率がこれを下回ると倒れる */
    minSupport: 0.42,
    /** 傾きがこれを超えると倒れる [度] */
    maxLeanDeg: 24,
    /** 偏り1.0あたりの傾き [度] */
    leanPerAsymmetry: 46,
    /** 支持不足による追加の傾き [度] */
    leanPerLoss: 14,
  },

  match: {
    /** 2人対戦の最大ターン数（両者合計） */
    maxTurnsVersus: 30,
    /** ひとり練習の最大ターン数 */
    maxTurnsSolo: 15,
    /** 残りの砂がこの割合以下になったら終了 */
    endSandRatio: 0.3,
    /** 競技モードの固定シード */
    standardSeed: 20261101,
  },
} as const;

export type ToolId = 'hand' | 'scoop' | 'shovel' | 'excavator';
