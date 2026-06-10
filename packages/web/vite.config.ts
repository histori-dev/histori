import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/sessions": "http://localhost:7777",
      "/search": "http://localhost:7777",
      "/rules": "http://localhost:7777",
      "/health": "http://localhost:7777",
    },
  },
});
