/**
 * Procedural environment: gradient sky dome, striped pitch, painted field lines, and a
 * tiered stadium crowd built as a single InstancedMesh (one draw call for hundreds of
 * seats). All generated - no textures. The crowd + fog give depth layering behind the
 * focal action without stealing attention.
 */

import * as THREE from "three";
import { QualitySettings } from "./quality";
import { createPitchMaterial, createSkyMaterial } from "./materials";

const SEAT_PALETTE = [0xb7ff4a, 0x65d8ff, 0xf6b73c, 0xeaf2ff, 0xff5370, 0x8ea7ff];

export class Environment {
  private disposables: Array<{ dispose: () => void }> = [];

  constructor(scene: THREE.Scene, quality: QualitySettings) {
    this.addSky(scene);
    this.addPitch(scene);
    this.addFieldLines(scene);
    this.addCrowd(scene, quality);
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
    const spot = new THREE.Mesh(arc, new THREE.MeshBasicMaterial({ color: 0xb7ff4a, transparent: true, opacity: 0.55 }));
    spot.rotation.x = -Math.PI / 2;
    spot.position.set(0, 0.04, 3.9);
    scene.add(spot);
  }

  private addCrowd(scene: THREE.Scene, quality: QualitySettings) {
    const transforms: { x: number; y: number; z: number }[] = [];
    const arcCount = quality.seatsPerRing;

    // Tiered arc behind the goal, raked up and back per ring.
    for (let ring = 0; ring < quality.seatRings; ring += 1) {
      const radius = 18 + ring * 1.6;
      const y = 1.4 + ring * 1.25;
      for (let i = 0; i < arcCount; i += 1) {
        const t = i / (arcCount - 1);
        const angle = Math.PI * (0.62 + t * 0.76); // wrap around the far end
        transforms.push({ x: Math.cos(angle) * radius, y, z: -6 + Math.sin(angle) * radius });
      }
    }
    // Short side rows for width.
    for (let ring = 0; ring < quality.seatRings; ring += 1) {
      const sideX = 15 + ring * 1.4;
      const y = 1.2 + ring * 1.15;
      for (let i = 0; i < Math.round(arcCount * 0.4); i += 1) {
        const z = 2 - i * 1.1;
        transforms.push({ x: -sideX, y, z });
        transforms.push({ x: sideX, y, z });
      }
    }

    const count = transforms.length;
    const geometry = this.track(new THREE.BoxGeometry(0.5, 0.42, 0.5));
    const material = this.track(new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.0 }));
    const seats = new THREE.InstancedMesh(geometry, material, count);
    seats.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    transforms.forEach((t, i) => {
      dummy.position.set(t.x, t.y, t.z);
      dummy.lookAt(0, t.y, -2);
      dummy.scale.setScalar(0.82 + Math.random() * 0.5);
      dummy.updateMatrix();
      seats.setMatrixAt(i, dummy.matrix);
      const base = SEAT_PALETTE[Math.floor(Math.random() * SEAT_PALETTE.length)];
      color.set(base).multiplyScalar(0.55 + Math.random() * 0.5);
      seats.setColorAt(i, color);
    });
    seats.instanceMatrix.needsUpdate = true;
    if (seats.instanceColor) seats.instanceColor.needsUpdate = true;
    scene.add(seats);
    this.track(seats);
  }

  // Static crowd, so update is a no-op; kept for a uniform Arena interface.
  update(_dt: number, _elapsed: number) {}

  dispose() {
    this.disposables.forEach((item) => item.dispose());
    this.disposables = [];
  }
}
