import type { ReactNode } from "react";
import { parseInline, parseLegalMarkdown } from "@/lib/legal-markdown";

/** The Terms / Privacy Markdown as markup, in the claim page's large text. Server component. */
function Inline({ text }: { text: string }) {
  const parts: ReactNode[] = parseInline(text).map((part, i) => {
    if (part.kind === "bold") return <strong key={i} className="font-bold" style={{ color: "var(--kb-ink)" }}>{part.text}</strong>;
    if (part.kind === "link") {
      return (
        <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" className="font-semibold underline" style={{ color: "var(--kb-purple)" }}>
          {part.text}
        </a>
      );
    }
    return <span key={i}>{part.text}</span>;
  });
  return <>{parts}</>;
}

export function LegalText({ source, id }: { source: string; id?: string }) {
  return (
    <div id={id} className="text-base leading-7" style={{ color: "var(--kb-ink-soft)" }}>
      {parseLegalMarkdown(source).map((block, i) => {
        switch (block.kind) {
          case "h1":
            return (
              <h2 key={i} className="font-display text-2xl font-bold leading-tight" style={{ color: "var(--kb-ink)" }}>
                <Inline text={block.text} />
              </h2>
            );
          case "h2":
            return (
              <h3 key={i} className="mt-6 text-lg font-bold leading-7" style={{ color: "var(--kb-ink)" }}>
                <Inline text={block.text} />
              </h3>
            );
          case "ul":
            return (
              <ul key={i} className="mt-2 list-disc space-y-2 pl-5">
                {block.items.map((item, j) => (
                  <li key={j}><Inline text={item} /></li>
                ))}
              </ul>
            );
          case "p":
            return (
              <p key={i} className="mt-3 break-words">
                {block.lines.map((line, j) => (
                  <span key={j}>
                    {j > 0 && <br />}
                    <Inline text={line} />
                  </span>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}
