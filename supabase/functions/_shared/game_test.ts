import { assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import { assignedMarketForAttempt, computePnlPct, resolveRound, resolveShots, RULES, settlementCloseTimeMs } from "./game.ts";

Deno.test("computePnlPct signs long and short rounds like the frontend engine", () => {
  assertAlmostEquals(computePnlPct("long", 100, 100.08), 0.08);
  assertAlmostEquals(computePnlPct("short", 100, 99.92), 0.08);
});

Deno.test("resolveShots uses the first matching tier", () => {
  assertEquals(resolveShots(0.08), { shots: 3, openness: 0.9 });
  assertEquals(resolveShots(0.035), { shots: 2, openness: 0.7 });
  assertEquals(resolveShots(0.008), { shots: 1, openness: 0.5 });
  assertEquals(resolveShots(-0.035), { shots: 1, openness: 0.15 });
  assertEquals(resolveShots(-0.036), { shots: 0, openness: 0 });
});

Deno.test("resolveRound mirrors points, profit, and injected RNG behavior", () => {
  const outcome = resolveRound({
    direction: "long",
    entryPrice: 100,
    exitPrice: 100.08,
    streak: 3,
    rng: () => 0,
  });

  assertEquals(outcome.profit, true);
  assertEquals(outcome.shots, 3);
  assertEquals(outcome.goals, 3);
  assertEquals(outcome.points, 370);
});

Deno.test("assignedMarketForAttempt is deterministic and returns supported markets", () => {
  const first = assignedMarketForAttempt("player-a", "2026-06-22", 0);
  const replay = assignedMarketForAttempt("player-a", "2026-06-22", 0);
  const drawn = Array.from({ length: 5 }, (_, attempt) =>
    assignedMarketForAttempt("player-a", "2026-06-22", attempt)
  );

  assertEquals(replay, first);
  drawn.forEach((market) => assertEquals(["BTC", "ETH", "SOL"].includes(market), true));
});

Deno.test("settlementCloseTimeMs pins manual closes to request receipt and clamps late closes", () => {
  const openedAt = Date.UTC(2026, 5, 22, 12, 0, 0);
  const closesAt = openedAt + RULES.tradeWindowMs;

  assertEquals(settlementCloseTimeMs(openedAt + 4_000, closesAt), openedAt + 4_000);
  assertEquals(settlementCloseTimeMs(closesAt + 4_000, closesAt), closesAt);
});
