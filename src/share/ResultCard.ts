export interface CardData {
  title: string;
  subtitle: string;
  players: Array<{ name: string; liters: number; color: string; best: number; winner: boolean; toppled: boolean }>;
  footer: string;
  url: string;
}

export const GAME_NAME = 'SAND FLAG BATTLE';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 結果画面の画像（1200×630、SNSのカード比率）を作る */
export function drawResultCard(screenshot: HTMLCanvasElement | null, data: CardData): HTMLCanvasElement {
  const W = 1200;
  const H = 630;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#5aa9e6');
  bg.addColorStop(0.55, '#bfe3f7');
  bg.addColorStop(0.56, '#e9cf9b');
  bg.addColorStop(1, '#d9b57a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // ゲーム画面のスクリーンショット（右側）
  const shotX = 600;
  const shotY = 40;
  const shotW = 560;
  const shotH = 550;
  ctx.save();
  roundRect(ctx, shotX, shotY, shotW, shotH, 28);
  ctx.clip();
  if (screenshot) {
    const s = Math.max(shotW / screenshot.width, shotH / screenshot.height);
    const w = screenshot.width * s;
    const h = screenshot.height * s;
    ctx.drawImage(screenshot, shotX + (shotW - w) / 2, shotY + (shotH - h) / 2, w, h);
  } else {
    ctx.fillStyle = '#e2c48f';
    ctx.fillRect(shotX, shotY, shotW, shotH);
  }
  ctx.restore();
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  roundRect(ctx, shotX, shotY, shotW, shotH, 28);
  ctx.stroke();

  const font = (size: number, weight = 800) =>
    `${weight} ${size}px "Hiragino Sans", "Noto Sans JP", "Yu Gothic", system-ui, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.font = font(30, 900);
  ctx.fillText(GAME_NAME, 48, 78);
  ctx.fillStyle = '#16324f';
  ctx.font = font(54, 900);
  ctx.fillText(data.title, 48, 160);
  ctx.font = font(26, 700);
  ctx.fillStyle = '#24486b';
  ctx.fillText(data.subtitle, 48, 204);

  let y = 250;
  for (const p of data.players) {
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    roundRect(ctx, 40, y, 520, 120, 22);
    ctx.fill();
    ctx.fillStyle = p.color;
    roundRect(ctx, 40, y, 14, 120, 7);
    ctx.fill();
    ctx.fillStyle = '#16324f';
    ctx.font = font(26, 800);
    ctx.fillText(p.name + (p.winner ? '  🏆' : '') + (p.toppled ? '  旗を倒した…' : ''), 72, y + 42);
    ctx.font = font(56, 900);
    ctx.fillText(`${p.liters.toFixed(1)} L`, 72, y + 100);
    ctx.font = font(20, 700);
    ctx.fillStyle = '#4a6582';
    ctx.textAlign = 'right';
    ctx.fillText(`最大一手 ${p.best.toFixed(1)} L`, 540, y + 100);
    ctx.textAlign = 'left';
    y += 136;
  }

  ctx.fillStyle = '#5a3d1a';
  ctx.font = font(22, 700);
  ctx.fillText(data.footer, 48, H - 70);
  ctx.font = font(20, 600);
  ctx.fillText(data.url, 48, H - 38);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

/**
 * Web Share API で共有する。画像付き共有に対応していなければテキストのみ、
 * Web Share 自体が無ければ false を返す（呼び出し側でコピー等に切り替える）。
 */
export async function shareResult(text: string, url: string, image: Blob | null): Promise<'shared' | 'cancelled' | 'unsupported'> {
  if (!navigator.share) return 'unsupported';
  try {
    if (image) {
      const file = new File([image], 'sand-flag-battle.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ text: `${text}\n${url}`, files: [file] });
        return 'shared';
      }
    }
    await navigator.share({ text, url });
    return 'shared';
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
    return 'unsupported';
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
