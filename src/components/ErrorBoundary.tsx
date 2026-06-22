/**
 * Top-level error boundary. The 3D scene and wallet SDK can throw at runtime; without
 * a boundary that takes down the whole page. This shows a recoverable fallback instead.
 */

import { Component, ErrorInfo, ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean; message: string };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: error instanceof Error ? error.message : "Unexpected error" };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Hook a real reporter (Sentry, etc.) here in production.
    console.error("Arena crashed:", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="crash-screen" role="alert">
        <h1>The arena hit a snag</h1>
        <p>{this.state.message}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
