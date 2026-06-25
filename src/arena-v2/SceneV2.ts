/**
 * v2 scene: a behind-the-kicker, cel-shaded "Blue Lock" penalty world. Framework-agnostic class
 * driven by a thin React wrapper. This is the vertical-slice foundation: graded sky, cel pitch,
 * procedural goal + ball, and the CC0 rigged character cel-shaded with an ink outline on Idle.
 * Strike choreography + post FX + World Cup wrapper land on top of this.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { ParticlePool } from "../arena/ParticlePool";
import { CrowdV2 } from "./CrowdV2";
import { PAL } from "./palette";
import { BallTrail } from "./BallTrail";
import { PostFx } from "./PostFx";
import { addInkOutline, createToonMaterial, DEFAULT_RAMP } from "./toon";

const GOAL_Z = -11;
const GOAL_W = 7.32;
const GOAL_H = 2.44;

// Strike sequence timings (seconds of game time).
const RUNUP = 0.55;
const STRIKE = 0.42;
const CONTACT = 0.16; // boot meets ball this far into the strike
const RECOVER = 0.7;
const FLIGHT = 1.0;
const smooth = (t: number) => t * t * (3 - 2 * t);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export class SceneV2 {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private mixer: THREE.AnimationMixer | null = null;
  private clips = new Map<string, THREE.AnimationAction>();
  private kicker: THREE.Object3D | null = null;
  private disposables: Array<{ dispose: () => void }> = [];

  // Strike sequence state.
  private ball: THREE.Mesh | null = null;
  private legThighR: THREE.Object3D | null = null;
  private legShinR: THREE.Object3D | null = null;
  private phase: "idle" | "runup" | "strike" | "recover" = "idle";
  private phaseT = 0;
  private autoTimer = 1.5;
  private timeScale = 1;
  private timeScaleTarget = 1;
  private slowmoT = 0;
  private ballFlying = false;
  private ballT = 0;
  private aimX = 0;
  private aimY = 1;
  private readonly startPos = new THREE.Vector3(-0.7, 0, 1.5);
  private readonly plantPos = new THREE.Vector3(-0.42, 0, 0.5);
  private readonly ballHome = new THREE.Vector3(0, 0.22, 0);
  private readonly ballFrom = new THREE.Vector3();
  private readonly ballTo = new THREE.Vector3();
  private readonly qTmp = new THREE.Quaternion();
  private readonly axisX = new THREE.Vector3(1, 0, 0);
  private postfx: PostFx | null = null;
  private trail: BallTrail | null = null;
  private particles: ParticlePool | null = null;
  private crowd2: CrowdV2 | null = null;
  private elapsed = 0;
  private netBack: THREE.Mesh | null = null;
  private readonly netBaseZ = GOAL_Z - 1.2;
  private netHitT = 0;
  /** Fired when a strike resolves; the React layer shows the GOOOAL / SAVED callout. */
  onResult: ((kind: "goal" | "save") => void) | null = null;

  // Keeper.
  private keeper: THREE.Object3D | null = null;
  private keeperMixer: THREE.AnimationMixer | null = null;
  private keeperBaseY = 0;
  private readonly keeperZ = GOAL_Z + 0.5;
  private diveDir = 1;
  private diveT = 0;
  private diving = false;
  private saved = false;

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
    this.postfx = new PostFx(this.renderer, this.scene, this.camera, { enabled: true });
    this.trail = new BallTrail(this.scene, { color: PAL.accent, width: 0.14, length: 22 });
    this.particles = new ParticlePool(this.scene, 140);
    this.crowd2 = new CrowdV2(this.scene, GOAL_Z);
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
    this.netBack = back;
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
    this.ball = ball;
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
    const groundY = -post.min.y;
    this.startPos.y = groundY;
    this.plantPos.y = groundY;
    root.position.copy(this.startPos);
    root.rotation.y = Math.PI; // face the goal (-Z)

    // Clone a keeper from the clean (un-outlined) rig before we modify the kicker.
    const keeperRoot = cloneSkinned(root);

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
    // GLTFLoader sanitizes dotted bone names ("DEF-thigh.R" -> "DEF-thighR").
    this.legThighR = root.getObjectByName("DEF-thighR") ?? root.getObjectByName("DEF-thigh.R") ?? null;
    this.legShinR = root.getObjectByName("DEF-shinR") ?? root.getObjectByName("DEF-shin.R") ?? null;

    this.mixer = new THREE.AnimationMixer(root);
    for (const clip of gltf.animations) {
      this.clips.set(clip.name, this.mixer.clipAction(clip));
    }
    this.play("Rig|Idle_Loop");

    this.setupKeeper(keeperRoot, gltf.animations);
  }

  private setupKeeper(root: THREE.Object3D, animations: THREE.AnimationClip[]) {
    this.keeperBaseY = this.startPos.y;
    root.position.set(0, this.keeperBaseY, this.keeperZ);
    root.rotation.set(0, 0, 0); // face the kicker (+Z)
    const kit = createToonMaterial({ color: PAL.accent, rimColor: PAL.rim, rimStrength: 0.95 }); // rival magenta
    const trim = createToonMaterial({ color: 0x141622, rimColor: PAL.rim, rimStrength: 0.5 });
    this.track(kit);
    this.track(trim);
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    for (const m of meshes) {
      m.castShadow = true;
      const n = (m.material as THREE.Material)?.name || "";
      m.material = n === "M_Joints" ? trim : kit;
      addInkOutline(m as THREE.SkinnedMesh, PAL.outline, 0.014);
    }
    this.scene.add(root);
    this.keeper = root;
    this.keeperMixer = new THREE.AnimationMixer(root);
    const idle = animations.find((c) => c.name === "Rig|Idle_Loop");
    if (idle) this.keeperMixer.clipAction(idle).play();
  }

  play(name: string, fade = 0.25) {
    const next = this.clips.get(name);
    if (!next) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    for (const [n, a] of this.clips) if (n !== name) a.fadeOut(fade);
  }

  /** Start a strike: run up to the ball, swing, launch. Aims at a point in the goal mouth. */
  kick() {
    if (this.phase !== "idle" || !this.kicker) return;
    this.phase = "runup";
    this.phaseT = 0;
    this.aimX = (Math.random() * 2 - 1) * 2.6;
    this.aimY = 0.5 + Math.random() * 1.4;
    this.play("Rig|Jog_Fwd_Loop", 0.15);
  }

  update(dt: number) {
    // Auto-loop in the dev view so the strike is visible; the real flow will call kick() instead.
    this.autoTimer += dt;
    if (this.phase === "idle" && this.autoTimer > 2.8) {
      this.autoTimer = 0;
      this.kick();
    }
    if (this.slowmoT > 0) {
      this.slowmoT -= dt;
      if (this.slowmoT <= 0) this.timeScaleTarget = 1;
    }
    this.timeScale += (this.timeScaleTarget - this.timeScale) * Math.min(1, dt * 6);
    const g = dt * this.timeScale; // game time (slows during the strike)
    this.elapsed += dt;
    this.crowd2?.update(this.elapsed);
    this.mixer?.update(g);
    this.keeperMixer?.update(g);
    this.advance(g);
    this.diveStep(g);
    this.flightStep(g);
    this.particles?.update(dt);
    if (this.netHitT > 0) {
      this.netHitT = Math.max(0, this.netHitT - dt);
      const e = this.netHitT / 0.55;
      if (this.netBack) this.netBack.position.z = this.netBaseZ - Math.sin(e * Math.PI) * 0.35; // bulge + settle
      if (this.netHitT === 0) this.postfx?.setBloomStrength(0.6);
    }
    this.postfx?.update(dt); // post fx keep real time so they never stutter
  }

  private advance(dt: number) {
    if (this.phase === "idle" || !this.kicker) return;
    this.phaseT += dt;
    if (this.phase === "runup") {
      const t = Math.min(1, this.phaseT / RUNUP);
      this.kicker.position.lerpVectors(this.startPos, this.plantPos, easeInOut(t));
      if (t >= 1) {
        this.phase = "strike";
        this.phaseT = 0;
        this.play("Rig|Idle_Loop", 0.06); // upright base pose; the leg swing is layered on top
      }
    } else if (this.phase === "strike") {
      const t = Math.min(1, this.phaseT / STRIKE);
      this.swingLeg(t);
      if (this.phaseT >= CONTACT && !this.ballFlying && this.ballT === 0) this.onContact();
      if (t >= 1) {
        this.phase = "recover";
        this.phaseT = 0;
      }
    } else if (this.phase === "recover") {
      if (this.phaseT >= RECOVER && !this.ballFlying) {
        this.phase = "idle";
        this.phaseT = 0;
        this.autoTimer = 0;
        this.kicker.position.copy(this.startPos);
        this.ball?.position.copy(this.ballHome);
        this.ballFlying = false;
        this.ballT = 0;
        this.trail?.update(this.ballHome, false);
        // Reset the keeper back to a ready stance in the goal.
        this.diving = false;
        this.diveT = 0;
        if (this.keeper) {
          this.keeper.position.set(0, this.keeperBaseY, this.keeperZ);
          this.keeper.rotation.set(0, 0, 0);
        }
      }
    }
  }

  /** Layer a grounded right-leg swing on top of the base pose: windup back, drive through contact. */
  private swingLeg(t: number) {
    if (!this.legThighR) return;
    const thigh = THREE.MathUtils.lerp(0.55, -1.2, smooth(t));
    this.legThighR.quaternion.multiply(this.qTmp.setFromAxisAngle(this.axisX, thigh));
    if (this.legShinR) {
      const shin = THREE.MathUtils.lerp(-1.15, 0.05, smooth(Math.min(1, t * 1.35)));
      this.legShinR.quaternion.multiply(this.qTmp.setFromAxisAngle(this.axisX, shin));
    }
  }

  private onContact() {
    if (!this.ball) return;
    this.ballFlying = true;
    this.ballT = 0.0001;
    this.ballFrom.copy(this.ball.position);
    this.ballTo.set(this.aimX, this.aimY, GOAL_Z + 0.3);
    this.timeScaleTarget = 0.32; // slow-mo burst on contact
    this.slowmoT = 0.5;
    this.postfx?.triggerImpact();
    this.postfx?.setSpeedLines(1);

    // Keeper reads the shot: dives to the aimed side ~55% of the time. A save needs the right
    // side, a reachable height, and a shot that is not dead-center (where a dive cannot cover).
    const correctSide = Math.sign(this.aimX) || 1;
    this.diveDir = Math.random() < 0.55 ? correctSide : -correctSide;
    const reachable = Math.abs(this.aimX) > 0.5 && Math.abs(this.aimX) < 2.4 && this.aimY < 1.7;
    this.saved = this.diveDir === correctSide && reachable;
    this.diving = true;
    this.diveT = 0;
  }

  private flightStep(dt: number) {
    if (!this.ballFlying || !this.ball) return;
    this.ballT += dt / FLIGHT;
    const t = Math.min(1, this.ballT);
    // Quadratic arc from boot to the aimed point.
    const mid = this.ballFrom.clone().lerp(this.ballTo, 0.5);
    mid.y += 1.5;
    const a = this.ballFrom.clone().lerp(mid, t);
    const b = mid.lerp(this.ballTo, t);
    this.ball.position.lerpVectors(a, b, t);
    this.ball.rotation.x -= dt * 14;
    this.trail?.update(this.ball.position, true, dt);
    this.postfx?.setSpeedLines(Math.max(0, 1 - t * 1.6));
    if (t >= 1) {
      this.ballFlying = false;
      this.ballT = 0;
      this.trail?.update(this.ball.position, false, dt);
      if (this.saved) this.saveShot();
      else this.scoreGoal();
    }
  }

  /** Keeper lunge: translate toward the dive side, hop, and topple (a grounded diving lunge). */
  private diveStep(dt: number) {
    if (!this.diving || !this.keeper) return;
    this.diveT += dt;
    const tt = Math.min(1, this.diveT / 0.5);
    const e = 1 - (1 - tt) * (1 - tt); // easeOut
    this.keeper.position.x = this.diveDir * 1.9 * e;
    this.keeper.position.y = this.keeperBaseY + Math.sin(tt * Math.PI) * 0.35;
    this.keeper.rotation.z = -this.diveDir * 1.0 * e;
  }

  /** Save payoff: ball deflects out to the dive side, a gray puff, no confetti. */
  private saveShot() {
    if (!this.ball) return;
    this.ball.position.set(this.diveDir * 2.2, 1.5, GOAL_Z + 1.2);
    this.particles?.burst(this.ball.position, 16, [0x9aa3ad, 0xd8dde4, PAL.rim], 0.6);
    this.postfx?.setSpeedLines(0);
    this.onResult?.("save");
  }

  /** Goal payoff: net bulge, gold/magenta confetti, a bloom flare, and the GOOOAL event. */
  private scoreGoal() {
    if (!this.ball) return;
    this.particles?.burst(this.ball.position, 90, [0xffce54, 0xff2e88, 0xffffff, 0x54f0ff], 1.3);
    this.netHitT = 0.55;
    this.postfx?.setBloomStrength(1.1);
    this.onResult?.("goal");
  }

  render() {
    if (this.postfx) this.postfx.render();
    else this.renderer.render(this.scene, this.camera);
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.postfx?.resize(w, h);
  }

  dispose() {
    this.postfx?.dispose();
    this.trail?.dispose();
    this.particles?.dispose();
    this.crowd2?.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.renderer.dispose();
  }
}
