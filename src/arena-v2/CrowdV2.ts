/**
 * CrowdV2: the World Cup wrapper for the cel scene. A raked stand behind the goal (plus short
 * side stands) packed with billboard spectators, and waving flags, all in the Blue Lock palette.
 *
 * Billboard impostor crowd: one camera-facing quad per fan sampling an anonymous spectator
 * silhouette atlas, tinted per fan, with bob + a stadium wave done entirely in the vertex shader
 * (one draw call, cheap on mobile, anonymous by design). Same approach proven in v1.
 */
import * as THREE from "three";
import { PAL } from "./palette";

const CROWD_VERT = /* glsl */ `
attribute vec3 aTint;
attribute float aPhase;
attribute float aWave;
attribute float aCell;
attribute float aScale;
uniform float uTime;
varying vec2 vUv;
varying vec3 vTint;
void main() {
  vec3 center = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float front = fract(uTime * 0.08);
  float d = abs(aWave - front);
  d = min(d, 1.0 - d);
  float wave = smoothstep(0.10, 0.0, d) * 0.32;
  center.y += sin(uTime * 2.0 + aPhase) * 0.03 + wave;
  float cell = aCell + step(0.5, wave * 4.0);
  vec3 toCam = cameraPosition - center; toCam.y = 0.0; toCam = normalize(toCam);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 worldPos = center + right * (position.x * aScale) + vec3(0.0, 1.0, 0.0) * (position.y * aScale);
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
  float col = mod(cell, 2.0);
  float row = floor(cell / 2.0);
  vUv = (vec2(col, row) + vec2(uv.x, 1.0 - uv.y)) * 0.5;
  vTint = aTint;
}
`;

const CROWD_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec3 vTint;
void main() {
  vec4 t = texture2D(uMap, vUv);
  if (t.a < 0.4) discard;
  gl_FragColor = vec4(t.rgb * vTint, 1.0);
}
`;

// Cool crowd tints + bright accents (Blue Lock: blue stands, magenta/cyan/gold pops).
const TINTS = [0x35509a, 0x2b3f7a, 0x46618c, 0xff2e88, 0x54f0ff, 0xffce54, 0xe8edff];
const FLAGS = [
  ["#1238ff", "#e8edff", "#ff2e88"],
  ["#ff2e88", "#ffffff", "#54f0ff"],
  ["#ffce54", "#1238ff", "#ffce54"],
  ["#54f0ff", "#0a0e2a", "#54f0ff"],
];

export class CrowdV2 {
  private mat: THREE.ShaderMaterial | null = null;
  private flagMat: THREE.ShaderMaterial | null = null;
  private disposables: Array<{ dispose: () => void }> = [];

  constructor(
    private scene: THREE.Scene,
    private goalZ = -11,
  ) {
    this.addStands();
    this.addCrowd();
    this.addFlags();
  }

  private track<T extends { dispose: () => void }>(o: T): T {
    this.disposables.push(o);
    return o;
  }

  /** A raked concrete deck behind the goal + two short side decks, cel-shaded dark. */
  private addStands() {
    const mat = this.track(
      new THREE.MeshToonMaterial({ color: 0x2a3350, emissive: 0x101426, emissiveIntensity: 1, side: THREE.DoubleSide }),
    );
    const z = this.goalZ;
    // End deck: a single raked quad.
    const end = this.track(new THREE.PlaneGeometry(42, 14));
    const endMesh = new THREE.Mesh(end, mat);
    endMesh.rotation.x = -Math.PI / 2.55; // rake back
    endMesh.position.set(0, 4.5, z - 8);
    this.scene.add(endMesh);
    // Side decks.
    for (const s of [-1, 1]) {
      const side = this.track(new THREE.PlaneGeometry(20, 11));
      const m = new THREE.Mesh(side, mat);
      m.rotation.y = (-s * Math.PI) / 2;
      m.rotation.x = -Math.PI / 2.7;
      m.position.set(s * 15, 4, z + 4);
      this.scene.add(m);
    }
  }

  private addCrowd() {
    const atlas = this.makeAtlas();
    this.mat = this.track(
      new THREE.ShaderMaterial({
        uniforms: { uMap: { value: atlas }, uTime: { value: 0 } },
        vertexShader: CROWD_VERT,
        fragmentShader: CROWD_FRAG,
      }),
    );
    const geo = this.track(new THREE.PlaneGeometry(0.62, 0.95));
    geo.translate(0, 0.475, 0);

    type Seat = { x: number; y: number; z: number };
    const seats: Seat[] = [];
    const z = this.goalZ;
    // End stand grid (behind the goal), rows rise + recede.
    for (let r = 0; r < 12; r += 1) {
      const f = r / 11;
      const y = 1.6 + f * 8;
      const zz = z - 2.5 - f * 11;
      for (let c = 0; c < 52; c += 1) {
        const u = c / 51;
        seats.push({ x: -19 + u * 38 + (Math.random() - 0.5) * 0.4, y, z: zz });
      }
    }
    // Side stands.
    for (const s of [-1, 1]) {
      for (let r = 0; r < 9; r += 1) {
        const f = r / 8;
        const y = 1.5 + f * 6.5;
        const x = s * (12.5 + f * 8.5);
        for (let c = 0; c < 16; c += 1) {
          const zz = z + 7 - c * 1.0;
          seats.push({ x, y, z: zz });
        }
      }
    }

    const count = seats.length;
    const mesh = new THREE.InstancedMesh(geo, this.mat, count);
    mesh.frustumCulled = false;
    const aTint = new Float32Array(count * 3);
    const aPhase = new Float32Array(count);
    const aWave = new Float32Array(count);
    const aCell = new Float32Array(count);
    const aScale = new Float32Array(count);
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    seats.forEach((s, i) => {
      m.makeTranslation(s.x, s.y, s.z);
      mesh.setMatrixAt(i, m);
      color.set(TINTS[(Math.random() * TINTS.length) | 0]).multiplyScalar(0.9 + Math.random() * 0.3);
      aTint[i * 3] = color.r;
      aTint[i * 3 + 1] = color.g;
      aTint[i * 3 + 2] = color.b;
      aPhase[i] = Math.random() * Math.PI * 2;
      aWave[i] = Math.min(1, Math.max(0, (s.x + 24) / 48));
      aCell[i] = Math.random() < 0.5 ? 0 : 2;
      aScale[i] = 0.85 + Math.random() * 0.5;
    });
    geo.setAttribute("aTint", new THREE.InstancedBufferAttribute(aTint, 3));
    geo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(aPhase, 1));
    geo.setAttribute("aWave", new THREE.InstancedBufferAttribute(aWave, 1));
    geo.setAttribute("aCell", new THREE.InstancedBufferAttribute(aCell, 1));
    geo.setAttribute("aScale", new THREE.InstancedBufferAttribute(aScale, 1));
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
    this.track(mesh);
  }

  /** A sparse layer of waving flags hoisted above the end stand. */
  private addFlags() {
    const atlas = this.makeFlagAtlas();
    this.flagMat = this.track(
      new THREE.ShaderMaterial({
        uniforms: { uMap: { value: atlas }, uTime: { value: 0 } },
        vertexShader: CROWD_VERT,
        fragmentShader: CROWD_FRAG,
      }),
    );
    const geo = this.track(new THREE.PlaneGeometry(1.7, 1.05));
    geo.translate(0, 0.525, 0);
    const z = this.goalZ;
    const seats: { x: number; y: number; z: number }[] = [];
    for (let r = 0; r < 5; r += 1) {
      const f = r / 4;
      const y = 2.2 + f * 7.5;
      const zz = z - 3 - f * 10;
      for (let c = 0; c < 8; c += 1) {
        seats.push({ x: -16 + (c + Math.random() * 0.6) * 4.4, y, z: zz });
      }
    }
    const count = seats.length;
    const mesh = new THREE.InstancedMesh(geo, this.flagMat, count);
    mesh.frustumCulled = false;
    const aTint = new Float32Array(count * 3).fill(1);
    const aPhase = new Float32Array(count);
    const aWave = new Float32Array(count);
    const aCell = new Float32Array(count);
    const aScale = new Float32Array(count);
    const m = new THREE.Matrix4();
    seats.forEach((s, i) => {
      m.makeTranslation(s.x, s.y, s.z);
      mesh.setMatrixAt(i, m);
      aPhase[i] = Math.random() * Math.PI * 2;
      aWave[i] = Math.min(1, Math.max(0, (s.x + 24) / 48));
      aCell[i] = (Math.random() * 4) | 0;
      aScale[i] = 0.85 + Math.random() * 0.4;
    });
    geo.setAttribute("aTint", new THREE.InstancedBufferAttribute(aTint, 3));
    geo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(aPhase, 1));
    geo.setAttribute("aWave", new THREE.InstancedBufferAttribute(aWave, 1));
    geo.setAttribute("aCell", new THREE.InstancedBufferAttribute(aCell, 1));
    geo.setAttribute("aScale", new THREE.InstancedBufferAttribute(aScale, 1));
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
    this.track(mesh);
  }

  /** 2x2 anonymous spectator silhouettes (two body types x arms down/up). */
  private makeAtlas(): THREE.CanvasTexture {
    const cv = document.createElement("canvas");
    cv.width = 256;
    cv.height = 256;
    const ctx = cv.getContext("2d");
    if (ctx) {
      const person = (ox: number, oy: number, armsUp: boolean, tall: boolean) => {
        const midX = ox + 64;
        const baseY = oy + 118;
        const headR = 15;
        const headCy = oy + (tall ? 22 : 30) + headR;
        const shoulderY = headCy + headR + 5;
        const topW = tall ? 30 : 36;
        const botW = tall ? 42 : 50;
        const g = ctx.createLinearGradient(0, oy + 10, 0, baseY);
        g.addColorStop(0, "#eef1f4");
        g.addColorStop(1, "#a7adb4");
        ctx.fillStyle = g;
        ctx.strokeStyle = g;
        ctx.lineCap = "round";
        if (armsUp) {
          ctx.lineWidth = 12;
          ctx.beginPath();
          ctx.moveTo(midX - topW / 2 + 3, shoulderY + 2);
          ctx.lineTo(midX - topW / 2 - 8, shoulderY - 30);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(midX + topW / 2 - 3, shoulderY + 2);
          ctx.lineTo(midX + topW / 2 + 8, shoulderY - 30);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(midX - topW / 2, shoulderY);
        ctx.quadraticCurveTo(midX - botW / 2, (shoulderY + baseY) / 2, midX - botW / 2, baseY);
        ctx.lineTo(midX + botW / 2, baseY);
        ctx.quadraticCurveTo(midX + botW / 2, (shoulderY + baseY) / 2, midX + topW / 2, shoulderY);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(midX, headCy, headR, 0, Math.PI * 2);
        ctx.fill();
      };
      person(0, 0, false, false);
      person(128, 0, true, false);
      person(0, 128, false, true);
      person(128, 128, true, true);
    }
    const tex = this.track(new THREE.CanvasTexture(cv));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    return tex;
  }

  /** 2x2 tricolor flags. */
  private makeFlagAtlas(): THREE.CanvasTexture {
    const cv = document.createElement("canvas");
    cv.width = 256;
    cv.height = 256;
    const ctx = cv.getContext("2d");
    if (ctx) {
      const draw = (ox: number, oy: number, cols: string[]) => {
        const n = cols.length;
        for (let k = 0; k < n; k += 1) {
          ctx.fillStyle = cols[k];
          ctx.fillRect(ox + Math.floor((k * 128) / n), oy + 14, Math.ceil(128 / n) + 1, 100);
        }
      };
      draw(0, 0, FLAGS[0]);
      draw(128, 0, FLAGS[1]);
      draw(0, 128, FLAGS[2]);
      draw(128, 128, FLAGS[3]);
    }
    const tex = this.track(new THREE.CanvasTexture(cv));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    return tex;
  }

  update(elapsed: number) {
    if (this.mat) this.mat.uniforms.uTime.value = elapsed;
    if (this.flagMat) this.flagMat.uniforms.uTime.value = elapsed;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
