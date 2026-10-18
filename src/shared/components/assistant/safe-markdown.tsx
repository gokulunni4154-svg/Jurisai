// Minimal, safe Markdown renderer for AI output.
//
// SECURITY: renders ONLY React elements built from parsed text. It never uses
// dangerouslySetInnerHTML, never emits <a>/<img>/raw HTML (links and images
// are shown as plain text), so model output or injected document text cannot
// execute script, load remote resources, or fake navigation.

import { Fragment, type ReactNode } from "react";

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(pattern)) {
    const idx = match.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith("**"))
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`"))
      out.push(
        <code
          key={key}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    else out.push(<em key={key}>{token.slice(1, -1)}</em>);
    last = idx + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { type: "p"; text: string }
  | { type: "h"; text: string }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "code"; text: string };

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
    } else if (line.trim().startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("```"))
        buf.push(lines[i++]!);
      i++;
      blocks.push({ type: "code", text: buf.join("\n") });
    } else if (/^#{1,6}\s+/.test(line)) {
      blocks.push({ type: "h", text: line.replace(/^#{1,6}\s+/, "") });
      i++;
    } else if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      const re = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/;
      while (i < lines.length && re.test(lines[i]!))
        items.push(lines[i++]!.replace(re, ""));
      blocks.push({ type: ordered ? "ol" : "ul", items });
    } else {
      const buf: string[] = [];
      while (
        i < lines.length &&
        lines[i]!.trim() !== "" &&
        !/^#{1,6}\s+/.test(lines[i]!) &&
        !/^\s*[-*]\s+/.test(lines[i]!) &&
        !/^\s*\d+[.)]\s+/.test(lines[i]!) &&
        !lines[i]!.trim().startsWith("```")
      )
        buf.push(lines[i++]!);
      blocks.push({ type: "p", text: buf.join(" ") });
    }
  }
  return blocks;
}

export function SafeMarkdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-2 text-[13.5px] leading-relaxed">
      {blocks.map((b, bi) => {
        const k = `b${bi}`;
        switch (b.type) {
          case "h":
            return (
              <p key={k} className="font-semibold">
                {renderInline(b.text, k)}
              </p>
            );
          case "ul":
          case "ol": {
            const Tag = b.type;
            return (
              <Tag
                key={k}
                className={
                  b.type === "ul" ? "list-disc pl-5" : "list-decimal pl-5"
                }
              >
                {b.items.map((it, ii) => (
                  <li key={`${k}-${ii}`}>{renderInline(it, `${k}-${ii}`)}</li>
                ))}
              </Tag>
            );
          }
          case "code":
            return (
              <pre
                key={k}
                className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-[12px]"
              >
                {b.text}
              </pre>
            );
          default:
            return (
              <Fragment key={k}>
                <p>{renderInline(b.text, k)}</p>
              </Fragment>
            );
        }
      })}
    </div>
  );
}
