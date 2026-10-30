// A tiny Markdown renderer for the model's condensed text: headings,
// paragraphs, bullet and numbered lists, quotes, code, **bold** and *italic*,
// and links written [words](L3), which `link` turns into the page's own link.
// Rendered as Preact nodes, never as HTML strings.

type LinkFn = (id: number, words: string, key: string) => any;

function inline(s: string, link?: LinkFn): any[] {
  const out: any[] = [];
  // Code first, so `*` and `_` inside code stay as typed. A link to anything
  // but a link id the page gave (a made-up address) shows only its words.
  // Emphasis never starts or ends inside a word, as in CommonMark for `_`:
  // first_name_last@example.org, MAX_RETRY_COUNT and 5*3*2 stay as typed.
  const re = /(`{1,3})([^`]+?)\1|\[([^[\]]+)\]\(\s*([^()\s]*)\s*\)|\*\*((?:[^*]|\*(?!\*))+?)\*\*|(?<![\p{L}\p{N}_*])\*([^*\s][^*]*)\*(?![\p{L}\p{N}_*])|(?<![\p{L}\p{N}_])_([^_\s][^_]*)_(?![\p{L}\p{N}_])/gu;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[2] !== undefined) out.push(<code key={i++}>{m[2].trim()}</code>);
    else if (m[3] !== undefined) {
      const id = /^#?L(\d+)$/.exec(m[4]);
      const words = inline(m[3]);
      out.push(id && link ? link(Number(id[1]), m[3], "l" + i++) ?? words : words);
    } else if (m[5]) out.push(<strong key={i++}>{m[5]}</strong>);
    else out.push(<em key={i++}>{m[6] ?? m[7]}</em>);
    last = re.lastIndex;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export function Markdown({ text, link }: { text: string; link?: LinkFn }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: any[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[]; start?: number } | null = null;
  let quote: string[] = [];
  /** Inside a fenced code block: its fence and lines so far. */
  let code: { fence: string; lines: string[] } | null = null;
  let k = 0;
  // Sift's page title is the h1; headings never skip a level after it.
  let level = 1;
  const heading = (want: number, content: any) => {
    level = Math.min(want, level + 1);
    const Tag = ("h" + level) as "h2";
    blocks.push(<Tag key={k++}>{content}</Tag>);
  };
  const flushPara = () => {
    if (para.length) blocks.push(<p key={k++}>{inline(para.join(" "), link)}</p>);
    para = [];
    if (quote.length) blocks.push(<blockquote key={k++}>{inline(quote.join(" "), link)}</blockquote>);
    quote = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, link)}</li>);
    // A numbered list keeps the model's first number ("3. It has cash…" is not "1.").
    blocks.push(list.ordered ? <ol key={k++} start={list.start !== 1 ? list.start : undefined}>{items}</ol> : <ul key={k++}>{items}</ul>);
    list = null;
  };
  const flushCode = () => {
    if (!code) return;
    // Common indentation goes (a fence inside a list item is indented).
    const pad = Math.min(...code.lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length), 99);
    blocks.push(<pre key={k++}><code>{code.lines.map((l) => l.slice(pad === 99 ? 0 : pad)).join("\n")}</code></pre>);
    code = null;
  };
  for (const raw of lines) {
    if (code) {
      if (raw.trim().startsWith(code.fence) && !raw.trim().slice(code.fence.length).trim()) flushCode();
      else code.lines.push(raw.trimEnd());
      continue;
    }
    const line = raw.trimEnd();
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      flushPara();
      flushList();
      const rest = line.trim().slice(fence[1].length);
      // A whole block on one line: ```code```.
      const close = rest.lastIndexOf(fence[1]);
      if (close > 0) {
        blocks.push(<pre key={k++}><code>{rest.slice(0, close).trim()}</code></pre>);
        continue;
      }
      // The rest of the opening line is the language name.
      code = { fence: fence[1], lines: [] };
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const h = /^(#{1,6})(?:\s+(.*))?$/.exec(line.trim());
    if (h) {
      flushPara();
      flushList();
      // A heading line with no text is nothing.
      if (!h[2]?.replace(/#+$/, "").trim()) continue;
      // "#" and "##" are the page's sections (h2), "###" their parts (h3).
      heading(Math.min(4, Math.max(2, h[1].length)), inline(h[2].replace(/#+$/, "").trim(), link));
      continue;
    }
    const bh = /^\*\*([^*]{2,80})\*\*:?$/.exec(line.trim());
    if (bh) {
      flushPara();
      flushList();
      heading(3, bh[1]);
      continue;
    }
    const qt = /^\s*>\s?(.*)$/.exec(line);
    if (qt) {
      if (para.length) flushPara();
      flushList();
      quote.push(qt[1].trim());
      continue;
    }
    if (quote.length) flushPara();
    const b = /^\s*[-*•]\s+(.*)$/.exec(line);
    const n = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (b || n) {
      flushPara();
      const ordered = !!n;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [], start: n ? Number(n[1]) : undefined };
      }
      list.items.push(b ? b[1] : n![2]);
      continue;
    }
    if (list && /^\s{2,}/.test(raw)) {
      list.items[list.items.length - 1] += " " + line.trim();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushCode();
  flushPara();
  flushList();
  return <>{blocks}</>;
}
