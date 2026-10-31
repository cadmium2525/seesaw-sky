import './style.css';
import { GameSimulation } from './simulation';
import { GameWorld } from './world';
import { GameAudio } from './audio';
import { WORLD, type GameEvent } from './types';

const element = <T extends HTMLElement = HTMLElement>(id: string) => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing interface element: ${id}`);
  return found as T;
};

const ui = {
  intro: element('intro'), sceneNote: element('scene-note'), hud: element('hud'),
  height: element('height'), runBest: element('run-best'), best: element('best'),
  catches: element('catch-count'), target: element('target-side'), direction: element('flight-direction'),
  assist: element('assist'), assistTime: element('assist-time'), board: element('board-marker'),
  landing: element('landing-marker'), blind: element('blind-note'),
  feedback: element('feedback'), flightLabel: element('flight-label'),
  movement: element('movement'), left: element<HTMLButtonElement>('left-btn'), right: element<HTMLButtonElement>('right-btn'),
  pauseButton: element<HTMLButtonElement>('pause-btn'), pause: element('pause-overlay'),
  over: element('gameover-overlay'), help: element<HTMLDialogElement>('help-dialog'),
  error: element('error-overlay'), sound: element<HTMLButtonElement>('sound-btn'),
};

const storage = {
  get(key: string) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* Private browsing still works. */ } },
};
const savedBest = Number(storage.get('seesaw-best-v1'));
let personalBest = Number.isFinite(savedBest) && savedBest > 0 ? savedBest : 0;
let bestAtStart = personalBest;
let seed = 1;
const simulation = new GameSimulation(seed);
const audio = new GameAudio();
audio.enabled = storage.get('seesaw-sound-v1') !== 'off';
const keys = new Set<string>();
const touchDirections = new Map<number, number>();
let previousPhase = '';
let feedbackUntil = 0;
let frameTime = performance.now();
let accumulator = 0;
let world: GameWorld;
let contextLost = false;
let helpPausedGame = false;
let lastSaveTime = 0;

function saveBest() {
  storage.set('seesaw-best-v1', personalBest.toFixed(1));
  lastSaveTime = performance.now();
}

function updateSoundButton() {
  ui.sound.classList.toggle('muted', !audio.enabled);
  ui.sound.setAttribute('aria-label', audio.enabled ? 'サウンドをオフにする' : 'サウンドをオンにする');
  ui.sound.setAttribute('aria-pressed', String(audio.enabled));
  element('sound-waves').style.display = audio.enabled ? '' : 'none';
}

function toggleSound() {
  audio.unlock();
  audio.enabled = !audio.enabled;
  storage.set('seesaw-sound-v1', audio.enabled ? 'on' : 'off');
  updateSoundButton();
}

function clearInput() {
  keys.clear();
  touchDirections.clear();
  ui.left.classList.remove('active');
  ui.right.classList.remove('active');
}

function startGame() {
  if (contextLost || ui.help.open) return;
  clearInput();
  bestAtStart = personalBest;
  // Each new run gets its own reproducible breeze pattern.
  seed = (Math.random() * 0xffffffff) >>> 0;
  simulation.reset(seed);
  simulation.start();
  feedbackUntil = 0;
  accumulator = 0;
  audio.unlock();
  updateInterface();
}

function pauseGame() {
  simulation.pause();
  saveBest();
  clearInput();
  accumulator = 0;
  updateInterface();
}

function resumeGame() {
  if (contextLost || ui.help.open) return;
  clearInput();
  simulation.resume();
  frameTime = performance.now();
  accumulator = 0;
  audio.unlock();
  updateInterface();
}

function togglePause() {
  if (simulation.state.phase === 'playing') pauseGame();
  else if (simulation.state.phase === 'paused') resumeGame();
}

function goHome() {
  clearInput();
  simulation.reset();
  accumulator = 0;
  updateInterface();
}

function showError(message: string) {
  clearInput();
  simulation.pause();
  element('error-message').textContent = message;
  ui.error.hidden = false;
}

function handleEvent(event: GameEvent) {
  audio.play(event.type, event.quality);
  if (event.type === 'launch') {
    const quality = event.quality ?? 0;
    const title = quality >= .9 ? 'PERFECT!' : quality >= .72 ? 'GREAT CATCH!' : 'NICE CATCH!';
    const caption = quality >= .9 ? '端っこ、大成功。もっと高く。' : quality >= .72 ? 'いい調子。そのまま空へ。' : '次は、もう少し端っこへ。';
    ui.feedback.replaceChildren(document.createTextNode(title));
    const subtitle = document.createElement('small');
    subtitle.textContent = caption;
    ui.feedback.append(subtitle);
    feedbackUntil = performance.now() + 1700;
  }
  if (event.type === 'miss') {
    saveBest();
    element('result-height').textContent = simulation.state.maxHeight.toFixed(1);
    element('result-catches').textContent = String(simulation.state.catches);
    element('result-best').textContent = personalBest.toFixed(1) + ' m';
    element('new-record').hidden = simulation.state.maxHeight <= bestAtStart;
    element('result-message').textContent = simulation.state.catches === 0 ? 'まずは、木から落ちてくる人を右側でキャッチ。' : 'いい旅だった。次は、もっと高くいける。';
  }
}

function updateInterface() {
  const state = simulation.state;
  const phaseChanged = previousPhase !== state.phase;
  if (phaseChanged) {
    document.body.className = state.phase;
    const ready = state.phase === 'ready';
    ui.intro.hidden = !ready;
    ui.sceneNote.hidden = !ready;
    ui.hud.hidden = ready || state.phase === 'gameover';
    ui.movement.hidden = state.phase !== 'playing';
    ui.pauseButton.hidden = ready || state.phase === 'gameover';
    ui.pause.hidden = state.phase !== 'paused' || ui.help.open;
    ui.over.hidden = state.phase !== 'gameover';
    ui.pauseButton.setAttribute('aria-label', state.phase === 'paused' ? 'ゲームをつづける' : '一時停止');
    previousPhase = state.phase;
    if (state.phase === 'gameover') element('retry-btn').focus({ preventScroll: true });
    if (state.phase === 'paused' && !ui.help.open) element('resume-btn').focus({ preventScroll: true });
  }
  ui.height.textContent = state.height.toFixed(1);
  ui.runBest.textContent = state.maxHeight.toFixed(1) + ' m';
  ui.best.textContent = personalBest.toFixed(1) + ' m';
  ui.catches.textContent = String(state.catches).padStart(2, '0');
  ui.target.textContent = state.targetSide === 1 ? '右側でキャッチ →' : '← 左側でキャッチ';
  const active = state.people[state.activePerson];
  ui.direction.textContent = active.vy >= 0 ? '↑' : '↓';
  ui.assist.hidden = !state.assistVisible || state.phase !== 'playing';
  ui.blind.hidden = state.assistVisible || state.phase !== 'playing' || state.catches === 0;
  if (state.assistVisible && state.phase === 'playing') {
    const position = (x: number) => `${Math.max(0, Math.min(100, (x / (WORLD.halfWidth + WORLD.boardHalfLength) + 1) * 50))}%`;
    ui.board.style.left = position(state.boardX);
    ui.landing.style.left = position(state.landingX);
    ui.assistTime.textContent = `着地まで ${state.landingIn.toFixed(1)} s`;
  }
  ui.flightLabel.textContent = state.catches === 0 ? '木の上から、最初のジャンプ。' : active.vy > 1 ? 'のぼれ、のぼれ。' : active.vy >= -1 ? '空のてっぺんで、ひといき。' : '落ちてくるよ。シーソーを動かして。';
  ui.feedback.classList.toggle('visible', performance.now() < feedbackUntil && state.phase === 'playing');
}

function bindMovement(button: HTMLButtonElement, direction: number) {
  button.addEventListener('pointerdown', event => {
    if (simulation.state.phase !== 'playing') return;
    event.preventDefault();
    audio.unlock();
    button.setPointerCapture(event.pointerId);
    touchDirections.set(event.pointerId, direction);
    button.classList.add('active');
  });
  const release = (event: PointerEvent) => {
    touchDirections.delete(event.pointerId);
    button.classList.remove('active');
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
  button.addEventListener('contextmenu', event => event.preventDefault());
}

element('start-btn').addEventListener('click', startGame);
element('retry-btn').addEventListener('click', startGame);
element('pause-retry').addEventListener('click', startGame);
element('resume-btn').addEventListener('click', resumeGame);
element('home-btn').addEventListener('click', goHome);
element('reload-btn').addEventListener('click', () => window.location.reload());
ui.pauseButton.addEventListener('click', togglePause);
ui.sound.addEventListener('click', toggleSound);
bindMovement(ui.left, -1);
bindMovement(ui.right, 1);

element('help-btn').addEventListener('click', () => {
  helpPausedGame = simulation.state.phase === 'playing';
  if (helpPausedGame) pauseGame();
  ui.help.showModal();
  ui.pause.hidden = true;
  clearInput();
});
element('close-help').addEventListener('click', () => ui.help.close());
ui.help.addEventListener('close', () => {
  if (helpPausedGame) resumeGame();
  else {
    previousPhase = '';
    updateInterface();
  }
  helpPausedGame = false;
});

window.addEventListener('keydown', event => {
  if (ui.help.open || !ui.error.hidden) return;
  const key = event.code;
  const isButton = event.target instanceof HTMLElement && ['BUTTON', 'A'].includes(event.target.tagName);
  if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(key)) {
    if (simulation.state.phase === 'playing') {
      event.preventDefault();
      keys.add(key);
    }
    return;
  }
  if (event.repeat) return;
  if (key === 'Space' && !isButton) {
    event.preventDefault();
    if (simulation.state.phase === 'ready' || simulation.state.phase === 'gameover') startGame();
    else if (simulation.state.phase === 'paused') resumeGame();
  }
  if (key === 'KeyP' || key === 'Escape') { event.preventDefault(); togglePause(); }
  if (key === 'KeyR' && simulation.state.phase !== 'ready') startGame();
  if (key === 'KeyM') toggleSound();
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => {
  clearInput();
  if (simulation.state.phase === 'playing') pauseGame();
});
window.addEventListener('pagehide', saveBest);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && simulation.state.phase === 'playing') pauseGame();
});

updateSoundButton();
updateInterface();
try {
  world = new GameWorld(element('world'));
  world.canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    contextLost = true;
    pauseGame();
    showError('描画が一時停止しました。再読み込みすると、もう一度遊べます。自己ベストは保存されています。');
  });
  window.addEventListener('resize', () => world.resize());
  // Read-only diagnostics make playtests inspectable without adding a gameplay shortcut.
  Object.defineProperty(window, '__SEESAW__', { value: Object.freeze({
    snapshot: () => structuredClone(simulation.state),
    version: '1.0.0',
  }) });
  function frame(now: number) {
    const dt = Math.max(0, Math.min((now - frameTime) / 1000, .05));
    frameTime = now;
    if (!contextLost) {
      if (simulation.state.phase === 'playing') {
        accumulator += dt;
        let move = Number(keys.has('ArrowRight') || keys.has('KeyD')) - Number(keys.has('ArrowLeft') || keys.has('KeyA'));
        for (const direction of touchDirections.values()) move += direction;
        move = Math.max(-1, Math.min(1, move));
        if (keys.has('ShiftLeft') || keys.has('ShiftRight')) move *= .32;
        ui.left.classList.toggle('active', move < 0);
        ui.right.classList.toggle('active', move > 0);
        while (accumulator >= 1 / 120 && simulation.state.phase === 'playing') {
          const events = simulation.step(1 / 120, { move });
          if (simulation.state.maxHeight > personalBest) {
            personalBest = simulation.state.maxHeight;
            // Save once per second, and on pause, game over, or page exit.
            if (now - lastSaveTime >= 1000) saveBest();
          }
          events.forEach(handleEvent);
          accumulator -= 1 / 120;
        }
      }
      world.update(simulation.state, dt);
      updateInterface();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
} catch (error) {
  console.error('Could not initialize game', error);
  showError('3D画面を開けませんでした。WebGL 2対応のブラウザで、ハードウェアアクセラレーションを有効にしてお試しください。');
}
