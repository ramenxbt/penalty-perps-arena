/**
 * ArenaV2: the playable v2 view. Reuses the existing trade-to-shoot logic (useGameSimulation)
 * and renders the cel-shaded SceneV2 + a minimal behind-kicker HUD. The resolved round outcome
 * drives the kick volley (the kicks are forced to match the authoritative shots/goals), so the
 * visuals always agree with the game logic. Mounted at /?v2.
 */
import { CSSProperties, useEffect, useRef, useState } from "react";
import { SceneV2 } from "../arena-v2/SceneV2";
import { useGameSimulation } from "../hooks/useGameSimulation";
import { Candles } from "./Candles";

export function ArenaV2() {
  const game = useGameSimulation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<SceneV2 | null>(null);
  const [shout, setShout] = useState<"goal" | "save" | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = new SceneV2(canvas);
    scene.autoplay = false; // driven by the round outcome, not the dev loop
    sceneRef.current = scene;
    let shoutTimer: number | undefined;
    scene.onResult = (kind) => {
      setShout(kind);
      window.clearTimeout(shoutTimer);
      shoutTimer = window.setTimeout(() => setShout(null), 1300);
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
      sceneRef.current = null;
    };
  }, []);

  // Drive the kick volley once per resolved outcome.
  const playedRef = useRef<unknown>(null);
  useEffect(() => {
    const o = game.outcome;
    if (!o || playedRef.current === o) return;
    if (game.phase !== "resolving" && game.phase !== "settled") return;
    playedRef.current = o;
    sceneRef.current?.playVolley(o.shots, o.goals);
  }, [game.phase, game.outcome]);

  const flat = game.phase === "idle" || game.phase === "settled";
  const trading = game.phase === "trading";
  const canOpen = flat && game.ready && game.marketReady && game.roundsLeft > 0 && !game.busy;
  const pnl = game.pnlPct;
  const pnlColor = pnl >= 0 ? "#2fd07a" : "#ff5247";

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#05060f" }}>
      <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", display: "block" }} />

      <div style={topBar}>
        <Chip label="SCORE" value={String(game.score)} />
        <Chip label="STREAK" value={String(game.streak)} />
        <Chip label="ROUNDS" value={String(game.roundsLeft)} />
        <div style={{ marginLeft: "auto" }}>
          <Chip label={game.marketAsset.displayPair} value={`$${game.derived.price.toFixed(2)}`} />
        </div>
      </div>

      <div style={chartWrap}>
        <Candles points={game.market} entryPrice={game.entryPrice} asset={game.marketAsset} pnlPct={trading ? pnl : null} />
      </div>

      <div style={dock}>
        {trading ? (
          <>
            <div style={{ ...val, fontSize: 30, color: pnlColor, minWidth: 120, textAlign: "center" }}>
              {pnl >= 0 ? "+" : ""}
              {pnl.toFixed(2)}%
            </div>
            <button
              style={{ ...btn, background: "#1238ff", opacity: game.canCloseNow ? 1 : 0.5 }}
              onClick={() => game.closeNow()}
              disabled={!game.canCloseNow}
            >
              BANK {game.shotsNow} {game.shotsNow === 1 ? "SHOT" : "SHOTS"}
            </button>
          </>
        ) : (
          <>
            <button
              style={{ ...btn, background: "#2fd07a", color: "#04210f", opacity: canOpen ? 1 : 0.4 }}
              onClick={() => game.openTrade("long")}
              disabled={!canOpen}
            >
              LONG
            </button>
            <button
              style={{ ...btn, background: "#ff5247", opacity: canOpen ? 1 : 0.4 }}
              onClick={() => game.openTrade("short")}
              disabled={!canOpen}
            >
              SHORT
            </button>
          </>
        )}
      </div>

      {shout && <div style={shoutStyle(shout)}>{shout === "goal" ? "GOOOAL" : "SAVED"}</div>}
    </div>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <div style={chip}>
      <span style={lbl}>{label}</span>
      <strong style={val}>{value}</strong>
    </div>
  );
}

const mono = '"IBM Plex Mono", ui-monospace, monospace';
const topBar: CSSProperties = { position: "fixed", top: 0, left: 0, right: 0, display: "flex", gap: 10, padding: "14px 18px", pointerEvents: "none", fontFamily: mono };
const chip: CSSProperties = { display: "flex", flexDirection: "column", padding: "6px 12px", background: "rgba(8,10,22,0.6)", border: "1px solid rgba(120,150,255,0.2)", borderRadius: 10, backdropFilter: "blur(6px)" };
const lbl: CSSProperties = { fontSize: 9, letterSpacing: "0.12em", color: "#7e8aa8" };
const val: CSSProperties = { fontSize: 18, color: "#e8edff", fontWeight: 700, fontFamily: mono };
const chartWrap: CSSProperties = { position: "fixed", left: 16, bottom: 16, width: "min(38vw, 380px)", height: 160, background: "rgba(8,10,22,0.55)", border: "1px solid rgba(120,150,255,0.18)", borderRadius: 12, overflow: "hidden", backdropFilter: "blur(6px)" };
const dock: CSSProperties = { position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 14, alignItems: "center" };
const btn: CSSProperties = { fontFamily: mono, fontWeight: 800, fontSize: 18, letterSpacing: "0.08em", color: "#eaf0ff", border: "none", borderRadius: 14, padding: "16px 30px", cursor: "pointer", boxShadow: "0 8px 24px rgba(0,0,0,0.45)" };

function shoutStyle(kind: "goal" | "save"): CSSProperties {
  const goal = kind === "goal";
  return {
    position: "fixed",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
    fontFamily: '"Arial Black", Impact, sans-serif',
    fontStyle: "italic",
    fontSize: goal ? "min(18vw, 220px)" : "min(13vw, 150px)",
    fontWeight: 900,
    color: goal ? "#e8edff" : "#cfe6ff",
    WebkitTextStroke: goal ? "4px #ff2e88" : "4px #54f0ff",
    textShadow: goal ? "0 6px 0 rgba(255,46,136,0.45), 0 0 40px rgba(84,240,255,0.6)" : "0 5px 0 rgba(84,240,255,0.4)",
    transform: "rotate(-6deg)",
  };
}
