// Entry point: finds <div id="root"> in index.html and renders <App /> into it.
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
// Fonts are bundled with the app (no internet needed for them)
import "@fontsource/bungee/400.css"; // chunky arcade-sign headings
import "@fontsource/silkscreen/400.css"; // pixel font for XP, levels, numbers
import "@fontsource/rubik/400.css"; // rounded, friendly body text
import "@fontsource/rubik/500.css";
import "@fontsource/rubik/700.css";
import "./index.css";

// Phone-app mode: the service worker caches the app so it opens offline.
// Only in the built app; in development it would serve stale files.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
