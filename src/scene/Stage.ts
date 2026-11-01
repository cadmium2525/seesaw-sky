import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type Quality = 'low' | 'medium' | 'high';

export const QUALITY_LABEL: Record<Quality, string> = { low: '低', medium: '中', high: '高' };

/** 砂の粒感を出すノイズテクスチャ（素材ファイル不要・自作） */
export function createGrainTexture(size = 256, seed = 7): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < size * size; i++) {
    const r = rnd();
    const v = 200 + (r * r * 55) - (rnd() < 0.04 ? 70 : 0);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * レンダラー・カメラ・光源・背景（浜辺）をまとめたもの。
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly sun: THREE.DirectionalLight;
  readonly grain: THREE.CanvasTexture;
  private quality: Quality = 'medium';
  private readonly water: THREE.Mesh;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 120);
    this.camera.position.set(0, 1.85, 3.5);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.18, 0.1);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1.1;
    this.controls.maxDistance = 5.5;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.enablePan = false;
    // スマホ：1本指は掘削位置の指定に使い、2本指で視点操作
    this.controls.touches = { ONE: null as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };

    const sky = new THREE.Color('#9fd3f0');
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 14, 60);

    this.scene.add(new THREE.HemisphereLight('#dff2ff', '#c9a774', 1.25));
    this.sun = new THREE.DirectionalLight('#fff3dc', 2.4);
    this.sun.position.set(2.2, 4.2, 1.6);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -2.2;
    sc.right = sc.top = 2.2;
    sc.near = 0.5;
    sc.far = 12;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);

    this.grain = createGrainTexture();
    this.scene.add(this.createSkyDome());
    this.scene.add(this.createBeach());
    this.water = this.createSea();
    this.scene.add(this.water);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private createSkyDome(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(80, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color('#4f9fe0') },
        bottom: { value: new THREE.Color('#e9f6ff') },
      },
      vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vPos;
        void main(){ float h = clamp(normalize(vPos).y * 1.6, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.7)), 1.0); }`,
    });
    return new THREE.Mesh(geo, mat);
  }

  private createBeach(): THREE.Mesh {
    const geo = new THREE.CircleGeometry(40, 64);
    geo.rotateX(-Math.PI / 2);
    const tex = this.grain.clone();
    tex.repeat.set(60, 60);
    tex.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({ color: '#e2c48f', map: tex, roughness: 1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = -0.002;
    mesh.receiveShadow = true;
    return mesh;
  }

  private createSea(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(120, 60);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: '#2f8fc4',
      roughness: 0.25,
      metalness: 0.1,
      transparent: true,
      opacity: 0.92,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, -0.03, -42);
    return mesh;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    const ratio = q === 'low' ? Math.min(dpr, 1) : q === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
    this.renderer.setPixelRatio(ratio);
    this.renderer.shadowMap.enabled = q !== 'low';
    const size = q === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    // シャドウの有効・無効を切り替えたらマテリアルの再コンパイルが必要
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    this.resize();
  }

  getQuality(): Quality {
    return this.quality;
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 縦長画面（スマホ）では砂山全体が収まるよう画角を広げる
    this.camera.fov = w / h < 0.8 ? 58 : 42;
    this.camera.updateProjectionMatrix();
  }

  update(time: number): void {
    this.controls.update();
    this.water.position.y = -0.03 + Math.sin(time * 0.6) * 0.006;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** 視点を初期位置へ戻す（アニメーション） */
  resetView(): void {
    this.camera.position.set(0, 1.85, 3.5);
    this.controls.target.set(0, 0.18, 0.1);
  }
}
