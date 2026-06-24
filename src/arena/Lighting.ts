/**
 * Lighting system. A hemisphere light gives the soft, even "mobile game" base; a warm
 * key spotlight carries the shadows and the hero highlight; cool rim/fill lights add
 * shape and the brand accents. Shadow cost scales with the quality tier.
 *
 * The lights also carry the stadium MOOD: setMood(-1..1) drifts them warmer + brighter as
 * the trade wins, and cooler + dimmer with a creeping red rim as it loses. update(dt)
 * smooths the current mood toward the target so it eases rather than snaps.
 */

import * as THREE from "three";
import { QualitySettings } from "./quality";

export class Lighting {
  private lights: THREE.Object3D[] = [];
  private key: THREE.SpotLight;
  private fill: THREE.PointLight;
  private rim: THREE.PointLight;
  private hemi: THREE.HemisphereLight;
  private base: { key: number; fill: number; rim: number; hemi: number };
  private rimBase = new THREE.Color(0x65d8ff);
  private danger = new THREE.Color(0xff5247);
  private mood = 0;
  private moodTarget = 0;

  constructor(scene: THREE.Scene, quality: QualitySettings) {
    // Sky brighter than ground so rounded figures (the crowd especially) get a clear top-down
    // gradient; the ground term is lifted off pure black so undersides read as form, not voids.
    const hemi = new THREE.HemisphereLight(0xdef2e8, 0x1b271f, 1.1);
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

    this.key = key;
    this.fill = fill;
    this.rim = rim;
    this.hemi = hemi;
    this.base = { key: key.intensity, fill: fill.intensity, rim: rim.intensity, hemi: hemi.intensity };

    this.lights = [hemi, key, key.target, fill, rim];
    this.lights.forEach((light) => scene.add(light));
  }

  /** Stadium mood, -1 (losing hard) .. 0 (neutral) .. 1 (winning hard). */
  setMood(value: number) {
    this.moodTarget = Math.max(-1, Math.min(1, value));
  }

  update(dt: number) {
    this.mood += (this.moodTarget - this.mood) * Math.min(1, dt * 2);
    const m = this.mood;
    const up = Math.max(0, m);
    const down = Math.max(0, -m);
    this.key.intensity = this.base.key * (1 + up * 0.2 - down * 0.28);
    this.fill.intensity = this.base.fill * (1 + up * 0.9 - down * 0.5); // gold fill swells on a win
    this.hemi.intensity = this.base.hemi * (1 + up * 0.1 - down * 0.22);
    this.rim.color.copy(this.rimBase).lerp(this.danger, down); // cyan -> red as it sours
    this.rim.intensity = this.base.rim * (1 + down * 0.5 - up * 0.1);
  }

  dispose() {
    this.lights.forEach((light) => {
      light.parent?.remove(light);
      (light as THREE.Object3D & { dispose?: () => void }).dispose?.();
    });
    this.lights = [];
  }
}
