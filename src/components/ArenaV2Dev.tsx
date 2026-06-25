/**
 * Standalone full-screen dev view for the v2 cel-shaded arena, mounted at /?v2 so it stays fully
 * isolated from the v1 app while we build. Not wrapped in StrictMode (single WebGL context).
 */
import { useEffect, useRef, useState } from "react";
import { SceneV2 } from "../arena-v2/SceneV2";

export function ArenaV2Dev() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [shout, setShout] = useState(false);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const scene = new SceneV2(canvas);
    let shoutTimer: number | undefined;
    scene.onResult = (kind) => {
      if (kind !== "goal") return;
      setShout(true);
      window.clearTimeout(shoutTimer);
      shoutTimer = window.setTimeout(() => setShout(false), 1400);
    };
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
      window.clearTimeout(shoutTimer);
      window.removeEventListener("resize", resize);
      scene.dispose();
    };
  }, []);
  return (
    <>
      <canvas ref={ref} style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", display: "block" }} />
      {shout && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            fontFamily: '"Arial Black", Impact, sans-serif',
            fontStyle: "italic",
            fontSize: "min(18vw, 220px)",
            fontWeight: 900,
            letterSpacing: "0.02em",
            color: "#e8edff",
            WebkitTextStroke: "4px #ff2e88",
            textShadow: "0 6px 0 rgba(255,46,136,0.45), 0 0 40px rgba(84,240,255,0.6)",
            transform: "rotate(-6deg)",
          }}
        >
          GOOOAL
        </div>
      )}
    </>
  );
}
