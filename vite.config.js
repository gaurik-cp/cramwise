// Vite config: tells Vite we're using React (so it understands JSX).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Always use port 5173 (Google sign-in is set up for exactly this address).
    // If 5173 is busy, an old copy of Cramwise is still running: close it instead
    // of silently moving to 5174, 5175...
    port: 5173,
    strictPort: true,
    // Any request to /api/... is passed to the Flask server on port 5050.
    // So the React app and the server look like ONE website to the browser,
    // which keeps login cookies simple and safe.
    proxy: {
      "/api": "http://127.0.0.1:5050",
    },
  },
});
