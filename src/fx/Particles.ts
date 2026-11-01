import * as THREE from 'three';

interface Grain {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  resting: boolean;
}

/**
 * 演出用の砂粒（物理計算はしない簡易な放物運動）。
 * 砂の総量やスコアには影響しない。
 */
export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private readonly grains: Grain[] = [];
  private readonly dummy = new THREE.Object3D();
  private limit: number;

  constructor(
    private readonly groundAt: (x: number, z: number) => number,
    readonly max = 700,
  ) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: '#d9b77e', roughness: 1 });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.limit = max;
  }

  /** 画質設定に応じた同時表示数の上限 */
  setLimit(limit: number): void {
    this.limit = Math.min(limit, this.max);
  }

  /** 砂粒を飛ばす */
  burst(
    origin: THREE.Vector3,
    count: number,
    options: { spread?: number; up?: number; speed?: number; dir?: THREE.Vector3; size?: number } = {},
  ): void {
    const spread = options.spread ?? 0.05;
    const up = options.up ?? 0.9;
    const speed = options.speed ?? 0.6;
    for (let i = 0; i < count; i++) {
      if (this.grains.length >= this.limit) this.grains.shift();
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      const s = speed * (0.4 + Math.random() * 0.8);
      const life = 1.2 + Math.random() * 1.2;
      this.grains.push({
        x: origin.x + Math.cos(a) * r,
        y: origin.y + Math.random() * 0.02,
        z: origin.z + Math.sin(a) * r,
        vx: Math.cos(a) * s * 0.6 + (options.dir?.x ?? 0),
        vy: up * (0.3 + Math.random() * 0.9),
        vz: Math.sin(a) * s * 0.6 + (options.dir?.z ?? 0),
        life,
        maxLife: life,
        size: (options.size ?? 0.006) * (0.5 + Math.random()),
        resting: false,
      });
    }
  }

  update(dt: number): void {
    const g = 9.81 * 0.6;
    let n = 0;
    for (let i = this.grains.length - 1; i >= 0; i--) {
      const p = this.grains[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.grains.splice(i, 1);
        continue;
      }
      if (!p.resting) {
        p.vy -= g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        const ground = this.groundAt(p.x, p.z);
        if (p.y < ground) {
          p.y = ground;
          if (Math.abs(p.vy) < 0.4) {
            p.resting = true;
          } else {
            p.vy *= -0.25;
            p.vx *= 0.5;
            p.vz *= 0.5;
          }
        }
      }
    }
    for (const p of this.grains) {
      const fade = Math.min(1, p.life / (p.maxLife * 0.35));
      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.scale.setScalar(p.size * fade);
      this.dummy.rotation.set(p.x * 40, p.z * 40, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(n++, this.dummy.matrix);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.grains.length = 0;
    this.mesh.count = 0;
  }
}
