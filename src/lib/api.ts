/**
 * The GameApi seam.
 *
 * The UI talks only to this interface - never directly to game logic or to Supabase.
 * Two implementations sit behind it:
 *
 *   - LocalGameApi    : client-side paper simulation (no server). Used in `local` mode.
 *   - SupabaseGameApi : server-authoritative PnL + realtime leaderboard via Supabase
 *                       edge functions. Used in `connected` mode.
 *
 * The trade is the game: openTrade pins an entry, closeTrade realizes PnL and resolves
 * the volley (your shots plus simulated co-shooters). The backend (built by Codex per
 * BACKEND_HANDOFF.md) only has to satisfy these method shapes.
 */

import { appMode } from "../config/env";
import {
  Direction,
  LeaderboardSnapshot,
  MarketSymbol,
  PlayerProfile,
  RoundOutcome,
  Shooter,
  TradeRound,
} from "../game/types";

export type AuthBridge = {
  getUserId: () => string | null;
  getDisplayName: () => string | null;
  getWalletAddress: () => string | null;
  getAccessToken: () => Promise<string | null>;
};

export type OpenTradeInput = {
  /** The market currently shown to the player; connected mode recomputes it server-side. */
  market: MarketSymbol;
  direction: Direction;
  /** Advisory only; the server pins the authoritative entry price. */
  referencePrice: number;
};

export type CloseTradeInput = {
  roundId: string;
  /** Advisory only; the server reads the authoritative exit price. */
  clientExitPrice: number;
};

export type RoundResult = {
  outcome: RoundOutcome;
  /** You plus co-shooters, for the simultaneous volley. */
  shooters: Shooter[];
  profile: PlayerProfile;
};

export interface GameApi {
  readonly mode: "local" | "connected";
  loadProfile(): Promise<PlayerProfile>;
  loadLeaderboard(): Promise<LeaderboardSnapshot>;
  subscribeLeaderboard(
    onSnapshot: (snapshot: LeaderboardSnapshot) => void,
    onError?: (error: unknown) => void,
  ): () => void;
  /** Reset the per-match round allotment so a new cup run can begin (local mode only;
   * connected mode keeps the server-authoritative daily cap and just returns the profile). */
  resetForMatch(): Promise<PlayerProfile>;
  /** Open a position; pins entry price and starts the trade window. */
  openTrade(input: OpenTradeInput): Promise<TradeRound>;
  /** Close (manually or via auto-close) and resolve the volley. */
  closeTrade(input: CloseTradeInput): Promise<RoundResult>;
}

export async function createGameApi(auth: AuthBridge): Promise<GameApi> {
  if (appMode === "connected") {
    const [{ SupabaseGameApi }, { getSupabaseClient }] = await Promise.all([
      import("./supabaseApi"),
      import("./supabaseClient"),
    ]);
    const client = getSupabaseClient();
    if (client) return new SupabaseGameApi(client, auth);
  }
  const { LocalGameApi } = await import("./localBackend");
  return new LocalGameApi(auth);
}
