import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy /api to the Fastify server during development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.API_URL ?? "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
