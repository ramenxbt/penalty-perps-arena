/**
 * Optional GLB stadium backdrop. Loads a self-hosted glTF stadium shell and drops it around
 * the procedural pitch/goal/actors as set dressing. It is purely decorative: the gameplay
 * (goal, keeper, critters, ball, pitch markings) stays procedural and tuned to the scene
 * coordinates, and this just rings it for atmosphere.
 *
 * Loads async and fails soft (a 404 or decode error just logs and leaves the procedural scene
 * intact). Skipped on the low tier so weak devices never pay the download. Auto-fits by its own
 * bounding box, then applies the tunable transform below so we can dial it in by eye.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { QualitySettings } from "./quality";

// Served from /public (Vite copies public/* to the site root). Keep the leading slash off so
// it works under a base path too.
const MODEL_URL = "models/stadium.glb";

/* ---- Tunable transform. Dial these once it is on screen. ---- */
// Auto-fit target: the stadium's longest horizontal footprint is scaled to this many world
// units. The game wants a HUGE bowl with the action as a small focal spot in the middle, so
// this defaults large; the on-screen tuner (?tune) is the real way to dial it.
const TARGET_SPAN = 120;
// Absolute scale override. Leave 0 to use the auto-fit above; set a number to force a scale.
const SCALE_OVERRIDE = 0;
// Center offset of the whole stadium (after auto-centering on its own bbox).
const OFFSET = new THREE.Vector3(0, 0, -4);
// Model-space height of the playing surface. We seat THIS at y=0 (just below our pitch) so
// the game plays ON the stadium field. Sitting the model's lowest point (foundations) on the
// ground instead would push the field up and the game would appear underneath it.
const FIELD_Y = -0.05;
// Yaw so the open end / main stand faces the camera (radians).
const ROT_Y = 0;

export class Stadium {
  private root: THREE.Group | null = null;
  private disposed = false;

  constructor(scene: THREE.Scene, quality: QualitySettings) {
    if (quality.tier === "low") return; // skip the 2.8MB asset on weak devices

    const loader = new GLTFLoader();
    loader.load(
      MODEL_URL,
      (gltf) => {
        if (this.disposed) return;
        const model = gltf.scene;

        // Measure, recenter on the bbox center, and sit the base on the ground (y=0).
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        const span = Math.max(size.x, size.z) || 1;
        const scale = SCALE_OVERRIDE > 0 ? SCALE_OVERRIDE : TARGET_SPAN / span;

        // Recenter the footprint on the origin, but seat the FIELD at y=0 (not the foundation)
        // so the game plays on the pitch rather than under the stadium.
        model.position.set(-center.x, FIELD_Y, -center.z);

        // The stadium reads as a far backdrop: no shadow casting (cost + it would smear over
        // the pitch), receive light so our floodlights/mood grade it.
        model.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = false;
            mesh.receiveShadow = true;
            mesh.frustumCulled = true;
          }
        });

        const root = new THREE.Group();
        root.add(model);
        root.scale.setScalar(scale);
        root.position.copy(OFFSET);
        root.rotation.y = ROT_Y;
        scene.add(root);
        this.root = root;

        // Live placement: when ?tune is in the URL, expose the root transform so the
        // on-screen StadiumTuner panel can drag it visually. Dialed values get baked into
        // the constants above, then this and the panel come out.
        if (typeof location !== "undefined" && location.search.includes("tune")) {
          (window as unknown as { __ppStadium?: unknown }).__ppStadium = {
            set: (s: number, x: number, y: number, z: number, ry: number) => {
              root.scale.setScalar(s);
              root.position.set(x, y, z);
              root.rotation.y = ry;
            },
            get: () => ({ s: root.scale.x, x: root.position.x, y: root.position.y, z: root.position.z, ry: root.rotation.y }),
          };
          window.dispatchEvent(new Event("pp-stadium-ready"));
        }
      },
      undefined,
      (err) => {
        // Non-fatal: the procedural arena stands on its own.
        console.warn("Stadium GLB failed to load; using procedural arena only.", err);
      },
    );
  }

  dispose() {
    this.disposed = true;
    (window as unknown as { __ppStadium?: unknown }).__ppStadium = undefined;
    const root = this.root;
    if (!root) return;
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) (mat as THREE.Material).dispose();
    });
    root.parent?.remove(root);
    this.root = null;
  }
}
