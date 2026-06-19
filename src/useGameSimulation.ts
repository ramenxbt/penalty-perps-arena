import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BoardRow,
  Direction,
  GamePhase,
  KickResult,
  MarketPoint,
  ShotZone,
  calculateMomentum,
  createInitialMarket,
  initialRows,
  keeperPick,
  nextPrice,
  settleKick,
} from "./game";

export function useGameSimulation() {
  const [market, setMarket] = useState<MarketPoint[]>(createInitialMarket);
  const [direction, setDirection] = useState<Direction | null>(null);
  const [entryPrice, setEntryPrice] = useState<number | null>(null);
  const [momentum, setMomentum] = useState(52);
  const [phase, setPhase] = useState<GamePhase>("idle");
  const [shotZone, setShotZone] = useState<ShotZone>("right");
  const [keeperZone, setKeeperZone] = useState<ShotZone>("center");
  const [result, setResult] = useState<KickResult | null>(null);
  const [score, setScore] = useState(1220);
  const [streak, setStreak] = useState(3);
  const [kicksLeft, setKicksLeft] = useState(3);
  const [rows, setRows] = useState<BoardRow[]>(initialRows);
  const lastPriceRef = useRef(market[market.length - 1].value);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setMarket((current) => {
        const before = current[current.length - 1].value;
        const updated = nextPrice(current);
        const after = updated[updated.length - 1].value;
        lastPriceRef.current = after;

        setMomentum((currentMomentum) =>
          phase === "tracking"
            ? calculateMomentum(currentMomentum, direction, before, after)
            : currentMomentum,
        );

        return updated;
      });

      setRows((currentRows) =>
        currentRows
          .map((row) =>
            row.isAi
              ? {
                  ...row,
                  score: row.score + Math.round(Math.random() * 18),
                  movement: Math.random() > 0.72 ? row.movement + 1 : row.movement,
                }
              : row,
          )
          .sort((a, b) => b.score - a.score)
          .map((row, index) => ({ ...row, rank: index + 1 })),
      );
    }, 950);

    return () => window.clearInterval(interval);
  }, [direction, phase]);

  const price = market[market.length - 1].value;
  const priceDelta = price - market[Math.max(0, market.length - 10)].value;

  const lockDirection = useCallback(
    (nextDirection: Direction) => {
      if (phase === "kicking") return;
      setDirection(nextDirection);
      setEntryPrice(lastPriceRef.current);
      setMomentum(52);
      setResult(null);
      setPhase("tracking");
    },
    [phase],
  );

  const takeKick = useCallback(() => {
    if (phase === "kicking" || kicksLeft <= 0) return;
    const pickedKeeperZone = keeperPick(momentum, shotZone);
    setKeeperZone(pickedKeeperZone);
    setPhase("kicking");

    window.setTimeout(() => {
      const settled = settleKick({
        momentum,
        direction,
        entryPrice,
        exitPrice: lastPriceRef.current,
        shotZone,
        keeperZone: pickedKeeperZone,
        streak,
      });

      setResult(settled);
      setScore((current) => current + settled.points);
      setStreak((current) => (settled.goal ? current + 1 : 0));
      setKicksLeft((current) => Math.max(0, current - 1));
      setRows((currentRows) => {
        const userRow: BoardRow = {
          id: "me",
          rank: 1,
          name: "@you",
          avatar: "YO",
          score: score + settled.points,
          streak: settled.goal ? streak + 1 : 0,
          today: `${4 - kicksLeft}/3`,
          isAi: false,
          isHolder: true,
          movement: settled.goal ? 7 : -1,
        };

        const withoutMe = currentRows.filter((row) => row.id !== "me");
        return [userRow, ...withoutMe]
          .sort((a, b) => b.score - a.score)
          .map((row, index) => ({ ...row, rank: index + 1 }));
      });
      setPhase("settled");
    }, 1800);
  }, [direction, entryPrice, kicksLeft, momentum, phase, score, shotZone, streak]);

  const resetRound = useCallback(() => {
    setDirection(null);
    setEntryPrice(null);
    setMomentum(52);
    setResult(null);
    setPhase("idle");
    setKeeperZone("center");
  }, []);

  const derived = useMemo(
    () => ({
      price,
      priceDelta,
      entryDelta: entryPrice ? price - entryPrice : 0,
      marketLabel: priceDelta >= 0 ? "tape lifting" : "tape slipping",
    }),
    [entryPrice, price, priceDelta],
  );

  return {
    market,
    direction,
    entryPrice,
    momentum,
    phase,
    shotZone,
    keeperZone,
    result,
    score,
    streak,
    kicksLeft,
    rows,
    derived,
    lockDirection,
    takeKick,
    resetRound,
    setShotZone,
  };
}
