/**
 * Unified auth surface. Downstream code only uses `useAuth()` and never imports Privy
 * directly, so the same UI works whether we're running with real Privy auth or in a
 * local guest mode. The provider is chosen once at the root based on configuration.
 *
 * The Privy runtime lives in ./PrivyAuthProvider and is code-split/deferred so
 * the heavy wallet SDK loads after first paint or when the player clicks Connect.
 */

import {
  createContext,
  lazy,
  ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { features } from "../config/env";

export type AuthUser = {
  id: string;
  displayName: string;
  walletAddress: string | null;
};

export type AuthState = {
  /** True once the auth system has finished initializing. */
  ready: boolean;
  isAuthenticated: boolean;
  user: AuthUser | null;
  /** True when backed by Privy; false in local guest mode. */
  isReal: boolean;
  login: () => void;
  logout: () => void;
  getAccessToken: () => Promise<string | null>;
};

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

export function truncateAddress(address: string | null | undefined): string {
  if (!address) return "";
  return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

/** Guest mode: no server, no wallet, no token. Lets the UI exercise the full flow offline. */
function GuestAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  const login = useCallback(() => {
    const handle = `guest-${Math.random().toString(36).slice(2, 6)}`;
    setUser({ id: handle, displayName: `@${handle}`, walletAddress: null });
  }, []);
  const logout = useCallback(() => setUser(null), []);
  const getAccessToken = useCallback(async () => null, []);

  const value = useMemo<AuthState>(
    () => ({
      ready: true,
      isAuthenticated: Boolean(user),
      user,
      isReal: false,
      login,
      logout,
      getAccessToken,
    }),
    [user, login, logout, getAccessToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

const LazyPrivyRuntime = lazy(() => import("./PrivyAuthProvider"));

function DeferredPrivyAuthProvider({ children }: { children: ReactNode }) {
  const [loadRequested, setLoadRequested] = useState(false);
  const [loginRequest, setLoginRequest] = useState(0);
  const [privyState, setPrivyState] = useState<AuthState | null>(null);
  const logoutRef = useRef<(() => void) | null>(null);

  const login = useCallback(() => {
    setLoadRequested(true);
    setLoginRequest((current) => current + 1);
  }, []);

  const logout = useCallback(() => {
    logoutRef.current?.();
  }, []);

  const getAccessToken = useCallback(async () => null, []);

  useEffect(() => {
    if (loadRequested) return undefined;
    const idleWindow = window as Window & {
      requestIdleCallback?: Window["requestIdleCallback"];
      cancelIdleCallback?: Window["cancelIdleCallback"];
    };

    if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
      const handle = idleWindow.requestIdleCallback(() => setLoadRequested(true), { timeout: 8000 });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }

    const timer = globalThis.setTimeout(() => setLoadRequested(true), 8000);
    return () => globalThis.clearTimeout(timer);
  }, [loadRequested]);

  const signedOutValue = useMemo<AuthState>(
    () => ({
      ready: true,
      isAuthenticated: false,
      user: null,
      isReal: true,
      login,
      logout,
      getAccessToken,
    }),
    [getAccessToken, login, logout],
  );

  const handlePrivyState = useCallback((next: AuthState) => {
    logoutRef.current = next.logout;
    setPrivyState(next);
  }, []);

  return (
    <AuthContext.Provider value={privyState ?? signedOutValue}>
      {children}
      {loadRequested && (
        <Suspense fallback={null}>
          <LazyPrivyRuntime loginRequest={loginRequest} onState={handlePrivyState} />
        </Suspense>
      )}
    </AuthContext.Provider>
  );
}

export function AppAuthProvider({ children }: { children: ReactNode }) {
  if (!features.privy) {
    return <GuestAuthProvider>{children}</GuestAuthProvider>;
  }
  return <DeferredPrivyAuthProvider>{children}</DeferredPrivyAuthProvider>;
}
