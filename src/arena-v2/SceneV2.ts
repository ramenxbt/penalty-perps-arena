/**
 * v2 scene: a behind-the-kicker, cel-shaded "Blue Lock" penalty world. Framework-agnostic class
 * driven by a thin React wrapper. This is the vertical-slice foundation: graded sky, cel pitch,
 * procedural goal + ball, and the CC0 rigged character cel-shaded with an ink outline on Idle.
 * Strike choreography + post FX + World Cup wrapper land on top of this.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { PAL } from "./palette";
import { addInkOutline, createToonMaterial, DEFAULT_RAMP } from "./toon";

const GOAL_Z = -11;
const GOAL_W = 7.32;
const GOAL_H = 2.44;

export class SceneV2 {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private mixer: THREE.AnimationMixer | null = null;
  private clips = new Map<string, THREE.AnimationAction>();
  private kicker: THREE.Object3D | null = null;
  private disposables: Array<{ dispose: () => void }> = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
    this.camera.position.set(0, 2.7, 5.2); // behind the kicker
    this.camera.lookAt(0, 1.3, -6);

    this.addSky();
    this.addLights();
    this.addPitch();
    this.addGoal();
    this.addBall();
    void this.loadCharacter();
    (window as unknown as { __v2: SceneV2 }).__v2 = this; // TEMP debug handle
  }

  private track<T extends { dispose: () => void }>(o: T): T {
    this.disposables.push(o);
    return o;
  }

  private addSky() {
    const geo = this.track(new THREE.SphereGeometry(120, 32, 16));
    const mat = this.track(
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uZenith: { value: new THREE.Color(PAL.skyZenith) },
          uHorizon: { value: new THREE.Color(PAL.skyHorizon) },
        },
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          varying vec3 vP; uniform vec3 uZenith; uniform vec3 uHorizon;
          void main(){
            float h = clamp(normalize(vP).y * 0.5 + 0.5, 0.0, 1.0);
            vec3 c = mix(uHorizon, uZenith, smoothstep(0.02, 0.8, h));
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    this.scene.add(new THREE.Mesh(geo, mat));
  }

  private addLights() {
    const hemi = new THREE.HemisphereLight(0x9fb6ff, 0x14203a, 0.7);
    this.scene.add(hemi);
    // Key light drives the toon ramp; angled front-left so the terminator reads on the kicker.
    const key = new THREE.DirectionalLight(0xfff2ff, 2.2);
    key.position.set(-5, 9, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 40;
    const s = 14;
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    key.shadow.bias = -0.0004;
    this.scene.add(key, key.target);
    // Cyan back-rim fill (the Blue Lock hero edge) from behind the goal.
    const rim = new THREE.DirectionalLight(PAL.rim, 0.8);
    rim.position.set(3, 5, -10);
    this.scene.add(rim);
  }

  private addPitch() {
    // Mowing-stripe map for the turf, cel-shaded via the ramp.
    const cv = document.createElement("canvas");
    cv.width = 8;
    cv.height = 64;
    const ctx = cv.getContext("2d");
    if (ctx) {
      const a = new THREE.Color(PAL.pitch).getStyle();
      const b = new THREE.Color(PAL.pitch).multiplyScalar(0.82).getStyle();
      for (let i = 0; i < 8; i += 1) {
        ctx.fillStyle = i % 2 === 0 ? a : b;
        ctx.fillRect(0, i * 8, 8, 8);
      }
    }
    const stripes = this.track(new THREE.CanvasTexture(cv));
    stripes.wrapS = THREE.RepeatWrapping;
    stripes.wrapT = THREE.RepeatWrapping;
    stripes.repeat.set(1, 16);
    stripes.colorSpace = THREE.SRGBColorSpace;
    const mat = createToonMaterial({ color: 0xffffff, rimStrength: 0 });
    mat.map = stripes;
    this.track(mat);
    const geo = this.track(new THREE.PlaneGeometry(70, 80));
    const pitch = new THREE.Mesh(geo, mat);
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.z = -8;
    pitch.receiveShadow = true;
    this.scene.add(pitch);

    // Penalty-spot + a simple box: thin bright lines.
    const lineMat = this.track(new THREE.MeshBasicMaterial({ color: PAL.pitchLine, transparent: true, opacity: 0.6 }));
    const spot = new THREE.Mesh(this.track(new THREE.CircleGeometry(0.12, 16)), lineMat);
    spot.rotation.x = -Math.PI / 2;
    spot.position.set(0, 0.02, 0);
    this.scene.add(spot);
  }

  private addGoal() {
    const postMat = createToonMaterial({ color: PAL.kitSecondary, rimStrength: 0.2 });
    this.track(postMat);
    const postGeo = this.track(new THREE.CylinderGeometry(0.08, 0.08, GOAL_H, 12));
    const barGeo = this.track(new THREE.CylinderGeometry(0.08, 0.08, GOAL_W + 0.16, 12));
    const mkPost = (x: number) => {
      const p = new THREE.Mesh(postGeo, postMat);
      p.position.set(x, GOAL_H / 2, GOAL_Z);
      p.castShadow = true;
      addInkOutline(p, PAL.outline, 0.008);
      this.scene.add(p);
    };
    mkPost(-GOAL_W / 2);
    mkPost(GOAL_W / 2);
    const bar = new THREE.Mesh(barGeo, postMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, GOAL_H, GOAL_Z);
    addInkOutline(bar, PAL.outline, 0.008);
    this.scene.add(bar);

    // Back net: a grid texture, alpha-tested, slightly behind the frame.
    const ncv = document.createElement("canvas");
    ncv.width = 128;
    ncv.height = 64;
    const nctx = ncv.getContext("2d");
    if (nctx) {
      nctx.clearRect(0, 0, 128, 64);
      nctx.strokeStyle = "rgba(220,230,255,0.5)";
      nctx.lineWidth = 1;
      for (let x = 0; x <= 128; x += 8) {
        nctx.beginPath();
        nctx.moveTo(x, 0);
        nctx.lineTo(x, 64);
        nctx.stroke();
      }
      for (let y = 0; y <= 64; y += 8) {
        nctx.beginPath();
        nctx.moveTo(0, y);
        nctx.lineTo(128, y);
        nctx.stroke();
      }
    }
    const netTex = this.track(new THREE.CanvasTexture(ncv));
    netTex.wrapS = THREE.RepeatWrapping;
    netTex.wrapT = THREE.RepeatWrapping;
    netTex.repeat.set(8, 3);
    const netMat = this.track(
      new THREE.MeshBasicMaterial({ map: netTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, opacity: 0.85 }),
    );
    const back = new THREE.Mesh(this.track(new THREE.PlaneGeometry(GOAL_W, GOAL_H)), netMat);
    back.position.set(0, GOAL_H / 2, GOAL_Z - 1.2);
    this.scene.add(back);
    const top = new THREE.Mesh(this.track(new THREE.PlaneGeometry(GOAL_W, 1.2)), netMat);
    top.rotation.x = -Math.PI / 2;
    top.position.set(0, GOAL_H, GOAL_Z - 0.6);
    this.scene.add(top);
  }

  private addBall() {
    const mat = createToonMaterial({ color: PAL.ball, rimColor: PAL.rim, rimStrength: 0.4 });
    this.track(mat);
    const geo = this.track(new THREE.IcosahedronGeometry(0.22, 2));
    const ball = new THREE.Mesh(geo, mat);
    ball.position.set(0, 0.22, 0);
    ball.castShadow = true;
    ball.name = "ball";
    addInkOutline(ball, PAL.outline, 0.009);
    this.scene.add(ball);
  }

  private async loadCharacter() {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync("/models/character.glb");
    const root = gltf.scene;
    // Auto-fit to ~1.8m tall with feet on the pitch, regardless of the model's source units.
    const pre = new THREE.Box3().setFromObject(root);
    const size = pre.getSize(new THREE.Vector3());
    if (size.y > 0) root.scale.setScalar(1.8 / size.y);
    const post = new THREE.Box3().setFromObject(root);
    root.position.set(-0.55, -post.min.y, 0.6); // beside + slightly behind the ball, planted to strike
    root.rotation.y = Math.PI; // face the goal (-Z)

    const kitMat = createToonMaterial({ color: PAL.kitPrimary, rimColor: PAL.rim, rimStrength: 1.0 });
    const trimMat = createToonMaterial({ color: PAL.kitSecondary, rimColor: PAL.rim, rimStrength: 0.6 });
    this.track(kitMat);
    this.track(trimMat);
    // Collect first; adding outline children during traverse would recurse into them.
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    for (const m of meshes) {
      m.castShadow = true;
      const name = (m.material as THREE.Material)?.name || "";
      m.material = name === "M_Joints" ? trimMat : kitMat;
      addInkOutline(m as THREE.SkinnedMesh, PAL.outline, 0.014);
    }
    this.scene.add(root);
    this.kicker = root;

    this.mixer = new THREE.AnimationMixer(root);
    for (const clip of gltf.animations) {
      this.clips.set(clip.name, this.mixer.clipAction(clip));
    }
    this.play("Rig|Idle_Loop");
  }

  play(name: string, fade = 0.25) {
    const next = this.clips.get(name);
    if (!next) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    for (const [n, a] of this.clips) if (n !== name) a.fadeOut(fade);
  }

  update(dt: number) {
    this.mixer?.update(dt);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.renderer.dispose();
  }
}
