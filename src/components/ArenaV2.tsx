/**
 * ArenaV2: the playable v2 view. Drives the cel-shaded SceneV2 from the full cup session
 * (useSession: welcome -> lobby -> countdown -> in_match -> round_break -> match_results) and
 * the existing trade-to-shoot logic, with audio. The resolved round outcome drives the kick
 * volley (forced to match the authoritative shots/goals). Mounted at /?v2. v1 is untouched.
 */
import { CSSProperties, ReactNode, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { SceneV2 } from "../arena-v2/SceneV2";
import { useArenaAudio } from "../hooks/useArenaAudio";
import { useSession } from "../hooks/useSession";
import { Candles } from "./Candles";

const cleanName = (n: string) => n.replace(/^AI (Squad|Keeper): /, "");

export function ArenaV2() {
  const game = useSession();
  const auth = useAuth();
  useArenaAudio(game.phase, game.outcome, game.shooters);
  const [showStandings, setShowStandings] = useState(false);
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

  // Drive the kick volley once per resolved outcome, only during a match.
  const playedRef = useRef<unknown>(null);
  useEffect(() => {
    const o = game.outcome;
    if (!o || playedRef.current === o || game.sessionPhase !== "in_match") return;
    if (game.phase !== "resolving" && game.phase !== "settled") return;
    playedRef.current = o;
    sceneRef.current?.playVolley(o.shots, o.goals);
  }, [game.phase, game.outcome, game.sessionPhase]);

  const sp = game.sessionPhase;
  const inMatch = sp === "in_match";
  const flat = inMatch && (game.phase === "idle" || game.phase === "settled");
  const trading = inMatch && game.phase === "trading";
  const canOpen = flat && game.ready && game.marketReady && game.roundsLeft > 0 && !game.busy;
  const pnl = game.pnlPct;
  const pnlColor = pnl >= 0 ? "#2fd07a" : "#ff5247";

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#05060f" }}>
      <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", display: "block" }} />

      {inMatch && (
        <>
          <div style={topBar}>
            <Chip label="SCORE" value={String(game.score)} />
            <Chip label="STREAK" value={String(game.streak)} />
            <Chip label="ROUND" value={`${game.roundNumber}/${game.matchRounds}`} />
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
                <button style={{ ...btn, background: "#1238ff", opacity: game.canCloseNow ? 1 : 0.5 }} onClick={() => game.closeNow()} disabled={!game.canCloseNow}>
                  BANK {game.shotsNow} {game.shotsNow === 1 ? "SHOT" : "SHOTS"}
                </button>
              </>
            ) : (
              <>
                <button style={{ ...btn, background: "#2fd07a", color: "#04210f", opacity: canOpen ? 1 : 0.4 }} onClick={() => game.openTrade("long")} disabled={!canOpen}>
                  LONG
                </button>
                <button style={{ ...btn, background: "#ff5247", opacity: canOpen ? 1 : 0.4 }} onClick={() => game.openTrade("short")} disabled={!canOpen}>
                  SHORT
                </button>
              </>
            )}
          </div>
        </>
      )}

      {!inMatch && sp !== "countdown" && !showStandings && (
        <button style={acctChip} onClick={() => (auth.isAuthenticated ? auth.logout() : auth.login())}>
          {auth.isAuthenticated ? (auth.user?.displayName ?? "@you") : "Connect"}
        </button>
      )}

      {sp === "welcome" && !showStandings && (
        <Overlay>
          <div style={eyebrow}>MERIDIAN CUP</div>
          <h1 style={title}>PENALTY PERPS</h1>
          <p style={sub}>Trade the chart. Earn your shots. Beat the keeper.</p>
          <PrimaryButton onClick={() => game.enterLobby()}>Enter arena</PrimaryButton>
          <SecondaryButton onClick={() => setShowStandings(true)}>Season standings</SecondaryButton>
        </Overlay>
      )}

      {sp === "lobby" && !showStandings && (
        <Overlay>
          <div style={eyebrow}>MERIDIAN CUP</div>
          <h1 style={title}>Ready up</h1>
          <p style={sub}>{game.matchRounds} rounds. Read the market, bury your chances.</p>
          <PrimaryButton onClick={() => game.startMatch()}>Start match</PrimaryButton>
          <SecondaryButton onClick={() => setShowStandings(true)}>Season standings</SecondaryButton>
        </Overlay>
      )}

      {showStandings && (
        <Overlay>
          <div style={eyebrow}>SEASON LADDER</div>
          <div style={ladderList}>
            {game.ladder.slice(0, 12).map((r) => {
              const me = r.id === game.meId;
              return (
                <div key={r.id} style={{ ...ladderRow, ...(me ? ladderMe : null) }}>
                  <span style={{ width: 26, color: "#7e8aa8" }}>{r.rank}</span>
                  <span style={{ flex: 1, textAlign: "left", color: me ? "#54f0ff" : "#e8edff" }}>
                    {cleanName(r.name)}
                    {me ? " (you)" : ""}
                  </span>
                  <span style={{ width: 72, textAlign: "right" }}>{r.score}</span>
                </div>
              );
            })}
          </div>
          <PrimaryButton onClick={() => setShowStandings(false)}>Back</PrimaryButton>
        </Overlay>
      )}

      {sp === "countdown" && (
        <div style={countdownStyle}>{game.countin > 0 ? game.countin : "GO"}</div>
      )}

      {sp === "round_break" && (
        <Overlay>
          <div style={eyebrow}>
            ROUND {game.roundNumber}/{game.matchRounds}
          </div>
          <h1 style={title}>{game.score} pts</h1>
          <p style={sub}>Streak {game.streak}</p>
          <PrimaryButton onClick={() => game.advanceRound()}>
            {game.isFinalRound ? "See results" : `Next round${game.breakSecondsLeft ? ` (${game.breakSecondsLeft})` : ""}`}
          </PrimaryButton>
        </Overlay>
      )}

      {sp === "match_results" && game.matchResult && !showStandings && (
        <Overlay>
          <div style={eyebrow}>CUP COMPLETE</div>
          <h1 style={title}>
            {placementLabel(game.matchResult.placement)} of {game.matchResult.fieldSize}
          </h1>
          <p style={sub}>
            {game.matchResult.totals.points} pts · {game.matchResult.totals.goals}{" "}
            {game.matchResult.totals.goals === 1 ? "goal" : "goals"}
          </p>
          <PrimaryButton onClick={() => game.findNewMatch()}>Play again</PrimaryButton>
          <SecondaryButton onClick={() => setShowStandings(true)}>Season standings</SecondaryButton>
        </Overlay>
      )}

      {shout && <div style={shoutStyle(shout)}>{shout === "goal" ? "GOOOAL" : "SAVED"}</div>}
    </div>
  );
}

function placementLabel(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <div style={chip}>
      <span style={lbl}>{label}</span>
      <strong style={val}>{value}</strong>
    </div>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div style={overlayWrap}>
      <div style={overlayPanel}>{children}</div>
    </div>
  );
}

function PrimaryButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button style={primaryBtn} onClick={onClick}>
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button style={secondaryBtn} onClick={onClick}>
      {children}
    </button>
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

const overlayWrap: CSSProperties = { position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, background: "radial-gradient(ellipse at center, rgba(5,6,15,0.35), rgba(5,6,15,0.78))" };
const overlayPanel: CSSProperties = { display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "38px 48px", textAlign: "center", background: "rgba(8,10,22,0.66)", border: "1px solid rgba(120,150,255,0.22)", borderRadius: 18, backdropFilter: "blur(10px)" };
const eyebrow: CSSProperties = { fontSize: 12, letterSpacing: "0.3em", color: "#54f0ff" };
const title: CSSProperties = { margin: 0, fontSize: 44, fontWeight: 900, fontStyle: "italic", color: "#e8edff", letterSpacing: "0.02em" };
const sub: CSSProperties = { margin: 0, fontSize: 14, color: "#9aa6c8" };
const primaryBtn: CSSProperties = { marginTop: 8, fontFamily: mono, fontWeight: 800, fontSize: 18, letterSpacing: "0.08em", color: "#04210f", background: "#2fd07a", border: "none", borderRadius: 14, padding: "15px 34px", cursor: "pointer", boxShadow: "0 8px 28px rgba(47,208,122,0.35)" };
const secondaryBtn: CSSProperties = { fontFamily: mono, fontWeight: 700, fontSize: 13, letterSpacing: "0.1em", color: "#9aa6c8", background: "transparent", border: "1px solid rgba(120,150,255,0.25)", borderRadius: 12, padding: "10px 22px", cursor: "pointer" };
const acctChip: CSSProperties = { position: "fixed", top: 16, right: 18, fontFamily: mono, fontWeight: 700, fontSize: 13, letterSpacing: "0.08em", color: "#e8edff", background: "rgba(8,10,22,0.6)", border: "1px solid rgba(120,150,255,0.25)", borderRadius: 12, padding: "10px 18px", cursor: "pointer", backdropFilter: "blur(6px)" };
const ladderList: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, width: "min(80vw, 380px)", maxHeight: "46vh", overflowY: "auto", fontFamily: mono, fontSize: 14 };
const ladderRow: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, color: "#cfd6ea", background: "rgba(255,255,255,0.03)" };
const ladderMe: CSSProperties = { background: "rgba(84,240,255,0.1)", border: "1px solid rgba(84,240,255,0.35)" };
const countdownStyle: CSSProperties = { position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", fontFamily: '"Arial Black", Impact, sans-serif', fontStyle: "italic", fontSize: "min(28vw, 340px)", fontWeight: 900, color: "#e8edff", WebkitTextStroke: "5px #54f0ff", textShadow: "0 0 50px rgba(84,240,255,0.6)" };

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
