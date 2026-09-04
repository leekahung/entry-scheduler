import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3001" },
  },
  test: {
    // Two projects, because the halves need different environments: the server
    // must be tested on the real Node it runs on, and components need a DOM.
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          globals: true,
          environment: "node",
          include: ["server/**/*.test.ts"],
          // Runs before each test file, so a real .env in the shell cannot
          // change what the suite is testing.
          setupFiles: ["./server/test-setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "web",
          globals: true,
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          setupFiles: ["./src/test-setup.ts"],
        },
      },
    ],
  },
});
