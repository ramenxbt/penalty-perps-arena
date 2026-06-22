/**
 * Live market feed for the paper chart. Prefers the selected real Pyth stream and
 * degrades gracefully to the bounded simulator if the stream is unavailable
 * (offline, blocked, or slow to connect) so the arena is never empty or frozen.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createInitialMarket, nextPrice } from "../game/engine";
import { MarketPoint } from "../game/types";
import { MarketAsset } from "../game/markets";
import { fetchLatestPrice, streamPrice } from "../lib/pyth";

export type FeedStatus = "connecting" | "live" | "simulated";

const MAX_POINTS = 96;
const MIN_APPEND_MS = 450; // throttle: Hermes streams several ticks/sec.
const CONNECT_TIMEOUT_MS = 4500; // fall back to sim if no live tick by then.
const SIM_INTERVAL_MS = 700;

export type MarketFeed = {
  asset: MarketAsset;
  market: MarketPoint[];
  price: number;
  priceDelta: number;
  status: FeedStatus;
};

export function useMarketFeed(asset: MarketAsset): MarketFeed {
  const [market, setMarket] = useState<MarketPoint[]>(() => createInitialMarket(asset.seedPrice, asset.volatility));
  const [latestPrice, setLatestPrice] = useState(asset.seedPrice);
  const [status, setStatus] = useState<FeedStatus>("connecting");

  const lastAppendRef = useRef(0);
  const simTimerRef = useRef<number | null>(null);
  const gotLiveRef = useRef(false);
  const simActiveRef = useRef(false);
  const lastLiveTickTimeRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const latestAbort = new AbortController();
    gotLiveRef.current = false;
    simActiveRef.current = false;
    lastLiveTickTimeRef.current = 0;
    lastAppendRef.current = 0;
    setStatus("connecting");
    setLatestPrice(asset.seedPrice);
    setMarket(createInitialMarket(asset.seedPrice, asset.volatility));

    const appendPoint = (value: number, time: number) => {
      const now = Date.now();
      if (now - lastAppendRef.current < MIN_APPEND_MS) return;
      lastAppendRef.current = now;
      setMarket((current) => {
        const latest = current[current.length - 1];
        if (latest && time <= latest.time) return current;
        return [...current.slice(-(MAX_POINTS - 1)), { value, time }];
      });
    };

    const stopSim = () => {
      if (simTimerRef.current !== null) {
        window.clearInterval(simTimerRef.current);
        simTimerRef.current = null;
      }
      simActiveRef.current = false;
    };

    const startSim = () => {
      if (simTimerRef.current !== null) return;
      simActiveRef.current = true;
      setStatus("simulated");
      simTimerRef.current = window.setInterval(() => {
        if (cancelled) return;
        setMarket((current) => nextPrice(current, asset.volatility));
      }, SIM_INTERVAL_MS);
    };

    // Seed the chart around the real current price so it doesn't open on a
    // cliff between the placeholder seed and the live market.
    fetchLatestPrice(asset.symbol, latestAbort.signal)
      .then((tick) => {
        if (cancelled || !tick || gotLiveRef.current) return;
        setLatestPrice(tick.price);
        setMarket(createInitialMarket(tick.price, asset.volatility, tick.time));
      })
      .catch(() => {});

    const stopStream = streamPrice({
      symbol: asset.symbol,
      onTick: (tick) => {
        if (cancelled) return;
        const firstLive = !gotLiveRef.current;
        if (!firstLive && tick.time <= lastLiveTickTimeRef.current) return;
        lastLiveTickTimeRef.current = Math.max(lastLiveTickTimeRef.current, tick.time);
        const recoveredFromSim = simActiveRef.current;
        gotLiveRef.current = true;
        setLatestPrice(tick.price);
        stopSim();
        setStatus("live");
        if (firstLive || recoveredFromSim) {
          // Rebuild the series around the real price on first connect or after
          // a simulator fallback so the chart never blends synthetic and live ticks.
          lastAppendRef.current = Date.now();
          setMarket(createInitialMarket(tick.price, asset.volatility, tick.time));
          return;
        }
        appendPoint(tick.price, tick.time);
      },
      onError: () => {
        if (cancelled) return;
        startSim();
      },
    });

    // Watchdog: if the live stream never delivers, switch to the simulator.
    const watchdog = window.setTimeout(() => {
      if (!cancelled && !gotLiveRef.current) startSim();
    }, CONNECT_TIMEOUT_MS);

    return () => {
      cancelled = true;
      latestAbort.abort();
      window.clearTimeout(watchdog);
      stopStream();
      stopSim();
    };
  }, [asset]);

  useEffect(() => {
    if (status === "live") return;
    setLatestPrice(market[market.length - 1]?.value ?? asset.seedPrice);
  }, [asset.seedPrice, market, status]);

  const price = latestPrice;
  const priceDelta = useMemo(() => {
    const reference = market[Math.max(0, market.length - 10)]?.value ?? price;
    return price - reference;
  }, [market, price]);

  return { asset, market, price, priceDelta, status };
}
