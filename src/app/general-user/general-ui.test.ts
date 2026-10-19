import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Design-token guard for the General Legal Portal and the shared components
// it renders (assistant chat, notifications). Mirrors the firm-pages guard.

const appRoot = __dirname;
const sharedRoot = path.join(__dirname, "../../shared/components");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [p] : [];
  });
}

const files = [
  ...sourceFiles(appRoot),
  ...sourceFiles(path.join(sharedRoot, "assistant")),
  ...sourceFiles(path.join(sharedRoot, "notifications")),
];

function codeLines(file: string): string[] {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    });
}

describe("general portal design-token guard", () => {
  it("finds the general portal pages", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each([
    [
      "hardcoded palette classes",
      /\b(?:bg|text|border|ring|divide)-(?:slate|gray|zinc|red|emerald|amber|orange|green|blue)-\d{2,3}\b/,
    ],
    [
      "translucent status backgrounds",
      /\b(?:bg|border)-(?:primary|destructive|success|warning|info)\/\d+\b/,
    ],
    ["font-serif headings", /\bfont-serif\b/],
    [
      "arbitrary pixel font sizes above 10px",
      /\btext-\[(?:1[1-9]|2\d)(?:\.\d+)?px\]/,
    ],
  ])("has no %s", (_label, pattern) => {
    const offenders = files.flatMap((f) =>
      codeLines(f)
        .filter((l) => pattern.test(l))
        .map(
          (l) => `${path.relative(sharedRoot, f)}: ${l.trim().slice(0, 100)}`,
        ),
    );
    expect(offenders).toEqual([]);
  });
});
