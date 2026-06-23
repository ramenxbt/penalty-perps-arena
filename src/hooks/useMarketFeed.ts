/**
 * Live-tethered arena feed for the paper chart.
 *
 * The raw live chart (Hyperliquid mid price) barely moves inside a ~12s trade window, so
 * timing a close has nothing to grab. Instead of plotting raw ticks, we run a lively
 * "arena" random walk that is loosely tethered to the real market price: it stays
 * recognizably the real asset over time, but always has enough movement that a trade
 * window is meaningful. This mirrors Roach Racing Club's "real chart, amplified effect"
 * idea, pushed one step further to guarantee action every round. The live stream feeds the
 * tether anchor and the live/simulated status; it never plots directly.
 *
 * Connected mode note: the server (Codex) must generate this same arena series and settle
 * on it, not on raw Pyth, or a connected result will not match what the player saw. See
 * BACKEND_HANDOFF.md.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ARENA_TICK_MS, createArenaSeed, nextArenaPrice } from "../game/engine";
import { MarketPoint } from "../game/types";
import { MarketAsset } from "../game/markets";
import { fetchLatestPrice, streamPrice } from "../lib/hyperliquid";

export type FeedStatus = "connecting" | "live" | "simulated";

// ~3 minutes of 500ms ticks so the chart can show ~12-15 fat 15-second candles.
const MAX_POINTS = 380;
const CONNECT_TIMEOUT_MS = 4500; // mark simulated if no live tick by then (arena keeps ticking).

export type MarketFeed = {
  asset: MarketAsset;
  market: MarketPoint[];
  price: number;
  priceDelta: number;
  status: FeedStatus;
};

export function useMarketFeed(asset: MarketAsset): MarketFeed {
  const [market, setMarket] = useState<MarketPoint[]>(() => createArenaSeed(asset.seedPrice));
  const [latestPrice, setLatestPrice] = useState(asset.seedPrice);
  const [status, setStatus] = useState<FeedStatus>("connecting");

  const liveAnchorRef = useRef(asset.seedPrice); // latest real market price (the tether)
  const arenaRef = useRef(asset.seedPrice); // latest arena price (what we plot and trade)
  const gotLiveRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const latestAbort = new AbortController();
    gotLiveRef.current = false;
    liveAnchorRef.current = asset.seedPrice;
    arenaRef.current = asset.seedPrice;
    setStatus("connecting");
    setLatestPrice(asset.seedPrice);
    setMarket(createArenaSeed(asset.seedPrice));

    // Seed the tether + arena around the real current price so the chart opens near reality.
    fetchLatestPrice(asset.symbol, latestAbort.signal)
      .then((tick) => {
        if (cancelled || !tick || gotLiveRef.current) return;
        liveAnchorRef.current = tick.price;
        arenaRef.current = tick.price;
        setLatestPrice(tick.price);
        setMarket(createArenaSeed(tick.price, tick.time));
      })
      .catch(() => {});

    // The live stream only updates the tether anchor and status; it is never plotted raw.
    const stopStream = streamPrice({
      symbol: asset.symbol,
      onTick: (tick) => {
        if (cancelled) return;
        liveAnchorRef.current = tick.price;
        if (!gotLiveRef.current) {
          gotLiveRef.current = true;
          arenaRef.current = tick.price; // snap the arena onto the first real print
          setStatus("live");
        }
      },
      onError: () => {
        if (!cancelled && !gotLiveRef.current) setStatus("simulated");
      },
    });

    // Watchdog: if the live stream never delivers, the arena keeps ticking as "simulated".
    const watchdog = window.setTimeout(() => {
      if (!cancelled && !gotLiveRef.current) setStatus("simulated");
    }, CONNECT_TIMEOUT_MS);

    // Arena heartbeat: the walk that makes the chart lively. Runs regardless of feed state.
    const ticker = window.setInterval(() => {
      if (cancelled) return;
      const next = nextArenaPrice(arenaRef.current, liveAnchorRef.current);
      arenaRef.current = next;
      setLatestPrice(next);
      const time = Date.now();
      setMarket((current) => {
        const last = current[current.length - 1];
        if (last && time <= last.time) return current;
        return [...current.slice(-(MAX_POINTS - 1)), { value: next, time }];
      });
    }, ARENA_TICK_MS);

    return () => {
      cancelled = true;
      latestAbort.abort();
      window.clearTimeout(watchdog);
      stopStream();
      window.clearInterval(ticker);
    };
  }, [asset]);

  const price = latestPrice;
  const priceDelta = useMemo(() => {
    const reference = market[Math.max(0, market.length - 10)]?.value ?? price;
    return price - reference;
  }, [market, price]);

  return { asset, market, price, priceDelta, status };
}
