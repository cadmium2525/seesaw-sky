import * as THREE from 'three';
import { Sfx } from '../audio/Sfx';
import { CONFIG, type ToolId } from '../config';
import { Particles } from '../fx/Particles';
import { FlagSystem, initPhysics } from '../physics/FlagSystem';
import { Stage, type Quality } from '../scene/Stage';
import { copyText, canvasToBlob, downloadBlob, drawResultCard, GAME_NAME, shareResult } from '../share/ResultCard';
import { loadBest, loadSettings, saveSettings, submitBest, type Settings } from '../storage';
import { SandField } from '../terrain/SandField';
import { SandMesh } from '../terrain/SandMesh';
import { brushOutline, DEFAULT_PARAMS, makeBrush, TOOLS, TOOL_ORDER, type Brush, type ToolParams } from '../tools/DigTools';
import { SandBin, ToolAnimator } from '../tools/ToolModels';
import { Hud } from '../ui/Hud';
import { CPU_LEVEL_LABEL, CpuPlanner, type CpuLevel } from './CpuPlayer';
import { Match, toLiters, type Mode } from './Match';

type Phase = 'title' | 'aim' | 'cpu' | 'digging' | 'settling' | 'falling' | 'result';

const PLAYER_COLORS = ['#ff6b4a', '#3a86ff'];
const BIN_POSITIONS = [new THREE.Vector3(-1.02, 0, 1.08), new THREE.Vector3(1.02, 0, 1.08)];
/** バケツの見た目が満杯に近づく目安 [m³] */
const BIN_SCALE = 0.07;

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

/**
 * ゲーム全体の進行役。入力 → 掘削アニメーション → 崩落 → 旗判定 → 手番交代 を回す。
 */
export class Game {
  private readonly stage: Stage;
  private field: SandField;
  private readonly sandMesh: SandMesh;
  private readonly flag = new FlagSystem();
  private readonly tools = new ToolAnimator();
  private readonly particles: Particles;
  private readonly bins = PLAYER_COLORS.map((c) => new SandBin(c));
  private readonly sfx = new Sfx();
  private readonly hud: Hud;
  private readonly clock = new THREE.Timer();
  private match: Match | null = null;
  private mode: Mode = 'cpu';
  private planner: CpuPlanner | null = null;
  /** CPU の手番になってからの経過時間 */
  private cpuTime = 0;
  /** CPU が狙いを見せ始めた時刻（cpuTime 基準） */
  private cpuAimAt = -1;
  private phase: Phase = 'title';
  private selectedTool: ToolId = 'scoop';
  private params: ToolParams = { ...DEFAULT_PARAMS };
  private aim: THREE.Vector3 | null = null;
  private aimLocked = false;
  private readonly preview: THREE.LineLoop;
  private readonly marker: THREE.Mesh;
  private readonly previewFill: THREE.Mesh;
  private settleSteps = 0;
  private settleTime = 0;
  private turnVolume = 0;
  private thudPlayed = false;
  private stepBudget = 0;
  private settings: Settings;
  private resultBlob: Blob | null = null;
  private resultText = '';
  private readonly raycaster = new THREE.Raycaster();
  private pointer = { id: -1, x: 0, y: 0, t: 0, moved: false, touch: false };
  private readonly touches = new Set<number>();
  private frameTimes: number[] = [];
  private autoQualityCooldown = 3;

  constructor(canvas: HTMLCanvasElement) {
    this.stage = new Stage(canvas);
    this.field = SandField.createMound(CONFIG.match.standardSeed);
    this.sandMesh = new SandMesh(this.field, this.stage.grain);
    this.stage.scene.add(this.sandMesh.mesh);
    this.flag.reset(this.field);
    this.stage.scene.add(this.flag.group);
    this.stage.scene.add(this.tools.root);
    this.particles = new Particles((x, z) => this.groundAt(x, z));
    this.stage.scene.add(this.particles.mesh);
    this.bins.forEach((bin, i) => {
      bin.group.position.copy(BIN_POSITIONS[i]);
      this.stage.scene.add(bin.group);
    });

    this.preview = new THREE.LineLoop(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3)),
      new THREE.LineBasicMaterial({ color: '#ff7b00', depthTest: false, transparent: true, opacity: 0.95 }),
    );
    this.preview.renderOrder = 10;
    this.preview.visible = false;
    this.preview.frustumCulled = false;
    this.stage.scene.add(this.preview);
    const fillGeo = new THREE.BufferGeometry();
    fillGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(65 * 3), 3));
    const idx: number[] = [];
    for (let i = 0; i < 64; i++) idx.push(64, i, (i + 1) % 64);
    fillGeo.setIndex(idx);
    this.previewFill = new THREE.Mesh(
      fillGeo,
      new THREE.MeshBasicMaterial({ color: '#ff7b00', transparent: true, opacity: 0.22, depthTest: false, side: THREE.DoubleSide }),
    );
    this.previewFill.renderOrder = 9;
    this.previewFill.frustumCulled = false;
    this.previewFill.visible = false;
    this.stage.scene.add(this.previewFill);
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.008, 0.016, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ff7b00', depthTest: false, transparent: true }),
    );
    this.marker.renderOrder = 11;
    this.marker.visible = false;
    this.stage.scene.add(this.marker);

    this.hud = new Hud({
      onTool: (t) => this.selectTool(t),
      onParam: (k, v) => {
        this.params[k] = v;
        this.refreshPreview();
      },
      onDig: () => this.dig(),
      onPass: () => this.pass(),
      onMenu: () => this.openModal('menu'),
    });

    this.settings = loadSettings();
    this.applySettings();
    this.bindInput(canvas);
    this.bindScreens();
  }

  async start(): Promise<void> {
    // 物理エンジンは裏で読み込む（旗が倒れる瞬間までに間に合えばよい）
    void initPhysics().catch((e) => console.warn('Rapier の読み込みに失敗。簡易表示で代替します', e));
    $('loading').classList.add('hidden');
    this.showTitle();
    this.stage.renderer.setAnimationLoop(() => this.frame());
  }

  // ------------------------------------------------------------------ 画面

  private bindScreens(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-start]').forEach((b) =>
      b.addEventListener('click', () => {
        this.sfx.unlock();
        this.startMatch(b.dataset.start as Mode);
      }),
    );
    $('howtoBtn').addEventListener('click', () => this.openModal('howto'));
    $('menuHowtoBtn').addEventListener('click', () => {
      this.closeModal('menu');
      this.openModal('howto');
    });
    document.querySelectorAll<HTMLElement>('[data-close]').forEach((b) =>
      b.addEventListener('click', () => this.closeModal(b.closest('.modal')!.id)),
    );
    document.querySelectorAll<HTMLElement>('.modal').forEach((m) =>
      m.addEventListener('click', (e) => {
        if (e.target === m) this.closeModal(m.id);
      }),
    );
    $('quitBtn').addEventListener('click', () => {
      this.closeModal('menu');
      this.showTitle();
    });
    $('resetViewBtn').addEventListener('click', () => {
      this.stage.resetView();
      this.closeModal('menu');
    });
    $('qualitySeg').addEventListener('click', (e) => {
      const q = (e.target as HTMLElement).dataset.q as Settings['quality'] | undefined;
      if (!q) return;
      this.settings.quality = q;
      this.applySettings();
    });
    $('cpuLevelSeg').addEventListener('click', (e) => {
      const lv = (e.target as HTMLElement).dataset.level as CpuLevel | undefined;
      if (!lv) return;
      this.sfx.click();
      this.settings.cpuLevel = lv;
      this.applySettings();
    });
    $('soundSeg').addEventListener('click', (e) => {
      const s = (e.target as HTMLElement).dataset.sound;
      if (!s) return;
      this.settings.muted = s === 'off';
      this.applySettings();
    });
    $('againBtn').addEventListener('click', () => this.startMatch(this.mode));
    $('titleBtn').addEventListener('click', () => this.showTitle());
    $('shareBtn').addEventListener('click', () => void this.share());
    $('copyBtn').addEventListener('click', async () => {
      const ok = await copyText(`${this.resultText}\n${this.gameUrl()}`);
      this.hud.toast(ok ? 'コピーしました' : 'コピーできませんでした');
    });
    $('saveBtn').addEventListener('click', () => {
      if (this.resultBlob) downloadBlob(this.resultBlob, 'sand-flag-battle-result.png');
    });
  }

  private openModal(id: string): void {
    this.sfx.click();
    $(id).classList.remove('hidden');
  }

  private closeModal(id: string): void {
    $(id).classList.add('hidden');
  }

  private applySettings(): void {
    const s = this.settings;
    const q: Quality =
      s.quality === 'auto' ? (matchMedia('(pointer: coarse)').matches ? 'medium' : 'high') : s.quality;
    this.stage.setQuality(q);
    this.particles.setLimit(q === 'low' ? 200 : q === 'medium' ? 450 : 700);
    this.sfx.setMuted(s.muted);
    $('qualitySeg').querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.classList.toggle('on', b.dataset.q === s.quality),
    );
    $('cpuLevelSeg').querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.classList.toggle('on', b.dataset.level === s.cpuLevel),
    );
    $('soundSeg').querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.classList.toggle('on', (b.dataset.sound === 'off') === s.muted),
    );
    saveSettings(s);
  }

  private showTitle(): void {
    this.phase = 'title';
    this.match = null;
    this.planner = null;
    this.resetWorld();
    this.hud.show(false);
    $('result').classList.add('hidden');
    $('title').classList.remove('hidden');
    const best = loadBest();
    $('bestLabel').textContent = best ? `端末内ベスト（ひとりで練習）: ${best.liters.toFixed(1)} L` : '';
    this.stage.controls.autoRotate = true;
    this.stage.controls.autoRotateSpeed = 0.6;
    this.bins[1].group.visible = true;
  }

  private resetWorld(): void {
    this.field = SandField.createMound(CONFIG.match.standardSeed);
    this.sandMesh.setField(this.field);
    this.flag.reset(this.field);
    this.particles.clear();
    this.bins.forEach((b) => b.setLevel(0));
    this.tools.parkExcavator(new THREE.Vector3(1.3, 0, -0.95), new THREE.Vector3(0, 0, 0));
    this.clearAim();
  }

  private startMatch(mode: Mode): void {
    this.mode = mode;
    this.resetWorld();
    this.match = new Match({ mode, initialVolume: this.field.totalVolume() });
    $('title').classList.add('hidden');
    $('result').classList.add('hidden');
    this.hud.show(true);
    this.stage.controls.autoRotate = false;
    this.stage.resetView();
    this.bins[1].group.visible = mode !== 'solo';
    this.bins[0].group.position.copy(mode === 'solo' ? new THREE.Vector3(-0.9, 0, 1.2) : BIN_POSITIONS[0]);
    this.selectedTool = 'scoop';
    this.params = { ...DEFAULT_PARAMS };
    this.hud.setParamValues(this.params);
    this.beginTurn(true);
  }

  // ------------------------------------------------------------------ 手番

  private beginTurn(first = false): void {
    const m = this.match!;
    this.phase = 'aim';
    if (!m.canUse(this.selectedTool)) this.selectedTool = 'hand';
    this.clearAim();
    this.hud.lock(false);
    this.refreshHud();
    if (m.players.length === 2) {
      this.hud.toast(`${m.currentPlayer.name}の番`, 1200);
      if (!first) this.sfx.turn();
    } else if (first) {
      this.hud.toast('旗を倒さずに、たくさん取れ！', 1600);
    }
    if (this.isCpuTurn) this.startCpuTurn();
  }

  private get isCpuTurn(): boolean {
    return this.match?.mode === 'cpu' && this.match.current === 1 && !this.match.isOver;
  }

  // ------------------------------------------------------------------ CPU

  private startCpuTurn(): void {
    const m = this.match!;
    this.phase = 'cpu';
    this.hud.lock(true);
    this.hud.hint('CPUが考え中…');
    this.cpuTime = 0;
    this.cpuAimAt = -1;
    this.planner = new CpuPlanner(this.field, this.flag.anchor, m.currentPlayer.uses, this.settings.cpuLevel);
  }

  /** CPU の思考を少しずつ進め、決まったら狙いを見せてから掘る */
  private updateCpu(dt: number): void {
    const planner = this.planner;
    if (!planner) return;
    this.cpuTime += dt;
    if (!planner.done) {
      planner.work(8);
      return;
    }
    // 考えている感じを出すため、最低でも少し待つ
    if (this.cpuTime < 0.9) return;
    const move = planner.move;
    if (!move) {
      this.planner = null;
      this.match!.recordPass();
      this.hud.hint('');
      this.hud.toast('CPUはパス', 1000);
      this.endTurn(false);
      return;
    }
    if (this.cpuAimAt < 0) {
      this.cpuAimAt = this.cpuTime;
      this.selectedTool = move.tool;
      this.params = { ...move.params };
      this.aim = new THREE.Vector3(move.x, this.field.heightAt(move.x, move.z), move.z);
      this.aimLocked = true;
      this.hud.hint('');
      this.refreshHud();
      return;
    }
    if (this.cpuTime - this.cpuAimAt > 0.9) {
      this.planner = null;
      this.dig();
    }
  }

  private refreshHud(): void {
    const m = this.match;
    if (!m) return;
    this.hud.updatePlayers(m, PLAYER_COLORS);
    this.hud.updateTools(m, this.selectedTool);
    this.refreshPreview();
  }

  private selectTool(tool: ToolId): void {
    if (this.phase !== 'aim' || !this.match?.canUse(tool)) return;
    this.sfx.click();
    this.selectedTool = tool;
    this.refreshHud();
  }

  private currentBrush(): Brush | null {
    if (!this.aim) return null;
    return makeBrush(this.selectedTool, this.params, this.aim.x, this.aim.z);
  }

  private clearAim(): void {
    this.aim = null;
    this.aimLocked = false;
    this.preview.visible = false;
    this.previewFill.visible = false;
    this.marker.visible = false;
    this.refreshPreview();
  }

  /** 予想掘削範囲と予想量を更新 */
  private refreshPreview(): void {
    const brush = this.currentBrush();
    const inAim = this.phase === 'aim' || this.phase === 'cpu';
    if (!brush || !inAim) {
      this.preview.visible = false;
      this.previewFill.visible = false;
      this.marker.visible = false;
      if (inAim) {
        this.hud.setEstimate('砂山をタップして掘る場所を選ぼう');
        this.hud.hint('');
      }
      this.hud.setDigEnabled(false);
      return;
    }
    const pts = brushOutline(brush, 64);
    const pos = this.preview.geometry.attributes.position as THREE.BufferAttribute;
    pts.forEach(([x, z], i) => pos.setXYZ(i, x, this.field.heightAt(x, z) + 0.006, z));
    pos.needsUpdate = true;
    const fill = this.previewFill.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < 64; i++) fill.setXYZ(i, pos.getX(i), pos.getY(i), pos.getZ(i));
    fill.setXYZ(64, brush.cx, this.field.heightAt(brush.cx, brush.cz) + 0.006, brush.cz);
    fill.needsUpdate = true;
    this.previewFill.visible = true;
    (this.previewFill.material as THREE.MeshBasicMaterial).opacity = this.aimLocked ? 0.28 : 0.14;
    this.preview.visible = true;
    this.marker.visible = true;
    this.marker.position.set(this.aim!.x, this.field.heightAt(this.aim!.x, this.aim!.z) + 0.004, this.aim!.z);
    const liters = toLiters(this.field.previewDig(brush));
    const color = this.aimLocked ? '#ff7b00' : '#ffffff';
    (this.preview.material as THREE.LineBasicMaterial).color.set(color);
    (this.marker.material as THREE.MeshBasicMaterial).color.set(color);
    const canDig = this.aimLocked && liters >= 0.1;
    this.hud.setEstimate(
      liters < 0.1 ? 'ここには砂がありません' : `${TOOLS[this.selectedTool].name}で 予想 約 <b>${liters.toFixed(1)}&nbsp;L</b>`,
    );
    this.hud.setDigEnabled(canDig);
    this.hud.hint(this.aimLocked ? '「掘る」で決定（場所は選び直せます）' : '');
  }

  private dig(): void {
    const m = this.match;
    const brush = this.currentBrush();
    if ((this.phase !== 'aim' && this.phase !== 'cpu') || !m || !brush || !this.aimLocked || !m.canUse(this.selectedTool)) return;
    const estimate = this.field.previewDig(brush);
    if (estimate < 0.0001) return;
    this.sfx.unlock();
    m.recordDig(this.selectedTool, 0);
    this.turnVolume = 0;
    this.phase = 'digging';
    this.hud.lock(true);
    this.hud.hint('');
    this.preview.visible = false;
    this.previewFill.visible = false;
    this.marker.visible = false;
    this.refreshHud();
    const bin = this.bins[m.current];
    const tool = this.selectedTool;
    const sizeFactor = { hand: 0.15, scoop: 0.35, shovel: 0.6, excavator: 1 }[tool];
    if (tool === 'excavator') this.sfx.engine();
    this.tools.start({
      tool,
      brush,
      target: this.aim!.clone(),
      bin,
      estimate,
      heightAt: (x, z) => this.field.heightAt(x, z),
      onDig: (fraction) => {
        const v = this.field.dig(brush, fraction);
        m.addToPending(v);
        this.turnVolume += v;
        this.sandMesh.markDirty();
        this.checkFlag();
        if (Math.random() < 0.6) {
          const p = new THREE.Vector3(brush.cx, this.field.heightAt(brush.cx, brush.cz), brush.cz);
          this.particles.burst(p, Math.ceil(4 * sizeFactor + 1), { spread: brush.ru * 0.6, up: 0.8, speed: 0.4 });
        }
        this.hud.updatePlayers(m, PLAYER_COLORS);
      },
      onImpact: (point) => {
        this.sfx.dig(sizeFactor);
        const dist = Math.hypot(point.x - this.flag.anchor.x, point.z - this.flag.anchor.z);
        this.flag.shake(sizeFactor * 3 * Math.max(0, 1 - dist / 0.8));
        this.particles.burst(point.clone().setY(this.field.heightAt(point.x, point.z)), Math.round(10 + 40 * sizeFactor), {
          spread: brush.ru * 0.8,
          up: 1.1,
          speed: 0.7,
        });
      },
      onDump: (point) => {
        this.sfx.dump(sizeFactor);
        this.particles.burst(point, Math.round(12 + 50 * sizeFactor), { spread: 0.04, up: 0.2, speed: 0.15, size: 0.007 });
        bin.setLevel(1 - Math.exp(-m.players[m.current].score / BIN_SCALE));
      },
      onDone: () => {
        this.phase = this.flag.isFalling ? 'falling' : 'settling';
        this.settleSteps = 0;
        this.settleTime = 0;
      },
    });
  }

  private pass(): void {
    const m = this.match;
    if (this.phase !== 'aim' || !m) return;
    if (m.mode === 'solo' && !window.confirm('ここで終了して記録しますか？')) return;
    this.sfx.click();
    m.recordPass();
    if (m.players.length === 2) this.hud.toast(`${m.currentPlayer.name}はパス`, 1000);
    this.endTurn(false);
  }

  /** 旗の支持を再評価し、支えを失ったら倒す */
  private checkFlag(): void {
    if (this.flag.isFalling) return;
    const s = this.flag.evaluate(this.field);
    if (s.fallen) {
      this.flag.topple(this.field);
      this.thudPlayed = false;
      const m = this.match!;
      this.hud.toast(m.mode === 'solo' ? '旗が倒れた！' : `${m.currentPlayer.name}が旗を倒した！`, 1800, true);
    }
  }

  private endTurn(fallen: boolean): void {
    const m = this.match!;
    const result = m.resolveTurn(fallen, this.field.totalVolume());
    if (result) {
      this.phase = 'result';
      this.hud.lock(true);
      this.refreshHud();
      window.setTimeout(() => this.showResult(), fallen ? 300 : 700);
    } else {
      this.beginTurn();
    }
  }

  // ------------------------------------------------------------------ 結果

  private gameUrl(): string {
    return location.origin + location.pathname;
  }

  private showResult(): void {
    const m = this.match;
    if (!m?.result || this.phase !== 'result') return;
    const r = m.result;
    this.hud.show(false);
    this.stage.controls.autoRotate = true;
    this.stage.controls.autoRotateSpeed = 1.2;
    const liters = m.players.map((p) => toLiters(p.score));
    const reasonText: Record<string, string> = {
      flag: `${r.toppledBy !== null ? m.players[r.toppledBy].name : ''}が旗を倒した！`,
      turns: '最大ターンに到達',
      sand: '砂がほとんど無くなった',
      pass: m.mode === 'solo' ? '旗を守りきって終了' : '双方パスで終了',
    };
    const level = CPU_LEVEL_LABEL[this.settings.cpuLevel];
    let kicker = m.mode === 'solo' ? 'ひとりで練習' : m.mode === 'cpu' ? `CPUと対戦（${level}）` : '2人対戦';
    let title: string;
    let sub = reasonText[r.reason];
    if (m.mode === 'solo') {
      if (r.validRecord) {
        const updated = submitBest(liters[0]);
        title = `${liters[0].toFixed(1)} L 獲得！`;
        if (updated) kicker += ' ・ 自己ベスト更新！';
        this.resultText = `${GAME_NAME} ひとりで練習で砂を ${liters[0].toFixed(1)} L 獲得！旗は守りきった⚑（最大一手 ${toLiters(m.players[0].bestMove).toFixed(1)} L） #SANDFLAGBATTLE`;
        this.sfx.win();
      } else {
        title = '旗が倒れた… 記録なし';
        sub = `倒れる前に ${liters[0].toFixed(1)} L 取っていた`;
        this.resultText = `${GAME_NAME} で ${liters[0].toFixed(1)} L 取ったところで旗を倒してしまった…⚑ #SANDFLAGBATTLE`;
        this.sfx.lose();
      }
    } else if (m.mode === 'cpu') {
      title = r.winner === null ? '引き分け！' : r.winner === 0 ? 'あなたの勝ち！' : 'CPUの勝ち…';
      const vs = `あなた ${liters[0].toFixed(1)} L vs CPU ${liters[1].toFixed(1)} L`;
      const verdict = r.winner === null ? `CPU（${level}）と引き分け` : r.winner === 0 ? `CPU（${level}）に勝利！` : `CPU（${level}）に負けた…`;
      this.resultText = `${GAME_NAME} ${verdict}（${sub}）${vs} #SANDFLAGBATTLE`;
      if (r.winner === 1) this.sfx.lose();
      else this.sfx.win();
    } else {
      title = r.winner === null ? '引き分け！' : `${m.players[r.winner].name}の勝ち！`;
      const vs = `${m.players[0].name} ${liters[0].toFixed(1)} L vs ${m.players[1].name} ${liters[1].toFixed(1)} L`;
      this.resultText = `${GAME_NAME} ${title}（${sub}）${vs} #SANDFLAGBATTLE`;
      this.sfx.win();
    }
    $('resultKicker').textContent = kicker;
    $('resultTitle').textContent = title;
    $('resultSub').textContent = sub;
    $('resultPlayers').innerHTML = m.players
      .map(
        (p, i) => `<div class="result-player" style="--c:${PLAYER_COLORS[i]}">
          <div class="rname">${p.name}${r.winner === i && m.players.length === 2 ? ' 🏆' : ''}${r.toppledBy === i ? ' （旗を倒した）' : ''}</div>
          <div class="rscore">${liters[i].toFixed(1)} L</div>
          <div class="rbest">最大一手 ${toLiters(p.bestMove).toFixed(1)} L ・ ${p.digs}回掘った</div>
        </div>`,
      )
      .join('');

    // 結果カード画像（その場のスクリーンショット付き）
    this.stage.render();
    const shot = document.createElement('canvas');
    shot.width = this.stage.renderer.domElement.width;
    shot.height = this.stage.renderer.domElement.height;
    shot.getContext('2d')!.drawImage(this.stage.renderer.domElement, 0, 0);
    const card = drawResultCard(shot, {
      title,
      subtitle: `${kicker} ・ ${sub}`,
      players: m.players.map((p, i) => ({
        name: p.name,
        liters: liters[i],
        color: PLAYER_COLORS[i],
        best: toLiters(p.bestMove),
        winner: m.players.length === 2 && r.winner === i,
        toppled: r.toppledBy === i,
      })),
      footer: 'たくさん取れ。でも、旗を倒すな。 ※非公式記録',
      url: this.gameUrl(),
    });
    ($('resultImage') as HTMLImageElement).src = card.toDataURL('image/png');
    this.resultBlob = null;
    void canvasToBlob(card).then((b) => (this.resultBlob = b));
    $('result').classList.remove('hidden');
  }

  private async share(): Promise<void> {
    const outcome = await shareResult(this.resultText, this.gameUrl(), this.resultBlob);
    if (outcome === 'unsupported') {
      const ok = await copyText(`${this.resultText}\n${this.gameUrl()}`);
      this.hud.toast(ok ? '共有テキストをコピーしました' : 'コピーできませんでした');
      if (this.resultBlob) downloadBlob(this.resultBlob, 'sand-flag-battle-result.png');
    }
  }

  // ------------------------------------------------------------------ 入力

  private bindInput(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (e) => {
      this.sfx.unlock();
      if (e.pointerType === 'touch') this.touches.add(e.pointerId);
      if (this.touches.size > 1) {
        // 2本指は視点操作。掘削位置の指定は取り消す
        this.pointer.id = -1;
        return;
      }
      this.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false, touch: e.pointerType === 'touch' };
      if (this.pointer.touch) this.aimAt(e.clientX, e.clientY, false);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.pointer.id) {
        if (Math.hypot(e.clientX - this.pointer.x, e.clientY - this.pointer.y) > 6) this.pointer.moved = true;
        if (this.pointer.touch) this.aimAt(e.clientX, e.clientY, false);
      } else if (e.pointerType === 'mouse' && e.buttons === 0 && !this.aimLocked) {
        this.aimAt(e.clientX, e.clientY, false);
      }
    });
    const end = (e: PointerEvent) => {
      this.touches.delete(e.pointerId);
      if (e.pointerId !== this.pointer.id) return;
      this.pointer.id = -1;
      const quick = performance.now() - this.pointer.t < 600;
      if (this.pointer.touch || (!this.pointer.moved && quick && e.button === 0)) this.aimAt(e.clientX, e.clientY, true);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', (e) => {
      this.touches.delete(e.pointerId);
      if (e.pointerId === this.pointer.id) this.pointer.id = -1;
    });
    canvas.addEventListener('pointerleave', () => {
      if (!this.aimLocked && this.phase === 'aim') this.clearAim();
    });
    window.addEventListener('keydown', (e) => {
      if (this.phase !== 'aim') return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        this.dig();
      }
      const n = Number(e.key);
      if (n >= 1 && n <= 4) this.selectTool(TOOL_ORDER[n - 1]);
      if (e.key === 'Escape') this.clearAim();
    });
  }

  /** 画面座標から砂の表面の点を求め、掘削位置にする */
  private aimAt(clientX: number, clientY: number, lock: boolean): void {
    if (this.phase !== 'aim') return;
    const rect = this.stage.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const hit = this.pickSurface(ndc);
    if (!hit) {
      if (!this.aimLocked) this.clearAim();
      return;
    }
    this.aim = hit;
    if (lock) {
      this.aimLocked = true;
      this.sfx.click();
    }
    this.refreshPreview();
  }

  /** 高さマップに対するレイマーチング（三角形との交差判定より高速） */
  private pickSurface(ndc: THREE.Vector2): THREE.Vector3 | null {
    this.raycaster.setFromCamera(ndc, this.stage.camera);
    const { origin, direction } = this.raycaster.ray;
    const half = this.field.size / 2 - 0.05;
    const p = new THREE.Vector3();
    let prevT = 0;
    const maxT = 20;
    for (let t = 0; t < maxT; t += 0.01) {
      p.copy(origin).addScaledVector(direction, t);
      if (p.y > 1.2 && direction.y >= 0) return null;
      if (Math.abs(p.x) <= half && Math.abs(p.z) <= half && p.y <= this.field.heightAt(p.x, p.z)) {
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          p.copy(origin).addScaledVector(direction, mid);
          if (p.y <= this.field.heightAt(p.x, p.z)) hi = mid;
          else lo = mid;
        }
        p.copy(origin).addScaledVector(direction, hi);
        return p.clone();
      }
      if (p.y < -0.05) return null;
      prevT = t;
    }
    return null;
  }

  private groundAt(x: number, z: number): number {
    for (const bin of this.bins) {
      if (!bin.group.visible) continue;
      const s = bin.surfaceAt(x, z);
      if (s !== null) return s;
    }
    return this.field.heightAt(x, z);
  }

  // ------------------------------------------------------------------ 毎フレーム

  private frame(): void {
    this.clock.update();
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const time = this.clock.getElapsed();

    if (this.phase === 'cpu') {
      this.updateCpu(dt);
    } else if (this.phase === 'digging') {
      this.tools.update(dt);
    } else if (this.phase === 'settling' || this.phase === 'falling') {
      this.settleTime += dt;
      this.runCollapse(dt);
      if (this.phase === 'settling') {
        this.checkFlag();
        if (this.flag.isFalling) {
          this.phase = 'falling';
        } else if (!this.field.isActive || this.settleSteps >= CONFIG.sand.maxSettleSteps) {
          if (this.settleTime > 0.5) {
            this.sfx.pour(0);
            this.endTurn(false);
          }
        }
      } else {
        if (!this.thudPlayed && this.flag.tiltDeg() > 65) {
          this.thudPlayed = true;
          this.sfx.thud();
        }
        if (this.flag.fallSettled) {
          this.sfx.pour(0);
          this.endTurn(true);
        }
      }
    } else if (this.phase === 'result' && this.field.isActive) {
      this.runCollapse(dt);
    }

    if (document.body.dataset.phase !== this.phase) document.body.dataset.phase = this.phase;
    this.flag.update(dt, time);
    this.particles.update(dt);
    this.sandMesh.update();
    this.stage.update(time);
    this.stage.render();
    this.watchPerformance(dt);
  }

  /** 崩落を数ステップ進め、流れる砂の演出を出す */
  private runCollapse(dt: number): void {
    let moved = 0;
    let lastFlow: number[] = [];
    // フレームレートに関係なく同じ速さで崩れるよう、経過時間からステップ数を決める
    this.stepBudget += dt * CONFIG.sand.stepsPerSecond;
    const steps = Math.min(Math.floor(this.stepBudget), CONFIG.sand.maxStepsPerFrame);
    this.stepBudget = Math.min(this.stepBudget - steps, 1);
    for (let i = 0; i < steps && this.field.isActive; i++) {
      const v = this.field.step();
      moved += v;
      this.settleSteps++;
      if (this.field.flowing.length) lastFlow = this.field.flowing.slice();
      if (v < CONFIG.sand.settleEpsilon) {
        this.field.sleep();
        break;
      }
    }
    if (moved > 0) this.sandMesh.markDirty();
    this.sfx.pour(moved / Math.max(dt, 1 / 120));
    const count = Math.min(lastFlow.length, 4);
    for (let k = 0; k < count; k++) {
      const idx = lastFlow[Math.floor(Math.random() * lastFlow.length)];
      const ix = idx % this.field.n;
      const iz = Math.floor(idx / this.field.n);
      const x = this.field.xOf(ix);
      const z = this.field.zOf(iz);
      const out = new THREE.Vector3(x, 0, z).normalize().multiplyScalar(0.25);
      this.particles.burst(new THREE.Vector3(x, this.field.heightAt(x, z) + 0.01, z), 2, {
        spread: 0.02,
        up: 0.2,
        speed: 0.2,
        dir: out,
        size: 0.005,
      });
    }
  }

  /** 画質「自動」の場合、重ければ一段下げる */
  private watchPerformance(dt: number): void {
    if (this.settings.quality !== 'auto') return;
    this.autoQualityCooldown -= dt;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    if (this.autoQualityCooldown > 0 || this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const q = this.stage.getQuality();
    if (avg > 1 / 28 && q !== 'low') {
      const next: Quality = q === 'high' ? 'medium' : 'low';
      this.stage.setQuality(next);
      this.particles.setLimit(next === 'low' ? 200 : 450);
      this.frameTimes = [];
      this.autoQualityCooldown = 4;
    }
  }
}
