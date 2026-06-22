/**
 * Real Privy-backed auth runtime. Code-split and mounted after first paint / on demand,
 * so the wallet SDK stays out of the initial game shell.
 */

import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { useEffect, useMemo, useRef } from "react";
import { env } from "../config/env";
import { AuthState, truncateAddress } from "./AuthContext";

type PrivyRuntimeProps = {
  loginRequest: number;
  onState: (state: AuthState) => void;
};

function playerHandle(userId: string | undefined): string {
  const suffix = userId?.replace(/[^a-z0-9]/gi, "").slice(-8) || "player";
  return `player-${suffix}`;
}

function PrivyBridge({ loginRequest, onState }: PrivyRuntimeProps) {
  const privy = usePrivy();
  const handledLoginRequest = useRef(0);

  const value = useMemo<AuthState>(() => {
    const u = privy.user;
    const displayName = u?.twitter?.username
      ? `@${u.twitter.username}`
      : u?.wallet?.address
        ? truncateAddress(u.wallet.address)
        : playerHandle(u?.id);
    return {
      ready: privy.ready,
      isAuthenticated: privy.authenticated,
      user: u ? { id: u.id, displayName, walletAddress: u.wallet?.address ?? null } : null,
      isReal: true,
      login: privy.login,
      logout: privy.logout,
      getAccessToken: privy.getAccessToken,
    };
  }, [privy]);

  useEffect(() => {
    onState(value);
  }, [onState, value]);

  useEffect(() => {
    if (!privy.ready || privy.authenticated || loginRequest <= handledLoginRequest.current) return;
    handledLoginRequest.current = loginRequest;
    privy.login();
  }, [loginRequest, privy]);

  return null;
}

export default function PrivyAuthRuntime({ loginRequest, onState }: PrivyRuntimeProps) {
  return (
    <PrivyProvider
      appId={env.privyAppId as string}
      config={{
        appearance: { theme: "dark", accentColor: "#b7ff4a" },
        loginMethods: ["wallet", "email", "twitter"],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          solana: { createOnLogin: "users-without-wallets" },
        },
      }}
    >
      <PrivyBridge loginRequest={loginRequest} onState={onState} />
    </PrivyProvider>
  );
}
