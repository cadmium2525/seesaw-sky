import type * as RapierNS from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import type { SandField } from '../terrain/SandField';
import { evaluateSupport, plantFlag, type FlagAnchor, type SupportState } from './FlagSupport';

type Rapier = typeof RapierNS;
let RAPIER: Rapier | null = null;
let rapierLoading: Promise<void> | null = null;

/**
 * Rapier（WASM・約3MB）を読み込む。旗が倒れる時にしか使わないため、
 * ゲーム開始を待たせずに裏で読み込む。
 */
export function initPhysics(): Promise<void> {
  rapierLoading ??= import('@dimforge/rapier3d-compat').then(async (mod) => {
    const r = (mod as unknown as { default?: Rapier }).default ?? (mod as unknown as Rapier);
    await r.init();
    RAPIER = r;
  });
  return rapierLoading;
}

export function physicsReady(): boolean {
  return RAPIER !== null;
}

const UP = new THREE.Vector3(0, 1, 0);

interface Pivot {
  axis: THREE.Vector3;
  angle: number;
  speed: number;
  base: THREE.Vector3;
}
const FIXED_DT = 1 / 60;

/**
 * 旗の見た目と挙動。
 * 支えがある間は支持判定に合わせて傾け（キネマティック）、
 * 支えを失ったら Rapier の剛体として砂の地形の上に倒す。
 */
export class FlagSystem {
  readonly group = new THREE.Group();
  anchor!: FlagAnchor;
  state: SupportState = { support: 1, leanDeg: 0, leanDir: 0, stability: 1, fallen: false };
  private readonly cloth: THREE.Mesh;
  private readonly clothBase: Float32Array;
  private leanDeg = 0;
  private leanDir = 0;
  private wobble = 0;
  private wobblePhase = 0;
  private world: RapierNS.World | null = null;
  private body: RapierNS.RigidBody | null = null;
  /** 倒れ始め（根元を支点にした回転）。Rapier が未読み込みならこのまま倒れきる */
  private pivot: Pivot | null = null;
  private fallField: SandField | null = null;
  private accumulator = 0;
  fallTime = 0;

  constructor() {
    const { poleLength, poleRadius } = CONFIG.flag;
    const poleMat = new THREE.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.6 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(poleRadius, poleRadius * 1.1, poleLength, 10), poleMat);
    pole.position.y = poleLength / 2;
    pole.castShadow = true;
    this.group.add(pole);

    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(poleRadius * 1.9, 12, 8),
      new THREE.MeshStandardMaterial({ color: '#ffd23f', roughness: 0.4, metalness: 0.2 }),
    );
    knob.position.y = poleLength;
    knob.castShadow = true;
    this.group.add(knob);

    const clothGeo = new THREE.PlaneGeometry(0.17, 0.11, 14, 8);
    clothGeo.translate(0.085, 0, 0);
    this.clothBase = (clothGeo.attributes.position.array as Float32Array).slice();
    this.cloth = new THREE.Mesh(
      clothGeo,
      new THREE.MeshStandardMaterial({ color: '#e63946', roughness: 0.75, side: THREE.DoubleSide }),
    );
    this.cloth.position.set(poleRadius, poleLength - 0.07, 0);
    this.cloth.castShadow = true;
    this.group.add(this.cloth);
  }

  /** 砂山の頂上に旗を立て直す */
  reset(field: SandField): void {
    this.disposePhysics();
    this.anchor = plantFlag(field);
    this.state = evaluateSupport(field, this.anchor);
    this.leanDeg = 0;
    this.leanDir = 0;
    this.wobble = 0;
    this.fallTime = 0;
    this.group.position.set(this.anchor.x, this.anchor.baseY, this.anchor.z);
    this.group.quaternion.identity();
  }

  get isFalling(): boolean {
    return this.body !== null || this.pivot !== null;
  }

  /** 支持状態を再計算する。倒れる状態になったら true */
  evaluate(field: SandField): SupportState {
    const prev = this.state;
    this.state = evaluateSupport(field, this.anchor);
    const change = Math.abs(this.state.leanDeg - prev.leanDeg) + Math.abs(this.state.support - prev.support) * 20;
    if (change > 0.05) this.shake(Math.min(4, change * 0.8));
    return this.state;
  }

  /** 旗を揺らす（掘った衝撃など） */
  shake(amountDeg: number): void {
    this.wobble = Math.min(6, this.wobble + amountDeg);
  }

  /**
   * 支えを失った旗を倒す。倒れ始めは根元を支点に重力で回転させ、
   * ある程度傾いたら Rapier の剛体に引き継いで砂の上を転がす。
   * （倒れ始めから剛体にすると、まだ残っている砂に竿がめり込んで引っかかるため）
   */
  topple(field: SandField): void {
    if (this.isFalling) return;
    const dir = this.state.leanDir;
    const { x, z } = this.anchor;
    // 倒れる側（砂が抜けた側）の砂面に根元を合わせる
    const surface = Math.min(
      field.heightAt(x, z),
      field.heightAt(x + Math.cos(dir) * 0.04, z + Math.sin(dir) * 0.04),
      field.heightAt(x + Math.cos(dir) * 0.08, z + Math.sin(dir) * 0.08),
    );
    const lift = Math.max(0, Math.min(surface, this.anchor.baseY + this.anchor.burial) - this.anchor.baseY);
    this.pivot = {
      axis: new THREE.Vector3(Math.sin(dir), 0, -Math.cos(dir)),
      angle: THREE.MathUtils.degToRad(Math.max(this.leanDeg, 3)),
      speed: 0.4,
      base: new THREE.Vector3(x, this.anchor.baseY + lift, z),
    };
    this.fallField = field;
    this.fallTime = 0;
  }

  /** Rapier の剛体を作り、支点回転の続きとして倒れさせる */
  private createBody(field: SandField, pivot: Pivot): void {
    if (!RAPIER) return;
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.integrationParameters.numSolverIterations = 8;
    this.world = world;

    // 砂の地形を heightfield コライダーにする（行 = z、列 = x、列優先で格納）
    const res = field.resolution;
    const n = field.n;
    const heights = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) heights[ix * n + iz] = field.heights[field.index(ix, iz)];
    }
    world.createCollider(
      RAPIER.ColliderDesc.heightfield(res, res, heights, { x: field.size, y: 1, z: field.size }).setFriction(0.9),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.05, 20).setTranslation(0, -0.05, 0).setFriction(0.9));

    const { poleLength, poleRadius } = CONFIG.flag;
    const q = new THREE.Quaternion().setFromAxisAngle(pivot.axis, pivot.angle);
    const r = new THREE.Vector3(0, poleLength / 2, 0).applyQuaternion(q);
    const center = r.clone().add(pivot.base);
    center.y += 0.004;
    const w = pivot.axis.clone().multiplyScalar(pivot.speed);
    const v = w.clone().cross(r);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(center.x, center.y, center.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setAngvel({ x: w.x, y: w.y, z: w.z })
        .setLinvel(v.x, v.y, v.z)
        .setCcdEnabled(true)
        .setLinearDamping(0.2)
        .setAngularDamping(0.5),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cylinder(poleLength / 2, poleRadius * 1.6).setDensity(400).setFriction(0.8).setRestitution(0.15),
      body,
    );
    // 旗の布の重さで少し頭が重い
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.08, 0.05, 0.004).setTranslation(0.09, poleLength / 2 - 0.07, 0).setDensity(60),
      body,
    );
    this.body = body;
    this.accumulator = 0;
  }

  update(dt: number, time: number): void {
    if (this.pivot) {
      const f = this.pivot;
      this.fallTime += dt;
      const limit = THREE.MathUtils.degToRad(RAPIER ? 35 : 84);
      if (f.angle < limit) {
        // 根元を支点にした棒の転倒： dω/dt = (3g / 2L)·sinθ
        f.speed += ((3 * 9.81) / (2 * CONFIG.flag.poleLength)) * Math.sin(f.angle) * dt;
        f.angle = Math.min(limit, f.angle + f.speed * dt);
      }
      this.group.quaternion.setFromAxisAngle(f.axis, f.angle);
      this.group.position.copy(f.base);
      if (RAPIER && f.angle >= limit && this.fallField) {
        this.createBody(this.fallField, f);
        this.pivot = null;
      }
    } else if (this.body && this.world) {
      this.accumulator += Math.min(dt, 0.1);
      while (this.accumulator >= FIXED_DT) {
        this.world.step();
        this.accumulator -= FIXED_DT;
      }
      this.fallTime += dt;
      const t = this.body.translation();
      const r = this.body.rotation();
      this.group.quaternion.set(r.x, r.y, r.z, r.w);
      const offset = new THREE.Vector3(0, CONFIG.flag.poleLength / 2, 0).applyQuaternion(this.group.quaternion);
      this.group.position.set(t.x - offset.x, t.y - offset.y, t.z - offset.z);
    } else {
      // 傾きは滑らかに追従し、揺れは減衰する
      const k = 1 - Math.exp(-dt * 6);
      this.leanDeg += (this.state.leanDeg - this.leanDeg) * k;
      const target = this.state.leanDir;
      let d = target - this.leanDir;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.leanDir += d * k;
      this.wobble *= Math.exp(-dt * 2.2);
      this.wobblePhase += dt * 11;
      const wob = Math.sin(this.wobblePhase) * this.wobble;
      const angle = THREE.MathUtils.degToRad(this.leanDeg + wob);
      const axis = new THREE.Vector3(Math.sin(this.leanDir), 0, -Math.cos(this.leanDir));
      if (this.leanDeg < 0.01 && Math.abs(wob) > 0) axis.set(0, 0, -1);
      this.group.quaternion.setFromAxisAngle(axis.normalize(), angle);
      this.group.position.set(this.anchor.x, this.anchor.baseY, this.anchor.z);
    }
    this.animateCloth(time);
  }

  /** 旗竿が地面に対して何度傾いているか */
  tiltDeg(): number {
    const up = UP.clone().applyQuaternion(this.group.quaternion);
    return THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.max(-1, up.y))));
  }

  /** 倒れ終わったか（剛体が静止した、または十分時間が経った） */
  get fallSettled(): boolean {
    if (this.pivot) return !RAPIER && this.fallTime > 1.4;
    if (!this.body) return false;
    return (this.body.isSleeping() && this.fallTime > 1) || this.fallTime > 3.5;
  }

  private animateCloth(time: number): void {
    const pos = this.cloth.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const base = this.clothBase;
    const strength = this.body ? 0.4 : 1;
    for (let i = 0; i < arr.length; i += 3) {
      const x = base[i];
      const y = base[i + 1];
      const wave = Math.sin(x * 38 - time * 7.5 + y * 6) * 0.012 + Math.sin(x * 21 - time * 4.3) * 0.006;
      arr[i + 2] = wave * (x / 0.17) * strength;
      arr[i + 1] = y - (x / 0.17) * 0.008;
    }
    pos.needsUpdate = true;
    this.cloth.geometry.computeVertexNormals();
  }

  private disposePhysics(): void {
    this.world?.free();
    this.world = null;
    this.body = null;
    this.pivot = null;
    this.fallField = null;
  }
}
