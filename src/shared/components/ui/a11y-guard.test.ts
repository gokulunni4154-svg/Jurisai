import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Source-level guard: every <input>/<select>/<textarea> (and the shared
 * Input/Select/Textarea primitives) rendered by app or shared code must have
 * an accessible name: aria-label, aria-labelledby, an id (for a <Label
 * htmlFor>), or sit inside a wrapping <label>. File inputs are exempt (they
 * are opened by a named button). Placeholder text alone is not a name.
 */
const ROOT = join(process.cwd(), "src");
const CONTROL =
  /<(input|select|textarea|Input|Select|Textarea)\b([^<>]*?(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^<>]*?)*)\/?>/gs;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx") && !full.endsWith(".test.tsx"))
      out.push(full);
  }
  return out;
}

describe("form controls have accessible names", () => {
  it("finds no unnamed controls", () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      if (file.endsWith(join("ui", "input.tsx"))) continue;
      const src = readFileSync(file, "utf8");
      const lines = src.split("\n");
      for (const m of src.matchAll(CONTROL)) {
        const attrs = m[2] ?? "";
        if (/aria-label|aria-labelledby|\bid=|type="file"/.test(attrs))
          continue;
        const start = m.index ?? 0;
        const line = src.slice(0, start).split("\n").length;
        if (/^\s*(\/\/|\*|\/\*)/.test(lines[line - 1] ?? "")) continue;
        const before = src.slice(Math.max(0, start - 400), start);
        if (before.lastIndexOf("<label") > before.lastIndexOf("</label>"))
          continue;
        offenders.push(`${file.replace(ROOT, "src")}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
