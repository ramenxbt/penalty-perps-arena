/**
 * The keeper is a larger critter with amber goalie gloves, a spread-arm "ready to dive"
 * pose, and a distinct cyan coat, so it matches the cast while staying instantly readable
 * as "the wall". The arms flare out and up so it reads as able to cover the goal mouth.
 * The Arena drives the dive (x slide + hop + lean via rotation.z) on the group returned
 * here, and reads the base scale back off keeper.scale.x.
 */

import * as THREE from "three";
import { createCritter } from "./Critter";

export function createKeeper(): THREE.Group {
  const keeper = createCritter({
    kind: "bear",
    color: 0x6dd6ff,
    gloves: true,
    readyPose: true,
  });
  keeper.scale.setScalar(1.45);
  return keeper;
}
