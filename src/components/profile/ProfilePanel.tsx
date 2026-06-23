/**
 * Player profile (v1). Reached by clicking your identity in the topbar; renders in the center
 * stage. Centers the 3D critter, then your season standing, tier progress, honors, and last
 * cup. Everything here is fed from data already available this session (no backend persistence
 * yet), so it is framed as "season standing", not lifetime career. See BACKEND_HANDOFF.md for
 * the career-stats follow-up.
 */
import { lazy, Suspense, useState } from "react";
import { BadgeCheck, Check, Flame, Goal, Lock, Share2, Trophy } from "lucide-react";
import { MatchResult } from "../../game/match";
import { truncateAddress } from "../../auth/AuthContext";
import { ordinal } from "../../lib/format";
import { seasonTier, SEASON_TIERS } from "../../lib/season";
import { buildProfileCard, copyCanvasToClipboard, downloadCanvas } from "../../lib/shareCard";

const ProfileCharacter = lazy(() =>
  import("../../components/profile/ProfileCharacter").then((m) => ({ default: m.ProfileCharacter })),
);

export type ProfilePanelProps = {
  playerId: string;
  handle: string;
  walletAddress: string | null;
  isHolder: boolean;
  tokenSymbol: string;
  rank: number;
  fieldSize: number;
  seasonPoints: number;
  streak: number;
  roundsLeft: number;
  dailyCap: number;
  lastMatch: MatchResult | null;
  onBack: () => void;
};

export function ProfilePanel(props: ProfilePanelProps) {
  const {
    playerId,
    handle,
    walletAddress,
    isHolder,
    tokenSymbol,
    rank,
    fieldSize,
    seasonPoints,
    streak,
    roundsLeft,
    dailyCap,
    lastMatch,
    onBack,
  } = props;

  const [shared, setShared] = useState<"idle" | "copied" | "saved">("idle");
  const tier = seasonTier(seasonPoints);

  const onShare = async () => {
    const canvas = buildProfileCard({ handle, rank, fieldSize, seasonPoints, tier: tier.name });
    const copied = await copyCanvasToClipboard(canvas);
    if (!copied) downloadCanvas(canvas, "penalty-perps-profile.png");
    setShared(copied ? "copied" : "saved");
    window.setTimeout(() => setShared("idle"), 2600);
  };

  const bestRoundGoals = lastMatch?.bestRound.goals ?? 0;
  const honors = [
    { name: "Holder", sub: `Hold ${tokenSymbol}`, icon: BadgeCheck, earned: isHolder },
    { name: "Hat Trick", sub: "3 goals in one round", icon: Goal, earned: bestRoundGoals >= 3 },
    { name: "Cup Winner", sub: "Win a cup", icon: Trophy, earned: lastMatch?.placement === 1 },
    { name: "On Fire", sub: "4 win streak", icon: Flame, earned: streak >= 4 },
    { name: "Iron Hands", sub: "Win a cup conceding none", icon: Lock, earned: false },
    { name: "Sharpshooter", sub: "Bank 50 career goals", icon: Lock, earned: false },
  ];
  const earnedCount = honors.filter((h) => h.earned).length;

  return (
    <section className="results-panel profile-panel">
      <div className="result-head profile-head">
        <span className="eyebrow">CIRCUIT IDENTITY</span>
        <button className="ghost-action" type="button" onClick={onBack}>
          Back to arena
        </button>
      </div>

      <div className="profile-hero">
        <div className="profile-critter arena-card">
          <Suspense fallback={<div className="arena-scene arena-loading" aria-label="Loading your character" />}>
            <ProfileCharacter playerId={playerId} isYou className="profile-critter-canvas" />
          </Suspense>
        </div>
        <div className="profile-identity">
          <h2 className="profile-handle">{handle || "Unnamed striker"}</h2>
          <span className="profile-rank">Rank {rank} of {fieldSize}</span>
          <div className="profile-badges">
            {isHolder && (
              <span className="token-chip active">
                <BadgeCheck size={14} /> {tokenSymbol} holder
              </span>
            )}
            {streak >= 2 && (
              <span className={"profile-streak-chip" + (streak >= 4 ? " blaze" : "")}>
                <Flame size={14} /> {streak} win streak
              </span>
            )}
          </div>
          <div className="profile-headline">
            <span>SEASON POINTS</span>
            <strong>{seasonPoints.toLocaleString()}</strong>
          </div>
          {walletAddress && <span className="profile-wallet">{truncateAddress(walletAddress)}</span>}
        </div>
      </div>

      <div className="section-heading">
        <h2>Season standing</h2>
        <span>this season</span>
      </div>
      <div className="result-stats profile-stats">
        <div className="stat-cell">
          <span>POINTS</span>
          <strong>{seasonPoints.toLocaleString()}</strong>
        </div>
        <div className="stat-cell">
          <span>RANK</span>
          <strong>#{rank}</strong>
          <small>of {fieldSize}</small>
        </div>
        <div className="stat-cell">
          <span>STREAK</span>
          <strong>{streak}</strong>
          <small>{streak === 1 ? "win" : "wins"}</small>
        </div>
        <div className="stat-cell">
          <span>ROUNDS TODAY</span>
          <strong>{roundsLeft}</strong>
          <small>of {dailyCap} left</small>
        </div>
      </div>

      <div className="section-heading">
        <h2>Season progress</h2>
        <span>{tier.nextName ? `${tier.ptsToNext?.toLocaleString()} pts to ${tier.nextName}` : "Top tier reached"}</span>
      </div>
      <div className="tier-block">
        <div className="tier-name">Tier: {tier.name}</div>
        <div className="tier-bar">
          <span className="tier-fill" style={{ width: `${Math.round(tier.progressPct * 100)}%` }} />
        </div>
        <div className="tier-ticks">
          {SEASON_TIERS.map((name) => (
            <span key={name} className={name === tier.name ? "lit" : ""}>
              {name}
            </span>
          ))}
        </div>
      </div>

      <div className="section-heading">
        <h2>Honors</h2>
        <span>{earnedCount} of {honors.length} earned</span>
      </div>
      <div className="honors-grid">
        {honors.map((h) => {
          const Icon = h.earned ? h.icon : Lock;
          return (
            <div key={h.name} className={"badge-cell" + (h.earned ? " earned" : "")}>
              <Icon size={18} />
              <strong>{h.earned ? h.name : "Locked"}</strong>
              <small>{h.sub}</small>
            </div>
          );
        })}
      </div>

      <div className="section-heading">
        <h2>Last cup</h2>
      </div>
      {lastMatch ? (
        <div className="standing-row board-row you profile-lastcup">
          <span className="rank">{ordinal(lastMatch.placement)}</span>
          <div className="board-name">
            <strong>of {lastMatch.fieldSize}</strong>
            <span>{lastMatch.bestRound.goals} goals best round</span>
          </div>
          <span className="standing-goals">{lastMatch.totals.goals} G</span>
          <span className="board-score">{lastMatch.totals.points.toLocaleString()}</span>
        </div>
      ) : (
        <p className="profile-empty">No cups yet. Enter the arena to start your record.</p>
      )}

      <div className="result-cta">
        <button className="primary-action full" type="button" onClick={onShare}>
          {shared === "idle" ? <Share2 size={16} /> : <Check size={16} />}
          {shared === "copied" ? "Copied to clipboard" : shared === "saved" ? "Image saved" : "Share profile card"}
        </button>
        <span className="cta-note">Paper points only. No deposits, no custody.</span>
      </div>
    </section>
  );
}
