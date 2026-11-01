import type { ToolId } from '../config';
import type { Match } from '../game/Match';
import { toLiters } from '../game/Match';
import { TOOLS, TOOL_ORDER, type ToolParams } from '../tools/DigTools';

const ICONS: Record<ToolId, string> = {
  hand: `<svg viewBox="0 0 40 40"><path d="M13 34c-3-3-6-8-6-12 0-2 2-3 3.5-1.5L13 23V9.5a2 2 0 0 1 4 0V19V7a2 2 0 0 1 4 0v12V8.5a2 2 0 0 1 4 0V20v-8a2 2 0 0 1 4 0v12c0 6-3 10-8 10z" fill="#f4c95d" stroke="#8a5a00" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  scoop: `<svg viewBox="0 0 40 40"><path d="M8 30c-2-6 1-12 6-15l5 5c-3 5-9 9-11 10z" fill="#ff8c42" stroke="#8a3b00" stroke-width="1.6"/><path d="M18 19l12-12" stroke="#2a9d8f" stroke-width="4.5" stroke-linecap="round"/></svg>`,
  shovel: `<svg viewBox="0 0 40 40"><path d="M6 34l3-10 6-1 2 2-1 6z" fill="#9aa4ad" stroke="#3d4650" stroke-width="1.6" stroke-linejoin="round"/><path d="M15 24L31 8" stroke="#b07a45" stroke-width="3.5" stroke-linecap="round"/><path d="M28 5l6 6" stroke="#222" stroke-width="3.5" stroke-linecap="round"/></svg>`,
  excavator: `<svg viewBox="0 0 40 40"><rect x="4" y="27" width="20" height="7" rx="3.5" fill="#2b2d31"/><rect x="6" y="18" width="16" height="9" rx="2" fill="#f5b700" stroke="#7a5a00" stroke-width="1.2"/><rect x="8" y="12" width="7" height="7" rx="1" fill="#9fd8ff" stroke="#7a5a00" stroke-width="1.2"/><path d="M20 19l9-9 6 9" fill="none" stroke="#f5b700" stroke-width="3.5" stroke-linejoin="round"/><path d="M32 18l5 1-2 6-5-2z" fill="#5c636b"/></svg>`,
};

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el;
}

export interface HudCallbacks {
  onTool: (tool: ToolId) => void;
  onParam: (key: keyof ToolParams, value: number) => void;
  onDig: () => void;
  onPass: () => void;
  onMenu: () => void;
}

/** プレイ中の画面表示（DOM） */
export class Hud {
  readonly root = $('hud');
  private readonly toolsEl = $('tools');
  private readonly dock = this.root.querySelector('.dock') as HTMLElement;
  private readonly estimateEl = $('estimate');
  private readonly digBtn = $('digBtn') as HTMLButtonElement;
  private readonly passBtn = $('passBtn') as HTMLButtonElement;
  private readonly turnLabel = $('turnLabel');
  private readonly toastEl = $('toast');
  private readonly hintEl = $('hint');
  private readonly cards = [$('card0'), $('card1')];
  private readonly toolButtons = new Map<ToolId, HTMLButtonElement>();
  private toastTimer = 0;

  constructor(cb: HudCallbacks) {
    for (const id of TOOL_ORDER) {
      const def = TOOLS[id];
      const b = document.createElement('button');
      b.className = 'tool';
      b.innerHTML = `${ICONS[id]}<span class="tname">${def.name}</span><span class="tscale">掘削量 ${def.scale}</span><span class="uses"></span>`;
      b.addEventListener('click', () => cb.onTool(id));
      this.toolButtons.set(id, b);
      this.toolsEl.appendChild(b);
    }
    this.root.querySelectorAll<HTMLLabelElement>('[data-param]').forEach((label) => {
      const key = label.dataset.param as keyof ToolParams;
      const input = label.querySelector('input')!;
      input.addEventListener('input', () => cb.onParam(key, Number(input.value)));
    });
    this.digBtn.addEventListener('click', () => cb.onDig());
    this.passBtn.addEventListener('click', () => cb.onPass());
    $('menuBtn').addEventListener('click', () => cb.onMenu());

    // 遊び方の道具表
    $('toolTable').innerHTML = TOOL_ORDER.map((id) => {
      const t = TOOLS[id];
      return `<tr><td>${t.name}</td><td>${t.scale}</td><td>${t.description}</td></tr>`;
    }).join('');
  }

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  /** 操作を受け付けない（掘削・崩落中） */
  lock(locked: boolean): void {
    this.dock.classList.toggle('locked', locked);
  }

  updatePlayers(match: Match, colors: string[]): void {
    this.cards.forEach((card, i) => {
      const p = match.players[i];
      card.classList.toggle('hidden', !p);
      if (!p) return;
      card.querySelector('.pname')!.textContent = p.name;
      card.querySelector('.pscore')!.innerHTML = `${toLiters(p.score).toFixed(1)}<small>L</small>`;
      card.classList.toggle('active', match.current === i && !match.isOver && match.players.length > 1);
      card.style.borderLeftColor = colors[i];
    });
    const solo = match.mode === 'solo';
    this.turnLabel.textContent = solo
      ? `残り ${Math.max(0, match.maxTurns - match.turn)} 手`
      : `ターン ${Math.min(match.turn + 1, match.maxTurns)} / ${match.maxTurns}`;
    this.passBtn.textContent = solo ? '終了する' : 'パス';
  }

  updateTools(match: Match, selected: ToolId): void {
    for (const [id, b] of this.toolButtons) {
      const uses = match.currentPlayer.uses[id];
      b.classList.toggle('selected', id === selected);
      b.disabled = uses <= 0;
      const badge = b.querySelector('.uses') as HTMLElement;
      badge.textContent = uses === Infinity ? '' : `残${uses}`;
      badge.classList.toggle('hidden', uses === Infinity);
    }
    const params = TOOLS[selected].params;
    this.root.querySelectorAll<HTMLLabelElement>('[data-param]').forEach((label) => {
      label.classList.toggle('hidden', !params.includes(label.dataset.param as keyof ToolParams));
    });
  }

  setParamValues(params: ToolParams): void {
    this.root.querySelectorAll<HTMLLabelElement>('[data-param]').forEach((label) => {
      const key = label.dataset.param as keyof ToolParams;
      label.querySelector('input')!.value = String(params[key]);
    });
  }

  setEstimate(html: string): void {
    this.estimateEl.innerHTML = html;
  }

  setDigEnabled(enabled: boolean): void {
    this.digBtn.disabled = !enabled;
  }

  toast(text: string, ms = 1400, danger = false): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.toggle('danger', danger);
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  hint(text: string): void {
    this.hintEl.textContent = text;
    this.hintEl.classList.toggle('show', text !== '');
  }
}
