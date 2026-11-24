/**
 * A deliberately tiny Markdown parser for the Terms and Privacy text (same
 * rules as the Customer app's src/lib/legal-markdown.tsx): "# " and "## "
 * headings, "- " bullets, paragraphs, and **bold** / [text](href) inline.
 * Every word is passed through as written.
 */
export type LegalBlock =
  | { kind: "h1" | "h2"; text: string }
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] };

export function parseLegalMarkdown(source: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  let current: LegalBlock | null = null;
  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") flush();
    else if (line.startsWith("## ")) {
      flush();
      blocks.push({ kind: "h2", text: line.slice(3) });
    } else if (line.startsWith("# ")) {
      flush();
      blocks.push({ kind: "h1", text: line.slice(2) });
    } else if (line.startsWith("- ")) {
      if (current?.kind !== "ul") {
        flush();
        current = { kind: "ul", items: [] };
      }
      current.items.push(line.slice(2));
    } else {
      if (current?.kind !== "p") {
        flush();
        current = { kind: "p", lines: [] };
      }
      current.lines.push(line);
    }
  }
  flush();
  return blocks;
}

export type InlinePart = { kind: "text" | "bold"; text: string } | { kind: "link"; text: string; href: string };

const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string): InlinePart[] {
  const out: InlinePart[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else out.push({ kind: "link", text: m[2], href: m[3] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}
