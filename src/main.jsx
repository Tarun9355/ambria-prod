import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { AuthProvider } from "./lib/AuthContext";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import "./index.css";

// Hidden planning-sweep run (IMS's "Sync planning" button loads Studio in an invisible frame at
// #/studio?sweep=1). A same-origin frame shares sessionStorage with the page that opened it, and
// Studio keeps "which deal is open / which step" there — so this run gets a private in-memory one:
// it restores nothing from the person's session and leaves their pointers exactly as they were.
if (/[?&]sweep=1\b/.test(window.location.hash) && window.self !== window.top) {
  const mem = new Map();
  try {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => { mem.set(k, String(v)); },
        removeItem: (k) => { mem.delete(k); },
        clear: () => mem.clear(),
        key: (i) => [...mem.keys()][i] ?? null,
        get length() { return mem.size; },
      },
    });
    window.__AMBRIA_SWEEP__ = true; // only once the private storage is in place
  } catch { /* cannot isolate sessionStorage — then no sweep runs here at all */ }
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>
);

// Installable app (PWA): register the pass-through service worker (public/sw.js — caches nothing,
// see its header). Production only, so `npm run dev` never runs a worker over Vite's own server.
// BASE_URL is "/ambria-prod/" on GitHub Pages, which is also the worker's scope.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {});
  });
}
