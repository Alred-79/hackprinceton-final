import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { chromium } from "@playwright/test";

const requiredNode = "20.19.0";
if (process.versions.node !== requiredNode) {
  console.error(
    `[architect:e2e] Node ${requiredNode} is required for the pinned Vite 7 / Playwright 1.55 browser lane; current Node is ${process.versions.node}.`,
  );
  process.exit(1);
}

const executable = chromium.executablePath();
try {
  await access(executable, constants.X_OK);
} catch {
  console.error(
    `[architect:e2e] Expected Chromium is missing or not executable at ${executable}. Run “pnpm setup:architect:e2e” first.`,
  );
  process.exit(1);
}

console.log(`[architect:e2e] Node ${requiredNode} and Chromium are ready.`);

