import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Transpile newer syntax for older Android Chromium/WebView engines.
  // Runtime APIs still need explicit compatibility checks.
  build: { target: ["chrome79", "edge79", "firefox78", "safari13"] },
  server: { proxy: { "/api": "http://localhost:8080" } },
});
