/**
 * Standalone full-screen dev view for the v2 cel-shaded arena, mounted at /?v2 so it stays fully
 * isolated from the v1 app while we build. Not wrapped in StrictMode (single WebGL context).
 */
import { useEffect, useRef } from "react";
import { SceneV2 } from "../arena-v2/SceneV2";

export function ArenaV2Dev() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const scene = new SceneV2(canvas);
    const resize = () => scene.resize(window.innerWidth, window.innerHeight);
    resize();
    window.addEventListener("resize", resize);
    let raf = 0;
    let prev = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - prev) / 1000);
      prev = t;
      scene.update(dt);
      scene.render();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      scene.dispose();
    };
  }, []);
  return <canvas ref={ref} style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", display: "block" }} />;
}
