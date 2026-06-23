/**
 * Object-pooled confetti, drawn as a single InstancedMesh. Particles are preallocated
 * once and recycled - no per-burst allocation, no GC churn. Inactive particles are
 * parked at zero scale. Used for goal celebrations.
 */

import * as THREE from "three";

type Particle = {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: number;
  spin: number;
  life: number;
  maxLife: number;
  scale: number;
  grav: number; // gravity scale: 1 for confetti, near 0 for floaty embers
};

const GRAVITY = -9.5;
export const GOAL_COLORS = [0x2fd07a, 0xffc53d, 0xffffff, 0x5fe39c, 0xffd970];
export const SAVE_COLORS = [0xff5247, 0x9aa3ad, 0xd8dde4];

export class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  private particles: Particle[];
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();

  constructor(scene: THREE.Scene, capacity: number) {
    const geometry = new THREE.BoxGeometry(0.12, 0.12, 0.02);
    const material = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.particles = Array.from({ length: capacity }, () => ({
      active: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      rot: 0,
      spin: 0,
      life: 0,
      maxLife: 1,
      scale: 1,
      grav: 1,
    }));

    // Park everything off-screen at zero scale.
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < capacity; i += 1) this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);
  }

  /**
   * Spawn a burst at a point. Reuses inactive slots; ignores overflow.
   * `palette` colors the burst; `spread` scales the launch velocity (goal = a tall
   * fountain, save = a small low puff).
   */
  burst(origin: THREE.Vector3, count: number, palette: number[] = GOAL_COLORS, spread = 1) {
    let spawned = 0;
    for (const particle of this.particles) {
      if (spawned >= count) break;
      if (particle.active) continue;
      particle.active = true;
      particle.grav = 1;
      particle.pos.copy(origin);
      particle.vel.set(
        (Math.random() - 0.5) * 4.5 * spread,
        (4 + Math.random() * 4.5) * spread,
        (Math.random() - 0.5) * 4.5 * spread,
      );
      particle.rot = Math.random() * Math.PI;
      particle.spin = (Math.random() - 0.5) * 12;
      particle.maxLife = 0.9 + Math.random() * 0.7;
      particle.life = particle.maxLife;
      particle.scale = 0.7 + Math.random() * 0.8;
      const index = this.particles.indexOf(particle);
      this.color.set(palette[Math.floor(Math.random() * palette.length)]);
      this.mesh.setColorAt(index, this.color);
      spawned += 1;
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Spawn one slow, floaty ember that drifts upward and fades. Used for the winning mood. */
  ember(origin: THREE.Vector3, hex = 0xffc53d) {
    for (const particle of this.particles) {
      if (particle.active) continue;
      particle.active = true;
      particle.grav = 0.04; // nearly weightless, keeps drifting up
      particle.pos.copy(origin);
      particle.vel.set((Math.random() - 0.5) * 0.5, 0.8 + Math.random() * 0.7, (Math.random() - 0.5) * 0.5);
      particle.rot = Math.random() * Math.PI;
      particle.spin = (Math.random() - 0.5) * 3;
      particle.maxLife = 1.6 + Math.random() * 1.0;
      particle.life = particle.maxLife;
      particle.scale = 0.32 + Math.random() * 0.3;
      const index = this.particles.indexOf(particle);
      this.color.set(hex);
      this.mesh.setColorAt(index, this.color);
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
      return;
    }
  }

  update(dt: number) {
    let dirty = false;
    this.particles.forEach((particle, index) => {
      if (!particle.active) return;
      dirty = true;
      particle.life -= dt;
      if (particle.life <= 0) {
        particle.active = false;
        this.dummy.scale.setScalar(0);
        this.dummy.position.set(0, -999, 0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(index, this.dummy.matrix);
        return;
      }
      particle.vel.y += GRAVITY * particle.grav * dt;
      particle.pos.addScaledVector(particle.vel, dt);
      particle.rot += particle.spin * dt;

      const fade = Math.min(1, particle.life / (particle.maxLife * 0.4));
      this.dummy.position.copy(particle.pos);
      this.dummy.rotation.set(particle.rot, particle.rot * 0.7, particle.rot * 1.3);
      this.dummy.scale.setScalar(particle.scale * fade);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(index, this.dummy.matrix);
    });
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
