/**
 * Cel-shading core for v2: a crisp 3-band toon ramp, a MeshToonMaterial factory with a
 * Fresnel rim injected via onBeforeCompile, and an inverted-hull ink-outline helper that
 * works for both static meshes and skinned characters. Slots into three's lighting system.
 */
import * as THREE from "three";
import { PAL } from "./palette";

/** A 1D step ramp sampled by NdotL*0.5+0.5. Boundaries set the terminator; NearestFilter keeps bands hard. */
export function makeToonRamp(stops: { at: number; v: number }[]): THREE.DataTexture {
  const W = 256;
  const data = new Uint8Array(W * 4);
  for (let i = 0; i < W; i += 1) {
    const x = i / (W - 1);
    let v = stops[0].v;
    for (const s of stops) if (x >= s.at) v = s.v;
    const c = Math.round(v * 255);
    data[i * 4] = c;
    data[i * 4 + 1] = c;
    data[i * 4 + 2] = c;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, W, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Mostly-lit anime ramp: tight shadow, a mid plateau, a bright core. Terminator pushed bright-ward. */
export const DEFAULT_RAMP = makeToonRamp([
  { at: 0.0, v: 0.34 },
  { at: 0.52, v: 0.72 },
  { at: 0.8, v: 1.0 },
]);

export type ToonOpts = {
  color?: THREE.ColorRepresentation;
  rimColor?: THREE.ColorRepresentation;
  rimPow?: number;
  rimStrength?: number;
  ramp?: THREE.DataTexture;
};

/**
 * A cel material: MeshToonMaterial (full lighting/shadow/mood support) + a Fresnel rim added in
 * the fragment. The rim color/strength are uniforms so the choreography can pulse the hero glow.
 */
export function createToonMaterial(opts: ToonOpts = {}): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    color: opts.color ?? 0xffffff,
    gradientMap: opts.ramp ?? DEFAULT_RAMP,
  });
  const rimColor = new THREE.Color(opts.rimColor ?? PAL.rim);
  const rimPow = opts.rimPow ?? 3.0;
  const rimStrength = opts.rimStrength ?? 0.9;
  mat.userData.rim = { color: rimColor, pow: { value: rimPow }, strength: { value: rimStrength } };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRimColor = { value: rimColor };
    sh.uniforms.uRimPow = mat.userData.rim.pow;
    sh.uniforms.uRimStrength = mat.userData.rim.strength;
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <common>",
      "#include <common>\nuniform vec3 uRimColor;\nuniform float uRimPow;\nuniform float uRimStrength;",
    );
    // Add the rim to outgoingLight just before it becomes gl_FragColor.
    const anchor = sh.fragmentShader.includes("#include <opaque_fragment>")
      ? "#include <opaque_fragment>"
      : "#include <output_fragment>";
    sh.fragmentShader = sh.fragmentShader.replace(
      anchor,
      `{
        vec3 vn = normalize(normal);
        vec3 vd = normalize(vViewPosition);
        float rim = pow(clamp(1.0 - max(dot(vn, vd), 0.0), 0.0, 1.0), uRimPow);
        outgoingLight += uRimColor * rim * uRimStrength;
      }
      ${anchor}`,
    );
  };
  return mat;
}

/** Pulse a toon material's rim (e.g. crank the hero glow during the strike). */
export function setRimStrength(mat: THREE.MeshToonMaterial, strength: number) {
  if (mat.userData.rim) mat.userData.rim.strength.value = strength;
}

/**
 * Inverted-hull ink outline. Renders a back-faced copy expanded along normals. Handles skinned
 * meshes (shares the skeleton so it deforms with the character). Returns the outline object.
 */
export function addInkOutline(
  mesh: THREE.Mesh | THREE.SkinnedMesh,
  color: THREE.ColorRepresentation = PAL.outline,
  thickness = 0.006,
): THREE.Object3D {
  // Based on MeshToonMaterial so the (skinned) view-space normal + skinning chunks are present,
  // then forced flat-unlit. Expansion is done in CLIP space (constant screen width, independent
  // of the model's local unit scale) rather than local space, which would balloon tiny-unit models.
  const mat = new THREE.MeshToonMaterial({ color, side: THREE.BackSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uThick = { value: thickness };
    sh.vertexShader = ("uniform float uThick;\n" + sh.vertexShader).replace(
      "#include <project_vertex>",
      "#include <project_vertex>\n  vec3 vOutN = normalize(transformedNormal);\n  gl_Position.xy += vOutN.xy * uThick * gl_Position.w;",
    );
    const anchor = sh.fragmentShader.includes("#include <opaque_fragment>")
      ? "#include <opaque_fragment>"
      : "#include <output_fragment>";
    sh.fragmentShader = sh.fragmentShader.replace(anchor, `outgoingLight = diffuse;\n${anchor}`);
  };

  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
    const src = mesh as THREE.SkinnedMesh;
    const outline = new THREE.SkinnedMesh(src.geometry, mat);
    outline.bind(src.skeleton, src.bindMatrix);
    outline.frustumCulled = false;
    src.add(outline); // shares the skeleton, so it deforms with the character
    return outline;
  }
  const outline = new THREE.Mesh(mesh.geometry, mat);
  mesh.add(outline);
  return outline;
}
