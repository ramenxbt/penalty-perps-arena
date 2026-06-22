/**
 * Owns the renderer, scene, fog, and the render call. Knows nothing about gameplay -
 * it just draws whatever is in the scene through the given camera, and handles resize
 * and disposal. Tone mapping + fog give the soft, graded "console game" look.
 */

import * as THREE from "three";
import { QualitySettings } from "./quality";

export class SceneManager {
  readonly scene: THREE.Scene;
  readonly renderer: THREE.WebGLRenderer;
  private pixelRatioCap: number;

  constructor(canvas: HTMLCanvasElement, quality: QualitySettings) {
    this.pixelRatioCap = quality.pixelRatioCap;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.antialias, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelRatioCap));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    // Depth layering: fog fades the far stands into the sky tone.
    this.scene.fog = new THREE.Fog(0x07120d, 22, 60);
  }

  setSize(width: number, height: number) {
    this.renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
  }

  setPixelRatioCap(cap: number) {
    this.pixelRatioCap = cap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
  }

  render(camera: THREE.Camera) {
    this.renderer.render(this.scene, camera);
  }

  dispose() {
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        object.geometry?.dispose?.();
        const material = (object as THREE.Mesh).material;
        const materials = Array.isArray(material) ? material : [material];
        materials.forEach((m) => m?.dispose?.());
      }
    });
    this.renderer.dispose();
  }
}
