/**
 * Game orchestrator. Wires the live market feed, auth identity, and the GameApi seam
 * into the trade-to-shoot loop: open a position, watch live PnL, close (manually or on
 * the auto-close timer), then resolve the volley. PnL shown while trading is computed
 * from the real feed; the authoritative result comes back from closeTrade.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RULES, computePnlPct, resolveShots } from "../game/engine";
import { getMarketAsset, MarketAsset, randomMarketAsset } from "../game/markets";
import {
  BoardRow,
  Direction,
  PlayerProfile,
  RoundOutcome,
  RoundPhase,
  Shooter,
  TradeRound,
} from "../game/types";
import { seedRows } from "../game/seed";
import { volleyDuration } from "../game/volley";
import { AuthBridge, GameApi, createGameApi } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useMarketFeed } from "./useMarketFeed";

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

export function useGameSimulation() {
  const [marketAsset, setMarketAsset] = useState<MarketAsset>(() => randomMarketAsset());
  const feed = useMarketFeed(marketAsset);
  const auth = useAuth();

  const [api, setApi] = useState<GameApi | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [rows, setRows] = useState<BoardRow[]>(seedRows);
  const [backendError, setBackendError] = useState<string | null>(null);

  const [direction, setDirection] = useState<Direction | null>(null);
  const [round, setRound] = useState<TradeRound | null>(null);
  const [phase, setPhase] = useState<RoundPhase>("idle");
  const [outcome, setOutcome] = useState<RoundOutcome | null>(null);
  const [shooters, setShooters] = useState<Shooter[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const mountedRef = useRef(true);
  const closingRef = useRef(false);
  const closeRetriesRef = useRef(0);
  const feedPriceRef = useRef(feed.price);

  useEffect(() => {
    feedPriceRef.current = feed.price;
  }, [feed.price]);

  const authRef = useRef(auth);
  authRef.current = auth;
  const bridge = useMemo<AuthBridge>(
    () => ({
      getUserId: () => authRef.current.user?.id ?? null,
      getDisplayName: () => authRef.current.user?.displayName ?? null,
      getWalletAddress: () => authRef.current.user?.walletAddress ?? null,
      getAccessToken: () => authRef.current.getAccessToken(),
    }),
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    createGameApi(bridge)
      .then((instance) => !cancelled && setApi(instance))
      .catch((err) => setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const identityKey = `${auth.isAuthenticated}:${auth.user?.id ?? ""}`;
  useEffect(() => {
    if (!api) return;
    const shouldLoadConnected = api.mode !== "connected" || auth.isAuthenticated;
    if (!shouldLoadConnected) {
      setBackendError(null);
      return;
    }

    let cancelled = false;
    setBackendError(null);
    Promise.all([api.loadProfile(), api.loadLeaderboard()])
      .then(([p, s]) => {
        if (!mountedRef.current || cancelled) return;
        setProfile(p);
        setRows(s.rows);
        if (p.activeRound) {
          setMarketAsset(getMarketAsset(p.activeRound.market));
          setDirection(p.activeRound.direction);
          setRound(p.activeRound);
          setPhase("trading");
          setNow(Date.now());
        } else if (p.nextMarket) {
          setMarketAsset(getMarketAsset(p.nextMarket));
        }
        setBackendError(null);
      })
      .catch((err) => {
        if (!mountedRef.current || cancelled) return;
        const message = errorMessage(err);
        if (api.mode === "connected") {
          setBackendError(message);
          setError(message);
        }
      });
    const unsubscribe = api.subscribeLeaderboard((snap) => {
      if (mountedRef.current) setRows(snap.rows);
    }, (err) => {
      if (!mountedRef.current || cancelled || api.mode !== "connected") return;
      const message = errorMessage(err);
      setBackendError(message);
      setError(message);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [api, auth.isAuthenticated, identityKey]);

  const closeRound = useCallback(
    (active: TradeRound) => {
      if (!api || closingRef.current) return;
      closingRef.current = true;
      setBusy(true);
      setPhase("settling");
      setError(null);

      api
        .closeTrade({ roundId: active.roundId, clientExitPrice: feedPriceRef.current })
        .then(async ({ outcome: settled, shooters: volley, profile: nextProfile }) => {
          if (!mountedRef.current) return;
          setOutcome(settled);
          setShooters(volley);
          setProfile(nextProfile);
          setRound(null);
          setPhase("resolving");
          await delay(volleyDuration(volley));
          if (!mountedRef.current) return;
          setPhase("settled");
          setBusy(false);
          closingRef.current = false;
          setMarketAsset(
            nextProfile.nextMarket ? getMarketAsset(nextProfile.nextMarket) : randomMarketAsset(settled.market),
          );
        })
        .catch((err) => {
          if (!mountedRef.current) return;
          setError(errorMessage(err));
          setPhase("closeFailed");
          setBusy(false);
          closingRef.current = false;
        });
    },
    [api],
  );

  // Countdown ticker + auto-close.
  useEffect(() => {
    if (phase !== "trading" || !round) return;
    const tick = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= round.closesAt) closeRound(round);
    }, 200);
    return () => window.clearInterval(tick);
  }, [phase, round, closeRound]);

  // Guaranteed exit from a failed close: auto-retry a couple of times so a transient
  // settlement error in connected mode can never deadlock the match.
  useEffect(() => {
    if (phase !== "closeFailed") {
      closeRetriesRef.current = 0;
      return undefined;
    }
    if (!round || closeRetriesRef.current >= 2) return undefined;
    const id = window.setTimeout(() => {
      closeRetriesRef.current += 1;
      closeRound(round);
    }, 3000);
    return () => window.clearTimeout(id);
  }, [phase, round, closeRound]);

  const openTrade = useCallback(
    (nextDirection: Direction) => {
      if (
        !api ||
        round ||
        phase === "opening" ||
        phase === "trading" ||
        phase === "settling" ||
        phase === "resolving" ||
        busy
      ) return;
      if ((profile?.attemptsRemaining ?? 0) <= 0) return;
      const openingAsset = marketAsset;
      setError(null);
      setOutcome(null);
      setDirection(nextDirection);
      setBusy(true);
      setPhase("opening");
      setNow(Date.now());

      api
        .openTrade({ market: openingAsset.symbol, direction: nextDirection, referencePrice: feed.price })
        .then((opened) => {
          if (!mountedRef.current) return;
          setMarketAsset(getMarketAsset(opened.market));
          setRound(opened);
          setProfile((current) =>
            current
              ? {
                ...current,
                attemptsRemaining: opened.attemptsRemaining,
                activeRound: opened,
                nextMarket: opened.market,
              }
              : current,
          );
          setPhase("trading");
          setBusy(false);
        })
        .catch((err) => {
          if (!mountedRef.current) return;
          setError(errorMessage(err));
          setPhase("idle");
          setDirection(null);
          setBusy(false);
        });
    },
    [api, busy, feed.price, marketAsset, phase, profile, round],
  );

  const closeNow = useCallback(() => {
    if (round) closeRound(round);
  }, [closeRound, round]);

  const resetForMatch = useCallback(() => {
    if (!api) return;
    api
      .resetForMatch()
      .then((p) => mountedRef.current && setProfile(p))
      .catch(() => {});
  }, [api]);

  const resetRound = useCallback(() => {
    if (busy) return;
    setDirection(null);
    setRound(null);
    setOutcome(null);
    setShooters([]);
    setPhase("idle");
    setError(null);
  }, [busy]);

  // Live PnL while a position is open.
  const pnlPct =
    round && (phase === "trading" || phase === "closeFailed")
      ? computePnlPct(round.direction, round.entryPrice, feed.price)
      : outcome
        ? outcome.pnlPct
        : 0;

  const timeLeftMs = round && phase === "trading" ? Math.max(0, round.closesAt - now) : 0;
  const tradeProgress = round && phase === "trading"
    ? Math.min(1, Math.max(0, 1 - timeLeftMs / RULES.tradeWindowMs))
    : 0;

  // Live "shot power": what the current trade would bank right now. Drives the meter.
  const power = resolveShots(pnlPct);
  const POWER_MIN = -20;
  const POWER_MAX = 55;
  const powerRatio = Math.max(0, Math.min(1, (pnlPct - POWER_MIN) / (POWER_MAX - POWER_MIN)));

  // The roster shown at rest (idle/trading); replaced by real results during the volley.
  const roster = useMemo<Shooter[]>(() => {
    const you: Shooter = {
      id: profile?.id ?? "me",
      name: profile?.name ?? "@you",
      isYou: true,
      isAi: false,
      pnlPct: 0,
      shots: 0,
      goals: 0,
      openness: 0,
    };
    const co = rows
      .filter((r) => r.isAi)
      .slice(0, 4)
      .map<Shooter>((r) => ({
        id: r.id,
        name: r.name,
        isYou: false,
        isAi: true,
        pnlPct: 0,
        shots: 0,
        goals: 0,
        openness: 0,
      }));
    return [you, ...co];
  }, [profile?.id, profile?.name, rows]);

  const mode = api?.mode ?? "local";
  const connectedMode = mode === "connected";
  const connectedBackendBlocked = connectedMode && auth.isAuthenticated && Boolean(backendError);
  const sceneShooters = phase === "resolving" || phase === "settled" ? shooters : roster;
  const requiresAuth = connectedMode && !auth.isAuthenticated;
  const marketReady = connectedMode ? feed.status === "live" : feed.status !== "connecting";
  const canCloseNow = phase === "trading" && marketReady;

  return {
    market: feed.market,
    marketAsset,
    feedStatus: feed.status,
    derived: { price: feed.price, priceDelta: feed.priceDelta },
    mode,
    ready: Boolean(api) && !connectedBackendBlocked,
    backendError,
    marketReady,
    canCloseNow,
    requiresAuth,
    score: profile?.score ?? 0,
    streak: profile?.streak ?? 0,
    roundsLeft: profile?.attemptsRemaining ?? RULES.dailyRounds,
    isHolder: profile?.isHolder ?? false,
    walletAddress: profile?.walletAddress ?? null,
    direction,
    phase,
    round,
    pnlPct,
    timeLeftMs,
    tradeProgress,
    shotsNow: power.shots,
    opennessNow: power.openness,
    powerRatio,
    outcome,
    shooters: sceneShooters,
    rows,
    busy,
    error,
    entryPrice: round?.entryPrice ?? null,
    openTrade,
    closeNow,
    resetRound,
    resetForMatch,
  };
}
