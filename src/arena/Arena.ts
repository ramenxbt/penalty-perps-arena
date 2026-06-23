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
import { arrangeShooters, FLIGHT_MS, SOLO_BEAT_MS, VOLLEY_LEAD_IN_MS } from "../game/volley";
import { CameraRig } from "./CameraRig";
import { createCritter, critterKindForIndex } from "./Critter";
import { createGoal } from "./Goal";
import { createKeeper } from "./Keeper";
import { createGlowSprite, createSoccerBall } from "./materials";
import { GOAL_COLORS, ParticlePool, SAVE_COLORS } from "./ParticlePool";
import { QualitySettings } from "./quality";
import { Scoreboard, ScoreboardData } from "./Scoreboard";

export type ArenaState = { phase: RoundPhase; shooters: Shooter[]; hud?: ScoreboardData; mood?: number };

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
const SETTLE_MS = 600; // how long a landed ball takes to drop and roll to rest

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

  // Solo shootout: only the player kicks. Each earned shot picks a fresh random spot in the
  // goal mouth so placement varies shot to shot.
  private goalMouth = 3;
  private shotPlacements: number[] = [];
  private emberTimer = 0; // paces the winning-mood embers

  // Comet trail behind the player's shot, and an expanding shockwave ring on a goal.
  private trail: THREE.Sprite[] = [];
  private trailHistory: THREE.Vector3[] = [];
  private trailActive = false;
  private shockwave: THREE.Mesh | null = null;
  private shockwaveStrength = 0;
  private youLane: Lane | null = null;

  // Goal celebration: sweeping searchlight beams that fan over the pitch for a beat.
  private beams: { pivot: THREE.Group; mat: THREE.MeshBasicMaterial; baseTilt: number; phase: number }[] = [];
  private celebrateStrength = 0;

  // Net ripple: a decaying impulse that bulges + lights the netting when a goal lands.
  private backNet: THREE.LineSegments | null = null;
  private netMat: THREE.LineBasicMaterial | null = null;
  private netBaseZ = 0;
  private netBaseOpacity = 0.42;
  private netRipple = 0;

  constructor(scene: THREE.Scene, quality: QualitySettings, initial: Shooter[]) {
    const arranged = arrangeShooters(initial.length ? initial : [{ id: "me", name: "@you", isYou: true, isAi: false, pnlPct: 0, shots: 0, goals: 0, openness: 0 }]);
    const count = Math.max(1, arranged.length);
    const center = Math.max(0, arranged.findIndex((s) => s.isYou));
    const goalW = Math.max(6.4, (count - 1) * SPACING + 4.5);

    const goal = createGoal(goalW, GOAL_H, GOAL_DEPTH).translateZ(GOAL_Z);
    this.goalMouth = Math.max(1.6, goalW / 2 - 1.2);
    scene.add(goal);
    this.backNet = (goal.userData.backNet as THREE.LineSegments) ?? null;
    this.netMat = (goal.userData.netMat as THREE.LineBasicMaterial) ?? null;
    this.netBaseZ = (goal.userData.netBaseZ as number) ?? 0;
    this.netBaseOpacity = (goal.userData.netBaseOpacity as number) ?? 0.42;

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
        color: shooter.isYou ? 0xffc53d : CRITTER_COLORS[i % CRITTER_COLORS.length],
      });
      critter.scale.setScalar(shooter.isYou ? 0.96 : 0.78);
      critter.position.set(laneX, 0, REST_Z + 0.62);
      // Shooters face the goal (away from camera); only the keeper faces us.
      critter.rotation.y = Math.PI;
      scene.add(critter);

      let ring: THREE.Mesh | null = null;
      let glow: THREE.Sprite | null = null;
      if (shooter.isYou) {
        ring = new THREE.Mesh(
          new THREE.RingGeometry(0.4, 0.52, 40),
          new THREE.MeshBasicMaterial({ color: 0xffc53d, transparent: true, opacity: 0.9, toneMapped: false }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(laneX, 0.04, REST_Z + 0.5);
        scene.add(ring);
        if (quality.glow) {
          glow = createGlowSprite(0xffc53d, 1.6);
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
    this.youLane = this.lanes.find((lane) => lane.isYou) ?? null;

    // Comet trail (a short string of fading additive sprites). Gated to the glow tier.
    if (quality.glow) {
      for (let i = 0; i < 9; i += 1) {
        const s = createGlowSprite(0xffe39a, 0.5 - i * 0.03);
        (s.material as THREE.SpriteMaterial).opacity = 0;
        scene.add(s);
        this.trail.push(s);
        this.trailHistory.push(new THREE.Vector3(0, -10, 0));
      }
    }

    // Goal shockwave: a flat additive ring at the net that expands and fades on a goal.
    this.shockwave = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.42, 36),
      new THREE.MeshBasicMaterial({
        color: 0x2fd07a,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    scene.add(this.shockwave);

    // Sweeping celebration searchlights: open additive cones hung high that fan on a goal.
    if (quality.glow) {
      const beamGeo = new THREE.ConeGeometry(2.4, 17, 18, 1, true);
      const beamColors = [0xffc53d, 0x2fd07a, 0x65d8ff];
      for (let i = 0; i < 3; i += 1) {
        const pivot = new THREE.Group();
        pivot.position.set((i - 1) * 5, 15.5, GOAL_Z + 2.5);
        const mat = new THREE.MeshBasicMaterial({
          color: beamColors[i],
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
          side: THREE.DoubleSide,
        });
        const cone = new THREE.Mesh(beamGeo, mat);
        cone.position.y = -8.5; // apex at the pivot, beam fans down to the pitch
        pivot.add(cone);
        scene.add(pivot);
        this.beams.push({ pivot, mat, baseTilt: (i - 1) * 0.28, phase: i * 2.1 });
      }
    }
  }

  update(dt: number, elapsedSec: number, state: ArenaState, rig: CameraRig) {
    const { phase, shooters } = state;
    if (state.hud) this.scoreboard.update(state.hud);
    this.trailActive = false;

    if (phase !== this.previousPhase) {
      if (phase === "resolving") {
        this.resolveStart = elapsedSec;
        this.resolved.clear();
        // Fresh random placement for each of the (up to three) earned shots.
        this.shotPlacements = Array.from({ length: 3 }, () => (Math.random() * 2 - 1) * this.goalMouth);
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

    this.lanes.forEach((lane) => {
      const shooter = shooters.find((s) => s.id === lane.id);
      const critterBaseZ = REST_Z + 0.62;
      const bobY = Math.sin(elapsedSec * 2 + lane.laneX) * 0.02;

      // AI rivals are spectators in the solo shootout: hold their spot with a gentle idle bob
      // and slow spin, never kicking. Their results live on the scoreboard, not in 3D.
      if (!lane.isYou) {
        const homeY = lane.radius + Math.sin(elapsedSec * 2 + lane.laneX) * 0.015;
        this.tmp.set(lane.laneX, homeY, REST_Z);
        lane.ball.position.lerp(this.tmp, homeK);
        lane.ball.rotation.y += 0.006;
        lane.ball.rotation.x += 0.002;
        lane.critter.position.set(lane.laneX, bobY, critterBaseZ);
        lane.critter.rotation.x = 0;
        if (lane.glow) {
          lane.glow.position.set(lane.laneX, 0.5, critterBaseZ);
          (lane.glow.material as THREE.SpriteMaterial).opacity = resolving ? 0.4 : 0.85;
        }
        return;
      }

      // --- Player lane: a solo shootout of the earned shots, one at a time ---
      const shots = Math.max(0, shooter?.shots ?? 0);
      const goals = shooter?.goals ?? 0;
      const noKick = shots <= 0;
      let kickPulse = 0;
      let celebrate = 0;
      let slump = 0; // bad-loss sulk: head down, shoulders dropped

      if (resolving && !noKick) {
        const t = sinceMs - VOLLEY_LEAD_IN_MS;
        const k = Math.max(0, Math.min(shots - 1, Math.floor(t / SOLO_BEAT_MS)));
        const localMs = t - k * SOLO_BEAT_MS;
        const isLast = k >= shots - 1;
        const scored = k < goals;
        const placeX = this.shotPlacements[k] ?? 0;
        const p = easeOut(clamp01(localMs / FLIGHT_MS));
        const settleQ = clamp01((localMs - FLIGHT_MS) / SETTLE_MS);
        const rerack = easeOut(clamp01((localMs - FLIGHT_MS) / (SOLO_BEAT_MS - FLIGHT_MS)));

        if (t < 0) {
          lane.ball.position.set(lane.laneX, lane.radius, REST_Z);
        } else if (scored) {
          if (settleQ <= 0) {
            // Flight into the back of the net.
            lane.ball.position.x = THREE.MathUtils.lerp(lane.laneX, placeX, p);
            lane.ball.position.z = THREE.MathUtils.lerp(REST_Z, GOAL_Z - 0.55, p);
            lane.ball.position.y = THREE.MathUtils.lerp(lane.radius, 1.45, Math.sin(p * Math.PI * 0.5));
          } else if (isLast) {
            // Drop down the net and bounce to rest on the goal floor.
            lane.ball.position.set(
              placeX,
              THREE.MathUtils.lerp(1.45, lane.radius, easeOut(settleQ)) + Math.sin(settleQ * Math.PI) * 0.16,
              GOAL_Z - 0.55,
            );
          } else {
            // Re-rack: glide the ball back to the spot for the next shot.
            lane.ball.position.set(
              THREE.MathUtils.lerp(placeX, lane.laneX, rerack),
              THREE.MathUtils.lerp(1.45, lane.radius, rerack),
              THREE.MathUtils.lerp(GOAL_Z - 0.55, REST_Z, rerack),
            );
          }
        } else if (p < 0.5) {
          // First half: in to the keeper.
          const a = p / 0.5;
          lane.ball.position.x = THREE.MathUtils.lerp(lane.laneX, placeX * 0.5, a);
          lane.ball.position.z = THREE.MathUtils.lerp(REST_Z, KEEPER_Z, a);
          lane.ball.position.y = THREE.MathUtils.lerp(lane.radius, 1.0, Math.sin(a * Math.PI * 0.5));
        } else if (settleQ <= 0) {
          // Second half: deflected back out toward the camera, so a block is unmistakable.
          const b = (p - 0.5) / 0.5;
          lane.ball.position.x = THREE.MathUtils.lerp(placeX * 0.5, placeX * 1.4, b);
          lane.ball.position.z = THREE.MathUtils.lerp(KEEPER_Z, -1.4, b);
          lane.ball.position.y = 1.0 * (1 - b) + 0.32 + Math.sin(b * Math.PI) * 0.85;
        } else if (isLast) {
          // The parried ball rolls forward to a stop on the turf.
          lane.ball.position.set(placeX * 1.4, lane.radius, THREE.MathUtils.lerp(-1.4, -0.9, easeOut(settleQ)));
        } else {
          // Re-rack the parried ball back to the spot.
          lane.ball.position.set(
            THREE.MathUtils.lerp(placeX * 1.4, lane.laneX, rerack),
            lane.radius,
            THREE.MathUtils.lerp(-1.4, REST_Z, rerack),
          );
        }

        if (t >= 0) lane.ball.rotation.x -= 0.34 * (1 - Math.min(1, settleQ));

        // The ball streaks a comet trail while it is in the air.
        if (t >= 0 && p > 0.02 && p < 0.98 && settleQ <= 0) this.trailActive = true;

        // The active shot drives the keeper: dive away on a goal, meet the ball on a save.
        if (t >= 0 && p > 0.04 && p < 1) {
          const dir = placeX >= 0 ? 1 : -1;
          keeperTargetX = scored ? -dir * Math.min(2.2, Math.abs(placeX) + 0.7) : placeX;
          keeperHop = Math.sin(p * Math.PI) * (scored ? 0.35 : 0.5);
          keeperLean = (keeperTargetX < 0 ? 1 : -1) * 0.45 * Math.sin(p * Math.PI);
        }

        // Fire each shot's result effect once, the instant it reaches the line.
        const key = `you-${k}`;
        if (t >= 0 && p >= 0.85 && !this.resolved.has(key)) {
          this.resolved.add(key);
          const flashX = scored ? placeX : placeX * 0.5;
          this.shotFlash.position.set(flashX, 1.3, GOAL_Z + 0.3);
          (this.shotFlash.material as THREE.SpriteMaterial).color.set(scored ? 0x2fd07a : 0xff5247);
          this.flashStrength = 1;
          if (scored) {
            this.tmp.set(placeX, 1.45, GOAL_Z - 0.55);
            this.particles.burst(this.tmp, 30, GOAL_COLORS, 1);
            this.netRipple = 1; // bulge + light the netting
            rig.punch(1); // push the camera in on your goal
            this.shockwaveStrength = 1; // expanding ring at the net
            this.shockwave?.position.set(placeX, 1.45, GOAL_Z - 0.4);
            this.celebrateStrength = 1; // fire the sweeping searchlights
            // Corner fountains erupt from the goalposts for a fuller celebration.
            this.tmp.set(-this.goalMouth, 1.3, GOAL_Z - 0.3);
            this.particles.burst(this.tmp, 12, GOAL_COLORS, 1.1);
            this.tmp.set(this.goalMouth, 1.3, GOAL_Z - 0.3);
            this.particles.burst(this.tmp, 12, GOAL_COLORS, 1.1);
          } else {
            this.tmp.set(placeX * 0.5, 1.1, KEEPER_Z);
            this.particles.burst(this.tmp, 12, SAVE_COLORS, 0.5);
            this.keeperPulseAt = elapsedSec; // keeper "grab" pop
          }
        }

        kickPulse = t >= 0 ? Math.sin(clamp01(localMs / FLIGHT_MS) * Math.PI) : 0;
        celebrate = scored && settleQ > 0 ? Math.abs(Math.sin(elapsedSec * 10)) * 0.16 : 0;
      } else if (resolving && noKick) {
        // Conceded: no kick for you. The keeper boots the ball back out past the camera, a
        // humiliating clearance, while your critter slumps. The worse the loss, the harsher.
        const t = sinceMs - VOLLEY_LEAD_IN_MS;
        if (t < 0) {
          lane.ball.position.set(lane.laneX, lane.radius, REST_Z);
        } else {
          const p = easeOut(clamp01(t / FLIGHT_MS));
          lane.ball.position.x = THREE.MathUtils.lerp(lane.laneX, lane.laneX * 1.5, p);
          lane.ball.position.z = THREE.MathUtils.lerp(REST_Z, -3.2, p);
          lane.ball.position.y = THREE.MathUtils.lerp(lane.radius, 0.4, p) + Math.sin(p * Math.PI) * 1.6;
          lane.ball.rotation.x -= 0.4;
          slump = clamp01(t / (FLIGHT_MS * 1.1));

          // Keeper struts out and celebrates the clearance.
          keeperTargetX = 0;
          keeperHop = Math.sin(p * Math.PI) * 0.5;

          if (p >= 0.35 && !this.resolved.has("concede")) {
            this.resolved.add("concede");
            this.shotFlash.position.set(0, 1.3, GOAL_Z + 0.3);
            (this.shotFlash.material as THREE.SpriteMaterial).color.set(0xff5247);
            this.flashStrength = 1;
            this.tmp.set(0, 1.0, KEEPER_Z);
            this.particles.burst(this.tmp, 14, SAVE_COLORS, 0.6);
            this.keeperPulseAt = elapsedSec;
          }
        }
      } else {
        // Idle / trading: clean glide home, then a gentle bob + spin.
        const homeY = lane.radius + Math.sin(elapsedSec * 2 + lane.laneX) * 0.015;
        this.tmp.set(lane.laneX, homeY, REST_Z);
        lane.ball.position.lerp(this.tmp, homeK);
        lane.ball.rotation.y += 0.01;
        lane.ball.rotation.x += 0.002;
      }

      lane.critter.position.set(
        lane.laneX,
        bobY + kickPulse * 0.22 + celebrate - slump * 0.22,
        critterBaseZ - kickPulse * 0.25,
      );
      lane.critter.rotation.x = -kickPulse * 0.4 + slump * 0.5;

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

    // Net ripple: bulge the back panel and brighten the strands, then ease back to rest.
    if (this.backNet && this.netMat) {
      if (this.netRipple > 0) this.netRipple = Math.max(0, this.netRipple - dt * 2.2);
      const wobble = Math.sin(this.netRipple * Math.PI) * (0.18 + Math.sin(elapsedSec * 30) * 0.05);
      this.backNet.position.z = this.netBaseZ - wobble;
      this.netMat.opacity = this.netBaseOpacity + this.netRipple * 0.5;
    }

    // Winning mood: gold embers rise off the pitch, faster the better the trade is doing.
    const mood = state.mood ?? 0;
    if (mood > 0.12) {
      this.emberTimer += dt;
      const interval = THREE.MathUtils.lerp(0.4, 0.05, Math.min(1, mood));
      while (this.emberTimer >= interval) {
        this.emberTimer -= interval;
        this.tmp.set((Math.random() - 0.5) * 5, 0.15, REST_Z - Math.random() * 8);
        this.particles.ember(this.tmp, 0xffc53d);
      }
    } else {
      this.emberTimer = 0;
    }

    // Comet trail: ride the live shot, otherwise fade out. Ring buffer reuses its vectors.
    if (this.trail.length) {
      const youBall = this.youLane?.ball;
      if (this.trailActive && youBall) {
        const head = this.trailHistory.pop();
        if (head) {
          head.copy(youBall.position);
          this.trailHistory.unshift(head);
        }
        for (let i = 0; i < this.trail.length; i += 1) {
          this.trail[i].position.copy(this.trailHistory[i]);
          (this.trail[i].material as THREE.SpriteMaterial).opacity = (1 - i / this.trail.length) * 0.5;
        }
      } else {
        for (const s of this.trail) {
          const m = s.material as THREE.SpriteMaterial;
          if (m.opacity > 0.001) m.opacity = Math.max(0, m.opacity - dt * 4);
        }
      }
    }

    // Goal shockwave ring: expand outward and fade.
    if (this.shockwave) {
      const mat = this.shockwave.material as THREE.MeshBasicMaterial;
      if (this.shockwaveStrength > 0) {
        this.shockwaveStrength = Math.max(0, this.shockwaveStrength - dt * 1.8);
        this.shockwave.scale.setScalar(1 + (1 - this.shockwaveStrength) * 5);
        mat.opacity = this.shockwaveStrength * 0.6;
      } else if (mat.opacity !== 0) {
        mat.opacity = 0;
      }
    }

    // Celebration searchlights: fan across the pitch while the celebration is hot, then fade.
    if (this.beams.length) {
      if (this.celebrateStrength > 0) {
        this.celebrateStrength = Math.max(0, this.celebrateStrength - dt * 0.6); // ~1.7s
        for (const b of this.beams) {
          b.pivot.rotation.z = b.baseTilt + Math.sin(elapsedSec * 1.8 + b.phase) * 0.5;
          b.pivot.rotation.x = Math.sin(elapsedSec * 1.2 + b.phase) * 0.2;
          b.mat.opacity = this.celebrateStrength * 0.22;
        }
      } else if (this.beams[0].mat.opacity !== 0) {
        for (const b of this.beams) b.mat.opacity = 0;
      }
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
      lane.critter.rotation.set(0, Math.PI, 0);
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
    this.netRipple = 0;
    if (this.backNet) this.backNet.position.z = this.netBaseZ;
    if (this.netMat) this.netMat.opacity = this.netBaseOpacity;
    this.shockwaveStrength = 0;
    if (this.shockwave) (this.shockwave.material as THREE.MeshBasicMaterial).opacity = 0;
    for (const s of this.trail) (s.material as THREE.SpriteMaterial).opacity = 0;
    this.celebrateStrength = 0;
    for (const b of this.beams) b.mat.opacity = 0;
  }

  dispose() {
    this.scoreboard.dispose();
    this.particles.dispose();
  }
}
