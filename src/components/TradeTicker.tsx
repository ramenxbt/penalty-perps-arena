import { useEffect, useRef, useState } from "react";
import { formatMarketPrice, MarketAsset } from "../game/markets";

type TickerEvent = {
  id: number;
  name: string;
  side: "LONG" | "SHORT";
  price: number;
  symbol: string;
  decimals: number;
  mult: string;
};

/**
 * Ambient feed of simulated AI-squad trades, echoing Roach Racing Club's live
 * trade ticker. Purely cosmetic flavor: these are the same simulated AI opponents
 * shown on the leaderboard, never real orders. No funds, no custody.
 */
export function TradeTicker({
  price,
  asset,
  aiNames,
  active,
}: {
  price: number;
  asset: MarketAsset;
  aiNames: string[];
  active: boolean;
}) {
  const [events, setEvents] = useState<TickerEvent[]>([]);
  const counter = useRef(0);
  const priceRef = useRef(price);
  priceRef.current = price;
  const activeRef = useRef(active);
  activeRef.current = active;
  const assetRef = useRef(asset);
  assetRef.current = asset;
  const namesRef = useRef(aiNames);
  namesRef.current = aiNames;

  useEffect(() => {
    setEvents([]);
  }, [active, asset.symbol]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const names = namesRef.current;
      const activeAsset = assetRef.current;
      if (!activeRef.current || !names.length || priceRef.current <= 0) return;
      counter.current += 1;
      const name = names[Math.floor(Math.random() * names.length)];
      const event: TickerEvent = {
        id: counter.current,
        name,
        side: Math.random() > 0.5 ? "LONG" : "SHORT",
        price: priceRef.current * (1 + (Math.random() - 0.5) * 0.004),
        symbol: activeAsset.symbol,
        decimals: activeAsset.decimals,
        mult: (1 + Math.random() * 2).toFixed(1),
      };
      setEvents((current) => [event, ...current].slice(0, 4));
    }, 2400);
    return () => window.clearInterval(interval);
  }, []);

  if (!active || !events.length) return null;

  return (
    <div className="trade-ticker" aria-hidden="true">
      {events.map((e) => (
        <div className="trade-event" key={e.id}>
          <span className="trade-name">{e.name.replace(/^AI (Squad|Keeper): /, "")}</span>
          <span className={e.side === "LONG" ? "trade-side long" : "trade-side short"}>
            {e.side}
          </span>
          <span className="trade-price">
            {e.symbol} {formatMarketPrice(e.price, { ...asset, decimals: e.decimals })} x{e.mult}
          </span>
        </div>
      ))}
    </div>
  );
}
