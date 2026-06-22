/**
 * React mount point for the Three.js arena engine.
 *
 * This component is deliberately thin: it owns the canvas, instantiates the engine
 * modules (SceneManager, CameraRig, Lighting, Environment, Arena), runs one rAF loop
 * with a clamped delta time, and feeds live game state in through a ref (so prop changes
 * never tear down the scene). It also runs a lightweight adaptive-quality fallback:
 * if the frame rate sags it drops the pixel-ratio cap, the cheapest perf lever.
 *
 * Engine modules live in src/arena/* and are framework-agnostic and reusable.
 */

import { useEffect, useRef } from "react";
import { Arena, ArenaState } from "./arena/Arena";
import { CameraRig } from "./arena/CameraRig";
import { Environment } from "./arena/Environment";
import { Lighting } from "./arena/Lighting";
import { detectQuality, downgrade, QualitySettings } from "./arena/quality";
import { SceneManager } from "./arena/SceneManager";
import { ScoreboardData } from "./arena/Scoreboard";
import { RoundPhase, Shooter } from "./game/types";

type ArenaSceneProps = {
  phase: RoundPhase;
  shooters: Shooter[];
  hud: ScoreboardData;
};

const SHOW_STATS = typeof window !== "undefined" && window.location.search.includes("stats");

export function ArenaScene({ phase, shooters, hud }: ArenaSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const statsRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<ArenaState>({ phase, shooters, hud });
  stateRef.current = { phase, shooters, hud };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let quality: QualitySettings = detectQuality();
    const scene = new SceneManager(canvas, quality);
    const rig = new CameraRig(1);
    const lighting = new Lighting(scene.scene, quality);
    const environment = new Environment(scene.scene, quality);
    const arena = new Arena(scene.scene, quality, stateRef.current.shooters);

    const sizeToHost = () => {
      const width = canvas.clientWidth || canvas.parentElement?.clientWidth || 1;
      const height = canvas.clientHeight || canvas.parentElement?.clientHeight || 1;
      scene.setSize(width, height);
      rig.setAspect(width / height);
    };
    sizeToHost();
    const resizeObserver = new ResizeObserver(sizeToHost);
    resizeObserver.observe(canvas);

    let raf = 0;
    let last = performance.now();
    let elapsed = 0;
    // Adaptive quality sampling.
    let frames = 0;
    let sampleStart = last;
    let downgraded = false;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); // clamp tab-refocus spikes
      last = now;
      elapsed += dt;

      environment.update(dt, elapsed);
      arena.update(dt, elapsed, stateRef.current, rig);
      rig.update(dt, elapsed);
      scene.render(rig.camera);

      frames += 1;
      const sampleMs = now - sampleStart;
      if (sampleMs >= 1000) {
        const fps = Math.round((frames * 1000) / sampleMs);
        if (statsRef.current) statsRef.current.textContent = `${fps} fps · ${quality.tier}`;
        // One-shot downgrade if we are clearly missing frames.
        if (!downgraded && fps < 45 && quality.tier !== "low") {
          quality = downgrade(quality);
          scene.setPixelRatioCap(quality.pixelRatioCap);
          downgraded = true;
        }
        frames = 0;
        sampleStart = now;
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      arena.dispose();
      environment.dispose();
      lighting.dispose();
      scene.dispose();
    };
  }, []);

  const you = shooters.find((s) => s.isYou);
  const showFlash = phase === "settled" && !!you;
  const flashText = you
    ? you.shots <= 0
      ? "NO KICK"
      : you.goals > 0
        ? you.goals > 1
          ? `${you.goals} GOALS`
          : "GOAL"
        : "SAVED"
    : "";
  const flashClass = you && you.goals > 0 ? "is-goal" : "is-saved";

  return (
    <>
      <canvas className="arena-scene" ref={canvasRef} aria-label="3D penalty arena" />
      {SHOW_STATS && <div className="arena-stats" ref={statsRef} aria-hidden="true" />}
      {showFlash && (
        <div className={`goal-flash ${flashClass}`} aria-hidden="true">
          <span>{flashText}</span>
        </div>
      )}
    </>
  );
}
