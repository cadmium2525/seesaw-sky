import * as THREE from 'three';
import type { SandField } from './SandField';

const DRY = new THREE.Color('#e8cc96');
const DRY_LOW = new THREE.Color('#e2c48f');
const WET = new THREE.Color('#b08a55');
const TOP = new THREE.Color('#f0d6a4');

/** 高さマップを3Dメッシュとして描画し、掘削・崩落に合わせて頂点を更新する */
export class SandMesh {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly colors: Float32Array;
  private dirty = true;

  constructor(
    private field: SandField,
    grain: THREE.Texture,
  ) {
    this.geometry = new THREE.PlaneGeometry(field.size, field.size, field.resolution, field.resolution);
    // PlaneGeometry は xy 平面。-90°回転で頂点の並びが SandField の index(ix, iz) と一致する
    this.geometry.rotateX(-Math.PI / 2);
    this.colors = new Float32Array(field.n * field.n * 3);
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const map = grain.clone();
    map.repeat.set(10, 10);
    map.needsUpdate = true;
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map,
      roughness: 0.96,
      metalness: 0,
      bumpMap: map,
      bumpScale: 0.6,
    });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.update();
  }

  setField(field: SandField): void {
    this.field = field;
    this.markDirty();
  }

  markDirty(): void {
    this.dirty = true;
  }

  update(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const { heights, moisture } = this.field;
    const pos = this.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const c = new THREE.Color();
    for (let i = 0; i < heights.length; i++) {
      const h = heights[i];
      arr[i * 3 + 1] = h;
      // 低い所は地面と同じ色、高い所は日に当たって明るく、掘った所は湿って暗い
      c.copy(DRY_LOW).lerp(DRY, Math.min(1, h * 12)).lerp(TOP, Math.max(0, (h - 0.35) * 1.4));
      c.lerp(WET, Math.min(1, moisture[i]) * 0.85);
      this.colors[i * 3] = c.r;
      this.colors[i * 3 + 1] = c.g;
      this.colors[i * 3 + 2] = c.b;
    }
    pos.needsUpdate = true;
    (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    this.updateNormals();
    this.geometry.computeBoundingSphere();
  }

  /** 格子の高さの差分から法線を求める（computeVertexNormals より軽い） */
  private updateNormals(): void {
    const { heights, n, cell } = this.field;
    const normal = this.geometry.attributes.normal as THREE.BufferAttribute;
    const arr = normal.array as Float32Array;
    const last = n - 1;
    for (let iz = 0; iz < n; iz++) {
      const zm = iz > 0 ? iz - 1 : iz;
      const zp = iz < last ? iz + 1 : iz;
      for (let ix = 0; ix < n; ix++) {
        const xm = ix > 0 ? ix - 1 : ix;
        const xp = ix < last ? ix + 1 : ix;
        const dx = (heights[iz * n + xp] - heights[iz * n + xm]) / ((xp - xm) * cell);
        const dz = (heights[zp * n + ix] - heights[zm * n + ix]) / ((zp - zm) * cell);
        const inv = 1 / Math.sqrt(dx * dx + dz * dz + 1);
        const i = (iz * n + ix) * 3;
        arr[i] = -dx * inv;
        arr[i + 1] = inv;
        arr[i + 2] = -dz * inv;
      }
    }
    normal.needsUpdate = true;
  }
}
