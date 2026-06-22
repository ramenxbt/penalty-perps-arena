/**
 * Arena: owns the focal actors (balls, one keeper, the goal) and the celebration
 * particles, and drives the whole round animation from game state. Timing comes from
 * game/volley.ts so the visuals stay locked to the audio and the settle delay.
 *
 * Visual flow: a calm wide framing while idle/trading keeps the eye on the trade dock;
 * when the volley resolves the camera pushes in and the balls fire one at a time, the
 * keeper dives, and a scored ball pops confetti - so the player always knows where to look.
 */

import * as THREE from "three";
import { RoundPhase, Shooter } from "../game/types";
import { arrangeShooters, FLIGHT_MS, SHOT_BEAT_MS, VOLLEY_LEAD_IN_MS } from "../game/volley";
import { CameraRig } from "./CameraRig";
import { createCritter, critterKindForIndex } from "./Critter";
import { createGoal } from "./Goal";
import { createKeeper } from "./Keeper";
import { createGlowSprite, createSoccerBall } from "./materials";
import { GOAL_COLORS, ParticlePool, SAVE_COLORS } from "./ParticlePool";
import { QualitySettings } from "./quality";
import { Scoreboard, ScoreboardData } from "./Scoreboard";

export type ArenaState = { phase: RoundPhase; shooters: Shooter[]; hud?: ScoreboardData };

type Lane = {
  id: string;
  isYou: boolean;
  ball: THREE.Mesh;
  critter: THREE.Group;
  ring: THREE.Mesh | null;
  glow: THREE.Sprite | null;
  radius: number;
  laneX: number;
  targetX: number;
};

// Cohesive, muted palette so co-shooters harmonize instead of clashing; "you" always
// takes the bright brand green so the focal character clearly stands out.
const CRITTER_COLORS = [0x6f86b6, 0x57b89a, 0xc28a5a, 0x8b8fa6, 0x6da0a8];

const REST_Z = 3.9;
const GOAL_Z = -8.6;
const GOAL_H = 3.4;
const GOAL_DEPTH = 1.9;
const KEEPER_Z = GOAL_Z + 0.75;
const SPACING = 1.2;

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export class Arena {
  private lanes: Lane[];
  private keeper: THREE.Group;
  private keeperBaseScale = 1.45;
  private particles: ParticlePool;
  private scoreboard: Scoreboard;
  private shotFlash!: THREE.Sprite;
  private tmp = new THREE.Vector3();

  private resolveStart = -1;
  private previousPhase: RoundPhase = "idle";
  // Shots whose result effect (confetti / save puff / flash) has already fired this round.
  private resolved = new Set<string>();
  private flashStrength = 0;
  private keeperPulseAt = -10;

  constructor(scene: THREE.Scene, quality: QualitySettings, initial: Shooter[]) {
    const arranged = arrangeShooters(initial.length ? initial : [{ id: "me", name: "@you", isYou: true, isAi: false, pnlPct: 0, shots: 0, goals: 0, openness: 0 }]);
    const count = Math.max(1, arranged.length);
    const center = Math.max(0, arranged.findIndex((s) => s.isYou));
    const goalW = Math.max(6.4, (count - 1) * SPACING + 4.5);

    scene.add(createGoal(goalW, GOAL_H, GOAL_DEPTH).translateZ(GOAL_Z));

    this.keeper = createKeeper();
    this.keeperBaseScale = this.keeper.scale.x;
    this.keeper.position.set(0, 0, KEEPER_Z);
    scene.add(this.keeper);

    // A bright additive flash at the goal mouth: green for a goal, red for a save.
    // One reused sprite is enough since shots resolve one at a time.
    this.shotFlash = createGlowSprite(0xffffff, 2.4);
    (this.shotFlash.material as THREE.SpriteMaterial).opacity = 0;
    this.shotFlash.position.set(0, 1.3, GOAL_Z + 0.3);
    scene.add(this.shotFlash);

    this.lanes = arranged.map((shooter, i) => {
      const laneX = (i - center) * SPACING;
      const radius = shooter.isYou ? 0.27 : 0.22;
      const ball = createSoccerBall(radius);
      ball.position.set(laneX, radius, REST_Z);
      scene.add(ball);

      // A cute critter stands just behind its ball, facing the camera.
      const critter = createCritter({
        kind: critterKindForIndex(i),
        color: shooter.isYou ? 0xb7ff4a : CRITTER_COLORS[i % CRITTER_COLORS.length],
      });
      critter.scale.setScalar(shooter.isYou ? 0.96 : 0.78);
      critter.position.set(laneX, 0, REST_Z + 0.62);
      scene.add(critter);

      let ring: THREE.Mesh | null = null;
      let glow: THREE.Sprite | null = null;
      if (shooter.isYou) {
        ring = new THREE.Mesh(
          new THREE.RingGeometry(0.4, 0.52, 40),
          new THREE.MeshBasicMaterial({ color: 0xb7ff4a, transparent: true, opacity: 0.9, toneMapped: false }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(laneX, 0.04, REST_Z + 0.5);
        scene.add(ring);
        if (quality.glow) {
          glow = createGlowSprite(0xb7ff4a, 1.6);
          glow.position.set(laneX, 0.5, REST_Z + 0.62);
          scene.add(glow);
        }
      }

      const spread = goalW / 2 - 0.9;
      const targetX = ((i + 1) / (count + 1) - 0.5) * 2 * spread;
      return { id: shooter.id, isYou: shooter.isYou, ball, critter, ring, glow, radius, laneX, targetX };
    });

    this.particles = new ParticlePool(scene, quality.particleCount);
    this.scoreboard = new Scoreboard(scene);
  }

  update(dt: number, elapsedSec: number, state: ArenaState, rig: CameraRig) {
    const { phase, shooters } = state;
    if (state.hud) this.scoreboard.update(state.hud);

    if (phase !== this.previousPhase) {
      if (phase === "resolving") {
        this.resolveStart = elapsedSec;
        this.resolved.clear();
      }
      if (phase === "idle" || phase === "trading" || phase === "opening") this.resolveStart = -1;
      // Rack a clean slate the instant a new round opens (or on a manual reset): snap every
      // ball, critter, and the keeper back to their spots so nothing drifts in from the net.
      if (phase === "opening" || phase === "idle") this.resetActors();
      this.previousPhase = phase;
    }

    rig.focus(phase === "resolving" || phase === "settled" ? "volley" : "wide");

    const resolving = (phase === "resolving" || phase === "settled") && this.resolveStart >= 0;
    const sinceMs = resolving ? (elapsedSec - this.resolveStart) * 1000 : -1;
    const homeK = 1 - Math.pow(0.0009, dt);

    let keeperTargetX = 0;
    let keeperHop = 0;
    let keeperLean = 0;

    this.lanes.forEach((lane, i) => {
      const shooter = shooters.find((s) => s.id === lane.id);
      const scored = !!shooter && shooter.goals > 0;
      const noKick = !shooter || shooter.shots <= 0;
      const shotAtMs = VOLLEY_LEAD_IN_MS + i * SHOT_BEAT_MS;
      const p = resolving ? easeOut(clamp01((sinceMs - shotAtMs) / FLIGHT_MS)) : 0;

      if (resolving && !noKick && sinceMs >= shotAtMs) {
        if (scored) {
          // Straight into the back of the net.
          lane.ball.position.x = THREE.MathUtils.lerp(lane.laneX, lane.targetX, p);
          lane.ball.position.z = THREE.MathUtils.lerp(REST_Z, GOAL_Z - 0.55, p);
          lane.ball.position.y = THREE.MathUtils.lerp(lane.radius, 1.45, Math.sin(p * Math.PI * 0.5));
        } else if (p < 0.5) {
          // First half: in to the keeper.
          const a = p / 0.5;
          lane.ball.position.x = THREE.MathUtils.lerp(lane.laneX, lane.targetX * 0.5, a);
          lane.ball.position.z = THREE.MathUtils.lerp(REST_Z, KEEPER_Z, a);
          lane.ball.position.y = THREE.MathUtils.lerp(lane.radius, 1.0, Math.sin(a * Math.PI * 0.5));
        } else {
          // Second half: deflected back out toward the camera, so a block is unmistakable.
          const b = (p - 0.5) / 0.5;
          lane.ball.position.x = THREE.MathUtils.lerp(lane.targetX * 0.5, lane.targetX * 1.4, b);
          lane.ball.position.z = THREE.MathUtils.lerp(KEEPER_Z, -1.4, b);
          lane.ball.position.y = 1.0 * (1 - b) + 0.32 + Math.sin(b * Math.PI) * 0.85;
        }
        lane.ball.rotation.x -= 0.26;

        // The actively-flying shot drives the keeper: dive away on a goal, meet the ball on a save.
        if (p > 0.04 && p < 1) {
          const dir = lane.targetX >= 0 ? 1 : -1;
          keeperTargetX = scored ? -dir * Math.min(2.2, Math.abs(lane.targetX) + 0.7) : lane.targetX;
          keeperHop = Math.sin(p * Math.PI) * (scored ? 0.35 : 0.5);
          keeperLean = (keeperTargetX < 0 ? 1 : -1) * 0.45 * Math.sin(p * Math.PI);
        }

        // Fire the result effect once, the instant the shot reaches the line.
        if (p >= 0.85 && !this.resolved.has(lane.id)) {
          this.resolved.add(lane.id);
          const flashX = scored ? lane.targetX : lane.targetX * 0.5;
          this.shotFlash.position.set(flashX, 1.3, GOAL_Z + 0.3);
          (this.shotFlash.material as THREE.SpriteMaterial).color.set(scored ? 0xb7ff4a : 0xff5370);
          this.flashStrength = 1;
          if (scored) {
            this.tmp.set(lane.targetX, 1.45, GOAL_Z - 0.55);
            this.particles.burst(this.tmp, lane.isYou ? 28 : 16, GOAL_COLORS, 1);
          } else {
            this.tmp.set(lane.targetX * 0.5, 1.1, KEEPER_Z);
            this.particles.burst(this.tmp, 12, SAVE_COLORS, 0.5);
            this.keeperPulseAt = elapsedSec; // keeper "grab" pop
          }
        }
      } else if (resolving && noKick) {
        lane.ball.position.set(lane.laneX, lane.radius, REST_Z);
      } else {
        // Idle / trading: clean glide home, then a gentle bob + spin.
        const homeY = lane.radius + Math.sin(elapsedSec * 2 + lane.laneX) * 0.015;
        this.tmp.set(lane.laneX, homeY, REST_Z);
        lane.ball.position.lerp(this.tmp, homeK);
        lane.ball.rotation.y += lane.isYou ? 0.01 : 0.006;
        lane.ball.rotation.x += 0.002;
      }

      // Critter idle bob + a kick lunge that pulses over its shot's flight.
      const critterBaseZ = REST_Z + 0.62;
      const bobY = Math.sin(elapsedSec * 2 + lane.laneX) * 0.02;
      const kickPulse = resolving && !noKick && sinceMs >= shotAtMs
        ? Math.sin(clamp01((sinceMs - shotAtMs) / FLIGHT_MS) * Math.PI)
        : 0;
      lane.critter.position.set(lane.laneX, bobY + kickPulse * 0.22, critterBaseZ - kickPulse * 0.25);
      lane.critter.rotation.x = -kickPulse * 0.4;

      if (lane.glow) {
        lane.glow.position.set(lane.laneX, 0.5 + kickPulse * 0.22, critterBaseZ);
        (lane.glow.material as THREE.SpriteMaterial).opacity = resolving ? 0.4 : 0.85;
      }
    });

    this.keeper.position.x += (keeperTargetX - this.keeper.position.x) * (1 - Math.pow(0.0008, dt));
    this.keeper.position.y += (keeperHop - this.keeper.position.y) * (1 - Math.pow(0.0008, dt));
    this.keeper.rotation.z += (keeperLean - this.keeper.rotation.z) * (1 - Math.pow(0.0008, dt));

    // Keeper "grab" pop right after a save reads as a clear catch.
    const grab = Math.max(0, 1 - (elapsedSec - this.keeperPulseAt) / 0.45);
    this.keeper.scale.setScalar(this.keeperBaseScale * (1 + grab * 0.16));

    // Decay the goal-mouth result flash.
    if (this.flashStrength > 0) {
      this.flashStrength = Math.max(0, this.flashStrength - dt * 2.4);
      (this.shotFlash.material as THREE.SpriteMaterial).opacity = this.flashStrength * 0.95;
      this.shotFlash.scale.setScalar(2.4 + (1 - this.flashStrength) * 2.2);
    }

    this.particles.update(dt);
  }

  /** Snap all actors back to their starting formation for a clean round reset. */
  private resetActors() {
    const critterBaseZ = REST_Z + 0.62;
    this.lanes.forEach((lane) => {
      lane.ball.position.set(lane.laneX, lane.radius, REST_Z);
      lane.ball.rotation.set(0, 0, 0);
      lane.critter.position.set(lane.laneX, 0, critterBaseZ);
      lane.critter.rotation.set(0, 0, 0);
      if (lane.ring) lane.ring.position.set(lane.laneX, 0.04, REST_Z + 0.5);
      if (lane.glow) {
        lane.glow.position.set(lane.laneX, 0.5, critterBaseZ);
        (lane.glow.material as THREE.SpriteMaterial).opacity = 0.85;
      }
    });
    this.keeper.position.set(0, 0, KEEPER_Z);
    this.keeper.rotation.set(0, 0, 0);
    this.keeper.scale.setScalar(this.keeperBaseScale);
    this.keeperPulseAt = -10;
    this.flashStrength = 0;
    (this.shotFlash.material as THREE.SpriteMaterial).opacity = 0;
  }

  dispose() {
    this.scoreboard.dispose();
    this.particles.dispose();
  }
}
