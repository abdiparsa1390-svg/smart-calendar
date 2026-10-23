import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const base = process.env.VITE_LOCAL_MODE === "true"
  ? "/"
  : process.env.GITHUB_ACTIONS === "true"
    ? "/smart-calendar/"
    : "/";

export default defineConfig({
  plugins: [react()],
  base,
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true
      }
    }
  }
});
