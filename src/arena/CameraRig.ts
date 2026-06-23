/**
 * Camera controller. Holds the perspective camera and damps it between named framings
 * so the player's eye is always led to the right place: a calm wide shot while trading,
 * a tighter push-in during the volley. A gentle idle sway keeps the frame alive.
 */

import * as THREE from "three";

export type CameraFraming = "wide" | "volley";

type Framing = { position: THREE.Vector3; target: THREE.Vector3; fov: number };

const FRAMINGS: Record<CameraFraming, Framing> = {
  wide: { position: new THREE.Vector3(0, 4.1, 12.2), target: new THREE.Vector3(0, 1.1, -2), fov: 44 },
  volley: { position: new THREE.Vector3(0, 3.2, 9.4), target: new THREE.Vector3(0, 1.4, -4), fov: 40 },
};

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private desiredPos = new THREE.Vector3();
  private desiredTarget = new THREE.Vector3();
  private currentTarget = new THREE.Vector3();
  private desiredFov: number;
  private punchAmount = 0; // decaying impulse that pushes the camera in on a goal
  private mood = 0;
  private moodTarget = 0;

  constructor(aspect: number) {
    const base = FRAMINGS.wide;
    this.camera = new THREE.PerspectiveCamera(base.fov, aspect, 0.1, 120);
    this.camera.position.copy(base.position);
    this.desiredPos.copy(base.position);
    this.desiredTarget.copy(base.target);
    this.currentTarget.copy(base.target);
    this.desiredFov = base.fov;
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  focus(framing: CameraFraming) {
    const next = FRAMINGS[framing];
    this.desiredPos.copy(next.position);
    this.desiredTarget.copy(next.target);
    this.desiredFov = next.fov;
  }

  /** Kick the camera in toward the net for a beat. Fired when a goal lands. */
  punch(strength = 1) {
    this.punchAmount = Math.min(1.2, this.punchAmount + strength);
  }

  /** Stadium mood, -1..1. Subtly tightens the lens on a win, widens it on a loss. */
  setMood(value: number) {
    this.moodTarget = Math.max(-1, Math.min(1, value));
  }

  update(dt: number, elapsed: number) {
    // Frame-rate independent damping.
    const k = 1 - Math.pow(0.0015, dt);
    // Goal punch: a short-lived push-in + slight zoom + handheld shake that decays out.
    this.punchAmount = Math.max(0, this.punchAmount - dt * 2.6);
    const punch = this.punchAmount;
    this.mood += (this.moodTarget - this.mood) * (1 - Math.pow(0.05, dt));
    // Subtle idle sway so a still scene never feels frozen; the shake rides on top of it.
    const swayX = Math.sin(elapsed * 0.25) * 0.25 + Math.sin(elapsed * 26) * 0.05 * punch;
    const swayY = Math.cos(elapsed * 0.2) * 0.12 + punch * 0.16;

    this.camera.position.x += (this.desiredPos.x + swayX - this.camera.position.x) * k;
    this.camera.position.y += (this.desiredPos.y + swayY - this.camera.position.y) * k;
    this.camera.position.z += (this.desiredPos.z - punch * 1.7 - this.camera.position.z) * k;

    this.currentTarget.x += (this.desiredTarget.x - this.currentTarget.x) * k;
    this.currentTarget.y += (this.desiredTarget.y - this.currentTarget.y) * k;
    this.currentTarget.z += (this.desiredTarget.z - this.currentTarget.z) * k;
    this.camera.lookAt(this.currentTarget);

    const targetFov = this.desiredFov - punch * 5 - this.mood * 1.6;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov += (targetFov - this.camera.fov) * k;
      this.camera.updateProjectionMatrix();
    }
  }
}
