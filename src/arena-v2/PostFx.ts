/**
 * PostFx: cel-shaded anime post-processing stack for the v2 penalty arena.
 *
 * Wraps three's EffectComposer over an existing renderer/scene/camera with:
 *   RenderPass -> UnrealBloomPass -> radial speed-lines -> manga impact-frame.
 * The last pass renders to screen. When disabled, render() falls back to a
 * plain renderer.render() so the caller never has to branch.
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { PAL } from "./palette";

// Loose uniform typing keeps ShaderPass happy without fighting three's defs.
type Uniforms = Record<string, { value: unknown }>;

// Standard ShaderPass fullscreen vertex shader. ShaderPass renders a screen
// quad with an ortho camera, so the usual projection*modelView transform holds.
const SCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Radial manga speed lines. Polar bins + hash give discrete streaks; a radial
// vignette keeps the center clear and pushes energy toward the edges.
const SPEED_LINES_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uStrength;
uniform float uTime;
uniform vec2 uCenter;
uniform vec3 uAccent;
varying vec2 vUv;
void main() {
  vec4 col = texture2D(tDiffuse, vUv);
  vec2 d = vUv - uCenter; float r = length(d); float a = atan(d.y, d.x);
  float bins = 140.0; float id = floor((a / 6.2831853 + 0.5) * bins);
  float line = step(0.55, fract(sin(id * 12.9898 + floor(uTime * 8.0) * 0.0) * 43758.5453));
  float vign = smoothstep(0.25, 0.7, r);
  float lines = line * vign * uStrength;
  gl_FragColor = mix(col, vec4(uAccent, 1.0), lines);
}
`;

// One-shot manga impact frame: posterize to a 2-tone plate plus a white flash,
// both scaled by a decaying envelope uHit. At uHit ~ 0 the image passes through.
const IMPACT_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uHit;
varying vec2 vUv;
void main() {
  vec4 col = texture2D(tDiffuse, vUv);
  float lum = dot(col.rgb, vec3(0.299, 0.587, 0.114));
  vec3 manga = lum > 0.5 ? vec3(1.0) : vec3(0.04);
  vec3 outc = mix(col.rgb, manga, uHit);
  outc = mix(outc, vec3(1.0), uHit * uHit * 0.6);
  gl_FragColor = vec4(outc, 1.0);
}
`;

const IMPACT_DECAY = 0.18; // seconds for uHit to fall from 1 toward 0

export class PostFx {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly speedPass: ShaderPass;
  private readonly impactPass: ShaderPass;

  public enabled: boolean;

  private clock = new THREE.Clock();
  private hit = 0;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    opts: { enabled?: boolean } = {},
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = opts.enabled ?? true;

    const size = renderer.getSize(new THREE.Vector2());

    this.composer = new EffectComposer(renderer);
    this.composer.setSize(size.x, size.y);

    const renderPass = new RenderPass(scene, camera);
    this.composer.addPass(renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      0.6, // strength
      0.5, // radius
      0.85, // threshold
    );
    this.composer.addPass(this.bloomPass);

    const accent = new THREE.Color(PAL.accent);

    const speedUniforms: Uniforms = {
      tDiffuse: { value: null },
      uStrength: { value: 0 },
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uAccent: { value: new THREE.Vector3(accent.r, accent.g, accent.b) },
    };
    this.speedPass = new ShaderPass({
      uniforms: speedUniforms,
      vertexShader: SCREEN_VERT,
      fragmentShader: SPEED_LINES_FRAG,
    });
    this.composer.addPass(this.speedPass);

    const impactUniforms: Uniforms = {
      tDiffuse: { value: null },
      uHit: { value: 0 },
    };
    this.impactPass = new ShaderPass({
      uniforms: impactUniforms,
      vertexShader: SCREEN_VERT,
      fragmentShader: IMPACT_FRAG,
    });
    this.impactPass.renderToScreen = true;
    this.composer.addPass(this.impactPass);
  }

  /** Set speed-line intensity (0..1) and the radial center in UV space. */
  setSpeedLines(strength: number, center?: THREE.Vector2): void {
    this.speedPass.uniforms.uStrength.value = Math.max(0, Math.min(1, strength));
    if (center) {
      const c = this.speedPass.uniforms.uCenter.value as THREE.Vector2;
      c.set(center.x, center.y);
    }
  }

  /** Fire the one-shot impact frame; the envelope decays back to 0. */
  triggerImpact(): void {
    this.hit = 1;
    this.impactPass.uniforms.uHit.value = 1;
  }

  setBloomStrength(v: number): void {
    this.bloomPass.strength = v;
  }

  /** Advance time uniforms and decay the impact envelope. */
  update(dt: number): void {
    const t = this.clock.getElapsedTime();
    this.speedPass.uniforms.uTime.value = t;

    if (this.hit > 0) {
      this.hit = Math.max(0, this.hit - dt / IMPACT_DECAY);
      this.impactPass.uniforms.uHit.value = this.hit;
    }
  }

  render(): void {
    if (this.enabled) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  resize(w: number, h: number): void {
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
    this.bloomPass.resolution.set(w, h);
  }

  dispose(): void {
    this.composer.dispose();
    this.bloomPass.dispose();
    this.speedPass.dispose();
    this.impactPass.dispose();
  }
}
