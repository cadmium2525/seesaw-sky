import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONFIG } from '../src/config';
import { Match } from '../src/game/Match';
import { evaluateSupport, plantFlag } from '../src/physics/FlagSupport';
import { SandField } from '../src/terrain/SandField';
import { DEFAULT_PARAMS, makeBrush } from '../src/tools/DigTools';

const SEED = CONFIG.match.standardSeed;
const base = SandField.createMound(SEED);

test('同じシードなら同じ砂山になる（競技モードの公平性）', () => {
  const again = SandField.createMound(SEED);
  assert.deepEqual(Array.from(again.heights), Array.from(base.heights));
  const other = SandField.createMound(SEED + 1);
  assert.notDeepEqual(Array.from(other.heights), Array.from(base.heights));
});

test('初期の砂山は安息角を超えず、頂上が一番高い', () => {
  const maxSlope = Math.tan((CONFIG.sand.reposeAngleDeg * Math.PI) / 180);
  assert.ok(base.maxGradient() <= maxSlope * Math.SQRT2 + 1e-6);
  assert.ok(base.heightAt(0, 0) > CONFIG.mound.height * 0.9);
  assert.equal(base.heightAt(1.5, 1.5), 0);
});

test('掘った量は砂の減少量と一致し、予想掘削量とも一致する', () => {
  const f = base.clone();
  const before = f.totalVolume();
  const brush = makeBrush('shovel', DEFAULT_PARAMS, 0.4, -0.2);
  const preview = f.previewDig(brush);
  const removed = f.dig(brush);
  assert.ok(removed > 0);
  assert.ok(Math.abs(preview - removed) < 1e-12);
  assert.ok(Math.abs(before - removed - f.totalVolume()) < 1e-9);
});

test('分割して掘っても一度に掘った量と同じになる', () => {
  const a = base.clone();
  const b = base.clone();
  const brush = makeBrush('excavator', DEFAULT_PARAMS, 0.5, 0.3);
  const once = a.dig(brush);
  let parts = 0;
  for (let i = 0; i < 5; i++) parts += b.dig(brush, 0.2);
  assert.ok(Math.abs(once - parts) < 1e-9);
});

test('崩落は砂の総量を保存し、斜面を安息角まで緩める', () => {
  const f = base.clone();
  f.dig(makeBrush('excavator', { ...DEFAULT_PARAMS, reach: 1 }, 0.35, 0));
  const before = f.totalVolume();
  const moved = f.settle(5000);
  assert.ok(moved > 0, '深く掘ると周りが崩れる');
  assert.ok(Math.abs(before - f.totalVolume()) < 1e-9);
  const maxSlope = Math.tan((CONFIG.sand.reposeAngleDeg * Math.PI) / 180);
  assert.ok(f.maxGradient() <= maxSlope * Math.SQRT2 * 1.05);
});

test('崩落の計算範囲を絞っても全域計算との差は1mm未満', () => {
  const a = base.clone();
  const b = base.clone();
  const brush = makeBrush('shovel', { ...DEFAULT_PARAMS, depth: 1 }, 0.25, 0.1);
  a.dig(brush);
  b.dig(brush);
  b.activateAll();
  for (let i = 0; i < 300; i++) {
    a.step();
    b.activateAll();
    b.step();
  }
  for (let i = 0; i < a.heights.length; i++) assert.ok(Math.abs(a.heights[i] - b.heights[i]) < 1e-3);
});

test('旗は立てた直後は安定している', () => {
  const s = evaluateSupport(base, plantFlag(base));
  assert.equal(s.fallen, false);
  assert.ok(s.support > 0.999);
  assert.ok(s.leanDeg < 0.01);
});

test('遠くを素手で掘っても旗は倒れない', () => {
  const f = base.clone();
  const anchor = plantFlag(f);
  f.dig(makeBrush('hand', DEFAULT_PARAMS, 0.8, 0.2));
  f.settle();
  assert.equal(evaluateSupport(f, anchor).fallen, false);
});

test('旗の根元をショベルカーで掘ると倒れ、砂が減った側へ傾く', () => {
  const f = base.clone();
  const anchor = plantFlag(f);
  f.dig(makeBrush('excavator', DEFAULT_PARAMS, 0.08, 0));
  f.settle();
  const s = evaluateSupport(f, anchor);
  assert.equal(s.fallen, true);
  assert.ok(Math.cos(s.leanDir) > 0.5, `+x側へ倒れる: ${s.leanDir}`);
});

test('崩落が旗の安定度に影響する（掘った直後より崩落後の方が不安定）', () => {
  const f = base.clone();
  const anchor = plantFlag(f);
  f.dig(makeBrush('shovel', { ...DEFAULT_PARAMS, depth: 1 }, 0.22, 0));
  const beforeCollapse = evaluateSupport(f, anchor).stability;
  f.settle();
  const afterCollapse = evaluateSupport(f, anchor).stability;
  assert.ok(afterCollapse < beforeCollapse, `${afterCollapse} < ${beforeCollapse}`);
});

test('2人対戦：交互に手番が回り、旗を倒した側が負ける', () => {
  const m = new Match({ mode: 'versus', initialVolume: 1 });
  assert.equal(m.current, 0);
  m.recordDig('hand', 0.001);
  assert.equal(m.resolveTurn(false, 0.9), null);
  assert.equal(m.current, 1);
  m.recordDig('excavator', 0.04);
  const r = m.resolveTurn(true, 0.85);
  assert.deepEqual(r, { reason: 'flag', winner: 0, toppledBy: 1, validRecord: false });
  assert.ok(m.isOver);
});

test('2人対戦：最大ターンに達したら獲得量の多い方が勝ち', () => {
  const m = new Match({ mode: 'versus', initialVolume: 1, maxTurns: 4 });
  const plays = [0.002, 0.003, 0.002, 0.0005];
  let r = null;
  for (const v of plays) {
    m.recordDig('scoop', v);
    r = m.resolveTurn(false, 0.9);
  }
  assert.equal(r?.reason, 'turns');
  assert.equal(r?.winner, 0);
  assert.equal(m.players[0].bestMove, 0.002);
  assert.equal(m.players[1].bestMove, 0.003);
});

test('2人対戦：双方パスで終了、同量なら引き分け', () => {
  const m = new Match({ mode: 'versus', initialVolume: 1 });
  m.recordPass();
  assert.equal(m.resolveTurn(false, 1), null);
  m.recordPass();
  const r = m.resolveTurn(false, 1);
  assert.equal(r?.reason, 'pass');
  assert.equal(r?.winner, null);
});

test('2人対戦：パスの後に掘ればパスの連続はリセットされる', () => {
  const m = new Match({ mode: 'versus', initialVolume: 1 });
  m.recordPass();
  m.resolveTurn(false, 1);
  m.recordDig('hand', 0.001);
  m.resolveTurn(false, 1);
  m.recordPass();
  assert.equal(m.resolveTurn(false, 1), null);
});

test('残りの砂が閾値以下になったら終了', () => {
  const m = new Match({ mode: 'versus', initialVolume: 1 });
  m.recordDig('excavator', 0.04);
  const r = m.resolveTurn(false, CONFIG.match.endSandRatio - 0.01);
  assert.equal(r?.reason, 'sand');
  assert.equal(r?.winner, 0);
});

test('道具はすべて回数無制限で使える', () => {
  const m = new Match({ mode: 'versus', initialVolume: 1, maxTurns: 99 });
  for (let i = 0; i < 10; i++) {
    m.recordDig('excavator', 0.01);
    m.resolveTurn(false, 0.9);
  }
  for (const t of ['hand', 'scoop', 'shovel', 'excavator'] as const) assert.equal(m.canUse(t), true);
});

test('1ターンに2回は行動できない', () => {
  const m = new Match({ mode: 'versus', initialVolume: 1 });
  m.recordDig('hand', 0.001);
  assert.equal(m.canUse('hand'), false);
  assert.throws(() => m.recordPass());
});

test('ひとり練習：旗を倒すと記録なし、自分で終了すると記録になる', () => {
  const fall = new Match({ mode: 'solo', initialVolume: 1 });
  fall.recordDig('shovel', 0.01);
  assert.equal(fall.resolveTurn(true, 0.9)?.validRecord, false);

  const ok = new Match({ mode: 'solo', initialVolume: 1 });
  ok.recordDig('shovel', 0.01);
  assert.equal(ok.resolveTurn(false, 0.9), null);
  assert.equal(ok.current, 0);
  ok.recordPass();
  const r = ok.resolveTurn(false, 0.9);
  assert.equal(r?.reason, 'pass');
  assert.equal(r?.validRecord, true);
  assert.equal(r?.winner, 0);
});

test('分割して加算した掘削量も「最大一手」として記録される', () => {
  const m = new Match({ mode: 'versus', initialVolume: 1 });
  m.recordDig('shovel', 0);
  m.addToPending(0.002);
  m.addToPending(0.003);
  m.resolveTurn(false, 0.9);
  assert.ok(Math.abs(m.players[0].bestMove - 0.005) < 1e-12);
  assert.ok(Math.abs(m.players[0].score - 0.005) < 1e-12);
});

test('CPU対戦：あなたとCPUの2人で、2人対戦と同じルールで進む', () => {
  const m = new Match({ mode: 'cpu', initialVolume: 1 });
  assert.deepEqual(m.players.map((p) => p.name), ['あなた', 'CPU']);
  assert.equal(m.maxTurns, CONFIG.match.maxTurnsVersus);
  m.recordPass();
  m.resolveTurn(false, 1);
  m.recordPass();
  assert.equal(m.resolveTurn(false, 1)?.reason, 'pass');
});

import { CpuPlanner } from '../src/game/CpuPlayer';
import { createRandom } from '../src/util/random';

function runCpu(field: SandField, anchor: ReturnType<typeof plantFlag>, uses: Match['players'][0]['uses'], level: 'easy' | 'normal' | 'hard', seed: number) {
  const planner = new CpuPlanner(field, anchor, uses, level, createRandom(seed));
  while (!planner.work(1000));
  return planner.move;
}

test('CPU（つよい）は旗を倒さずに砂を取り続ける', () => {
  const f = base.clone();
  const anchor = plantFlag(f);
  const m = new Match({ mode: 'cpu', initialVolume: f.totalVolume(), maxTurns: 99 });
  for (let turn = 0; turn < 8; turn++) {
    const move = runCpu(f, anchor, m.players[1].uses, 'hard', 100 + turn);
    assert.ok(move, 'まだ安全な手があるはず');
    assert.ok(m.players[1].uses[move.tool] > 0, '使用回数の残っている道具を選ぶ');
    m.players[1].uses[move.tool] -= 1;
    const got = f.dig(makeBrush(move.tool, move.params, move.x, move.z));
    assert.ok(Math.abs(got - move.volume) < 1e-9, '予想した量をそのまま取れる');
    f.settle();
    assert.equal(evaluateSupport(f, anchor).fallen, false, `${turn}手目で旗が倒れた`);
  }
});

test('旗が不安定な局面では、よわいCPUは倒すことがあるが、つよいCPUは倒さない', () => {
  const f = base.clone();
  const anchor = plantFlag(f);
  f.dig(makeBrush('shovel', { ...DEFAULT_PARAMS, depth: 0.8 }, 0.2, 0));
  f.settle();
  const before = evaluateSupport(f, anchor).stability;
  assert.ok(before > 0 && before < 0.6, `不安定な局面を作る: ${before}`);
  const toppled = { easy: 0, hard: 0 };
  for (let seed = 0; seed < 20; seed++) {
    for (const level of ['easy', 'hard'] as const) {
      const m = new Match({ mode: 'cpu', initialVolume: 1 });
      const move = runCpu(f, anchor, m.players[1].uses, level, seed);
      if (!move) continue;
      const g = f.clone();
      g.dig(makeBrush(move.tool, move.params, move.x, move.z));
      g.settle();
      if (evaluateSupport(g, anchor).fallen) toppled[level]++;
    }
  }
  assert.equal(toppled.hard, 0);
  assert.ok(toppled.easy > 0, 'よわいCPUは読み違えて倒すことがある');
});

/** 旗がかなり不安定になった終盤の局面（安定度 0.1〜0.3 程度） */
function fragilePosition() {
  const f = base.clone();
  const anchor = plantFlag(f);
  f.dig(makeBrush('shovel', { ...DEFAULT_PARAMS, depth: 1 }, 0.17, 0));
  f.settle();
  return { f, anchor, stability: evaluateSupport(f, anchor).stability };
}

function plan(f: SandField, anchor: ReturnType<typeof plantFlag>, level: 'easy' | 'normal' | 'hard', seed: number, ctx: { myScore: number; oppScore: number; turnsRemaining: number }) {
  const m = new Match({ mode: 'cpu', initialVolume: 1 });
  const p = new CpuPlanner(f, anchor, m.players[1].uses, level, createRandom(seed), ctx);
  while (!p.work(1000));
  return p.move;
}

test('つよいCPUは旗が不安定な終盤でも、小さな手に逃げずに倒れない範囲でたくさん取る', () => {
  const { f, anchor, stability } = fragilePosition();
  assert.ok(stability > 0 && stability < 0.3, `不安定な局面: ${stability}`);
  const move = plan(f, anchor, 'hard', 3, { myScore: 0.05, oppScore: 0.12, turnsRemaining: 5 });
  assert.ok(move, '安全な手はあるはず');
  const g = f.clone();
  g.dig(makeBrush(move.tool, move.params, move.x, move.z));
  g.settle();
  assert.equal(evaluateSupport(g, anchor).fallen, false);
  assert.ok(move.volume > 0.015, `15L 以上取る: ${(move.volume * 1000).toFixed(1)}L`);
});

test('ふつうのCPUは負けていて残りが少ないほど攻める（勝っている時より多く取る）', () => {
  const { f, anchor } = fragilePosition();
  let ahead = 0;
  let behind = 0;
  for (let seed = 0; seed < 8; seed++) {
    ahead += plan(f, anchor, 'normal', seed, { myScore: 0.2, oppScore: 0.05, turnsRemaining: 4 })?.volume ?? 0;
    behind += plan(f, anchor, 'normal', seed, { myScore: 0.05, oppScore: 0.2, turnsRemaining: 4 })?.volume ?? 0;
  }
  assert.ok(behind > ahead, `負けている時 ${(behind * 125).toFixed(1)}L > 勝っている時 ${(ahead * 125).toFixed(1)}L`);
});
