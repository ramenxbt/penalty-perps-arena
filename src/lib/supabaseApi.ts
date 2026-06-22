/**
 * SupabaseGameApi - connected, server-authoritative implementation of GameApi.
 *
 * The client sends only the player's choices (direction, leverage, close timing). The
 * edge function pins entry/exit prices from Pyth, computes PnL, converts it to shots,
 * resolves the volley, and updates the leaderboard. The Privy access token is forwarded
 * as a bearer so the function can verify identity and wallet. See BACKEND_HANDOFF.md.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { LeaderboardSnapshot, PlayerProfile, RoundOutcome, Shooter, TradeRound } from "../game/types";
import {
  AuthBridge,
  CloseTradeInput,
  GameApi,
  OpenTradeInput,
  RoundResult,
} from "./api";

export class SupabaseGameApi implements GameApi {
  readonly mode = "connected" as const;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly auth: AuthBridge,
  ) {}

  private async invoke<T>(fn: string, body?: Record<string, unknown>): Promise<T> {
    const token = await this.auth.getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    const { data, error } = await this.supabase.functions.invoke<T>(fn, { body, headers });
    if (error) throw new Error(`${fn} failed: ${error.message}`);
    if (data == null) throw new Error(`${fn} returned no data`);
    return data;
  }

  loadProfile(): Promise<PlayerProfile> {
    return this.invoke<PlayerProfile>("profile");
  }

  loadLeaderboard(): Promise<LeaderboardSnapshot> {
    return this.invoke<LeaderboardSnapshot>("leaderboard");
  }

  resetForMatch(): Promise<PlayerProfile> {
    // Connected mode keeps the server-authoritative daily cap; just refetch the profile.
    return this.loadProfile();
  }

  subscribeLeaderboard(
    onSnapshot: (snapshot: LeaderboardSnapshot) => void,
    onError?: (error: unknown) => void,
  ): () => void {
    const push = () => {
      this.loadLeaderboard().then(onSnapshot).catch((error) => onError?.(error));
    };
    const channel = this.supabase
      .channel("leaderboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "leaderboard" }, push)
      .subscribe();
    push();
    return () => {
      this.supabase.removeChannel(channel);
    };
  }

  openTrade(input: OpenTradeInput): Promise<TradeRound> {
    return this.invoke<TradeRound>("open-trade", {
      market: input.market,
      direction: input.direction,
      referencePrice: input.referencePrice,
    });
  }

  closeTrade(input: CloseTradeInput): Promise<RoundResult> {
    return this.invoke<{ outcome: RoundOutcome; shooters: Shooter[]; profile: PlayerProfile }>(
      "close-trade",
      { roundId: input.roundId, clientExitPrice: input.clientExitPrice },
    );
  }
}
