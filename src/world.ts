import * as THREE from 'three';
import { WORLD, type GameState, type PersonState } from './types';

const COLOR = {
  sky: '#f2f0e6', grass: '#b8c8a2', lawn: '#cad3b5', leaf: '#637f68',
  leafLight: '#80967a', dark: '#253d3a', trunk: '#8d7657', coral: '#e57657',
  mustard: '#ddb451', cream: '#fff7dc', skin: '#edc3a0', path: '#e3ddc5',
};

type Figure = {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  arms: [THREE.Group, THREE.Group];
  legs: [THREE.Group, THREE.Group];
};

/** The scene is a view of the simulation: meshes never own gameplay state. */
export class GameWorld {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-25, 25, 17.5, -17.5, .1, 350);
  private readonly board = new THREE.Group();
  private readonly plank = new THREE.Group();
  private readonly pupil = new THREE.Group();
  private readonly crabLegs: THREE.Group[] = [];
  private readonly figures: [Figure, Figure];
  private readonly clouds: THREE.Group[] = [];
  private readonly geometry = new Set<THREE.BufferGeometry>();
  private readonly material = new Set<THREE.Material>();
  private readonly sphere: THREE.SphereGeometry;
  private readonly box: THREE.BoxGeometry;
  private readonly stem: THREE.CylinderGeometry;
  private readonly mat: Record<string, THREE.MeshStandardMaterial>;
  private readonly cameraTarget = new THREE.Vector3(-5, 11, 0);
  private readonly cameraOffset = new THREE.Vector3(0, 17, 64);
  private readonly projection = new THREE.Vector3();
  private elapsed = 0;
  private width = 1;
  private height = 1;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private ready = true;
  private skyBand = -1;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setClearColor(COLOR.sky, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', '木と、一つ目のカニ脚シーソーがある3Dの公園');
    this.container.append(this.renderer.domElement);
    this.scene.fog = new THREE.Fog(COLOR.sky, 90, 200);
    this.sphere = this.track(new THREE.SphereGeometry(1, 16, 12));
    this.box = this.track(new THREE.BoxGeometry(1, 1, 1));
    this.stem = this.track(new THREE.CylinderGeometry(1, 1, 1, 9));
    this.mat = Object.fromEntries(Object.entries(COLOR).map(([key, color]) => [key, this.makeMat(color)]));
    this.scene.add(new THREE.HemisphereLight('#fffbea', '#798f77', 2.5));
    const sun = new THREE.DirectionalLight('#fff3cf', 3.2);
    sun.position.set(-24, 45, 35);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 35, bottom: -35, near: 1, far: 120 });
    sun.shadow.normalBias = .035;
    sun.shadow.bias = -.0004;
    this.scene.add(sun);
    this.buildPark();
    this.buildSeesaw();
    this.figures = [this.buildPerson(this.mat.coral), this.buildPerson(this.mat.mustard)];
    this.figures.forEach(figure => this.scene.add(figure.root));
    this.buildClouds();
    this.resize();
    this.camera.position.copy(this.cameraTarget).add(this.cameraOffset);
    this.camera.lookAt(this.cameraTarget);
  }

  get canvas(): HTMLCanvasElement { return this.renderer.domElement; }

  private track<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometry.add(geometry);
    return geometry;
  }

  private makeMat(color: string, roughness = .82): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
    this.material.add(material);
    return material;
  }

  private mesh(
    geometry: THREE.BufferGeometry, material: THREE.Material,
    parent: THREE.Object3D, position: [number, number, number],
    scale: [number, number, number] = [1, 1, 1], shadows = true,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    parent.add(mesh);
    return mesh;
  }

  private ball(parent: THREE.Object3D, material: THREE.Material, x: number, y: number, z: number, sx: number, sy = sx, sz = sx): THREE.Mesh {
    return this.mesh(this.sphere, material, parent, [x, y, z], [sx, sy, sz]);
  }

  private link(parent: THREE.Object3D, material: THREE.Material, from: THREE.Vector3, to: THREE.Vector3, radius: number): THREE.Mesh {
    const delta = to.clone().sub(from);
    const mesh = this.mesh(this.stem, material, parent, from.clone().add(to).multiplyScalar(.5).toArray() as [number, number, number], [radius, delta.length(), radius]);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    return mesh;
  }

  private buildSeesaw(): void {
    this.scene.add(this.board);
    this.board.add(this.plank);
    this.plank.position.y = WORLD.boardY;
    this.mesh(this.box, this.mat.mustard, this.plank, [0, 0, 0], [WORLD.boardHalfLength * 2, .4, 1.45]);
    this.mesh(this.box, this.mat.coral, this.plank, [0, .22, 0], [WORLD.boardHalfLength * 2, .085, 1.48]);
    for (const side of [-1, 1]) {
      this.mesh(this.box, this.mat.cream, this.plank, [side * 4.27, .275, 0], [.18, .025, 1.48]);
      this.mesh(this.box, this.mat.coral, this.plank, [side * 4.69, .02, 0], [.2, .49, 1.52]);
      this.link(this.plank, this.mat.dark, new THREE.Vector3(side * 3.55, .24, -.48), new THREE.Vector3(side * 3.55, 1, -.48), .07);
      this.link(this.plank, this.mat.dark, new THREE.Vector3(side * 3.55, 1, -.48), new THREE.Vector3(side * 3.55, 1, .35), .07);
    }
    this.ball(this.board, this.mat.coral, 0, 1.15, 0, 1.25, 1.05, .82);
    this.ball(this.board, this.mat.mustard, 0, 1.4, .73, 1.04, 1.04, .3);
    this.ball(this.board, this.mat.cream, 0, 1.46, .94, .87, .87, .38);
    this.pupil.position.set(0, 1.46, 1.27);
    this.board.add(this.pupil);
    this.ball(this.pupil, this.mat.dark, 0, 0, 0, .39, .42, .12);
    this.ball(this.pupil, this.mat.cream, -.12, .14, .1, .11);
    // Eyebrow gives the single eye a friendly, alert silhouette.
    const browGeometry = this.track(new THREE.TorusGeometry(.92, .065, 6, 20, Math.PI * .7));
    const brow = this.mesh(browGeometry, this.mat.dark, this.board, [0, 1.47, 1.09]);
    brow.rotation.z = Math.PI * .15;
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1;
      const row = i % 3;
      const leg = new THREE.Group();
      leg.position.set(side * .65, .95, (row - 1) * .58);
      this.board.add(leg);
      const knee = new THREE.Vector3(side * (1.12 + row * .12), .12, .1);
      const foot = new THREE.Vector3(side * (1.65 + row * .16), -.87, .3);
      this.link(leg, this.mat.coral, new THREE.Vector3(), knee, .12);
      this.ball(leg, this.mat.mustard, knee.x, knee.y, knee.z, .2);
      this.link(leg, this.mat.coral, knee, foot, .095);
      this.ball(leg, this.mat.dark, foot.x, foot.y, foot.z, .22, .1, .25);
      this.crabLegs.push(leg);
    }
    const shadowMaterial = new THREE.MeshBasicMaterial({ color: '#465b45', transparent: true, opacity: .12, depthWrite: false });
    this.material.add(shadowMaterial);
    const shadow = this.mesh(this.track(new THREE.CircleGeometry(1, 32)), shadowMaterial, this.board, [0, .035, 0], [4.7, 1.45, 1], false);
    shadow.rotation.x = -Math.PI / 2;
  }

  private buildPerson(shirt: THREE.Material): Figure {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    this.ball(body, shirt, 0, 1.04, 0, .36, .5, .3);
    this.ball(body, this.mat.cream, 0, 1.42, .02, .22, .07, .2);
    const head = new THREE.Group();
    head.position.y = 1.8;
    body.add(head);
    this.ball(head, this.mat.skin, 0, 0, 0, .35, .39, .33);
    this.ball(head, this.mat.dark, 0, .23, -.03, .36, .22, .32);
    this.ball(head, this.mat.skin, 0, -.04, .32, .09, .08, .09);
    for (const side of [-1, 1]) this.ball(head, this.mat.dark, side * .12, .035, .307, .035, .047, .024);
    const arms: THREE.Group[] = [];
    const legs: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * .32, 1.28, 0);
      body.add(arm);
      this.link(arm, shirt, new THREE.Vector3(), new THREE.Vector3(side * .07, -.32, 0), .115);
      this.link(arm, this.mat.skin, new THREE.Vector3(side * .07, -.3, 0), new THREE.Vector3(side * .15, -.65, .04), .08);
      this.ball(arm, this.mat.skin, side * .15, -.67, .04, .1);
      arms.push(arm);
      const leg = new THREE.Group();
      leg.position.set(side * .16, .7, 0);
      body.add(leg);
      this.link(leg, this.mat.dark, new THREE.Vector3(), new THREE.Vector3(side * .025, -.56, 0), .115);
      this.ball(leg, this.mat.cream, side * .025, -.59, .1, .14, .12, .23);
      legs.push(leg);
    }
    return { root, body, head, arms: arms as Figure['arms'], legs: legs as Figure['legs'] };
  }

  private buildPark(): void {
    this.mesh(this.box, this.mat.grass, this.scene, [0, -.55, -14], [220, 1, 100]);
    // Gently rounded distant terrain, kept behind the playable silhouette.
    for (let i = 0; i < 9; i++) {
      const x = -105 + i * 26;
      this.ball(this.scene, i % 2 ? this.mat.lawn : this.mat.leafLight, x, -5, -50 - i % 3 * 8, 25 + i % 3 * 5, 10 + i % 4 * 2, 14);
    }
    for (let i = 0; i < 30; i++) {
      const x = -63 + i * 4.5;
      const stone = this.mesh(this.stem, this.mat.path, this.scene, [x, .015, 5.4 + Math.sin(i * .6) * .3], [1.85, .12, 1.25]);
      stone.rotation.y = i * 1.3;
    }
    // The launch tree: trunk behind the drop path, branch meeting the 23m platform.
    this.buildTree(14.5, -3.6, 23.3, true);
    const treePositions: [number, number, number][] = [
      [-30, -11, 10], [-22, -18, 14], [-15, -25, 13], [26, -16, 16], [35, -24, 12],
      [-47, -8, 13], [51, -14, 14], [-62, -19, 15], [70, -12, 10], [5, -35, 11],
    ];
    treePositions.forEach(([x, z, height]) => this.buildTree(x, z, height));
    const random = this.random(4217);
    for (let i = 0; i < 115; i++) {
      const x = (random() - .5) * 135;
      const z = (random() - .5) * 24;
      if (Math.abs(z) < 1.6 || z > 4 && z < 7) continue;
      const flower = new THREE.Group();
      flower.position.set(x, 0, z);
      this.scene.add(flower);
      const flowerHeight = .22 + random() * .32;
      this.mesh(this.stem, this.mat.leaf, flower, [0, flowerHeight / 2, 0], [.025, flowerHeight, .025], false);
      const flowerMat = i % 4 === 0 ? this.mat.coral : i % 3 === 0 ? this.mat.mustard : this.mat.cream;
      this.ball(flower, flowerMat, 0, flowerHeight, 0, .11, .065, .11);
    }
    for (let i = 0; i < 18; i++) {
      const x = -51 + i * 6.3;
      const z = -6 - Math.sin(i * 2.7) * 2;
      this.ball(this.scene, i % 3 ? this.mat.leafLight : this.mat.trunk, x, .2, z, .5 + i % 3 * .25, .3 + i % 2 * .2, .5);
    }
    // Little mushrooms near the first catch, for scale.
    for (const [x, z, size] of [[-4, 3.3, .4], [-3.4, 3.8, .28], [19, 2.7, .43]]) {
      this.mesh(this.stem, this.mat.cream, this.scene, [x, size * .5, z], [.1, size, .1]);
      this.ball(this.scene, this.mat.coral, x, size, z, size * .65, size * .32, size * .65);
    }
    // Small fence gives the scene depth without obscuring the playing plane.
    for (let i = 0; i < 17; i++) {
      const x = -42 + i * 5.5;
      this.mesh(this.box, this.mat.cream, this.scene, [x, .9, -9], [.2, 1.8, .2]);
      if (i < 16) this.mesh(this.box, this.mat.cream, this.scene, [x + 2.75, 1.1, -9], [5.5, .14, .14]);
    }
  }

  private buildTree(x: number, z: number, height: number, launch = false): void {
    const tree = new THREE.Group();
    tree.position.set(x, 0, z);
    this.scene.add(tree);
    const trunkHeight = height * .73;
    const trunkRadius = launch ? .76 : .4;
    this.mesh(this.stem, this.mat.trunk, tree, [0, trunkHeight / 2, 0], [trunkRadius, trunkHeight, trunkRadius]);
    this.link(tree, this.mat.trunk, new THREE.Vector3(0, trunkHeight * .5, 0), new THREE.Vector3(-2, trunkHeight + 1, -.5), trunkRadius * .5);
    this.link(tree, this.mat.trunk, new THREE.Vector3(0, trunkHeight * .63, 0), new THREE.Vector3(2.2, trunkHeight + 1.6, -.8), trunkRadius * .44);
    const scale = launch ? 1.8 : 1;
    for (let i = 0; i < 5; i++) {
      const angle = i * Math.PI * 2 / 5;
      this.ball(tree, i % 2 ? this.mat.leaf : this.mat.leafLight,
        Math.sin(angle) * 2.1 * scale, trunkHeight + Math.cos(angle) * 1.6 * scale + 1.1,
        -1.6 - (i % 2) * 1.4, 2.8 * scale, 3 * scale, 2.5 * scale);
    }
    if (launch) {
      // The person begins at WORLD.treeX, clear of the trunk and foliage.
      const branchStart = new THREE.Vector3(0, height - 3, 1.1);
      const branchEnd = new THREE.Vector3(WORLD.treeX - x, WORLD.treeHeight - .18, 3.6);
      this.link(tree, this.mat.trunk, branchStart, branchEnd, .23);
      this.mesh(this.box, this.mat.mustard, tree, [WORLD.treeX - x, WORLD.treeHeight - .17, 3.6], [2.1, .28, 2]);
      for (let i = 0; i < 8; i++) {
        this.mesh(this.box, this.mat.mustard, tree, [-.9, 2 + i * 1.9, 1], [.7, .12, .55]);
      }
    }
  }

  private buildClouds(): void {
    const cloudMaterial = this.makeMat('#fffcf1');
    for (let i = 0; i < 32; i++) {
      const cloud = new THREE.Group();
      const level = Math.floor(i / 4);
      cloud.position.set((i % 4 - 1.5) * 28 + Math.sin(i * 5) * 5, 20 + level * 24 + Math.cos(i) * 6, -24 - i % 3 * 9);
      const s = 1.8 + i % 3;
      this.ball(cloud, cloudMaterial, 0, 0, 0, s * 2, s * .6, s,);
      this.ball(cloud, cloudMaterial, -s, s * .5, 0, s * .9, s * .8, s * .7);
      this.ball(cloud, cloudMaterial, s * .35, s * .7, 0, s * 1.2, s, s * .8);
      cloud.traverse(node => { if (node instanceof THREE.Mesh) { node.castShadow = false; node.receiveShadow = false; } });
      this.scene.add(cloud);
      this.clouds.push(cloud);
    }
  }

  private random(seed: number): () => number {
    return () => {
      seed = Math.imul(seed ^ seed >>> 15, 1 | seed);
      seed ^= seed + Math.imul(seed ^ seed >>> 7, 61 | seed);
      return ((seed ^ seed >>> 14) >>> 0) / 4294967296;
    };
  }

  private updatePerson(figure: Figure, person: PersonState, state: GameState, index: number): void {
    // Simulation uses the lever centre line. The plank's visible top is .26m above it.
    figure.root.position.set(person.x, person.y + .26, 0);
    const airborne = !person.seated;
    const bob = this.reducedMotion ? 0 : Math.sin(this.elapsed * 4 + index) * .035;
    figure.body.position.y = bob;
    figure.root.rotation.z = airborne ? THREE.MathUtils.clamp(-person.vx * .045, -.3, .3) + Math.sin(this.elapsed * 3) * .06 : state.boardAngle * .6;
    figure.root.scale.setScalar(1);
    if (!airborne) {
      // Person.y is their feet; bend the knees toward the front while seated.
      figure.body.position.y = -.22 + bob;
      figure.legs[0].rotation.x = -1.05;
      figure.legs[1].rotation.x = -1.05;
      figure.arms[0].rotation.z = -.4;
      figure.arms[1].rotation.z = .4;
    } else {
      figure.legs[0].rotation.x = .08;
      figure.legs[1].rotation.x = -.1;
      figure.legs[0].rotation.z = -.2 + Math.sin(this.elapsed * 5) * .1;
      figure.legs[1].rotation.z = .22 - Math.sin(this.elapsed * 5) * .1;
      figure.arms[0].rotation.z = -2.1 + Math.sin(this.elapsed * 7) * .15;
      figure.arms[1].rotation.z = 2.1 - Math.sin(this.elapsed * 7) * .15;
    }
    figure.head.rotation.z = Math.sin(this.elapsed * 2 + index) * .04;
    figure.root.visible = state.phase !== 'gameover' || index !== state.activePerson || person.y > -.6;
  }

  update(state: GameState, dt: number): void {
    const animationDt = state.phase === 'paused' ? 0 : Math.min(dt, .1);
    this.elapsed += animationDt;
    this.board.position.x = state.boardX;
    this.plank.rotation.z = state.boardAngle;
    const walking = Math.min(Math.abs(state.boardVelocity) / WORLD.moveSpeed, 1);
    this.crabLegs.forEach((leg, i) => {
      const cycle = this.elapsed * 19 + i * Math.PI * .67;
      leg.rotation.z = walking * Math.sin(cycle) * .2;
      leg.rotation.y = walking * Math.cos(cycle) * .2;
      leg.position.y = .95 + walking * Math.max(0, Math.sin(cycle)) * .12;
    });
    const active = state.people[state.activePerson];
    const gaze = THREE.MathUtils.clamp((active.x - state.boardX) * .035, -.23, .23);
    this.pupil.position.x = gaze;
    this.pupil.position.y = 1.46 + THREE.MathUtils.clamp((active.y - 4) * .008, -.05, .2);
    const blink = !this.reducedMotion && this.elapsed % 5.7 > 5.54 ? .12 : 1;
    this.pupil.scale.y = blink;
    this.figures.forEach((figure, index) => this.updatePerson(figure, state.people[index], state, index));
    this.clouds.forEach((cloud, i) => {
      if (!this.reducedMotion) cloud.position.x += Math.sin(i * 2.3 + 1) * animationDt * .22;
      // Reuse cloud groups above the initial sky rather than growing the scene.
      if (active.y > 170 && cloud.position.y < active.y - 75) cloud.position.y += 192;
      if (cloud.position.y > active.y + 230) cloud.position.y -= 192;
    });
    const isReady = state.phase === 'ready';
    // Keep both the tree and the board in view throughout the first drop. Once
    // the first person launches, the camera follows that person into the sky.
    const opening = state.catches === 0;
    const narrow = this.width / this.height < .9;
    const desiredX = opening ? (narrow ? 6 : -5) : THREE.MathUtils.clamp(active.x * .86, -34, 34);
    const desiredY = opening ? 11 : Math.max(9, active.y + 2.7);
    const smoothing = this.reducedMotion ? 1 : 1 - Math.exp(-dt * (opening ? 2.4 : 4.5));
    if (isReady && !this.ready) this.cameraTarget.set(desiredX, desiredY, 0);
    this.ready = isReady;
    this.cameraTarget.x = THREE.MathUtils.lerp(this.cameraTarget.x, desiredX, smoothing);
    this.cameraTarget.y = THREE.MathUtils.lerp(this.cameraTarget.y, desiredY, smoothing);
    if (!opening) {
      // Height has no ceiling. Bound follow error rather than allowing a fast
      // descent to outrun the camera, including on narrow portrait screens.
      const horizontalMargin = (this.camera.right - this.camera.left) * .29;
      const verticalMargin = (this.camera.top - this.camera.bottom) * .19;
      this.cameraTarget.x = THREE.MathUtils.clamp(this.cameraTarget.x, active.x - horizontalMargin, active.x + horizontalMargin);
      this.cameraTarget.y = THREE.MathUtils.clamp(this.cameraTarget.y,
        Math.max(9, active.y - verticalMargin), Math.max(9, active.y + verticalMargin));
    }
    this.camera.position.copy(this.cameraTarget).add(this.cameraOffset);
    this.camera.lookAt(this.cameraTarget);
    // A soft warm-to-blue sky transition gives altitude a sense of place.
    const skyBand = Math.round(Math.min(state.height, 240) / 2);
    if (skyBand !== this.skyBand) {
      this.skyBand = skyBand;
      const altitude = skyBand / 120;
      const top = new THREE.Color('#edf1e7').lerp(new THREE.Color('#aecedb'), altitude * .82);
      const middle = new THREE.Color('#f4f3e9').lerp(new THREE.Color('#d9e8e8'), altitude * .9);
      const bottom = new THREE.Color('#e8ead7').lerp(new THREE.Color('#eaf0e9'), altitude);
      this.container.style.background = `linear-gradient(180deg,#${top.getHexString()} 0%,#${middle.getHexString()} 65%,#${bottom.getHexString()} 100%)`;
    }
    this.renderer.render(this.scene, this.camera);
  }

  resize(): void {
    this.width = Math.max(this.container.clientWidth, 1);
    this.height = Math.max(this.container.clientHeight, 1);
    const aspect = this.width / this.height;
    const halfHeight = aspect < .85 ? 20 : 17.5;
    this.camera.left = -halfHeight * aspect;
    this.camera.right = halfHeight * aspect;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height);
  }

  projectWorld(x: number, y: number): { x: number; y: number; visible: boolean } {
    this.projection.set(x, y, 0).project(this.camera);
    return {
      x: (this.projection.x * .5 + .5) * this.width,
      y: (-this.projection.y * .5 + .5) * this.height,
      visible: Math.abs(this.projection.x) < 1 && Math.abs(this.projection.y) < 1 && this.projection.z > -1 && this.projection.z < 1,
    };
  }

  dispose(): void {
    this.geometry.forEach(geometry => geometry.dispose());
    this.material.forEach(material => material.dispose());
    this.renderer.dispose();
    this.canvas.remove();
  }
}
