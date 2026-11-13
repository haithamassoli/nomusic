import { existsSync } from "node:fs";

export function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const candidate of ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("No browser found: set CHROME to a Chrome, Edge, Brave or Chromium executable.");
}
