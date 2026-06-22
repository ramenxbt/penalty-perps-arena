import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppAuthProvider } from "./auth/AuthContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root not found");

createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppAuthProvider>
        <App />
      </AppAuthProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
