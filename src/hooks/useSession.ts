/**
 * Session orchestrator. Wraps the single-round game loop (useGameSimulation) into a
 * "cup run": lobby -> countdown -> in_match -> round_break -> match_results, played
 * against an AI field. It gates trading to the in-match phase, tallies each round into
 * live match standings, and computes a final placement. The persistent season standing
 * stays the existing leaderboard (updated by the round loop); this layer is additive.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RULES } from "../game/engine";
import {
  buildField,
  buildLadder,
  MatchParticipant,
  MatchResult,
  matchSummary,
  rankParticipants,
  SessionPhase,
  shooterRoundPoints,
} from "../game/match";
import { Direction } from "../game/types";
import { useGameSimulation } from "./useGameSimulation";

const ROUND_BREAK_AUTO_MS = 5000;
const MATCH_ROUNDS = RULES.matchRounds;

export function useSession() {
  const game = useGameSimulation();

  const [sessionPhase, setSessionPhase] = useState<SessionPhase>("welcome");
  const [participants, setParticipants] = useState<MatchParticipant[]>([]);
  const [roundIndex, setRoundIndex] = useState(0); // 0-based index of the active round
  const [bestRound, setBestRound] = useState({ round: 0, goals: 0 });
  const [rankBefore, setRankBefore] = useState(0);
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [countin, setCountin] = useState(3);
  const [breakNow, setBreakNow] = useState(0);

  const breakEndsAtRef = useRef(0);
  const talliedRef = useRef(-1);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Your identity comes from the volley roster (always present), with a season seed.
  const you = useMemo(() => {
    const meShooter = game.shooters.find((s) => s.isYou);
    return { id: meShooter?.id ?? "me", name: meShooter?.name ?? "@you" };
  }, [game.shooters]);

  // The single ranked season ladder. Guarantees the player's row is present, sorts by
  // score, and reassigns ranks so every surface (right-stack widget, Standings, Season,
  // profile) reads one derived rank instead of a seed row's frozen rank.
  const ladder = useMemo(
    () =>
      buildLadder(game.rows, {
        id: you.id,
        name: you.name,
        avatar: "YO",
        score: game.score,
        streak: game.streak,
        isHolder: game.isHolder,
        playedToday: RULES.dailyRounds - game.roundsLeft,
      }),
    [game.rows, game.score, game.streak, game.isHolder, game.roundsLeft, you.id, you.name],
  );

  const yourRow = ladder.find((r) => r.id === you.id);
  const seasonRank = yourRow?.rank ?? ladder.length;
  const fieldSize = ladder.length;

  // Local mode can always run another cup; connected mode honors the server daily cap.
  const outOfRounds = game.mode === "connected" && game.roundsLeft <= 0;

  const beginMatch = useCallback(() => {
    setParticipants(buildField(game.rows, { id: you.id, name: you.name, isHolder: game.isHolder }));
    setRoundIndex(0);
    setBestRound({ round: 0, goals: 0 });
    setMatchResult(null);
    talliedRef.current = -1;
    setRankBefore(seasonRank);
    game.resetRound();
    setSessionPhase("countdown");
  }, [game, you.id, you.name, seasonRank]);

  const startMatch = useCallback(() => {
    if (outOfRounds) return;
    beginMatch();
  }, [beginMatch, outOfRounds]);

  const finishMatch = useCallback(() => {
    const ranked = rankParticipants(participants);
    const mine = ranked.find((p) => p.isYou);
    const placement = mine?.standing ?? ranked.length;
    const leader = ranked[0]?.name ?? "The field";
    // Fold the cup into persistent progression. In local mode this also nudges a couple
    // of rival rows so the season ladder visibly reshuffles around the player's moved row.
    game.recordCup({
      placement,
      fieldSize: ranked.length,
      points: mine?.matchPoints ?? 0,
      goals: mine?.matchGoals ?? 0,
      honorIds: placement === 1 ? ["cup_winner"] : [],
    });
    const rankAfter = seasonRank;
    setMatchResult({
      placement,
      fieldSize: ranked.length,
      summary: matchSummary(placement, leader, mine?.matchGoals ?? 0),
      totals: { points: mine?.matchPoints ?? 0, goals: mine?.matchGoals ?? 0 },
      bestRound: bestRound.goals > 0 ? bestRound : { round: 1, goals: 0 },
      seasonDelta: { rankDelta: rankBefore - rankAfter, seasonPoints: game.score },
    });
    setParticipants(ranked);
    game.resetRound(); // clear the settled round so results does not show stale trade state
    setSessionPhase("match_results");
  }, [participants, game, rankBefore, bestRound, seasonRank]);

  const advanceRound = useCallback(() => {
    if (roundIndex + 1 >= MATCH_ROUNDS) {
      finishMatch();
      return;
    }
    setRoundIndex((index) => index + 1);
    game.resetRound();
    setSessionPhase("in_match");
  }, [roundIndex, finishMatch, game]);

  const enterLobby = useCallback(() => {
    setSessionPhase("lobby");
  }, []);

  const findNewMatch = useCallback(() => {
    game.resetForMatch();
    setSessionPhase("lobby");
  }, [game]);

  // Gate trading to the in-match phase.
  const openTrade = useCallback(
    (direction: Direction) => {
      if (sessionPhase !== "in_match") return;
      game.openTrade(direction);
    },
    [sessionPhase, game],
  );

  // Tally a round the moment it settles, then break.
  useEffect(() => {
    if (sessionPhase !== "in_match" || game.phase !== "settled" || !game.outcome) return;
    if (talliedRef.current === roundIndex) return;
    talliedRef.current = roundIndex;

    const outcome = game.outcome;
    const volley = game.shooters;
    setParticipants((prev) => {
      const next = prev.map((p) => ({ ...p }));
      const mine = next.find((p) => p.isYou);
      if (mine) {
        mine.matchPoints += outcome.points;
        mine.matchGoals += outcome.goals;
      }
      volley
        .filter((s) => !s.isYou)
        .forEach((shooter) => {
          const participant = next.find((p) => p.id === shooter.id);
          if (participant) {
            participant.matchPoints += shooterRoundPoints(shooter);
            participant.matchGoals += shooter.goals;
          }
        });
      return rankParticipants(next);
    });
    setBestRound((prev) => (outcome.goals > prev.goals ? { round: roundIndex + 1, goals: outcome.goals } : prev));
    setSessionPhase("round_break");
  }, [game.phase, game.outcome, game.shooters, sessionPhase, roundIndex]);

  // Countdown -> in_match, ticking a real 3, 2, 1.
  useEffect(() => {
    if (sessionPhase !== "countdown") return undefined;
    setCountin(3);
    let n = 3;
    const id = window.setInterval(() => {
      if (!mountedRef.current) {
        window.clearInterval(id);
        return;
      }
      n -= 1;
      if (n <= 0) {
        window.clearInterval(id);
        setSessionPhase("in_match");
      } else {
        setCountin(n);
      }
    }, 800);
    return () => window.clearInterval(id);
  }, [sessionPhase]);

  // Soft auto-advance out of the round break with a visible countdown (final round waits).
  // `advanceRound` closes over `game` (a fresh object each render), so it is not stable.
  // Call it through a ref so this effect does not re-run (and re-setState) every render.
  const advanceRef = useRef(advanceRound);
  advanceRef.current = advanceRound;

  useEffect(() => {
    if (sessionPhase !== "round_break") return undefined;
    if (roundIndex + 1 >= MATCH_ROUNDS) return undefined;
    breakEndsAtRef.current = Date.now() + ROUND_BREAK_AUTO_MS;
    setBreakNow(Date.now());
    const id = window.setInterval(() => {
      if (!mountedRef.current) {
        window.clearInterval(id);
        return;
      }
      const t = Date.now();
      setBreakNow(t);
      if (t >= breakEndsAtRef.current) {
        window.clearInterval(id);
        advanceRef.current();
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [sessionPhase, roundIndex]);

  const standings = useMemo(() => rankParticipants(participants), [participants]);
  const isFinalRound = roundIndex + 1 >= MATCH_ROUNDS;
  const breakSecondsLeft =
    sessionPhase === "round_break" && !isFinalRound
      ? Math.max(0, Math.ceil((breakEndsAtRef.current - breakNow) / 1000))
      : null;

  // Preview field for the lobby (you + AI squads), before a match is built.
  const lobbyField = useMemo(
    () => buildField(game.rows, { id: you.id, name: you.name, isHolder: game.isHolder }),
    [game.rows, game.isHolder, you],
  );

  return {
    ...game,
    openTrade,
    // session surface
    sessionPhase,
    matchRounds: MATCH_ROUNDS,
    roundNumber: roundIndex + 1,
    isFinalRound,
    countin,
    breakSecondsLeft,
    participants: standings,
    lobbyField,
    matchResult,
    // The single derived season ladder + the player's place on it.
    ladder,
    meId: you.id,
    seasonRank,
    fieldSize,
    seed: { rank: seasonRank, points: game.score },
    outOfRounds,
    startMatch,
    advanceRound,
    findNewMatch,
    enterLobby,
  };
}
