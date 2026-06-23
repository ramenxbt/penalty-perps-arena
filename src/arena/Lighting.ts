/**
 * Lighting system. A hemisphere light gives the soft, even "mobile game" base; a warm
 * key spotlight carries the shadows and the hero highlight; cool rim/fill lights add
 * shape and the brand accents. Shadow cost scales with the quality tier.
 */

import * as THREE from "three";
import { QualitySettings } from "./quality";

export class Lighting {
  private lights: THREE.Object3D[] = [];

  constructor(scene: THREE.Scene, quality: QualitySettings) {
    const hemi = new THREE.HemisphereLight(0xcfeede, 0x09140d, 0.9);
    hemi.position.set(0, 12, 0);

    const key = new THREE.SpotLight(0xffffff, quality.shadows ? 7.5 : 9, 48, Math.PI / 4.4, 0.55, 1.0);
    key.position.set(-4, 13, 8);
    key.target.position.set(0, 0.6, -3);
    if (quality.shadows) {
      key.castShadow = true;
      key.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      key.shadow.bias = -0.0004;
      key.shadow.camera.near = 2;
      key.shadow.camera.far = 40;
    }

    const fill = new THREE.PointLight(0xffc53d, 2.0, 34);
    fill.position.set(6, 5, 7);

    const rim = new THREE.PointLight(0x65d8ff, 2.4, 34);
    rim.position.set(-7, 6, -9);

    this.lights = [hemi, key, key.target, fill, rim];
    this.lights.forEach((light) => scene.add(light));
  }

  dispose() {
    this.lights.forEach((light) => {
      light.parent?.remove(light);
      (light as THREE.Object3D & { dispose?: () => void }).dispose?.();
    });
    this.lights = [];
  }
}
