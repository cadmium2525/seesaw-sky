import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSimulation } from '../src/simulation';
import { WORLD } from '../src/types';

const DT = 1 / 120;

function advance(sim: GameSimulation, seconds: number, move = 0): void {
  for (let i = 0; i < Math.ceil(seconds / DT); i++) sim.step(DT, { move });
}

function firstCatch(seed = 1): GameSimulation {
  const sim = new GameSimulation(seed);
  sim.start();
  for (let i = 0; i < 1000 && sim.state.catches === 0 && sim.state.phase === 'playing'; i++) sim.step(DT, { move: 0 });
  assert.equal(sim.state.catches, 1, 'The initial tree drop should be catchable without input.');
  return sim;
}

test('tree drop launches the opposite person and swaps receiving side', () => {
  const sim = firstCatch();
  assert.equal(sim.state.activePerson, 0);
  assert.equal(sim.state.targetSide, -1);
  assert.equal(sim.state.people[0].seated, false);
  assert.equal(sim.state.people[1].seated, true);
  assert.ok(sim.state.people[0].vy > 20);
  assert.ok(sim.state.lastQuality > 0.85);
  assert.ok(sim.state.people[0].vx !== 0, 'Launched people drift horizontally.');
});

test('missing the board ends the game on the ground', () => {
  const sim = new GameSimulation();
  sim.start();
  advance(sim, 5, -1);
  assert.equal(sim.state.phase, 'gameover');
  assert.equal(sim.state.people[sim.state.activePerson].y, 0);
  assert.equal(sim.state.catches, 0);
});

test('same-side and wrong-side collisions are distinguished', () => {
  const sim = new GameSimulation();
  sim.start();
  sim.state.boardX = WORLD.treeX + 3;
  advance(sim, 4);
  assert.equal(sim.state.phase, 'gameover');
  assert.equal(sim.state.catches, 0);
});

test('edge catches launch higher than catches near the pivot', () => {
  function launchAt(offset: number): number {
    const sim = new GameSimulation(44);
    sim.start();
    sim.state.boardX = WORLD.treeX - offset;
    for (let i = 0; i < 500 && sim.state.catches === 0; i++) sim.step(DT, { move: 0 });
    assert.equal(sim.state.catches, 1);
    return sim.state.people[0].vy;
  }
  assert.ok(launchAt(4.6) > launchAt(1.0));
});

test('the location assist disappears at five seconds and stays hidden until the next catch', () => {
  const sim = firstCatch(15);
  assert.ok(sim.state.landingIn > 5);
  assert.equal(sim.state.assistVisible, true);
  let hidden = false;
  while (sim.state.phase === 'playing') {
    sim.step(DT, { move: 0 });
    if (sim.state.landingIn <= 5) hidden = true;
    if (hidden) assert.equal(sim.state.assistVisible, false);
    else assert.equal(sim.state.assistVisible, true);
  }
  assert.ok(hidden);
});

test('landing prediction remains accurate while rising from below the receiving height', () => {
  const sim = firstCatch();
  const active = sim.state.people[sim.state.activePerson];
  const seated = sim.state.people[1 - sim.state.activePerson];
  assert.ok(active.y < seated.y);
  const time = sim.state.landingIn;
  const futureY = active.y + active.vy * time - WORLD.gravity * time * time / 2;
  assert.ok(Math.abs(futureY - seated.y) < 1e-8);
});

test('pause freezes the simulation and resume continues the same flight', () => {
  const sim = firstCatch();
  sim.pause();
  const before = JSON.stringify(sim.state);
  advance(sim, 2, 1);
  assert.equal(JSON.stringify(sim.state), before);
  sim.resume();
  advance(sim, 0.1);
  assert.equal(sim.state.phase, 'playing');
  assert.ok(sim.state.time > JSON.parse(before).time);
});

test('board respects world boundaries and reset clears the run', () => {
  const sim = new GameSimulation(22);
  sim.start();
  advance(sim, 2, -1);
  assert.ok(sim.state.boardX >= -WORLD.halfWidth);
  sim.reset(22);
  assert.equal(sim.state.phase, 'ready');
  assert.equal(sim.state.catches, 0);
  assert.equal(sim.state.boardX, 4);
  assert.equal(sim.state.maxHeight, 0);
});

test('the same seed and inputs produce the same flight at multiple step sizes', () => {
  const fine = new GameSimulation(99);
  const coarse = new GameSimulation(99);
  fine.start();
  coarse.start();
  for (let i = 0; i < 180; i++) fine.step(1 / 120, { move: 0.1 });
  for (let i = 0; i < 45; i++) coarse.step(1 / 30, { move: 0.1 });
  assert.ok(Math.abs(fine.state.people[1].y - coarse.state.people[1].y) < 1e-9);
  assert.ok(Math.abs(fine.state.boardX - coarse.state.boardX) < 1e-9);
});

test('invalid time or movement input does not corrupt state', () => {
  const sim = new GameSimulation();
  sim.start();
  sim.step(Number.NaN, { move: 1 });
  sim.step(-1, { move: 1 });
  sim.step(DT, { move: Number.NaN });
  assert.ok(Number.isFinite(sim.state.boardX));
  assert.equal(sim.state.time, DT);
});

test('successful edge catches alternate people and keep increasing reachable altitude', () => {
  const sim = new GameSimulation(7);
  sim.start();
  let launches = 0;
  let lastActive = sim.state.activePerson;
  const peaks: number[] = [];
  for (let i = 0; i < 60000 && sim.state.catches < 8 && sim.state.phase === 'playing'; i++) {
    const desired = sim.state.landingX - sim.state.targetSide * 4.6;
    const move = Math.max(-1, Math.min(1, (desired - sim.state.boardX) * 3 / WORLD.moveSpeed));
    const events = sim.step(DT, { move });
    for (const event of events) {
      if (event.type !== 'launch') continue;
      launches++;
      assert.notEqual(sim.state.activePerson, lastActive);
      lastActive = sim.state.activePerson;
      assert.ok((event.quality ?? 0) > 0.85);
      const person = sim.state.people[sim.state.activePerson];
      peaks.push(person.y + person.vy * person.vy / (2 * WORLD.gravity));
    }
  }
  assert.equal(launches, 8);
  assert.equal(sim.state.phase, 'playing');
  for (let i = 1; i < peaks.length; i++) assert.ok(peaks[i] > peaks[i - 1]);
  assert.ok(peaks.at(-1)! > 200, 'There is no arbitrary altitude ceiling.');
});

test('random drift keeps end catches reachable when launching from either runway boundary', () => {
  for (const boundary of [-WORLD.halfWidth, WORLD.halfWidth]) {
    for (const receivingSide of [-1, 1] as const) {
      for (let seed = 1; seed <= 32; seed++) {
        const sim = new GameSimulation(seed);
        sim.start();
        sim.state.boardX = boundary;
        sim.state.targetSide = receivingSide;
        sim.state.boardAngle = receivingSide * 0.11;
        const falling = sim.state.people[1];
        falling.x = boundary + receivingSide * 4.6;
        falling.y = 3;
        falling.vy = -10;
        for (let i = 0; i < 120 && sim.state.catches === 0; i++) sim.step(DT, { move: 0 });
        assert.equal(sim.state.catches, 1);
        const nextCatchCentre = sim.state.landingX - sim.state.targetSide * 4.6;
        assert.ok(Math.abs(nextCatchCentre) <= WORLD.halfWidth, `Seed ${seed}: end catch must fit on the runway.`);
        assert.ok(Math.abs(sim.state.people[sim.state.activePerson].vx) <= 3.8);
      }
    }
  }
});
