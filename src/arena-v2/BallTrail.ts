/**
 * BallTrail: a comet-style ribbon that follows the ball.
 *
 * Built on meshline so the ribbon keeps a constant screen-space width and
 * tapers from a fat head down to a thin tail. The trail keeps a short ring
 * buffer of recent ball world positions and rebuilds the geometry every frame.
 *
 * Visual treatment matches the v2 "Blue Lock Electric" look: additive blending
 * on a cyan rim color so the streak glows over the dark indigo pitch.
 */
import * as THREE from "three";
import { MeshLineGeometry, MeshLineMaterial } from "meshline";
import { PAL } from "./palette";

export interface BallTrailOptions {
  color?: THREE.ColorRepresentation;
  /** Ribbon width at the head, in world units. */
  width?: number;
  /** Number of positions kept in the ring buffer. */
  length?: number;
}

const DEFAULT_LENGTH = 20;
const DEFAULT_WIDTH = 0.12;

/** How quickly the trail fades out once it goes inactive (per-second factor). */
const FADE_SPEED = 6;
/** How quickly it fades back in once active. */
const RISE_SPEED = 12;

export class BallTrail {
  private readonly scene: THREE.Scene;
  private readonly geometry: MeshLineGeometry;
  private readonly material: MeshLineMaterial;
  private readonly mesh: THREE.Mesh;

  private readonly maxPoints: number;
  private readonly headWidth: number;

  /** Ring buffer of recent positions, oldest first (tail) to newest last (head). */
  private readonly buffer: THREE.Vector3[] = [];

  /** Eased opacity target driven by the active flag. */
  private opacity = 0;

  private disposed = false;

  constructor(scene: THREE.Scene, opts: BallTrailOptions = {}) {
    this.scene = scene;
    this.maxPoints = Math.max(2, Math.floor(opts.length ?? DEFAULT_LENGTH));
    this.headWidth = opts.width ?? DEFAULT_WIDTH;

    const color = new THREE.Color(opts.color ?? PAL.rim);

    this.geometry = new MeshLineGeometry();

    this.material = new MeshLineMaterial({
      color,
      lineWidth: this.headWidth,
      // resolution is required by the material; the actual numbers do not
      // matter for sizeAttenuation:1 (world-space width), but the uniform
      // must exist so the shader compiles.
      resolution: new THREE.Vector2(1, 1),
      sizeAttenuation: 1,
      opacity: 0,
    });
    this.material.transparent = true;
    this.material.depthWrite = false;
    this.material.depthTest = true;
    this.material.blending = THREE.AdditiveBlending;
    this.material.opacity = 0;

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    // The geometry rebuilds in world space, so keep the mesh at the origin.
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;

    this.scene.add(this.mesh);
  }

  /** Swap the ribbon color at runtime. */
  setColor(c: THREE.ColorRepresentation): void {
    this.material.color = new THREE.Color(c);
  }

  /**
   * Advance the trail one frame.
   *
   * When active we push the latest ball position and rebuild the ribbon. When
   * inactive we ease opacity toward zero and stop adding points; once fully
   * faded we clear the buffer so the next activation does not snap a long line
   * across the old and new positions.
   *
   * @param ballPos current ball world position
   * @param active  whether the ball is in flight and should leave a trail
   * @param dt      seconds since the last frame (defaults to a 60fps step)
   */
  update(ballPos: THREE.Vector3, active: boolean, dt = 1 / 60): void {
    if (this.disposed) return;

    if (active) {
      this.push(ballPos);
      this.opacity = Math.min(1, this.opacity + RISE_SPEED * dt);
    } else {
      this.opacity = Math.max(0, this.opacity - FADE_SPEED * dt);
      if (this.opacity <= 0.001) {
        this.opacity = 0;
        this.clear();
      }
    }

    this.material.opacity = this.opacity;
    this.material.lineWidth = this.headWidth;

    const renderable = this.opacity > 0 && this.buffer.length >= 2;
    this.mesh.visible = renderable;

    if (renderable) {
      this.rebuild();
    }
  }

  /** Remove from scene and free GPU resources. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.buffer.length = 0;
  }

  private push(p: THREE.Vector3): void {
    // Avoid stacking duplicate points; a zero-length segment makes meshline
    // produce a degenerate quad.
    const last = this.buffer[this.buffer.length - 1];
    if (last && last.distanceToSquared(p) < 9e-4) {
      // Too close to the last point: a coincident segment makes meshline emit NaN normals.
      last.copy(p);
      return;
    }
    this.buffer.push(p.clone());
    if (this.buffer.length > this.maxPoints) {
      this.buffer.shift();
    }
  }

  private clear(): void {
    this.buffer.length = 0;
  }

  private rebuild(): void {
    // meshline needs at least two points to build a ribbon.
    if (this.buffer.length < 2) return;

    // Pass a flat number[] (meshline v3 is more robust with this than Vector3[]).
    // The width callback tapers: p runs 0 (tail) to 1 (head) for the comet look.
    const flat: number[] = [];
    for (const v of this.buffer) flat.push(v.x, v.y, v.z);
    this.geometry.setPoints(flat, (p: number) => taper(p));
  }
}

/**
 * Width multiplier along the ribbon. p is 0 at the tail and 1 at the head.
 * Eased so the head stays full width and the tail pinches off smoothly.
 */
function taper(p: number): number {
  // Smooth ramp from a near-zero tail up to full width at the head.
  const eased = p * p * (3 - 2 * p); // smoothstep
  return 0.04 + 0.96 * eased;
}
