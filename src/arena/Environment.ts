/**
 * Procedural environment: gradient sky dome, striped pitch, painted field lines, and a
 * tiered stadium crowd. The crowd is two InstancedMeshes (low-poly torsos + heads, one draw
 * call each) so hundreds of fans read as people, not cubes, at the wide camera distance.
 * All generated, no textures.
 *
 * Crowd design (from the art + graphics passes):
 *  - A team-split color tifo: a muted blue-steel home bank and a clay away bank, divided
 *    behind the goal with a blurred seam, plus neutral filler and a few sparse lit accents.
 *    Everything sits darker + cooler than the gold/green focal action so it never competes.
 *  - Alive but subtle: each fan fidgets on its own incoherent phase, with a slow ambient
 *    wave rolling across the bowl. An `excitement` signal (0..1, fed from live trade energy
 *    via setExcitement) lifts the energy when the player is doing well.
 */

import * as THREE from "three";
import { QualitySettings } from "./quality";
import { createGlowSprite, createPitchMaterial, createSkyMaterial } from "./materials";

const AD_MESSAGES = "PENALTY PERPS    ·    TRADE THE CHART    ·    PROFIT EARNS YOUR SHOTS    ·    PAPER ONLY    ·    $PERP    ·    GLOBAL PENALTY CIRCUIT    ·    ";

// Muted, structured kits. Deliberately darker + less saturated than the focal gold #ffc53d /
// green #2fd07a so the stands stay background. Home = blue-steel, away = clay.
const HOME_KIT = [0x3a5a78, 0x2f4860, 0x4d6e8c];
const AWAY_KIT = [0x7a4038, 0x5e2f2a, 0x94544a];
const NEUTRAL = [0x3a3c40, 0x4a4640, 0x52555a];
const ACCENT_HOME = 0x65d8ff; // sparse cyan pop on the home side
const ACCENT_AWAY = 0xffb454; // sparse amber pop on the away side
const HEAD_TONES = [0x6b6258, 0x5d6066]; // desaturated heads, darker than the shirts

type Fan = {
  x: number;
  y: number;
  z: number;
  scale: number;
  phase: number; // idle bob, decorrelated per fan
  swayPhase: number; // lateral sway, decorrelated
  waveCoord: number; // position along the bowl, times the wave front
};

const BOWL_SPAN = 10; // wave travels across t in [0..BOWL_SPAN]

export class Environment {
  private disposables: Array<{ dispose: () => void }> = [];
  private torsos: THREE.InstancedMesh | null = null;
  private heads: THREE.InstancedMesh | null = null;
  private fans: Fan[] = [];
  private dummy = new THREE.Object3D();
  private wavePhase = 0;
  private excitement = 0;
  private excitementTarget = 0;
  private adTexture: THREE.CanvasTexture | null = null;
  private flashes: { sprite: THREE.Sprite; life: number }[] = [];
  private flashTimer = 0;
  private banners: { mesh: THREE.Mesh; phase: number }[] = [];

  constructor(scene: THREE.Scene, quality: QualitySettings) {
    this.addSky(scene);
    this.addPitch(scene);
    this.addFieldLines(scene);
    this.addFloodlights(scene);
    this.addAdBoards(scene);
    this.addCrowd(scene, quality);
    this.addCameraFlashes(scene, quality);
    this.addBanners(scene, quality);
  }

  private track<T extends { dispose: () => void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  private addSky(scene: THREE.Scene) {
    const geometry = this.track(new THREE.SphereGeometry(70, 24, 16));
    const material = this.track(createSkyMaterial());
    scene.add(new THREE.Mesh(geometry, material));
  }

  private addPitch(scene: THREE.Scene) {
    const geometry = this.track(new THREE.PlaneGeometry(46, 42, 1, 1));
    const material = this.track(createPitchMaterial());
    const pitch = new THREE.Mesh(geometry, material);
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.z = -4;
    pitch.receiveShadow = true;
    scene.add(pitch);
  }

  private addFieldLines(scene: THREE.Scene) {
    const material = this.track(
      new THREE.LineBasicMaterial({ color: 0xdfffe8, transparent: true, opacity: 0.32 }),
    );
    const box = (w: number, d: number, z: number) => {
      const geo = this.track(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.02, d)));
      const seg = new THREE.LineSegments(geo, material);
      seg.position.set(0, 0.03, z);
      scene.add(seg);
    };
    box(15, 7, -8.6); // penalty box
    box(7.5, 3, -10.4); // six-yard box

    const arc = this.track(new THREE.RingGeometry(0.32, 0.4, 36));
    const spot = new THREE.Mesh(arc, new THREE.MeshBasicMaterial({ color: 0xffc53d, transparent: true, opacity: 0.55 }));
    spot.rotation.x = -Math.PI / 2;
    spot.position.set(0, 0.04, 3.9);
    scene.add(spot);
  }

  /** Low-frequency value over a seat position so colors cluster into pockets, not noise. */
  private pocket(x: number, z: number): number {
    return Math.sin(x * 0.45) * 0.6 + Math.cos(z * 0.5 + 1.3) * 0.4;
  }

  private addCrowd(scene: THREE.Scene, quality: QualitySettings) {
    // Seat anchors: a tiered arc wrapping behind the goal + steep side rows for width.
    const seats: { x: number; y: number; z: number; t: number; coord: number; side: boolean }[] = [];
    const arcCount = quality.seatsPerRing;

    for (let ring = 0; ring < quality.seatRings; ring += 1) {
      const radius = 18 + ring * 1.6;
      const y = 1.4 + ring * 1.25;
      for (let i = 0; i < arcCount; i += 1) {
        const t = i / (arcCount - 1);
        const angle = Math.PI * (0.58 + t * 0.84); // wrap around the far end
        seats.push({ x: Math.cos(angle) * radius, y, z: -6 + Math.sin(angle) * radius, t, coord: t * BOWL_SPAN, side: false });
      }
    }
    for (let ring = 0; ring < quality.seatRings; ring += 1) {
      const sideX = 15 + ring * 1.4;
      const y = 1.2 + ring * 1.15;
      for (let i = 0; i < Math.round(arcCount * 0.4); i += 1) {
        const z = 2 - i * 1.1;
        seats.push({ x: -sideX, y, z, t: 0, coord: -2, side: true });
        seats.push({ x: sideX, y, z, t: 1, coord: BOWL_SPAN + 2, side: true });
      }
    }

    const count = seats.length;
    const torsoGeo = this.track(new THREE.CylinderGeometry(0.16, 0.26, 0.5, 6, 1));
    const headGeo = this.track(new THREE.SphereGeometry(0.12, 6, 5));
    headGeo.translate(0, 0.42, 0); // sit the head on the shoulders (shares the fan matrix)
    const torsoMat = this.track(new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 }));
    const headMat = this.track(new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 }));

    const torsos = new THREE.InstancedMesh(torsoGeo, torsoMat, count);
    const heads = new THREE.InstancedMesh(headGeo, headMat, count);
    torsos.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    seats.forEach((s, i) => {
      const scale = 0.82 + Math.random() * 0.5;
      this.fans.push({
        x: s.x,
        y: s.y,
        z: s.z,
        scale,
        phase: Math.random() * Math.PI * 2,
        swayPhase: Math.random() * Math.PI * 2,
        waveCoord: s.coord,
      });

      dummy.position.set(s.x, s.y, s.z);
      dummy.lookAt(0, s.y, -2); // whole bowl faces the penalty spot
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      torsos.setMatrixAt(i, dummy.matrix);
      heads.setMatrixAt(i, dummy.matrix);

      // Team split with a jittered seam; side rows stay neutral. Pockets cluster shades.
      const home = s.side ? false : s.t < 0.5 + (Math.random() - 0.5) * 0.08;
      const accentRoll = Math.random();
      let hex: number;
      if (!s.side && accentRoll < 0.045) {
        hex = home ? ACCENT_HOME : ACCENT_AWAY; // sparse lit pop
      } else {
        const p = this.pocket(s.x, s.z);
        const neutral = s.side || Math.random() < 0.18;
        const kit = neutral ? NEUTRAL : home ? HOME_KIT : AWAY_KIT;
        const shade = p > 0.3 ? kit[2] : p < -0.3 ? kit[1] : kit[0];
        hex = shade;
      }
      // Tier fade: lift toward dark as rows climb so the back melts into the sky.
      const fade = 0.5 + Math.random() * 0.42;
      color.set(hex).multiplyScalar(fade);
      torsos.setColorAt(i, color);
      color.set(HEAD_TONES[(Math.random() * HEAD_TONES.length) | 0]).multiplyScalar(0.7 + Math.random() * 0.3);
      heads.setColorAt(i, color);
    });

    torsos.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    if (torsos.instanceColor) torsos.instanceColor.needsUpdate = true;
    if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
    scene.add(torsos, heads);
    this.torsos = this.track(torsos);
    this.heads = this.track(heads);
  }

  /** Four corner floodlight pylons: a dark mast, a bright lamp bank, and an additive bloom. */
  private addFloodlights(scene: THREE.Scene) {
    const poleGeo = this.track(new THREE.CylinderGeometry(0.22, 0.34, 16, 8));
    const poleMat = this.track(new THREE.MeshStandardMaterial({ color: 0x20262b, roughness: 0.6, metalness: 0.7 }));
    const bankGeo = this.track(new THREE.BoxGeometry(2.6, 1.3, 0.3));
    const bankMat = this.track(new THREE.MeshBasicMaterial({ color: 0xfdf6e3, toneMapped: false }));
    const corners: [number, number][] = [
      [-17, -16],
      [17, -16],
      [-19, 5],
      [19, 5],
    ];
    for (const [x, z] of corners) {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(x, 8, z);
      scene.add(pole);

      const bank = new THREE.Mesh(bankGeo, bankMat);
      bank.position.set(x, 16, z);
      bank.lookAt(0, 4, -4); // aim the lamp bank at the pitch
      scene.add(bank);

      const glow = createGlowSprite(0xfff4d6, 5.2);
      glow.position.set(x, 16, z);
      (glow.material as THREE.SpriteMaterial).opacity = 0.85;
      scene.add(glow);
    }
  }

  /** Pitch-side LED advertising boards with scrolling crypto/game flavor (one shared texture). */
  private addAdBoards(scene: THREE.Scene) {
    const canvas = document.createElement("canvas");
    canvas.width = 2048;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#0a0f12";
      ctx.fillRect(0, 0, 2048, 128);
      ctx.font = "700 64px IBM Plex Mono, ui-monospace, monospace";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      // Tile the message across the strip; alternate gold/cyan words for an LED feel.
      const words = AD_MESSAGES.split("·");
      let x = 0;
      let pass = 0;
      while (x < 2048) {
        for (const word of words) {
          ctx.fillStyle = pass % 2 === 0 ? "#ffc53d" : "#65d8ff";
          ctx.fillText(word.trim(), x, 70);
          x += ctx.measureText(word.trim()).width + 60;
          pass += 1;
        }
      }
    }
    const texture = this.track(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(3, 1);
    this.adTexture = texture;
    const mat = this.track(new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, transparent: true }));
    const geo = this.track(new THREE.PlaneGeometry(12, 0.7));

    const left = new THREE.Mesh(geo, mat);
    left.position.set(-8, 0.45, -3);
    left.rotation.y = Math.PI / 2; // face inward (+X)
    scene.add(left);

    const right = new THREE.Mesh(geo, mat);
    right.position.set(8, 0.45, -3);
    right.rotation.y = -Math.PI / 2; // face inward (-X)
    scene.add(right);

    const backGeo = this.track(new THREE.PlaneGeometry(11, 0.8));
    const back = new THREE.Mesh(backGeo, mat);
    back.position.set(0, 1.0, -11.4); // behind the goal, visible above the net
    scene.add(back);
  }

  /** A pool of additive sparkles in the stands that randomly pop, like crowd camera flashes. */
  private addCameraFlashes(scene: THREE.Scene, quality: QualitySettings) {
    const count = quality.tier === "high" ? 26 : quality.tier === "medium" ? 16 : 0;
    for (let i = 0; i < count; i += 1) {
      const angle = Math.PI * (0.6 + Math.random() * 0.8);
      const radius = 18 + Math.random() * 6;
      const y = 1.6 + Math.random() * 5;
      const sprite = createGlowSprite(0xffffff, 0.6 + Math.random() * 0.4);
      sprite.position.set(Math.cos(angle) * radius, y, -6 + Math.sin(angle) * radius);
      (sprite.material as THREE.SpriteMaterial).opacity = 0;
      scene.add(sprite);
      this.flashes.push({ sprite, life: 0 });
    }
  }

  /** Hanging team banners around the lower stands (the festive flags), with a gentle twist. */
  private addBanners(scene: THREE.Scene, quality: QualitySettings) {
    if (quality.tier === "low") return;
    const COLORS = [0x2fd07a, 0x43c7c0, 0xffc53d, 0x4d6e8c, 0xc56a3a, 0xeaf2ff];
    const geo = this.track(new THREE.PlaneGeometry(1.3, 3.4));
    const count = quality.tier === "high" ? 14 : 9;
    for (let i = 0; i < count; i += 1) {
      const t = i / (count - 1);
      const angle = Math.PI * (0.56 + t * 0.88); // wrap the bowl behind + around the goal
      const radius = 16.5;
      const y = 3.6;
      const mat = this.track(
        new THREE.MeshStandardMaterial({
          color: COLORS[i % COLORS.length],
          emissive: COLORS[i % COLORS.length],
          emissiveIntensity: 0.18,
          roughness: 0.65,
          metalness: 0,
          side: THREE.DoubleSide,
        }),
      );
      // A facing pivot holds the banner upright toward the action; the banner twists within it.
      const pivot = new THREE.Group();
      pivot.position.set(Math.cos(angle) * radius, y, -6 + Math.sin(angle) * radius);
      pivot.lookAt(0, y, -2);
      const mesh = new THREE.Mesh(geo, mat);
      pivot.add(mesh);
      scene.add(pivot);
      this.banners.push({ mesh, phase: Math.random() * Math.PI * 2 });
    }
  }

  /** Live trade energy, 0..1. Lifts crowd bob, wave speed, and reach. Smoothed in update. */
  setExcitement(value: number) {
    this.excitementTarget = Math.max(0, Math.min(1, value));
  }

  /** Restless crowd: incoherent idle bob + lateral sway + a slow wave that rolls the bowl. */
  update(dt: number, elapsed: number) {
    this.excitement += (this.excitementTarget - this.excitement) * Math.min(1, dt * 3);
    const ex = this.excitement;

    // Scrolling LED ad boards.
    if (this.adTexture) this.adTexture.offset.x = (this.adTexture.offset.x + dt * 0.05) % 1;

    // Crowd camera flashes: pop a random sparkle on a cadence that quickens when excited.
    if (this.flashes.length > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        const f = this.flashes[(Math.random() * this.flashes.length) | 0];
        f.life = 0.16;
        this.flashTimer = 0.32 - ex * 0.22 + Math.random() * 0.15;
      }
      for (const f of this.flashes) {
        if (f.life > 0) {
          f.life = Math.max(0, f.life - dt);
          (f.sprite.material as THREE.SpriteMaterial).opacity = (f.life / 0.16) * 0.9;
        }
      }
    }

    // Banners twist gently, more lively when the trade is hot.
    for (let i = 0; i < this.banners.length; i += 1) {
      const b = this.banners[i];
      b.mesh.rotation.y = Math.sin(elapsed * 1.1 + b.phase) * (0.12 + ex * 0.12);
    }

    const torsos = this.torsos;
    const heads = this.heads;
    if (!torsos || !heads) return;

    const bobAmp = 0.045 * (1 + 0.9 * ex);
    const waveSpeed = 1.3 + ex * 1.7;
    const waveLift = 0.18 + ex * 0.4;
    this.wavePhase = (this.wavePhase + dt * waveSpeed) % (BOWL_SPAN + 4);

    const d = this.dummy;
    for (let i = 0; i < this.fans.length; i += 1) {
      const f = this.fans[i];
      const bob = Math.sin(elapsed * 2.1 + f.phase) * bobAmp;
      const sway = Math.sin(elapsed * 1.3 + f.swayPhase) * 0.03;
      let p = 1 - Math.abs(this.wavePhase - f.waveCoord) / 2.4;
      p = p > 0 ? p * p * (3 - 2 * p) : 0; // smoothstep the wave front
      const y = f.y + bob + p * waveLift;
      d.position.set(f.x + sway, y, f.z);
      d.lookAt(0, y, -2);
      d.scale.setScalar(f.scale);
      d.updateMatrix();
      torsos.setMatrixAt(i, d.matrix);
      heads.setMatrixAt(i, d.matrix);
    }
    torsos.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.disposables.forEach((item) => item.dispose());
    this.disposables = [];
    this.torsos = null;
    this.heads = null;
    this.fans = [];
    this.flashes = [];
    this.banners = [];
    this.adTexture = null;
  }
}
