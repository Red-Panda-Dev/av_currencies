import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.js", "ios/**/*.js"],
      exclude: ["src/content/**", "src/popup/**"],
      thresholds: {
        "src/**/*.js": {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
        "ios/**/*.js": {
          lines: 70,
          functions: 75,
          branches: 50,
          statements: 65,
        },
      },
    },
  },
});
