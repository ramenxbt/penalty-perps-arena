import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppAuthProvider } from "./auth/AuthContext";
import { ArenaV2 } from "./components/ArenaV2";
import { ArenaV2Dev } from "./components/ArenaV2Dev";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toast";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root not found");

const root = createRoot(container);

const params = new URLSearchParams(window.location.search);
// Isolated v2 views (no StrictMode = single WebGL context). /?v2 = playable, /?v2dev = auto-loop.
if (params.has("v2dev")) {
  root.render(<ArenaV2Dev />);
} else if (params.has("v2")) {
  root.render(
    <ErrorBoundary>
      <AppAuthProvider>
        <ArenaV2 />
      </AppAuthProvider>
    </ErrorBoundary>,
  );
} else {
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <AppAuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AppAuthProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
