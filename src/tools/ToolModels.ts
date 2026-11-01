import * as THREE from 'three';
import type { ToolId } from '../config';
import type { Brush } from './DigTools';

/** 2点を結ぶ円柱 */
function limb(from: THREE.Vector3, to: THREE.Vector3, radius: number, mat: THREE.Material, radial = 10): THREE.Mesh {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, radial), mat);
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.castShadow = true;
  return mesh;
}

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) c.castShadow = true;
  });
  return o;
}

/*
 * 手持ちの道具は「先端 = 原点」「掘る向き = -z」「柄は +y/+z 側」で作る。
 */

function buildHand(): THREE.Group {
  const g = new THREE.Group();
  const glove = new THREE.MeshStandardMaterial({ color: '#f4c95d', roughness: 0.85 });
  const cuff = new THREE.MeshStandardMaterial({ color: '#3d5a80', roughness: 0.9 });
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), glove);
  palm.scale.set(0.048, 0.022, 0.055);
  palm.position.set(0, 0.022, 0.06);
  g.add(palm);
  for (let i = 0; i < 4; i++) {
    const x = -0.03 + i * 0.02;
    const len = i === 0 || i === 3 ? 0.04 : 0.05;
    g.add(limb(new THREE.Vector3(x, 0.02, 0.04), new THREE.Vector3(x * 1.1, 0.006, 0.04 - len), 0.0105, glove, 8));
  }
  g.add(limb(new THREE.Vector3(0.045, 0.025, 0.07), new THREE.Vector3(0.07, 0.015, 0.03), 0.012, glove, 8));
  g.add(limb(new THREE.Vector3(0, 0.03, 0.1), new THREE.Vector3(0, 0.1, 0.17), 0.035, cuff));
  g.add(limb(new THREE.Vector3(0, 0.1, 0.17), new THREE.Vector3(0, 0.45, 0.42), 0.03, glove));
  return shadowed(g);
}

function buildScoop(): THREE.Group {
  const g = new THREE.Group();
  const plastic = new THREE.MeshStandardMaterial({ color: '#ff8c42', roughness: 0.45, side: THREE.DoubleSide });
  const grip = new THREE.MeshStandardMaterial({ color: '#2a9d8f', roughness: 0.6 });
  const blade = new THREE.CylinderGeometry(0.055, 0.035, 0.14, 18, 1, true, -Math.PI / 2, Math.PI);
  blade.rotateX(Math.PI / 2);
  blade.translate(0, 0.035, 0.07);
  g.add(new THREE.Mesh(blade, plastic));
  g.add(limb(new THREE.Vector3(0, 0.035, 0.14), new THREE.Vector3(0, 0.07, 0.19), 0.012, plastic));
  g.add(limb(new THREE.Vector3(0, 0.07, 0.19), new THREE.Vector3(0, 0.13, 0.3), 0.016, grip));
  return shadowed(g);
}

function buildShovel(): THREE.Group {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: '#8d99a6', roughness: 0.35, metalness: 0.7 });
  const wood = new THREE.MeshStandardMaterial({ color: '#b07a45', roughness: 0.8 });
  const black = new THREE.MeshStandardMaterial({ color: '#222', roughness: 0.7 });
  const shape = new THREE.Shape();
  shape.moveTo(-0.065, 0.17);
  shape.lineTo(0.065, 0.17);
  shape.lineTo(0.068, 0.05);
  shape.quadraticCurveTo(0.05, -0.005, 0, 0);
  shape.quadraticCurveTo(-0.05, -0.005, -0.068, 0.05);
  shape.closePath();
  const blade = new THREE.ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: false });
  blade.rotateX(Math.PI / 2);
  g.add(new THREE.Mesh(blade, metal));
  g.add(limb(new THREE.Vector3(0, 0, 0.17), new THREE.Vector3(0, 0.03, 0.22), 0.016, metal));
  const top = new THREE.Vector3(0, 0.45, 0.7);
  g.add(limb(new THREE.Vector3(0, 0.03, 0.22), top, 0.014, wood));
  g.add(limb(top.clone().add(new THREE.Vector3(-0.05, 0, 0)), top.clone().add(new THREE.Vector3(0.05, 0, 0)), 0.013, black));
  return shadowed(g);
}

/** ショベルカー（腕は2関節） */
export class Excavator {
  readonly group = new THREE.Group();
  readonly upper = new THREE.Group();
  readonly boomPivot = new THREE.Group();
  readonly stickPivot = new THREE.Group();
  readonly bucketPivot = new THREE.Group();
  readonly bucketTip = new THREE.Object3D();
  static readonly BOOM = 0.42;
  static readonly STICK = 0.34;
  static readonly PIVOT = new THREE.Vector3(0, 0.17, -0.1);

  constructor() {
    const yellow = new THREE.MeshStandardMaterial({ color: '#f5b700', roughness: 0.5, metalness: 0.15 });
    const dark = new THREE.MeshStandardMaterial({ color: '#2b2d31', roughness: 0.8 });
    const steel = new THREE.MeshStandardMaterial({ color: '#5c636b', roughness: 0.45, metalness: 0.6 });
    const glass = new THREE.MeshStandardMaterial({ color: '#9fd8ff', roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.6 });

    for (const side of [-1, 1]) {
      const track = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.07, 0.36), dark);
      track.position.set(side * 0.1, 0.035, 0);
      this.group.add(track);
      for (let i = 0; i < 4; i++) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.08, 12), steel);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(side * 0.1, 0.035, -0.13 + i * 0.087);
        this.group.add(wheel);
      }
    }
    const turntable = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 20), dark);
    turntable.position.y = 0.085;
    this.group.add(turntable);

    this.upper.position.y = 0.1;
    this.group.add(this.upper);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.08, 0.27), yellow);
    body.position.set(0, 0.04, 0.02);
    this.upper.add(body);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.07, 0.06), dark);
    counter.position.set(0, 0.05, 0.15);
    this.upper.add(counter);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.12, 0.12), glass);
    cab.position.set(-0.06, 0.14, -0.03);
    this.upper.add(cab);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.13), yellow);
    roof.position.set(-0.06, 0.205, -0.03);
    this.upper.add(roof);

    this.boomPivot.position.copy(Excavator.PIVOT).sub(this.upper.position);
    this.upper.add(this.boomPivot);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, Excavator.BOOM), yellow);
    boom.position.z = -Excavator.BOOM / 2;
    this.boomPivot.add(boom);
    this.boomPivot.add(limb(new THREE.Vector3(0.03, -0.03, -0.05), new THREE.Vector3(0.03, 0.0, -0.3), 0.009, steel));

    this.stickPivot.position.z = -Excavator.BOOM;
    this.boomPivot.add(this.stickPivot);
    const stick = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.04, Excavator.STICK), yellow);
    stick.position.z = -Excavator.STICK / 2;
    this.stickPivot.add(stick);

    this.bucketPivot.position.z = -Excavator.STICK;
    this.stickPivot.add(this.bucketPivot);
    const bucketShape = new THREE.CylinderGeometry(0.06, 0.06, 0.12, 16, 1, false, 0, Math.PI * 1.2);
    bucketShape.rotateZ(Math.PI / 2);
    const bucket = new THREE.Mesh(bucketShape, steel);
    bucket.material = steel.clone();
    (bucket.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    bucket.position.set(0, -0.05, -0.02);
    bucket.rotation.x = Math.PI * 0.55;
    this.bucketPivot.add(bucket);
    this.bucketTip.position.set(0, -0.1, -0.02);
    this.bucketPivot.add(this.bucketTip);

    shadowed(this.group);
    this.pose(0.5, -1.4, -0.6);
  }

  /** 腕の角度（boom: 水平からの角度、stick/bucket: 親からの相対角度） */
  pose(boom: number, stick: number, bucket: number): void {
    this.boomPivot.rotation.x = boom;
    this.stickPivot.rotation.x = stick;
    this.bucketPivot.rotation.x = bucket;
  }

  /** 車体を (x,z) に置き、(tx,tz) の方を向かせる。heightAt があれば斜面に合わせて傾ける */
  place(x: number, y: number, z: number, tx: number, tz: number, heightAt?: (x: number, z: number) => number): void {
    const yaw = Math.atan2(-(tx - x), -(tz - z));
    this.group.position.set(x, y, z);
    this.group.rotation.set(0, yaw, 0, 'YXZ');
    if (!heightAt) return;
    // 前後・左右の高さの差から車体の傾きを決める
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const half = 0.16;
    const side = 0.1;
    const front = heightAt(x + fx * half, z + fz * half);
    const back = heightAt(x - fx * half, z - fz * half);
    const left = heightAt(x - fz * side, z + fx * side);
    const right = heightAt(x + fz * side, z - fx * side);
    this.group.position.y = Math.max((front + back) / 2, (left + right) / 2, heightAt(x, z));
    this.group.rotation.x = Math.atan2(front - back, half * 2);
    this.group.rotation.z = Math.atan2(left - right, side * 2);
  }

  /**
   * バケットの先端を世界座標 target に合わせる2関節IK。
   * bucketCurl はバケットの巻き込み角。
   */
  reach(target: THREE.Vector3, bucketCurl: number): void {
    this.group.updateMatrixWorld(true);
    const local = this.group.worldToLocal(target.clone());
    const d = Math.max(0.05, -(local.z - Excavator.PIVOT.z));
    const h = local.y - Excavator.PIVOT.y + 0.08;
    const L1 = Excavator.BOOM;
    const L2 = Excavator.STICK;
    const D = THREE.MathUtils.clamp(Math.hypot(d, h), Math.abs(L1 - L2) + 0.01, L1 + L2 - 0.005);
    const elbow = Math.acos(THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2), -1, 1));
    const shoulder = Math.atan2(h, d) + Math.acos(THREE.MathUtils.clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
    const stickRel = -(Math.PI - elbow);
    this.pose(shoulder, stickRel, bucketCurl - (shoulder + stickRel) * 0.6);
  }
}

/** 掘った砂を入れるバケツ（プレイヤーごと） */
export class SandBin {
  readonly group = new THREE.Group();
  private readonly fill: THREE.Mesh;
  static readonly RADIUS = 0.13;
  static readonly HEIGHT = 0.2;

  constructor(color: string) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, side: THREE.DoubleSide });
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(SandBin.RADIUS, SandBin.RADIUS * 0.8, SandBin.HEIGHT, 28, 1, true),
      mat,
    );
    body.position.y = SandBin.HEIGHT / 2;
    this.group.add(body);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(SandBin.RADIUS * 0.8, 28), mat);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = 0.004;
    this.group.add(bottom);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(SandBin.RADIUS, 0.008, 8, 32), mat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = SandBin.HEIGHT;
    this.group.add(rim);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(SandBin.RADIUS, 0.005, 6, 24, Math.PI), mat);
    handle.position.y = SandBin.HEIGHT;
    handle.rotation.z = 0.25;
    this.group.add(handle);
    this.fill = new THREE.Mesh(
      new THREE.CylinderGeometry(SandBin.RADIUS * 0.97, SandBin.RADIUS * 0.8, 1, 28),
      new THREE.MeshStandardMaterial({ color: '#c99f63', roughness: 1 }),
    );
    this.group.add(this.fill);
    shadowed(this.group);
    body.receiveShadow = true;
    this.setLevel(0);
  }

  /** 0..1（溢れる場合は山盛りにする） */
  setLevel(level: number): void {
    const h = Math.max(0.001, Math.min(1, level) * (SandBin.HEIGHT - 0.01));
    this.fill.scale.y = h;
    this.fill.position.y = h / 2 + 0.004;
    this.fill.visible = level > 0.002;
  }

  get level(): number {
    return this.fill.visible ? (this.fill.scale.y) / (SandBin.HEIGHT - 0.01) : 0;
  }

  /** 砂を受け止める高さ */
  surfaceAt(x: number, z: number): number | null {
    const dx = x - this.group.position.x;
    const dz = z - this.group.position.z;
    if (dx * dx + dz * dz > SandBin.RADIUS * SandBin.RADIUS) return null;
    return this.group.position.y + (this.fill.visible ? this.fill.scale.y + 0.004 : 0.004);
  }

  topCenter(): THREE.Vector3 {
    return this.group.position.clone().add(new THREE.Vector3(0, SandBin.HEIGHT + 0.06, 0));
  }
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const phase = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

export interface DigJob {
  tool: ToolId;
  brush: Brush;
  target: THREE.Vector3;
  bin: SandBin;
  heightAt: (x: number, z: number) => number;
  onDig: (fraction: number) => void;
  onImpact: (point: THREE.Vector3) => void;
  onDump: (point: THREE.Vector3) => void;
  onDone: () => void;
  estimate: number;
}

/**
 * 掘る動作のアニメーション。道具を砂山へ運び、掘削を少しずつ反映し、
 * 取った砂を自分のバケツまで運ぶ。
 */
export class ToolAnimator {
  readonly root = new THREE.Group();
  readonly excavator = new Excavator();
  private readonly models: Record<Exclude<ToolId, 'excavator'>, THREE.Group>;
  private readonly holder = new THREE.Group();
  private readonly clump: THREE.Mesh;
  private job: DigJob | null = null;
  private time = 0;
  private dug = 0;
  private impacted = false;
  private dumped = false;
  private duration = 0;
  private exFrom = new THREE.Vector3();
  private exTo = new THREE.Vector3();
  private exYawFrom = 0;
  private exYawTo = 0;
  speed = 1;

  constructor() {
    this.models = { hand: buildHand(), scoop: buildScoop(), shovel: buildShovel() };
    for (const m of Object.values(this.models)) {
      m.visible = false;
      this.holder.add(m);
    }
    this.root.add(this.holder);
    this.clump = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: '#b8925c', roughness: 1, flatShading: true }),
    );
    this.clump.castShadow = true;
    this.clump.visible = false;
    this.root.add(this.clump);
    this.root.add(this.excavator.group);
    this.parkExcavator(new THREE.Vector3(1.3, 0, -0.95), new THREE.Vector3(0, 0, 0));
  }

  get busy(): boolean {
    return this.job !== null;
  }

  parkExcavator(pos: THREE.Vector3, lookAt: THREE.Vector3, heightAt?: (x: number, z: number) => number): void {
    this.excavator.place(pos.x, pos.y, pos.z, lookAt.x, lookAt.z, heightAt);
    this.excavator.pose(0.75, -1.9, -0.9);
  }

  /** ショベルカーが掘るときの停車位置 */
  excavatorSpot(brush: Brush, heightAt: (x: number, z: number) => number): THREE.Vector3 {
    const ex = brush.cx + Math.cos(brush.angle) * (brush.halfLength + 0.36);
    const ez = brush.cz + Math.sin(brush.angle) * (brush.halfLength + 0.36);
    let y = 0;
    for (const [ox, oz] of [[0, 0], [0.12, 0.12], [-0.12, 0.12], [0.12, -0.12], [-0.12, -0.12]]) {
      y = Math.max(y, heightAt(ex + ox, ez + oz));
    }
    return new THREE.Vector3(ex, y, ez);
  }

  start(job: DigJob): void {
    this.job = job;
    this.time = 0;
    this.dug = 0;
    this.impacted = false;
    this.dumped = false;
    this.exClumpFrom = null;
    this.exDumped = false;
    const size = Math.cbrt(Math.max(job.estimate, 1e-6)) * 0.42;
    this.clump.scale.setScalar(Math.max(0.012, size));
    if (job.tool === 'excavator') {
      this.duration = 4.0;
      this.exFrom.copy(this.excavator.group.position);
      this.exYawFrom = this.excavator.group.rotation.y;
      this.exTo.copy(this.excavatorSpot(job.brush, job.heightAt));
      this.exYawTo = Math.atan2(-(job.brush.cx - this.exTo.x), -(job.brush.cz - this.exTo.z));
      let d = this.exYawTo - this.exYawFrom;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.exYawTo = this.exYawFrom + d;
    } else {
      this.duration = 2.5;
      for (const [id, m] of Object.entries(this.models)) m.visible = id === job.tool;
    }
  }

  update(dt: number): void {
    const job = this.job;
    if (!job) return;
    this.time += dt * this.speed;
    if (job.tool === 'excavator') this.updateExcavator(job);
    else this.updateHandTool(job);
    if (this.time >= this.duration) {
      this.holder.visible = false;
      this.clump.visible = false;
      this.job = null;
      job.onDone();
    }
  }

  private progressDig(job: DigJob, p: number): void {
    if (p > this.dug) {
      job.onDig(p - this.dug);
      this.dug = p;
    }
  }

  private updateHandTool(job: DigJob): void {
    const t = this.time;
    const { brush, target, bin } = job;
    const surface = job.heightAt(target.x, target.z);
    const binTop = bin.topCenter();
    const toTarget = Math.atan2(-(target.x - binTop.x), -(target.z - binTop.z));
    const yaw = job.tool === 'shovel' ? brush.angle + Math.PI / 2 : toTarget;
    const hover = new THREE.Vector3(target.x, surface + 0.32, target.z);
    const start = binTop.clone().add(new THREE.Vector3(0, 0.25, 0));
    const bottom = new THREE.Vector3(target.x, surface - brush.depth * 0.6, target.z);
    const pos = new THREE.Vector3();
    let pitch = -0.5;
    this.holder.visible = true;
    if (t < 0.5) {
      pos.lerpVectors(start, hover, ease(phase(t, 0, 0.5)));
    } else if (t < 0.8) {
      pos.lerpVectors(hover, bottom, ease(phase(t, 0.5, 0.8)));
      pitch = -0.5 - 0.3 * phase(t, 0.5, 0.8);
    } else if (t < 1.25) {
      const p = phase(t, 0.8, 1.25);
      if (!this.impacted) {
        this.impacted = true;
        job.onImpact(bottom.clone());
      }
      this.progressDig(job, ease(p));
      pos.copy(bottom);
      pos.y += p * brush.depth * 0.5;
      pitch = -0.8 + p * 1.2;
    } else if (t < 1.6) {
      this.progressDig(job, 1);
      pos.lerpVectors(bottom, hover, ease(phase(t, 1.25, 1.6)));
      pitch = 0.4;
    } else if (t < 2.1) {
      const p = ease(phase(t, 1.6, 2.1));
      pos.lerpVectors(hover, binTop, p);
      pos.y += Math.sin(p * Math.PI) * 0.12;
      pitch = 0.4;
    } else {
      const p = phase(t, 2.1, 2.5);
      pos.copy(binTop);
      pos.y += p * 0.2;
      pitch = 0.4 - p * 1.6;
      if (!this.dumped) {
        this.dumped = true;
        job.onDump(binTop.clone());
      }
    }
    this.holder.position.copy(pos);
    this.holder.rotation.set(0, 0, 0);
    this.holder.rotateY(yaw);
    this.holder.rotateX(pitch);
    const carrying = t > 1.1 && !this.dumped;
    this.clump.visible = carrying;
    if (carrying) this.clump.position.copy(pos).add(new THREE.Vector3(0, 0.03, 0));
  }

  private updateExcavator(job: DigJob): void {
    const t = this.time;
    const ex = this.excavator;
    const { brush } = job;
    this.holder.visible = false;
    const c = Math.cos(brush.angle);
    const s = Math.sin(brush.angle);
    // バケットは砂山側の端から車体側へ引き寄せる
    const startXZ = new THREE.Vector2(brush.cx - c * brush.halfLength, brush.cz - s * brush.halfLength);
    const endXZ = new THREE.Vector2(brush.cx + c * brush.halfLength, brush.cz + s * brush.halfLength);
    const depth = brush.depth * 0.55;
    const pointAt = (p: THREE.Vector2, lift: number) =>
      new THREE.Vector3(p.x, job.heightAt(p.x, p.y) - depth + lift, p.y);
    if (t >= 0.8 && t < 3.2) {
      // 掘っている間も足元の砂が崩れるので、車体の姿勢を地形に合わせ続ける
      ex.place(this.exTo.x, 0, this.exTo.z, brush.cx, brush.cz, job.heightAt);
    }

    if (t < 0.8) {
      this.drive(job, this.exFrom, this.exTo, this.exYawFrom, this.exYawTo, ease(phase(t, 0, 0.8)), t);
    } else if (t < 1.2) {
      const above = pointAt(startXZ, depth + 0.25);
      ex.reach(above, -0.4 * phase(t, 0.8, 1.2));
    } else if (t < 1.5) {
      const p = ease(phase(t, 1.2, 1.5));
      const above = pointAt(startXZ, depth + 0.25);
      const bite = pointAt(startXZ, 0);
      ex.reach(above.lerp(bite, p), -0.4);
      if (p >= 1 && !this.impacted) {
        this.impacted = true;
        job.onImpact(bite);
      }
    } else if (t < 2.2) {
      const p = phase(t, 1.5, 2.2);
      if (!this.impacted) {
        this.impacted = true;
        job.onImpact(pointAt(startXZ, 0));
      }
      this.progressDig(job, p);
      const xz = startXZ.clone().lerp(endXZ, ease(p));
      ex.reach(pointAt(xz, 0.02 * p), -0.4 + p * 1.0);
    } else if (t < 2.6) {
      this.progressDig(job, 1);
      const p = ease(phase(t, 2.2, 2.6));
      ex.reach(pointAt(endXZ, 0.02 + p * 0.3), 0.6 + p * 0.4);
    } else if (t < 3.1) {
      const p = phase(t, 2.6, 3.1);
      ex.reach(pointAt(endXZ, 0.32), 1.0 - p * 2.2);
    } else {
      // 掘り終えたら待機位置へ戻る
      ex.pose(0.75, -1.9, -0.9);
      this.drive(job, this.exTo, this.exFrom, this.exYawTo, this.exYawFrom, ease(phase(t, 3.2, 4.0)), t);
    }
    // 取った砂の塊はバケットからバケツへ放物線で飛ぶ
    const tip = new THREE.Vector3();
    ex.bucketTip.getWorldPosition(tip);
    if (t > 1.9 && t < 2.6) {
      this.clump.visible = true;
      this.clump.position.copy(tip).add(new THREE.Vector3(0, 0.04, 0));
    } else if (t >= 2.6) {
      const p = ease(phase(t, 2.6, 3.05));
      const from = this.exClumpFrom ?? tip.clone();
      this.exClumpFrom = from;
      const to = job.bin.topCenter();
      this.clump.visible = p < 1;
      this.clump.position.lerpVectors(from, to, p);
      this.clump.position.y += Math.sin(p * Math.PI) * 0.5;
      if (p >= 1 && !this.exDumped) {
        this.exDumped = true;
        job.onDump(to);
      }
    }
    if (t >= this.duration - 0.001 && !this.exDumped) {
      this.exDumped = true;
      job.onDump(job.bin.topCenter());
    }
  }

  private drive(job: DigJob, from: THREE.Vector3, to: THREE.Vector3, yawFrom: number, yawTo: number, p: number, t: number): void {
    const ex = this.excavator;
    const x = from.x + (to.x - from.x) * p;
    const z = from.z + (to.z - from.z) * p;
    const yaw = yawFrom + (yawTo - yawFrom) * p;
    ex.place(x, 0, z, x - Math.sin(yaw), z - Math.cos(yaw), job.heightAt);
    if (p > 0 && p < 1) ex.group.position.y += Math.abs(Math.sin(t * 30)) * 0.003;
    ex.pose(0.75, -1.9, -0.9);
  }

  private exClumpFrom: THREE.Vector3 | null = null;
  private exDumped = false;
}
