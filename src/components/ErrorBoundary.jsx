import { Component } from "react";

// App-wide safety net. Without this, ANY uncaught render error unmounts React and leaves a blank
// white screen (no theme, no message) — impossible to diagnose from a screenshot. This catches the
// error, shows it on screen with the message + stack, and offers Reload / Copy so the issue can be
// reported instead of guessed at.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Also log to console for DevTools.
    // eslint-disable-next-line no-console
    console.error("Ambria crashed:", error, info);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    const text = `${error?.message || error}\n\n${error?.stack || ""}\n\nComponent stack:${info?.componentStack || ""}`;
    const box = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#0d0d18", color: "#f1f1f4", border: "1px solid #333", borderRadius: 8, padding: 14, marginTop: 14, maxHeight: "50vh", overflow: "auto" };
    const btn = (bg) => ({ padding: "8px 16px", borderRadius: 8, border: "none", background: bg, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" });

    return (
      <div style={{ minHeight: "100vh", background: "#13131f", color: "#f1f1f4", padding: 24, boxSizing: "border-box" }}>
        <div style={{ maxWidth: 820, margin: "40px auto" }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#F87171" }}>⚠️ Something broke on this screen</div>
          <div style={{ fontSize: 13, color: "#a3a3b2", marginTop: 6 }}>
            The app hit an unexpected error and stopped rendering. Your data is safe. Try Reload — if it
            keeps happening, copy the details below and send them over so it can be fixed.
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            <button onClick={() => window.location.reload()} style={btn("#7C3AED")}>↻ Reload</button>
            <button onClick={() => { window.location.hash = "#/"; window.location.reload(); }} style={btn("#374151")}>🏠 Go to start & reload</button>
            <button onClick={() => { try { navigator.clipboard.writeText(text); } catch { /* ignore */ } }} style={btn("#374151")}>📋 Copy error</button>
          </div>
          <div style={box}>{text}</div>
        </div>
      </div>
    );
  }
}
