/**
 * Tiny low-poly critters, built entirely from primitives (no rigging, no assets).
 * Big eyes + simple ears + little arms give each one a cute, readable silhouette. They
 * face +Z (the camera) so you see their faces; the Arena leans/hops them to "kick". A
 * keeper variant adds amber goalie gloves and a spread-arm ready pose.
 *
 * Cheap on purpose: ~14 meshes each, low sphere segments. The crowd is instanced; these
 * few hero characters are fine as plain meshes. The group origin sits at the feet (y=0),
 * so the Arena can lean each character with rotation.x and it pivots from the ground.
 */

import * as THREE from "three";

export type CritterKind = "cat" | "bear" | "fox" | "frog";

const KINDS: CritterKind[] = ["cat", "bear", "fox", "frog"];

export function critterKindForIndex(index: number): CritterKind {
  return KINDS[index % KINDS.length];
}

function std(color: number, roughness = 0.5): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.04 });
}

function lighten(color: number, amount: number): number {
  return new THREE.Color(color).lerp(new THREE.Color(0xffffff), amount).getHex();
}

export function createCritter(opts: {
  kind: CritterKind;
  color: number;
  gloves?: boolean;
  /** Spread the arms out and up into a goalie "ready to dive" pose. */
  readyPose?: boolean;
}): THREE.Group {
  const { kind, color, gloves = false, readyPose = false } = opts;
  const group = new THREE.Group();

  const bodyMat = std(color, 0.55);
  const bellyMat = std(lighten(color, 0.32), 0.6);
  const armMat = std(lighten(color, 0.06), 0.55);
  const white = std(0xffffff, 0.35);
  const dark = std(0x101218, 0.5);
  const earMat = kind === "fox" ? std(lighten(color, 0.08)) : bodyMat;

  // Rounded egg body.
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 18), bodyMat);
  body.scale.set(1, 1.18, 0.92);
  body.position.y = 0.4;
  group.add(body);

  // Lighter belly patch on the front (+Z).
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 14), bellyMat);
  belly.scale.set(0.85, 1.05, 0.5);
  belly.position.set(0, 0.34, 0.2);
  group.add(belly);

  // Eyes (big, camera-facing) + pupils on the +Z face.
  const eyeR = kind === "frog" ? 0.15 : 0.12;
  const eyeY = kind === "frog" ? 0.66 : 0.52;
  const eyeZ = 0.24;
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 16, 14), white);
    eye.position.set(side * 0.14, eyeY, eyeZ);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.5, 12, 12), dark);
    pupil.position.set(side * 0.14, eyeY, eyeZ + eyeR * 0.7);
    group.add(eye, pupil);
  }

  // Ears by species.
  for (const side of [-1, 1]) {
    let ear: THREE.Mesh;
    if (kind === "cat" || kind === "fox") {
      const h = kind === "fox" ? 0.34 : 0.24;
      ear = new THREE.Mesh(new THREE.ConeGeometry(0.12, h, 12), earMat);
      ear.position.set(side * 0.18, 0.72 + h * 0.3, -0.02);
      ear.rotation.z = side * -0.25;
    } else {
      // bear / frog: round ears / eye-domes set high.
      const r = kind === "frog" ? 0.13 : 0.12;
      ear = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 12), kind === "frog" ? white : earMat);
      ear.position.set(side * 0.2, kind === "frog" ? 0.74 : 0.72, kind === "frog" ? 0.16 : 0);
    }
    group.add(ear);
  }

  // Little rounded arms on the sides. Each arm is its own pivot group anchored at the
  // shoulder so the whole limb (upper arm + paw/glove) swings together. The default
  // pose tucks them down by the sides; the keeper's ready pose flares them out and up.
  const shoulderY = 0.46;
  const shoulderX = 0.3;
  const pawR = gloves ? 0.15 : 0.1;
  const pawMat = gloves ? std(0xf6b73c, 0.45) : armMat;
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * shoulderX, shoulderY, 0.06);

    // Upper arm: a short capsule reaching down/out from the shoulder.
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.18, 6, 12), armMat);
    upper.position.set(0, -0.13, 0);
    arm.add(upper);

    // Paw or glove at the end of the arm.
    const paw = new THREE.Mesh(new THREE.SphereGeometry(pawR, 14, 12), pawMat);
    paw.position.set(0, -0.27, 0.02);
    arm.add(paw);

    if (readyPose) {
      // Spread out and slightly up: a goalie bracing to cover the goal. The pivot at
      // the shoulder makes the paws end up wide and high.
      arm.rotation.z = side * 1.15;
      arm.rotation.x = -0.35;
    } else {
      // Resting at the sides with a touch of outward splay for life.
      arm.rotation.z = side * 0.28;
    }

    group.add(arm);
  }

  // Little feet on the +Z front.
  for (const side of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), dark);
    foot.scale.set(1, 0.6, 1.3);
    foot.position.set(side * 0.14, 0.07, 0.12);
    group.add(foot);
  }

  group.traverse((o) => {
    o.castShadow = true;
  });
  return group;
}
