import './style.css';
import { Game } from './game/Game';

function supportsWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

const loading = document.getElementById('loading')!;
if (!supportsWebGL2()) {
  loading.innerHTML = '<p>このブラウザは WebGL2 に対応していないため遊べません。<br>最新の Chrome / Safari / Edge / Firefox でお試しください。</p>';
} else {
  const game = new Game(document.getElementById('scene') as HTMLCanvasElement);
  // 自動テスト・調整用（?debug を付けた時だけ公開）
  if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __game: Game }).__game = game;
  game.start().catch((e) => {
    console.error(e);
    loading.innerHTML = '<p>読み込みに失敗しました。ページを再読み込みしてください。</p>';
  });
}
