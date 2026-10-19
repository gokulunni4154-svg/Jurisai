import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Contrast guard for the shared Badge/Button/Input token pairs, computed from
 * the real HSL tokens in globals.css (not hand-copied hex values).
 */
const css = readFileSync(
  path.resolve(__dirname, "../../../app/globals.css"),
  "utf8",
);

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n  }", start));
}

function tokens(selector: string): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  for (const m of block(selector).matchAll(
    /--([a-z-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g,
  )) {
    out[m[1]!] = [Number(m[2]), Number(m[3]) / 100, Number(m[4]) / 100];
  }
  return out;
}

function luminance([h, s, l]: [number, number, number]): number {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const lin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(f(0)) + 0.7152 * lin(f(8)) + 0.0722 * lin(f(4));
}

function contrast(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

// [background token, foreground token] pairs used by the shared primitives.
const PAIRS: Array<[string, string]> = [
  ["muted", "muted-foreground"], // Badge neutral
  ["accent", "accent-foreground"], // Badge primary
  ["success-subtle", "success-subtle-foreground"],
  ["warning-subtle", "warning-subtle-foreground"],
  ["info-subtle", "info-subtle-foreground"],
  ["destructive-subtle", "destructive-subtle-foreground"],
  ["primary", "primary-foreground"], // Button default
  ["secondary", "secondary-foreground"], // Button secondary
  ["destructive", "destructive-foreground"], // Button destructive
  ["background", "foreground"], // Input / Tooltip inverse
  ["background", "muted-foreground"], // placeholder + help text
  ["background", "destructive"], // FieldError on page background
  ["card", "card-foreground"],
];

describe.each([
  ["light", ":root"],
  ["dark", ".dark"],
])("%s theme contrast", (_name, selector) => {
  const t = tokens(selector);
  it.each(PAIRS)("%s / %s >= 4.5:1", (bg, fg) => {
    // The dark block only overrides what differs; fall back to :root values.
    const root = tokens(":root");
    const bgv = t[bg] ?? root[bg];
    const fgv = t[fg] ?? root[fg];
    expect(bgv, `token --${bg}`).toBeDefined();
    expect(fgv, `token --${fg}`).toBeDefined();
    expect(contrast(bgv!, fgv!)).toBeGreaterThanOrEqual(4.5);
  });
});
