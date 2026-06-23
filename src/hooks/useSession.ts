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
  MatchParticipant,
  MatchResult,
  matchSummary,
  rankParticipants,
  SessionPhase,
  shooterRoundPoints,
} from "../game/match";
import { Direction } from "../game/types";
import { useGameSimulation } from "./useGameSimulation";

const COUNTDOWN_MS = 2200;
const ROUND_BREAK_AUTO_MS = 9000;
const MATCH_ROUNDS = RULES.matchRounds;

export function useSession() {
  const game = useGameSimulation();

  const [sessionPhase, setSessionPhase] = useState<SessionPhase>("welcome");
  const [participants, setParticipants] = useState<MatchParticipant[]>([]);
  const [roundIndex, setRoundIndex] = useState(0); // 0-based index of the active round
  const [bestRound, setBestRound] = useState({ round: 0, goals: 0 });
  const [rankBefore, setRankBefore] = useState(0);
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);

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

  const yourRow = game.rows.find((r) => r.id === you.id);
  const seedRank = yourRow?.rank ?? game.rows.length + 1;

  // Local mode can always run another cup; connected mode honors the server daily cap.
  const outOfRounds = game.mode === "connected" && game.roundsLeft <= 0;

  const beginMatch = useCallback(() => {
    setParticipants(buildField(game.rows, { id: you.id, name: you.name, isHolder: game.isHolder }));
    setRoundIndex(0);
    setBestRound({ round: 0, goals: 0 });
    setMatchResult(null);
    talliedRef.current = -1;
    setRankBefore(yourRow?.rank ?? game.rows.length + 1);
    game.resetRound();
    setSessionPhase("countdown");
  }, [game, you.id, you.name, yourRow?.rank]);

  const startMatch = useCallback(() => {
    if (outOfRounds) return;
    beginMatch();
  }, [beginMatch, outOfRounds]);

  const finishMatch = useCallback(() => {
    const ranked = rankParticipants(participants);
    const mine = ranked.find((p) => p.isYou);
    const placement = mine?.standing ?? ranked.length;
    const leader = ranked[0]?.name ?? "The field";
    const rankAfter = game.rows.find((r) => r.id === you.id)?.rank ?? rankBefore;
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
  }, [participants, game, you.id, rankBefore, bestRound]);

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

  // Countdown -> in_match.
  useEffect(() => {
    if (sessionPhase !== "countdown") return undefined;
    const timer = window.setTimeout(() => mountedRef.current && setSessionPhase("in_match"), COUNTDOWN_MS);
    return () => window.clearTimeout(timer);
  }, [sessionPhase]);

  // Soft auto-advance out of the round break (except the final round, which waits for the player).
  useEffect(() => {
    if (sessionPhase !== "round_break") return undefined;
    if (roundIndex + 1 >= MATCH_ROUNDS) return undefined;
    const timer = window.setTimeout(() => mountedRef.current && advanceRound(), ROUND_BREAK_AUTO_MS);
    return () => window.clearTimeout(timer);
  }, [sessionPhase, roundIndex, advanceRound]);

  const standings = useMemo(() => rankParticipants(participants), [participants]);
  const isFinalRound = roundIndex + 1 >= MATCH_ROUNDS;

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
    participants: standings,
    lobbyField,
    matchResult,
    seed: { rank: seedRank, points: game.score },
    outOfRounds,
    startMatch,
    advanceRound,
    findNewMatch,
    enterLobby,
  };
}
