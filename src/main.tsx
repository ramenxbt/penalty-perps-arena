import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppAuthProvider } from "./auth/AuthContext";
import { ArenaV2Dev } from "./components/ArenaV2Dev";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toast";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root not found");

const root = createRoot(container);

// Isolated v2 dev view: /?v2 renders only the new cel-shaded arena (no StrictMode = single WebGL context).
if (new URLSearchParams(window.location.search).has("v2")) {
  root.render(<ArenaV2Dev />);
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
