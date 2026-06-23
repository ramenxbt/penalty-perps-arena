/**
 * Goal with real depth: rounded glossy posts + crossbar (cylinders read cleaner than boxes),
 * a slanted lower back frame, depth/ground bars, side stanchions, and a dense procedural net
 * (back + roof + both sides + a front-top lip) built from line grids so it glows softly under
 * the lights and reads as real netting from the camera instead of a faint ghost.
 */

import * as THREE from "three";

export function createGoal(width: number, height: number, depth: number): THREE.Group {
  const group = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f5, roughness: 0.3, metalness: 0.14 });
  const r = 0.09;
  const backH = height * 0.5;

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

  // Front frame: two posts and the crossbar at the goal line (local z = 0).
  const frontL = vBar(height);
  frontL.position.set(-width / 2, height / 2, 0);
  const frontR = vBar(height);
  frontR.position.set(width / 2, height / 2, 0);
  const crossbar = hBar(width);
  crossbar.position.set(0, height, 0);

  // Lower back frame plus depth and ground bars give the box real volume.
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
  const groundBack = hBar(width);
  groundBack.position.set(0, r, -depth);

  // Slanted roof struts from crossbar back down to the lower back frame.
  const strutLen = Math.hypot(depth, height - backH);
  const strutAngle = Math.atan2(height - backH, depth);
  const roofL = new THREE.Mesh(new THREE.CylinderGeometry(r, r, strutLen, 14), white);
  roofL.position.set(-width / 2, (height + backH) / 2, -depth / 2);
  roofL.rotation.x = Math.PI / 2 - strutAngle;
  const roofR = roofL.clone();
  roofR.position.x = width / 2;

  group.add(
    frontL,
    frontR,
    crossbar,
    backL,
    backR,
    backTop,
    groundL,
    groundR,
    groundBack,
    roofL,
    roofR,
  );
  group.traverse((o) => {
    o.castShadow = true;
  });

  /* ---------------------------------------------------------------- */
  /* Net: dense procedural line grids, near-white and softly glowing.  */
  /* ---------------------------------------------------------------- */

  // Additive, depth-tested but not depth-writing so panels layer without z-fighting and
  // pick up a soft glow under the lights. No shadows for perf and cleanliness.
  const netMat = new THREE.LineBasicMaterial({
    color: 0xeaf2ff,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });

  // Build a flat grid of line segments in the XY plane, centered on origin, sized w x h.
  // cols/rows are the number of cells; the mesh is returned untransformed so the caller
  // can position and rotate each panel into place.
  const makeGridPanel = (w: number, h: number, cols: number, rows: number): THREE.LineSegments => {
    const verts: number[] = [];
    const x0 = -w / 2;
    const y0 = -h / 2;
    // Vertical strands.
    for (let c = 0; c <= cols; c++) {
      const x = x0 + (w * c) / cols;
      verts.push(x, y0, 0, x, y0 + h, 0);
    }
    // Horizontal strands.
    for (let rr = 0; rr <= rows; rr++) {
      const y = y0 + (h * rr) / rows;
      verts.push(x0, y, 0, x0 + w, y, 0);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    const lines = new THREE.LineSegments(geom, netMat);
    lines.castShadow = false;
    lines.receiveShadow = false;
    return lines;
  };

  const cell = 0.22; // target net cell size in world units, keeps mesh density consistent
  const cols = (len: number) => Math.max(6, Math.round(len / cell));

  // Back panel: stands on the lower back frame, facing the camera.
  const backNet = makeGridPanel(width, backH, cols(width), cols(backH));
  backNet.position.set(0, backH / 2, -depth + 0.01);
  group.add(backNet);

  // Roof panel: slants from the crossbar back to the lower back frame.
  const roofNet = makeGridPanel(width, strutLen, cols(width), cols(strutLen));
  roofNet.position.set(0, (height + backH) / 2, -depth / 2);
  roofNet.rotation.x = Math.PI / 2 - strutAngle;
  group.add(roofNet);

  // Side panels: fill each side from the slanted roof line down to the ground.
  // A four-corner quad (front-top, back-top, back-bottom, front-bottom) approximated by a
  // flat panel sized to the side profile, rotated to face inward.
  const sideH = (height + backH) / 2;
  const sideD = Math.hypot(depth, 0) + 0.0;
  const makeSide = (sign: number): THREE.LineSegments => {
    const panel = makeGridPanel(sideD, sideH, cols(sideD), cols(sideH));
    panel.rotation.y = (Math.PI / 2) * sign;
    panel.position.set((sign * width) / 2, sideH / 2, -depth / 2);
    return panel;
  };
  group.add(makeSide(-1), makeSide(1));

  // Front-top lip: a short panel hanging just under the crossbar so the mouth reads as netted.
  const lipH = (height - backH) * 0.35;
  const frontLip = makeGridPanel(width, lipH, cols(width), Math.max(3, cols(lipH)));
  frontLip.position.set(0, height - lipH / 2, -0.06);
  group.add(frontLip);

  // Expose the back net + its shared material so the arena can ripple/flash it on a goal.
  group.userData.backNet = backNet;
  group.userData.netMat = netMat;
  group.userData.netBaseZ = backNet.position.z;
  group.userData.netBaseOpacity = netMat.opacity;

  return group;
}
