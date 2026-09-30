import { rm } from "node:fs/promises";

await Promise.all(
  [".build", "coverage", "playwright-report", "test-results"].map((path) =>
    rm(path, { force: true, recursive: true }),
  ),
);
