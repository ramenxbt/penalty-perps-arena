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
// units. Our action spans roughly +/-18, the pitch plane is ~46. A value here that wraps the
// pitch without dwarfing it is the goal; raise to push the stands out, lower to pull them in.
const TARGET_SPAN = 70;
// Absolute scale override. Leave 0 to use the auto-fit above; set a number to force a scale.
const SCALE_OVERRIDE = 0;
// Center offset of the whole stadium (after auto-centering on its own bbox).
const OFFSET = new THREE.Vector3(0, 0, -4);
// Lift/lower onto the pitch (its base is sat on y=0 first; nudge if it z-fights our pitch).
const Y_NUDGE = -0.02;
// Yaw so the open end / main stand faces the camera (radians).
const ROT_Y = 0;

export class Stadium {
  private root: THREE.Group | null = null;
  private disposed = false;
  private tunerCleanup: (() => void) | null = null;

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

        model.position.set(-center.x, -box.min.y, -center.z);

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
        root.position.y += Y_NUDGE;
        root.rotation.y = ROT_Y;
        scene.add(root);
        this.root = root;

        // Live placement tuner: load with ?tune in the URL, drag the stadium into place
        // with the keyboard, and read the logged numbers to bake into the constants above.
        if (typeof location !== "undefined" && location.search.includes("tune")) {
          this.attachTuner(root, scale);
        }
      },
      undefined,
      (err) => {
        // Non-fatal: the procedural arena stands on its own.
        console.warn("Stadium GLB failed to load; using procedural arena only.", err);
      },
    );
  }

  /** Dev-only keyboard tuner so the placement can be dialed by eye (gated behind ?tune). */
  private attachTuner(root: THREE.Group, startScale: number) {
    let scale = startScale;
    const log = () =>
      console.log(
        `[stadium] scale=${scale.toFixed(3)} pos=(${root.position.x.toFixed(1)}, ${root.position.y.toFixed(2)}, ${root.position.z.toFixed(1)}) rotY=${root.rotation.y.toFixed(3)}`,
      );
    const onKey = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 5 : 1;
      const sFactor = e.shiftKey ? 1.2 : 1.05;
      switch (e.key) {
        case "ArrowLeft": root.position.x -= step; break;
        case "ArrowRight": root.position.x += step; break;
        case "ArrowUp": root.position.z -= step; break;
        case "ArrowDown": root.position.z += step; break;
        case "w": root.position.y += step; break;
        case "s": root.position.y -= step; break;
        case "a": root.rotation.y -= 0.1; break;
        case "d": root.rotation.y += 0.1; break;
        case "=":
        case "+": scale *= sFactor; root.scale.setScalar(scale); break;
        case "-":
        case "_": scale /= sFactor; root.scale.setScalar(scale); break;
        default: return;
      }
      e.preventDefault();
      log();
    };
    window.addEventListener("keydown", onKey);
    this.tunerCleanup = () => window.removeEventListener("keydown", onKey);
    console.log("[stadium] TUNER ON. Arrows = move X/Z, w/s = up/down, a/d = rotate, +/- = scale. Hold Shift for coarse steps.");
    log();
  }

  dispose() {
    this.disposed = true;
    this.tunerCleanup?.();
    this.tunerCleanup = null;
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
