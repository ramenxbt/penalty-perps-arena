import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoundPhase, Shooter } from "./game/types";
import {
  arrangeShooters,
  FLIGHT_MS,
  SHOT_BEAT_MS,
  VisibleVolleyAttempt,
  visibleVolleyAttempts,
  VOLLEY_LEAD_IN_MS,
} from "./game/volley";

type ArenaSceneProps = {
  phase: RoundPhase;
  shooters: Shooter[];
};

/** 32 panel centers of a real soccer ball (truncated icosahedron). */
function soccerBallCenters(): { centers: THREE.Vector3[]; isPentagon: number[] } {
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const pos = ico.attributes.position;
  const get = (i: number) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
  const pentagons = new Map<string, THREE.Vector3>();
  const hexagons: THREE.Vector3[] = [];
  for (let f = 0; f < pos.count; f += 3) {
    const a = get(f);
    const b = get(f + 1);
    const c = get(f + 2);
    hexagons.push(a.clone().add(b).add(c).normalize());
    for (const v of [a, b, c]) {
      const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
      if (!pentagons.has(key)) pentagons.set(key, v);
    }
  }
  ico.dispose();
  const pentList = [...pentagons.values()];
  const centers = [...pentList, ...hexagons];
  const isPentagon = centers.map((_, i) => (i < pentList.length ? 1 : 0));
  return { centers, isPentagon };
}

const SHARED = soccerBallCenters();
const VOLLEY_LEAD_IN = VOLLEY_LEAD_IN_MS / 1000;
const PER_SHOT = SHOT_BEAT_MS / 1000;
const FLIGHT = FLIGHT_MS / 1000;
const SOCCER_BALL_GEOMETRY = new THREE.SphereGeometry(1, 40, 40);
const SOCCER_BALL_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.46,
  metalness: 0.04,
});
SOCCER_BALL_GEOMETRY.userData.sharedArenaAsset = true;
SOCCER_BALL_MATERIAL.userData.sharedArenaAsset = true;
SOCCER_BALL_MATERIAL.onBeforeCompile = (shader) => {
  shader.uniforms.uCenters = { value: SHARED.centers };
  shader.uniforms.uIsPent = { value: SHARED.isPentagon };
  shader.uniforms.uSeam = { value: 0.02 };
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vBallPos;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBallPos = position;");
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>
      varying vec3 vBallPos;
      uniform vec3 uCenters[32];
      uniform float uIsPent[32];
      uniform float uSeam;`,
    )
    .replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      {
        vec3 p = normalize(vBallPos);
        float best = -2.0; float second = -2.0; int bi = 0;
        for (int i = 0; i < 32; i++) {
          float d = dot(p, uCenters[i]);
          if (d > best) { second = best; best = d; bi = i; }
          else if (d > second) { second = d; }
        }
        float edge = smoothstep(0.0, uSeam, best - second);
        vec3 panel = uIsPent[bi] > 0.5 ? vec3(0.03) : vec3(0.95);
        diffuseColor.rgb *= mix(vec3(0.0), panel, edge);
      }`,
    );
};
SOCCER_BALL_MATERIAL.customProgramCacheKey = () => "soccerball-v4";

function seededRandom(seed: string) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return () => {
    hash += hash << 13;
    hash ^= hash >>> 7;
    hash += hash << 3;
    hash ^= hash >>> 17;
    hash += hash << 5;
    return ((hash >>> 0) % 10000) / 10000;
  };
}

function createSoccerBall(radius: number): THREE.Mesh {
  const mesh = new THREE.Mesh(SOCCER_BALL_GEOMETRY, SOCCER_BALL_MATERIAL);
  mesh.scale.setScalar(radius);
  mesh.castShadow = true;
  return mesh;
}

/** A goal with real depth: rounded posts, a slanted back frame, and a wireframe net box. */
function buildGoal(width: number, height: number, depth: number): THREE.Group {
  const group = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f5, roughness: 0.38, metalness: 0.1 });
  const backH = height * 0.5;
  const r = 0.09;

  const vBar = (h: number) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 14), white);
  const hBar = (len: number) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 14), white);
    m.rotation.z = Math.PI / 2;
    return m;
  };
  const dBar = (len: number) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 14), white);
    m.rotation.x = Math.PI / 2;
    return m;
  };

  // Front frame.
  const frontL = vBar(height);
  frontL.position.set(-width / 2, height / 2, 0);
  const frontR = vBar(height);
  frontR.position.set(width / 2, height / 2, 0);
  const crossbar = hBar(width);
  crossbar.position.set(0, height, 0);

  // Back frame (lower) + side depth bars + slanted roof struts.
  const backL = vBar(backH);
  backL.position.set(-width / 2, backH / 2, -depth);
  const backR = vBar(backH);
  backR.position.set(width / 2, backH / 2, -depth);
  const backTop = hBar(width);
  backTop.position.set(0, backH, -depth);
  const groundL = dBar(depth);
  groundL.position.set(-width / 2, r, -depth / 2);
  const groundR = dBar(depth);
  groundR.position.set(width / 2, r, -depth / 2);

  const strutLen = Math.hypot(depth, height - backH);
  const strutAngle = Math.atan2(height - backH, depth);
  const roofL = new THREE.Mesh(new THREE.CylinderGeometry(r, r, strutLen, 14), white);
  roofL.position.set(-width / 2, (height + backH) / 2, -depth / 2);
  roofL.rotation.x = Math.PI / 2 - strutAngle;
  const roofR = roofL.clone();
  roofR.position.x = width / 2;

  group.add(frontL, frontR, crossbar, backL, backR, backTop, groundL, groundR, roofL, roofR);
  group.traverse((o) => {
    o.castShadow = true;
  });

  // Net box (wireframe).
  const netMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.13, wireframe: true });
  const backNet = new THREE.Mesh(new THREE.PlaneGeometry(width, backH, Math.round(width * 2), 6), netMat);
  backNet.position.set(0, backH / 2, -depth + 0.01);
  const roofNet = new THREE.Mesh(new THREE.PlaneGeometry(width, strutLen, Math.round(width * 2), 5), netMat);
  roofNet.position.set(0, (height + backH) / 2, -depth / 2);
  roofNet.rotation.x = Math.PI / 2 - strutAngle;
  const sideL = new THREE.Mesh(new THREE.PlaneGeometry(depth, height, 5, 6), netMat);
  sideL.rotation.y = Math.PI / 2;
  sideL.position.set(-width / 2, height / 2 - (height - backH) * 0.25, -depth / 2);
  const sideR = sideL.clone();
  sideR.position.x = width / 2;
  group.add(backNet, roofNet, sideL, sideR);
  [backNet, roofNet, sideL, sideR].forEach((mesh) => {
    mesh.userData.isGoalNet = true;
    mesh.userData.baseOpacity = netMat.opacity;
  });

  return group;
}

function addPitchLine(scene: THREE.Scene, points: Array<[number, number]>) {
  const material = new THREE.LineBasicMaterial({ color: 0xf4f4f5, transparent: true, opacity: 0.52 });
  const geometry = new THREE.BufferGeometry().setFromPoints(
    points.map(([x, z]) => new THREE.Vector3(x, 0.035, z)),
  );
  const line = new THREE.Line(geometry, material);
  scene.add(line);
}

function addWorldCupDressing(scene: THREE.Scene, goalW: number, goalZ: number) {
  const standMat = new THREE.MeshStandardMaterial({ color: 0x11151a, roughness: 0.88, metalness: 0.04 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x222832, roughness: 0.65 });
  const flagColors = [0xb7ff4a, 0x6dd6ff, 0xf6b73c, 0xff5370];

  for (let row = 0; row < 4; row += 1) {
    const stand = new THREE.Mesh(new THREE.BoxGeometry(goalW + 13 + row * 1.6, 0.36, 0.72), standMat);
    stand.position.set(0, 2.1 + row * 0.42, goalZ - 4.6 - row * 0.72);
    stand.rotation.x = -0.08;
    stand.receiveShadow = true;
    scene.add(stand);

    const rail = new THREE.Mesh(new THREE.BoxGeometry(goalW + 12 + row * 1.6, 0.05, 0.08), railMat);
    rail.position.set(0, 2.34 + row * 0.42, goalZ - 4.24 - row * 0.72);
    scene.add(rail);
  }

  for (let i = 0; i < 18; i += 1) {
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.2),
      new THREE.MeshBasicMaterial({
        color: flagColors[i % flagColors.length],
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      }),
    );
    flag.position.set((i - 8.5) * 0.72, 3.86 + Math.sin(i) * 0.06, goalZ - 3.8);
    flag.rotation.y = Math.sin(i * 1.7) * 0.28;
    scene.add(flag);
  }

  const towerMat = new THREE.MeshStandardMaterial({ color: 0xdff7ff, emissive: 0x6dd6ff, emissiveIntensity: 1.5 });
  [-1, 1].forEach((side) => {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 4.4, 8), railMat);
    mast.position.set(side * (goalW / 2 + 4.4), 3.1, goalZ - 2.6);
    scene.add(mast);
    const lamps = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.3, 0.08), towerMat);
    lamps.position.set(side * (goalW / 2 + 4.4), 5.34, goalZ - 2.45);
    lamps.rotation.y = -side * 0.35;
    scene.add(lamps);
  });
}

function makeBoardTexture(label: string, accent = "#b7ff4a"): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
    gradient.addColorStop(0, "#08110b");
    gradient.addColorStop(0.5, "#101820");
    gradient.addColorStop(1, "#08110b");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, canvas.width, 8);
    ctx.fillRect(0, canvas.height - 8, canvas.width, 8);
    ctx.fillStyle = "#eefbf2";
    ctx.font = "700 38px Inter, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, canvas.width / 2, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function addBroadcastBoards(scene: THREE.Scene, goalW: number, goalZ: number) {
  const labels = [
    ["PENALTY PERPS", "#b7ff4a"],
    ["BTC / ETH / SOL", "#6dd6ff"],
    ["FINALS ARENA", "#f6b73c"],
  ] as const;

  labels.forEach(([label, accent], index) => {
    const texture = makeBoardTexture(label, accent);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
    });
    material.userData.ownsTexture = texture;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.8), material);
    board.position.set((index - 1) * 3.85, 0.62, goalZ + 4.05);
    board.rotation.x = -0.1;
    scene.add(board);
  });

  [-1, 1].forEach((side) => {
    const texture = makeBoardTexture(side < 0 ? "OPEN THE NET" : "BEAT THE KEEPER", "#ff5370");
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.86,
      side: THREE.DoubleSide,
    });
    material.userData.ownsTexture = texture;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 0.72), material);
    board.position.set(side * (goalW / 2 + 2.5), 0.56, goalZ + 2.8);
    board.rotation.y = -side * 0.62;
    board.rotation.x = -0.08;
    scene.add(board);
  });
}

function buildShooterFigure(isYou: boolean): THREE.Group {
  const group = new THREE.Group();
  const kit = new THREE.MeshStandardMaterial({
    color: isYou ? 0xb7ff4a : 0xe8edf2,
    roughness: 0.58,
    metalness: 0.03,
  });
  const shorts = new THREE.MeshStandardMaterial({ color: isYou ? 0x101512 : 0x15191f, roughness: 0.64 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xf1c7a4, roughness: 0.5 });
  const boot = new THREE.MeshStandardMaterial({ color: 0x0a0b0c, roughness: 0.5 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.46, 6, 12), kit);
  torso.position.y = 0.84;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 18, 18), skin);
  head.position.y = 1.27;
  const waist = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.2), shorts);
  waist.position.y = 0.52;

  const limb = (length: number, radius: number, material: THREE.Material) =>
    new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 8), material);

  const leftLeg = limb(0.52, 0.045, shorts);
  leftLeg.position.set(-0.08, 0.26, 0.03);
  leftLeg.rotation.z = -0.08;
  const rightLeg = limb(0.52, 0.045, shorts);
  rightLeg.position.set(0.08, 0.26, -0.02);
  rightLeg.rotation.z = 0.08;
  const leftBoot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.055, 0.25), boot);
  leftBoot.position.set(-0.08, 0.02, -0.06);
  const rightBoot = leftBoot.clone();
  rightBoot.position.set(0.08, 0.02, -0.07);

  const leftArm = limb(0.42, 0.035, skin);
  leftArm.position.set(-0.24, 0.82, 0.02);
  leftArm.rotation.z = 0.55;
  const rightArm = limb(0.42, 0.035, skin);
  rightArm.position.set(0.24, 0.82, 0.02);
  rightArm.rotation.z = -0.55;

  group.add(torso, head, waist, leftLeg, rightLeg, leftBoot, rightBoot, leftArm, rightArm);
  group.scale.setScalar(isYou ? 1.08 : 0.92);
  group.traverse((object) => {
    object.castShadow = true;
  });
  return group;
}

function buildKeeperFigure(): THREE.Group {
  const group = new THREE.Group();
  const kit = new THREE.MeshStandardMaterial({ color: 0x6dd6ff, roughness: 0.42, metalness: 0.05 });
  const shorts = new THREE.MeshStandardMaterial({ color: 0x10151d, roughness: 0.58 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xf1c7a4, roughness: 0.5 });
  const glove = new THREE.MeshStandardMaterial({ color: 0xf6b73c, roughness: 0.4 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.86, 8, 16), kit);
  torso.position.y = 1.1;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 20), skin);
  head.position.y = 1.8;
  const waist = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.16, 0.24), shorts);
  waist.position.y = 0.57;

  const limb = (length: number, radius: number, material: THREE.Material) =>
    new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10), material);

  const leftArm = limb(0.74, 0.055, kit);
  leftArm.name = "keeper-left-arm";
  leftArm.position.set(-0.48, 1.2, 0);
  leftArm.rotation.z = 0.85;
  const rightArm = limb(0.74, 0.055, kit);
  rightArm.name = "keeper-right-arm";
  rightArm.position.set(0.48, 1.2, 0);
  rightArm.rotation.z = -0.85;
  const leftGlove = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 14), glove);
  leftGlove.name = "keeper-left-glove";
  leftGlove.position.set(-0.82, 1.47, 0);
  const rightGlove = leftGlove.clone();
  rightGlove.name = "keeper-right-glove";
  rightGlove.position.x = 0.82;

  const leftLeg = limb(0.64, 0.06, shorts);
  leftLeg.position.set(-0.16, 0.28, 0);
  leftLeg.rotation.z = -0.08;
  const rightLeg = limb(0.64, 0.06, shorts);
  rightLeg.position.set(0.16, 0.28, 0);
  rightLeg.rotation.z = 0.08;

  group.add(torso, head, waist, leftArm, rightArm, leftGlove, rightGlove, leftLeg, rightLeg);
  group.traverse((object) => {
    object.castShadow = true;
  });
  return group;
}

function buildTargetMarker(isYou: boolean): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    color: isYou ? 0xb7ff4a : 0x6dd6ff,
    transparent: true,
    opacity: isYou ? 0.34 : 0.14,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.25, 32), material);
  marker.renderOrder = 3;
  return marker;
}

function buildShotTrail(isYou: boolean): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const material = new THREE.LineBasicMaterial({
    color: isYou ? 0xb7ff4a : 0x6dd6ff,
    transparent: true,
    opacity: 0,
  });
  return new THREE.Line(geometry, material);
}

function setTrail(trail: THREE.Line, from: THREE.Vector3, to: THREE.Vector3, opacity: number) {
  const position = trail.geometry.getAttribute("position") as THREE.BufferAttribute;
  position.setXYZ(0, from.x, from.y, from.z);
  position.setXYZ(1, to.x, to.y, to.z);
  position.needsUpdate = true;
  (trail.material as THREE.LineBasicMaterial).opacity = opacity;
}

function disposeOwnedGeometry(geometry: THREE.BufferGeometry) {
  if (!geometry.userData.sharedArenaAsset) geometry.dispose();
}

function disposeOwnedMaterial(material: THREE.Material) {
  if (material.userData.ownsTexture instanceof THREE.Texture) material.userData.ownsTexture.dispose();
  if (!material.userData.sharedArenaAsset) material.dispose();
}

type Lane = {
  id: string;
  isYou: boolean;
  ball: THREE.Mesh;
  player: THREE.Group;
  ring: THREE.Mesh | null;
  trail: THREE.Line;
  targetMarker: THREE.Mesh;
  restPos: THREE.Vector3;
  radius: number;
  laneX: number;
  targetX: number;
};

type VisualAttempt = VisibleVolleyAttempt & {
  laneIndex: number;
};

type FlashState = {
  text: string;
  className: "is-goal" | "is-saved";
};

function flashForShooter(shooter: Shooter | undefined): FlashState | null {
  if (!shooter) return null;
  const text = shooter.shots <= 0
    ? "NO KICK"
    : shooter.goals > 0
      ? shooter.goals > 1
        ? `${shooter.goals} GOALS`
        : "GOAL"
      : "SAVED";
  return {
    text,
    className: shooter.goals > 0 ? "is-goal" : "is-saved",
  };
}

export function ArenaScene({ phase, shooters }: ArenaSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef({ phase, shooters });
  const [liveFlash, setLiveFlash] = useState<FlashState | null>(null);
  const arrangedShooters = useMemo(() => arrangeShooters(shooters), [shooters]);
  stateRef.current = { phase, shooters };

  useEffect(() => {
    if (phase !== "resolving") {
      if (phase !== "settled") setLiveFlash(null);
      return undefined;
    }

    const attempts = visibleVolleyAttempts(arrangedShooters);
    const userAttemptIndex = attempts.findIndex((attempt) => attempt.shooter?.isYou);
    const flash = flashForShooter(attempts[userAttemptIndex]?.shooter);
    if (userAttemptIndex < 0 || !flash) return undefined;

    const showAt = VOLLEY_LEAD_IN_MS + userAttemptIndex * SHOT_BEAT_MS;
    const showTimer = window.setTimeout(() => setLiveFlash(flash), showAt);
    const hideTimer = window.setTimeout(() => setLiveFlash(null), showAt + 1600);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
  }, [arrangedShooters, phase]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x08100b, 18, 46);

    const camera = new THREE.PerspectiveCamera(44, host.clientWidth / host.clientHeight, 0.1, 100);
    const cameraTarget = new THREE.Vector3(0, 1.1, -2);
    const baseCameraPosition = new THREE.Vector3(0, 3.7, 11.6);
    const baseCameraTarget = new THREE.Vector3(0, 1.1, -2);
    const desiredCameraPosition = new THREE.Vector3();
    const desiredCameraTarget = new THREE.Vector3();
    camera.position.set(0, 3.7, 11.6);
    camera.lookAt(cameraTarget);

    const isCompactViewport = window.matchMedia("(max-width: 700px)");
    const pixelRatioCap = () => (isCompactViewport.matches ? 1.35 : 1.75);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap()));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xb8fff2, 0.5));
    const key = new THREE.SpotLight(0xffffff, 8, 46, Math.PI / 4.2, 0.5, 1.05);
    key.position.set(-3, 13, 9);
    key.target.position.set(0, 0.6, -3);
    key.castShadow = true;
    key.shadow.mapSize.set(isCompactViewport.matches ? 1024 : 1536, isCompactViewport.matches ? 1024 : 1536);
    key.shadow.bias = -0.0004;
    scene.add(key, key.target);
    const fill = new THREE.PointLight(0xb7ff4a, 2.2, 30);
    fill.position.set(5, 5, 7);
    scene.add(fill);
    const rim = new THREE.PointLight(0x65d8ff, 2.6, 30);
    rim.position.set(-6, 5, -9);
    scene.add(rim);

    // Roster (captured once; ids stable across phases). You sit dead center.
    const roster = stateRef.current.shooters.length ? stateRef.current.shooters : [];
    const arranged = arrangeShooters(roster);
    const count = Math.max(1, arranged.length);
    const meIndex = arranged.findIndex((s) => s.isYou);
    const center = meIndex >= 0 ? meIndex : Math.floor((count - 1) / 2);
    const spacing = 1.2;
    const restZ = 3.9;

    const goalZ = -8.6;
    const goalW = Math.max(6.4, (count - 1) * spacing + 4.5);
    const goalH = 3.4;
    const goalDepth = 1.9;
    const keeperZ = goalZ + 0.75;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    // Pitch.
    const pitch = new THREE.Mesh(
      new THREE.PlaneGeometry(goalW + 12, 34, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x0b2617, roughness: 0.95, metalness: 0.02 }),
    );
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.z = -3;
    pitch.receiveShadow = true;
    scene.add(pitch);

    for (let stripe = 0; stripe < 9; stripe += 1) {
      const stripeMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(goalW + 12, 2.6, 1, 1),
        new THREE.MeshBasicMaterial({
          color: stripe % 2 === 0 ? 0x10351f : 0x092918,
          transparent: true,
          opacity: 0.38,
        }),
      );
      stripeMesh.rotation.x = -Math.PI / 2;
      stripeMesh.position.set(0, 0.025, -14.2 + stripe * 3.4);
      scene.add(stripeMesh);
    }

    addPitchLine(scene, [[-goalW / 2 - 1.2, goalZ + 2.8], [goalW / 2 + 1.2, goalZ + 2.8]]);
    addPitchLine(scene, [[-goalW / 2 - 1.2, goalZ + 2.8], [-goalW / 2 - 1.2, goalZ + 7.1]]);
    addPitchLine(scene, [[goalW / 2 + 1.2, goalZ + 2.8], [goalW / 2 + 1.2, goalZ + 7.1]]);
    addPitchLine(scene, [[-goalW / 2 - 1.2, goalZ + 7.1], [goalW / 2 + 1.2, goalZ + 7.1]]);
    addPitchLine(scene, [[-goalW / 2 + 0.8, goalZ + 1.2], [goalW / 2 - 0.8, goalZ + 1.2]]);
    addPitchLine(scene, [[-goalW / 2 + 0.8, goalZ + 1.2], [-goalW / 2 + 0.8, goalZ + 3.25]]);
    addPitchLine(scene, [[goalW / 2 - 0.8, goalZ + 1.2], [goalW / 2 - 0.8, goalZ + 3.25]]);
    addPitchLine(scene, [[-1.2, restZ - 0.4], [1.2, restZ - 0.4]]);

    // Penalty arc marking.
    const arc = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.4, 48),
      new THREE.MeshBasicMaterial({ color: 0xb7ff4a, transparent: true, opacity: 0.5 }),
    );
    arc.rotation.x = -Math.PI / 2;
    arc.position.set(0, 0.03, restZ);
    scene.add(arc);

    const spot = new THREE.Mesh(
      new THREE.CircleGeometry(0.13, 24),
      new THREE.MeshBasicMaterial({ color: 0xf4f4f5, transparent: true, opacity: 0.86 }),
    );
    spot.rotation.x = -Math.PI / 2;
    spot.position.set(0, 0.036, restZ);
    scene.add(spot);

    const goal = buildGoal(goalW, goalH, goalDepth);
    goal.position.z = goalZ;
    scene.add(goal);
    const goalNetMeshes: THREE.Mesh[] = [];
    goal.traverse((object) => {
      if (object instanceof THREE.Mesh && object.userData.isGoalNet) {
        object.userData.baseZ = object.position.z;
        goalNetMeshes.push(object);
      }
    });
    addWorldCupDressing(scene, goalW, goalZ);
    addBroadcastBoards(scene, goalW, goalZ);

    // One shared keeper, centered.
    const keeper = buildKeeperFigure();
    keeper.position.set(0, 0, keeperZ);
    scene.add(keeper);
    const keeperLeftArm = keeper.getObjectByName("keeper-left-arm") as THREE.Mesh | undefined;
    const keeperRightArm = keeper.getObjectByName("keeper-right-arm") as THREE.Mesh | undefined;
    const keeperLeftGlove = keeper.getObjectByName("keeper-left-glove") as THREE.Mesh | undefined;
    const keeperRightGlove = keeper.getObjectByName("keeper-right-glove") as THREE.Mesh | undefined;

    const lanes: Lane[] = arranged.map((shooter, i) => {
      const laneX = (i - center) * spacing;
      const radius = shooter.isYou ? 0.42 : 0.34;
      const ball = createSoccerBall(radius);
      const restPos = new THREE.Vector3(laneX, radius, restZ);
      ball.position.copy(restPos);
      scene.add(ball);

      const player = buildShooterFigure(shooter.isYou);
      player.position.set(laneX, 0, restZ + 0.78);
      scene.add(player);

      const targetMarker = buildTargetMarker(shooter.isYou);
      targetMarker.position.set(0, 1.42, goalZ + 0.08);
      scene.add(targetMarker);

      const trail = buildShotTrail(shooter.isYou);
      scene.add(trail);

      let ring: THREE.Mesh | null = null;
      if (shooter.isYou) {
        ring = new THREE.Mesh(
          new THREE.RingGeometry(radius + 0.1, radius + 0.2, 40),
          new THREE.MeshBasicMaterial({ color: 0xb7ff4a, transparent: true, opacity: 0.9 }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(laneX, 0.04, restZ);
        scene.add(ring);
      }

      // Deterministic-ish target spread across the mouth, lane by lane.
      const spread = goalW / 2 - 0.9;
      const targetX = ((i + 1) / (count + 1) - 0.5) * 2 * spread;
      targetMarker.position.x = targetX;

      return { id: shooter.id, isYou: shooter.isYou, ball, player, ring, trail, targetMarker, restPos, radius, laneX, targetX };
    });

    // Stadium glow.
    const crowd = new THREE.Group();
    const crowdBaseY: number[] = [];
    const crowdRandom = seededRandom(arranged.map((shooter) => shooter.id).join("|") || "finals");
    for (let index = 0; index < 120; index += 1) {
      const light = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.05, 0.05),
        new THREE.MeshBasicMaterial({ color: index % 4 === 0 ? 0xb7ff4a : 0xeff6ff }),
      );
      const baseY = 3.6 + crowdRandom() * 2.6;
      light.position.set((crowdRandom() - 0.5) * (goalW + 12), baseY, -11 - crowdRandom() * 8);
      crowdBaseY.push(baseY);
      crowd.add(light);
    }
    scene.add(crowd);

    const clock = new THREE.Clock();
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
    let resolveStart = -1;
    let previousPhase = stateRef.current.phase;
    let frame = 0;
    let documentHidden = document.visibilityState === "hidden";
    let offscreen = false;
    let crowdTick = 0;
    let visualElapsed = 0;

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      const compact = isCompactViewport.matches;
      const narrowArena = width / height < 1.05;
      camera.fov = compact ? 55 : narrowArena ? 52 : 44;
      baseCameraPosition.set(0, compact || narrowArena ? 4.05 : 3.7, compact || narrowArena ? 12.9 : 11.6);
      baseCameraTarget.set(0, compact || narrowArena ? 1.02 : 1.1, compact || narrowArena ? -1.25 : -2);
      camera.position.lerp(baseCameraPosition, 0.55);
      cameraTarget.lerp(baseCameraTarget, 0.55);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap()));
      renderer.setSize(width, height, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);

    const shooterForLane = (lane: Lane) =>
      stateRef.current.shooters.find((s) => s.id === lane.id) ??
      (lane.isYou ? stateRef.current.shooters.find((s) => s.isYou) : undefined);
    const buildVisualAttempts = () => {
      return visibleVolleyAttempts(lanes.map(shooterForLane).filter(Boolean) as Shooter[])
        .map<VisualAttempt>((attempt) => ({
          ...attempt,
          laneIndex: lanes.findIndex((lane) => lane.id === attempt.shooter?.id),
        }))
        .filter((attempt) => attempt.laneIndex >= 0);
    };
    const volleySignature = () =>
      stateRef.current.shooters
        .map((shooter) => `${shooter.id}:${shooter.shots}:${shooter.goals}:${shooter.pnlPct.toFixed(4)}`)
        .join("|");
    const tmp = new THREE.Vector3();
    const finalTmp = new THREE.Vector3();
    const playerPose = new THREE.Vector3();
    const playerHomeZ = restZ + 0.78;
    const playerStrikeZ = restZ + 0.18;
    let cachedVolleySignature = "";
    let cachedAttempts: VisualAttempt[] = [];
    let cachedActiveAttemptIdx = -999;
    let cachedLatestAttemptByLane = new Map<number, VisualAttempt>();

    const syncVolleyCache = (resolving: boolean, activeAttemptIdx: number) => {
      if (!resolving) {
        cachedActiveAttemptIdx = -999;
        cachedLatestAttemptByLane.clear();
        return cachedAttempts;
      }

      const signature = volleySignature();
      if (signature !== cachedVolleySignature) {
        cachedVolleySignature = signature;
        cachedAttempts = buildVisualAttempts();
        cachedActiveAttemptIdx = -999;
      }

      if (activeAttemptIdx !== cachedActiveAttemptIdx) {
        cachedActiveAttemptIdx = activeAttemptIdx;
        cachedLatestAttemptByLane = new Map();
        for (let index = 0; index < Math.max(0, activeAttemptIdx); index += 1) {
          const attempt = cachedAttempts[index];
          if (attempt) cachedLatestAttemptByLane.set(attempt.laneIndex, attempt);
        }
      }

      return cachedAttempts;
    };

    const isPaused = () => documentHidden || offscreen;
    const stopAnimation = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };
    const scheduleAnimation = () => {
      if (!frame && !isPaused()) frame = requestAnimationFrame(animate);
    };

    const animate = () => {
      frame = 0;
      if (isPaused()) return;
      const delta = clock.getDelta();
      visualElapsed += Math.min(delta, 0.05);
      if (renderer.domElement.width <= 1) resize();
      const elapsed = visualElapsed;
      const { phase: ph } = stateRef.current;
      const motion = prefersReducedMotion.matches ? 0.2 : 1;

      if (previousPhase !== ph) {
        if (ph === "resolving") resolveStart = elapsed;
        if (ph === "idle" || ph === "trading") resolveStart = -1;
        previousPhase = ph;
      }

      crowdTick += 1;
      if (crowdTick % 3 === 0) {
        crowd.children.forEach((child, i) => {
          child.position.y = crowdBaseY[i] + Math.sin(elapsed * 2.4 + i) * 0.045 * motion;
        });
      }

      const resolving = (ph === "resolving" || ph === "settled") && resolveStart >= 0;
      const since = resolving ? elapsed - resolveStart : -1;
      const shotClock = resolving ? since - VOLLEY_LEAD_IN : -1;
      const activeAttemptIdx = shotClock >= 0 ? Math.floor(shotClock / PER_SHOT) : -1;
      const attempts = syncVolleyCache(resolving, activeAttemptIdx);
      const activeAttempt = attempts[activeAttemptIdx];

      let keeperTargetX = 0;
      let keeperHop = 0;
      let keeperLean = 0;
      let keeperReach = 0;
      let netRipple = 0;

      desiredCameraPosition.copy(baseCameraPosition);
      desiredCameraTarget.copy(baseCameraTarget);
      if (resolving && activeAttempt) {
        const activeLane = lanes[activeAttempt.laneIndex];
        const localSince = shotClock - activeAttemptIdx * PER_SHOT;
        const p = THREE.MathUtils.clamp(localSince / FLIGHT, 0, 1);
        const focusX = activeLane ? THREE.MathUtils.clamp(activeLane.laneX * 0.25 + activeLane.targetX * 0.12, -1.25, 1.25) : 0;
        desiredCameraPosition.set(
          focusX * 0.45,
          baseCameraPosition.y - 0.25 * Math.sin(p * Math.PI),
          baseCameraPosition.z - 1.05 * Math.sin(p * Math.PI),
        );
        desiredCameraTarget.set(focusX, baseCameraTarget.y + 0.12 * Math.sin(p * Math.PI), -2.8);
      } else if (resolving) {
        desiredCameraPosition.set(0, baseCameraPosition.y + 0.12, baseCameraPosition.z - 0.35);
        desiredCameraTarget.set(0, baseCameraTarget.y, -2.6);
      }

      lanes.forEach((lane, i) => {
        const latestAttempt = cachedLatestAttemptByLane.get(i);
        const laneActive = activeAttempt?.laneIndex === i ? activeAttempt : null;
        const markerMaterial = lane.targetMarker.material as THREE.MeshBasicMaterial;
        markerMaterial.opacity = lane.isYou ? 0.26 + Math.sin(elapsed * 2.1) * 0.08 : 0.1;
        lane.targetMarker.scale.setScalar(1);
        setTrail(lane.trail, lane.restPos, lane.ball.position, 0);

        const finalPositionForAttempt = (attempt: VisualAttempt | null | undefined) => {
          if (!attempt || attempt.noKick) return lane.restPos;
          const shotOffset = (attempt.attemptIndex - Math.max(0, (attempt.shooter?.shots ?? 1) - 1) / 2) * 0.34;
          const targetX = THREE.MathUtils.clamp(lane.targetX + shotOffset, -goalW / 2 + 0.55, goalW / 2 - 0.55);
          return attempt.scored
            ? finalTmp.set(targetX, 1.25 + (attempt.attemptIndex % 2) * 0.35, goalZ - 0.55)
            : finalTmp.set(targetX * 0.42, 0.52, keeperZ - 0.1);
        };

        if (resolving && latestAttempt && !laneActive) {
          // Already attempted: settle into the last visible attempt's final position.
          const finalPos = finalPositionForAttempt(latestAttempt);
          lane.ball.position.lerp(finalPos, 0.25);
          lane.ball.rotation.x -= 0.05 * motion;
          markerMaterial.opacity = latestAttempt.scored ? (lane.isYou ? 0.4 : 0.18) : 0.08;
          playerPose.set(lane.laneX, 0, playerStrikeZ);
          lane.player.position.lerp(playerPose, 0.14);
          lane.player.rotation.x = THREE.MathUtils.lerp(lane.player.rotation.x, -0.08, 0.12);
          lane.player.rotation.z = THREE.MathUtils.lerp(lane.player.rotation.z, 0, 0.16);
        } else if (resolving && laneActive && !laneActive.noKick) {
          // Active shot in flight. Multi-shot players reset to the spot for each attempt.
          const localSince = shotClock - activeAttemptIdx * PER_SHOT;
          const p = easeOut(THREE.MathUtils.clamp(localSince / FLIGHT, 0, 1));
          const finalPos = finalPositionForAttempt(laneActive);
          const arcLift = Math.sin(p * Math.PI) * (laneActive.scored ? 0.58 : 0.28);
          lane.ball.position.x = THREE.MathUtils.lerp(lane.laneX, finalPos.x, p);
          lane.ball.position.z = THREE.MathUtils.lerp(restZ, finalPos.z, p);
          lane.ball.position.y = THREE.MathUtils.lerp(lane.radius, finalPos.y, p) + arcLift;
          lane.ball.rotation.x -= 0.45 * motion;
          setTrail(lane.trail, lane.restPos, lane.ball.position, 0.12 + (1 - p) * 0.42);
          markerMaterial.opacity = 0.28 + Math.sin(p * Math.PI) * 0.42;
          lane.targetMarker.scale.setScalar(1 + Math.sin(p * Math.PI) * 0.18);
          lane.player.position.set(
            lane.laneX,
            Math.sin(p * Math.PI * 5) * 0.02 * motion,
            THREE.MathUtils.lerp(playerHomeZ, playerStrikeZ, p),
          );
          lane.player.rotation.x = -0.22 * p * motion;
          lane.player.rotation.z = THREE.MathUtils.clamp((lane.targetX - lane.laneX) * 0.045, -0.28, 0.28) * p;
          // Keeper reacts to the active shot.
          if (p > 0.05) {
            const dir = finalPos.x >= 0 ? 1 : -1;
            keeperTargetX = laneActive.scored ? -dir * Math.min(2.2, Math.abs(finalPos.x) + 0.7) : finalPos.x;
            keeperHop = Math.sin(p * Math.PI) * 0.35;
            keeperLean = (keeperTargetX < 0 ? 1 : -1) * 0.45 * Math.sin(p * Math.PI);
            keeperReach = Math.min(1, Math.abs(keeperTargetX) / 2.2) * Math.sin(p * Math.PI);
            if (laneActive.scored && p > 0.62) netRipple = Math.max(netRipple, Math.sin((p - 0.62) / 0.38 * Math.PI));
          }
        } else if (resolving && laneActive && laneActive.noKick) {
          // Liquidated: no shot, small slump shake.
          lane.ball.position.set(lane.laneX + Math.sin(elapsed * 28) * 0.012 * motion, lane.radius, restZ);
          lane.player.position.set(lane.laneX, 0, playerHomeZ);
          lane.player.rotation.x = THREE.MathUtils.lerp(lane.player.rotation.x, -0.24, 0.1);
          lane.player.rotation.z = Math.sin(elapsed * 20) * 0.025 * motion;
        } else if (resolving && !latestAttempt) {
          // Waiting its turn.
          lane.ball.position.set(lane.laneX, lane.radius + Math.sin(elapsed * 2 + lane.laneX) * 0.012 * motion, restZ);
          lane.ball.rotation.y += (lane.isYou ? 0.01 : 0.006) * motion;
          lane.player.position.set(lane.laneX, Math.sin(elapsed * 1.8 + lane.laneX) * 0.01 * motion, playerHomeZ);
          lane.player.rotation.x = THREE.MathUtils.lerp(lane.player.rotation.x, 0, 0.16);
          lane.player.rotation.z = THREE.MathUtils.lerp(lane.player.rotation.z, 0, 0.16);
        } else {
          // Idle / trading: clean glide home, then gentle bob + spin.
          const homeY = lane.radius + Math.sin(elapsed * 2 + lane.laneX) * 0.015 * motion;
          tmp.set(lane.laneX, homeY, restZ);
          lane.ball.position.lerp(tmp, 0.12);
          lane.ball.rotation.y += (lane.isYou ? 0.01 : 0.006) * motion;
          lane.ball.rotation.x += 0.002 * motion;
          playerPose.set(lane.laneX, Math.sin(elapsed * 1.55 + lane.laneX) * 0.01 * motion, playerHomeZ);
          lane.player.position.lerp(playerPose, 0.12);
          lane.player.rotation.x = THREE.MathUtils.lerp(lane.player.rotation.x, 0, 0.16);
          lane.player.rotation.z = THREE.MathUtils.lerp(lane.player.rotation.z, 0, 0.16);
        }

        if (lane.ring) {
          lane.ring.position.set(lane.laneX, 0.04, restZ);
          (lane.ring.material as THREE.MeshBasicMaterial).opacity = resolving ? 0.22 : 0.9;
        }
      });

      // Keeper motion (snappy dive, smooth return).
      keeper.position.x = THREE.MathUtils.lerp(keeper.position.x, keeperTargetX, 0.2);
      keeper.position.y = THREE.MathUtils.lerp(keeper.position.y, keeperHop, 0.25);
      keeper.rotation.z = THREE.MathUtils.lerp(keeper.rotation.z, keeperLean, 0.2);
      const keeperDiveDirection = keeperTargetX === 0 ? 0 : keeperTargetX > 0 ? 1 : -1;
      if (keeperLeftArm && keeperRightArm && keeperLeftGlove && keeperRightGlove) {
        keeperLeftArm.rotation.z = THREE.MathUtils.lerp(
          keeperLeftArm.rotation.z,
          0.85 + (keeperDiveDirection < 0 ? 0.58 : -0.12) * keeperReach,
          0.18,
        );
        keeperRightArm.rotation.z = THREE.MathUtils.lerp(
          keeperRightArm.rotation.z,
          -0.85 + (keeperDiveDirection > 0 ? -0.58 : 0.12) * keeperReach,
          0.18,
        );
        keeperLeftGlove.position.y = THREE.MathUtils.lerp(
          keeperLeftGlove.position.y,
          1.47 + (keeperDiveDirection < 0 ? 0.34 : 0.03) * keeperReach,
          0.18,
        );
        keeperRightGlove.position.y = THREE.MathUtils.lerp(
          keeperRightGlove.position.y,
          1.47 + (keeperDiveDirection > 0 ? 0.34 : 0.03) * keeperReach,
          0.18,
        );
      }

      goalNetMeshes.forEach((mesh, i) => {
        mesh.position.z = THREE.MathUtils.lerp(
          mesh.position.z,
          (mesh.userData.baseZ as number) + Math.sin(elapsed * 10 + i) * 0.055 * netRipple,
          0.24,
        );
        const material = mesh.material as THREE.MeshBasicMaterial;
        material.opacity = THREE.MathUtils.lerp(material.opacity, (mesh.userData.baseOpacity as number) + netRipple * 0.16, 0.2);
      });

      camera.position.lerp(desiredCameraPosition, 0.075);
      cameraTarget.lerp(desiredCameraTarget, 0.085);
      camera.lookAt(cameraTarget);
      renderer.render(scene, camera);
      scheduleAnimation();
    };
    scheduleAnimation();

    const handleVisibility = () => {
      documentHidden = document.visibilityState === "hidden";
      if (documentHidden) {
        stopAnimation();
        return;
      }
      clock.getDelta();
      scheduleAnimation();
    };

    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", handleVisibility);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      offscreen = entry ? !entry.isIntersecting : false;
      if (offscreen) {
        stopAnimation();
        return;
      }
      clock.getDelta();
      scheduleAnimation();
    }, { threshold: 0.05 });
    intersectionObserver.observe(host);

    return () => {
      stopAnimation();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", handleVisibility);
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          disposeOwnedGeometry(object.geometry);
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach(disposeOwnedMaterial);
        }
      });
    };
  }, []);

  const settledFlash = phase === "settled" ? flashForShooter(shooters.find((s) => s.isYou)) : null;
  const visibleFlash = liveFlash ?? settledFlash;

  return (
    <>
      <div className="arena-scene" ref={hostRef} aria-label="3D penalty arena" />
      {visibleFlash && (
        <div className={`goal-flash ${visibleFlash.className}`} aria-hidden="true">
          <span>{visibleFlash.text}</span>
        </div>
      )}
    </>
  );
}
