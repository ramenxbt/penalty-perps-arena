/**
 * Generated, texture-free materials. Everything here is procedural (shaders, canvas
 * gradients) so there are no image assets to load and the look stays crisp at any zoom.
 */

import * as THREE from "three";

/* ------------------------------------------------------------------ */
/* Soccer ball: a real truncated-icosahedron panel pattern via Voronoi */
/* ------------------------------------------------------------------ */

function soccerBallCenters(): { centers: THREE.Vector3[]; isPentagon: number[] } {
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const pos = ico.attributes.position;
  const get = (i: number) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
  const pentagons = new Map<string, THREE.Vector3>();
  const hexagons: THREE.Vector3[] = [];
  for (let f = 0; f < pos.count; f += 3) {
    const a = get(f);
    const b = get(f + 1);
    const c = get(f + 2);
    hexagons.push(a.clone().add(b).add(c).normalize());
    for (const v of [a, b, c]) {
      const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
      if (!pentagons.has(key)) pentagons.set(key, v);
    }
  }
  ico.dispose();
  const pentList = [...pentagons.values()];
  const centers = [...pentList, ...hexagons];
  const isPentagon = centers.map((_, i) => (i < pentList.length ? 1 : 0));
  return { centers, isPentagon };
}

const BALL_PANELS = soccerBallCenters();

/** Glossy PBR sphere shaded as a black/white soccer ball, lit by the scene. */
export function createSoccerBall(radius: number): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(radius, 48, 48);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.38, metalness: 0.06 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCenters = { value: BALL_PANELS.centers };
    shader.uniforms.uIsPent = { value: BALL_PANELS.isPentagon };
    shader.uniforms.uSeam = { value: 0.02 };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBallPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBallPos = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vBallPos;
        uniform vec3 uCenters[32];
        uniform float uIsPent[32];
        uniform float uSeam;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          vec3 p = normalize(vBallPos);
          float best = -2.0; float second = -2.0; int bi = 0;
          for (int i = 0; i < 32; i++) {
            float d = dot(p, uCenters[i]);
            if (d > best) { second = best; best = d; bi = i; }
            else if (d > second) { second = d; }
          }
          float edge = smoothstep(0.0, uSeam, best - second);
          vec3 panel = uIsPent[bi] > 0.5 ? vec3(0.03) : vec3(0.96);
          diffuseColor.rgb *= mix(vec3(0.0), panel, edge);
        }`,
      );
  };
  material.customProgramCacheKey = () => "arena-soccerball";
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* Sky dome: vertical gradient with a soft horizon glow                */
/* ------------------------------------------------------------------ */

export function createSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x0a1f17) },
      uBottom: { value: new THREE.Color(0x05080a) },
      uHorizon: { value: new THREE.Color(0x123b27) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 uTop;
      uniform vec3 uBottom;
      uniform vec3 uHorizon;
      void main() {
        float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
        float horizon = smoothstep(0.35, 0.5, h) * (1.0 - smoothstep(0.5, 0.7, h));
        vec3 col = mix(uBottom, uTop, pow(h, 1.2));
        col += uHorizon * horizon * 0.6;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/* ------------------------------------------------------------------ */
/* Pitch: procedural mowing stripes + radial vignette, still PBR-lit   */
/* ------------------------------------------------------------------ */

export function createPitchMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0x0c2a19, roughness: 0.96, metalness: 0.02 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vPitchUv;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvPitchUv = uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vPitchUv;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          float band = step(0.5, fract(vPitchUv.y * 7.0));
          vec3 turf = mix(vec3(0.043, 0.149, 0.090), vec3(0.071, 0.196, 0.122), band);
          float d = distance(vPitchUv, vec2(0.5));
          turf *= smoothstep(1.05, 0.15, d);
          diffuseColor.rgb = turf;
        }`,
      );
  };
  material.customProgramCacheKey = () => "arena-pitch";
  return material;
}

/* ------------------------------------------------------------------ */
/* Additive glow sprite (the cheap "bloom") + shared geometry helpers  */
/* ------------------------------------------------------------------ */

let glowTexture: THREE.CanvasTexture | null = null;

export function getGlowTexture(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.5)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  glowTexture = new THREE.CanvasTexture(canvas);
  return glowTexture;
}

export function createGlowSprite(color: number, scale: number): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(scale);
  return sprite;
}
