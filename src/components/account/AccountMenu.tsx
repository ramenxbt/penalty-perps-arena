/**
 * Topbar account control. Renders a single avatar+handle chip (or a Connect button when
 * signed out) that opens a popover menu. The menu collects everything that used to live as
 * loose topbar buttons: view profile, wallet address with a copy target, holder status,
 * a match sound toggle, and a clearly separated Disconnect / Connect action.
 *
 * The wallet address row is a COPY target only; it never disconnects. Disconnect is its
 * own red action, separated from the rest. Closes on click-outside and Escape, and returns
 * focus to the trigger.
 */
import { useEffect, useRef, useState } from "react";
import {
  BadgeCheck,
  Check,
  ChevronRight,
  Copy,
  LogOut,
  UserRound,
  Volume2,
  VolumeX,
  Wallet,
} from "lucide-react";
import { truncateAddress, type AuthState } from "../../auth/AuthContext";

export type AccountMenuProps = {
  auth: AuthState;
  /** Holder status, already gated by the caller (features.tokenGate). Null = do not show. */
  isHolder: boolean | null;
  tokenSymbol: string;
  soundOn: boolean;
  onToggleSound: (next: boolean) => void;
  onViewProfile: () => void;
};

export function AccountMenu(props: AccountMenuProps) {
  const { auth, isHolder, tokenSymbol, soundOn, onToggleSound, onViewProfile } = props;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  if (!auth.ready) {
    return (
      <button className="wallet-button" type="button" disabled aria-busy="true">
        <Wallet size={17} />
        Loading
      </button>
    );
  }

  if (!auth.isAuthenticated || !auth.user) {
    return (
      <button className="wallet-button" type="button" onClick={auth.login}>
        <Wallet size={17} />
        Connect
      </button>
    );
  }

  const user = auth.user;
  const handle = user.displayName || "@you";
  const address = user.walletAddress;

  const onCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        className={open ? "account-trigger open" : "account-trigger"}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="account-avatar" aria-hidden="true">
          <UserRound size={16} />
        </span>
        <span className="account-handle">{handle}</span>
        <ChevronRight size={15} className="account-caret" aria-hidden="true" />
      </button>

      {open && (
        <div className="account-popover" role="menu" aria-label="Account">
          <button
            className="account-item"
            type="button"
            role="menuitem"
            onClick={() => {
              onViewProfile();
              close();
            }}
          >
            <UserRound size={16} />
            <span>View profile</span>
          </button>

          {address ? (
            <div className="account-wallet">
              <span className="account-wallet-label">Wallet</span>
              <div className="account-wallet-row">
                <code>{truncateAddress(address)}</code>
                <button
                  className="account-copy"
                  type="button"
                  onClick={onCopy}
                  aria-label="Copy wallet address"
                  title="Copy wallet address"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          ) : (
            <div className="account-wallet">
              <span className="account-wallet-label">Wallet</span>
              <div className="account-wallet-row">
                <code>Guest session</code>
              </div>
            </div>
          )}

          {isHolder !== null && (
            <div className={isHolder ? "account-holder is-holder" : "account-holder"}>
              <BadgeCheck size={16} />
              <span>{isHolder ? `${tokenSymbol} holder` : `Not a ${tokenSymbol} holder`}</span>
            </div>
          )}

          <button
            className="account-item"
            type="button"
            role="menuitemcheckbox"
            aria-checked={soundOn}
            onClick={() => onToggleSound(!soundOn)}
          >
            {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
            <span>Match sound</span>
            <span className={soundOn ? "account-toggle on" : "account-toggle"} aria-hidden="true">
              {soundOn ? "On" : "Off"}
            </span>
          </button>

          <div className="account-divider" aria-hidden="true" />

          <button
            className="account-item danger"
            type="button"
            role="menuitem"
            onClick={() => {
              auth.logout();
              close();
            }}
          >
            <LogOut size={16} />
            <span>Disconnect</span>
          </button>
        </div>
      )}
    </div>
  );
}
