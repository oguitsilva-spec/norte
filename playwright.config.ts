import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  use: {
    baseURL: process.env.BASE ?? "http://localhost:3000",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    launchOptions: process.env.CHROME ? { executablePath: process.env.CHROME } : undefined,
  },
  reporter: [["list"]],
});
