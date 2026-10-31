import { WORLD, type GameEvent, type GameInput, type GameState, type Side } from './types';

const SEAT_X = 3.95;
const REST_ANGLE = 0.11;
const INNER_CATCH = 0.65;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** The entire arcade simulation. Coordinates describe a person's feet, in metres. */
export class GameSimulation {
  state!: GameState;
  private randomState = 1;
  private assistHidden = false;
  private events: GameEvent[] = [];

  constructor(seed = 1) {
    this.reset(seed);
  }

  reset(seed = this.state?.seed ?? 1): void {
    this.randomState = seed >>> 0 || 1;
    this.assistHidden = false;
    this.events = [];
    this.state = {
      phase: 'ready', time: 0,
      boardX: 4, boardVelocity: 0, boardAngle: REST_ANGLE, targetSide: 1,
      people: [
        { x: 4 - SEAT_X, y: WORLD.boardY - SEAT_X * Math.sin(REST_ANGLE), vx: 0, vy: 0, seated: true, color: 'coral' },
        { x: WORLD.treeX, y: WORLD.treeHeight, vx: 0, vy: 0, seated: false, color: 'mustard' },
      ],
      activePerson: 1, height: WORLD.treeHeight, maxHeight: 0,
      catches: 0, combo: 0, lastQuality: 0,
      assistVisible: false, landingIn: 0, landingX: WORLD.treeX,
      wind: 0, impact: 0, seed,
    };
    this.updatePrediction();
  }

  start(): void {
    if (this.state.phase !== 'ready') return;
    this.state.phase = 'playing';
    this.events.push({ type: 'start' });
  }

  pause(): void {
    if (this.state.phase === 'playing') this.state.phase = 'paused';
  }

  resume(): void {
    if (this.state.phase === 'paused') this.state.phase = 'playing';
  }

  step(dt: number, input: GameInput): GameEvent[] {
    if (this.state.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return [];
    // A stalled browser must never tunnel through the board or advance a whole flight.
    const total = Math.min(dt, 0.25);
    const steps = Math.ceil(total / (1 / 120));
    for (let i = 0; i < steps && this.state.phase === 'playing'; i++) {
      this.tick(total / steps, Number.isFinite(input.move) ? clamp(input.move, -1, 1) : 0);
    }
    const events = this.events;
    this.events = [];
    return events;
  }

  private tick(dt: number, move: number): void {
    const state = this.state;
    const person = state.people[state.activePerson];
    const previousX = person.x;
    const previousY = person.y;
    const previousBoardX = state.boardX;
    const previousAngle = state.boardAngle;
    state.time += dt;
    state.impact = Math.max(0, state.impact - dt * 2.8);

    state.boardVelocity += (move * WORLD.moveSpeed - state.boardVelocity) * (1 - Math.exp(-18 * dt));
    state.boardX = clamp(state.boardX + state.boardVelocity * dt, -WORLD.halfWidth, WORLD.halfWidth);
    if (Math.abs(state.boardX) === WORLD.halfWidth) state.boardVelocity = 0;
    state.boardAngle += (state.targetSide * REST_ANGLE - state.boardAngle) * (1 - Math.exp(-14 * dt));
    this.updateSeat();

    person.x += person.vx * dt;
    person.y += person.vy * dt - WORLD.gravity * dt * dt / 2;
    person.vy -= WORLD.gravity * dt;

    const previousOffset = previousX - previousBoardX;
    const offset = person.x - state.boardX;
    const previousSurface = WORLD.boardY + previousOffset * Math.sin(previousAngle);
    const surface = WORLD.boardY + offset * Math.sin(state.boardAngle);
    const before = previousY - previousSurface;
    const after = person.y - surface;

    if (person.vy < 0 && before >= 0 && after <= 0) {
      const fraction = clamp(before / (before - after), 0, 1);
      const hitOffset = previousOffset + (offset - previousOffset) * fraction;
      const hitDistance = hitOffset * state.targetSide;
      if (hitDistance >= INNER_CATCH && hitDistance <= WORLD.boardHalfLength) {
        this.launch(hitOffset, surface);
      }
    }

    const active = state.people[state.activePerson];
    state.height = Math.max(0, active.y);
    if (state.catches > 0) state.maxHeight = Math.max(state.maxHeight, state.height);
    if (active.y <= 0) {
      active.y = 0;
      active.vy = 0;
      state.phase = 'gameover';
      state.assistVisible = false;
      state.boardVelocity = 0;
      this.events.push({ type: 'miss', x: active.x, y: 0 });
      return;
    }
    this.updatePrediction();
  }

  private launch(offset: number, surface: number): void {
    const state = this.state;
    const incoming = state.people[state.activePerson];
    const nextIndex = (1 - state.activePerson) as 0 | 1;
    const outgoing = state.people[nextIndex];
    const quality = clamp((Math.abs(offset) - INNER_CATCH) / (WORLD.boardHalfLength - INNER_CATCH), 0, 1);
    const incomingEnergy = incoming.vy * incoming.vy / (2 * WORLD.gravity);
    // The end of the lever adds energy; central catches lose it. A 26 m floor
    // still leaves enough airtime to move from one side to the other.
    const rise = Math.max(26, incomingEnergy * (0.68 + quality * 0.94));
    const launchSpeed = Math.sqrt(2 * WORLD.gravity * rise);

    incoming.seated = true;
    incoming.vx = 0;
    incoming.vy = 0;
    incoming.y = surface;
    outgoing.seated = false;
    outgoing.vy = launchSpeed;
    const flightTime = 2 * launchSpeed / WORLD.gravity;
    let displacement = (this.random() * 2 - 1) * 19;
    if (Math.abs(displacement) < 6) displacement = displacement < 0 ? -6 : 6;
    // Leave a full lever's worth of room at both edges of the runway. A
    // randomly chosen landing must never make an end catch unreachable.
    const landingLimit = WORLD.halfWidth - WORLD.boardHalfLength;
    const landing = clamp(outgoing.x + displacement, -landingLimit, landingLimit);
    outgoing.vx = clamp((landing - outgoing.x) / flightTime, -3.8, 3.8);

    state.targetSide = (-state.targetSide) as Side;
    state.activePerson = nextIndex;
    state.catches++;
    state.combo = quality >= 0.8 ? state.combo + 1 : 0;
    state.lastQuality = quality;
    state.impact = 1;
    state.wind = outgoing.vx;
    this.assistHidden = false;
    this.updateSeat();
    this.events.push({ type: 'launch', quality, x: state.boardX + offset, y: surface });
  }

  private updateSeat(): void {
    const state = this.state;
    const seatSide = -state.targetSide;
    for (const person of state.people) {
      if (!person.seated) continue;
      person.x = state.boardX + seatSide * SEAT_X * Math.cos(state.boardAngle);
      person.y = WORLD.boardY + seatSide * SEAT_X * Math.sin(state.boardAngle);
    }
  }

  private updatePrediction(): void {
    const state = this.state;
    const person = state.people[state.activePerson];
    // Predict against the board's settled receiving-side height. The view can
    // display this data only while assistVisible is true.
    const targetHeight = WORLD.boardY + SEAT_X * Math.sin(REST_ANGLE);
    const discriminant = Math.max(0, person.vy * person.vy + 2 * WORLD.gravity * (person.y - targetHeight));
    state.landingIn = Math.max(0, (person.vy + Math.sqrt(discriminant)) / WORLD.gravity);
    state.landingX = person.x + person.vx * state.landingIn;
    if (state.landingIn <= WORLD.assistCutoff) this.assistHidden = true;
    state.assistVisible = !this.assistHidden && state.phase === 'playing';
  }

  private random(): number {
    // Mulberry32: stable replays without changing the global random source.
    this.randomState += 0x6D2B79F5;
    let value = this.randomState;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  }
}
