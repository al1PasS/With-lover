import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "../e2e",
  use: {
    baseURL: "http://127.0.0.1:5173",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROME ||
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
  },
});
