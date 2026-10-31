export type Phase = 'ready' | 'playing' | 'paused' | 'gameover';
export type Side = -1 | 1;

export interface PersonState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  seated: boolean;
  color: 'coral' | 'mustard';
}

export interface GameState {
  phase: Phase;
  time: number;
  boardX: number;
  boardVelocity: number;
  boardAngle: number;
  targetSide: Side;
  people: [PersonState, PersonState];
  activePerson: 0 | 1;
  height: number;
  maxHeight: number;
  catches: number;
  combo: number;
  lastQuality: number;
  assistVisible: boolean;
  landingIn: number;
  landingX: number;
  wind: number;
  impact: number;
  seed: number;
}

export interface GameEvent {
  type: 'launch' | 'miss' | 'start';
  quality?: number;
  x?: number;
  y?: number;
}

export interface GameInput { move: number; }

export const WORLD = {
  halfWidth: 34,
  boardHalfLength: 4.8,
  boardY: 1.9,
  gravity: 7.8,
  moveSpeed: 17,
  treeX: 8.4,
  treeHeight: 23,
  assistCutoff: 5,
} as const;
