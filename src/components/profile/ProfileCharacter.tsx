/**
 * A self-contained 3D portrait of a player's critter for the profile page. It mirrors the
 * lifecycle of ArenaScene (ResizeObserver sizing, clamped-dt rAF, full dispose) but stands
 * completely alone: its own tiny renderer + scene + studio lighting, no SceneManager /
 * CameraRig / Arena / Environment. The critter species and color come from identity.ts so
 * the portrait matches who the player is on the pitch; the local player gets the brand gold.
 *
 * It is a good citizen for a page full of these: transparent background, paused when the
 * tab is hidden or the canvas scrolls offscreen, and a single static frame under
 * prefers-reduced-motion instead of a running loop.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { createCritter } from "../../arena/Critter";
import { identityColor, identityKind } from "../../arena/identity";
import { detectQuality } from "../../arena/quality";

export type ProfileCharacterProps = {
  playerId: string;
  isYou?: boolean;
  spin?: boolean;
  className?: string;
};

// The "you" brand gold, matching Arena.ts so the local player reads identically here.
const YOU_GOLD = 0xffc53d;
const SPIN_RATE = 0.55; // radians/sec on the turntable

export function ProfileCharacter(props: ProfileCharacterProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Keep the latest props in a ref so the rAF closure never goes stale and prop changes
  // (e.g. toggling spin) don't tear down the whole scene.
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const quality = detectQuality();
    const reduceMotion =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    // --- Renderer: transparent, ACES-toned, capped pixel ratio ---
    // WebGL can be unavailable or context-capped (headless browsers, some machines, too many
    // live contexts). Fail soft to a blank transparent canvas rather than crashing the page.
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.antialias, alpha: true });
    } catch {
      return undefined;
    }
    renderer.setClearAlpha(0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    renderer.setPixelRatio(Math.min(dpr, quality.pixelRatioCap));

    // --- Scene + camera (no fog) ---
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
    camera.position.set(0, 0.7, 2.6);
    camera.lookAt(0, 0.5, 0);

    // --- Critter on a turntable. Origin at feet (y=0), ~0.9 tall. ---
    const turntable = new THREE.Group();
    const kind = identityKind(propsRef.current.playerId);
    const color = propsRef.current.isYou ? YOU_GOLD : identityColor(propsRef.current.playerId);
    const critter = createCritter({ kind, color });
    turntable.add(critter);
    scene.add(turntable);

    // Reduced-motion gets a flattering static 3/4 angle instead of head-on.
    if (reduceMotion) turntable.rotation.y = -0.5;

    // --- Studio lighting: soft fill + warm key + cool rim. No shadows. ---
    const hemi = new THREE.HemisphereLight(0xffffff, 0x404656, 0.9);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff2e0, 1.25);
    key.position.set(1.2, 2.4, 2.2); // front-upper
    scene.add(key);

    const rim = new THREE.PointLight(0x7fa8ff, 0.9, 12, 2);
    rim.position.set(-1.6, 1.4, -1.8); // cool back-side rim
    scene.add(rim);

    // --- Sizing: drive renderer + camera from the canvas box ---
    const sizeToHost = () => {
      const width = canvas.clientWidth || canvas.parentElement?.clientWidth || 1;
      const height = canvas.clientHeight || canvas.parentElement?.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    sizeToHost();

    const renderFrame = () => renderer.render(scene, camera);

    const resizeObserver = new ResizeObserver(() => {
      sizeToHost();
      // A static portrait won't be redrawn by a loop, so refresh it on resize.
      if (reduceMotion || !running) renderFrame();
    });
    resizeObserver.observe(canvas);

    // --- Animation loop (skipped entirely under reduced motion) ---
    let raf = 0;
    let last = performance.now();
    let running = false;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); // clamp tab-refocus spikes
      last = now;
      if (propsRef.current.spin !== false) turntable.rotation.y += dt * SPIN_RATE;
      renderFrame();
    };

    const start = () => {
      if (running || reduceMotion) return;
      running = true;
      last = performance.now(); // reset so a long pause doesn't lurch the turntable
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    // --- Pause when hidden (tab) or scrolled offscreen; resume when shown ---
    let onscreen = true;

    const onVisibility = () => {
      if (document.hidden) stop();
      else if (onscreen) start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        onscreen = entries.some((e) => e.isIntersecting);
        if (onscreen && !document.hidden) start();
        else stop();
      },
      { threshold: 0 },
    );
    intersectionObserver.observe(canvas);

    if (reduceMotion) {
      renderFrame(); // single static frame
    } else {
      start();
    }

    // --- Cleanup: stop everything and free all GPU resources ---
    return () => {
      stop();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);

      // createCritter allocates per-mesh geometries and materials, so dispose each.
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = (mesh as THREE.Mesh).material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
      hemi.dispose();
      key.dispose();
      rim.dispose();

      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, []);

  return <canvas ref={canvasRef} className={props.className} aria-label="3D player character" />;
}
