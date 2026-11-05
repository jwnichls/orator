import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: "server", environment: "node", include: ["server/**/*.test.ts"] },
      },
      {
        plugins: [react()],
        test: { name: "web", environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"], setupFiles: ["test/setup-web.ts"] },
      },
    ],
  },
});
