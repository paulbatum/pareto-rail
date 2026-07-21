import type { ReactNode } from 'react';

/** Renders the small Markdown subset used by the site's editable prose pages:
 * `##` headings, paragraphs, `-` lists, `**bold**`, and `[text](url)` links.
 * Content is authored in this repo, not user-supplied, and is turned into React
 * elements rather than raw HTML. */
export function Markdown({ source }: { source: string }) {
  const blocks = source.trim().split(/\n{2,}/).filter((block) => !block.startsWith('<!--'));
  return (
    <>
      {blocks.map((block, index) => {
        const key = `block-${index}`;
        if (block.startsWith('## ')) return <h2 key={key}>{inline(block.slice(3))}</h2>;
        if (block.startsWith('- ')) {
          const items = block.split('\n').map((line) => line.replace(/^- /, ''));
          return <ul key={key}>{items.map((item, itemIndex) => <li key={`${key}-${itemIndex}`}>{inline(item)}</li>)}</ul>;
        }
        return <p key={key}>{inline(block.replace(/\n/g, ' '))}</p>;
      })}
    </>
  );
}

/** Returns the region of `source` between `<!-- name:start -->` and its matching
 * end marker. Lets a document be authored once and shown in part somewhere else
 * — the site's About page renders a region of the repository README. */
export function markdownRegion(source: string, name: string): string {
  const open = `<!-- ${name}:start -->`;
  const close = `<!-- ${name}:end -->`;
  const from = source.indexOf(open);
  const to = source.indexOf(close);
  if (from < 0 || to < from) {
    if (import.meta.env.DEV) console.error(`Markdown region "${name}" is missing its ${from < 0 ? 'start' : 'end'} marker.`);
    return '';
  }
  return source.slice(from + open.length, to).trim();
}

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let plain = 0;
  let at = 0;
  const flush = (upTo: number) => { if (upTo > plain) nodes.push(text.slice(plain, upTo)); };

  while (at < text.length) {
    const link = readLink(text, at);
    if (link) {
      flush(at);
      nodes.push(link.href.startsWith('http')
        ? <a key={at} href={link.href} target="_blank" rel="noreferrer">{link.label}</a>
        : <a key={at} href={link.href}>{link.label}</a>);
      at = plain = link.end;
      continue;
    }
    if (text.startsWith('**', at)) {
      const close = text.indexOf('**', at + 2);
      if (close > 0) {
        flush(at);
        nodes.push(<strong key={at}>{text.slice(at + 2, close)}</strong>);
        at = plain = close + 2;
        continue;
      }
    }
    at += 1;
  }
  flush(text.length);
  return nodes;
}

/** Reads `[label](href)` at `start`, tracking nested parentheses so URLs that
 * end in one — Wikipedia's `Rez_(video_game)`, say — survive intact. */
function readLink(text: string, start: number) {
  if (text[start] !== '[') return null;
  const labelEnd = text.indexOf(']', start + 1);
  if (labelEnd < 0 || text[labelEnd + 1] !== '(') return null;

  let depth = 1;
  let scan = labelEnd + 2;
  for (; scan < text.length && depth > 0; scan += 1) {
    if (text[scan] === '(') depth += 1;
    else if (text[scan] === ')') depth -= 1;
  }
  if (depth > 0) return null;
  return { label: text.slice(start + 1, labelEnd), href: text.slice(labelEnd + 2, scan - 1), end: scan };
}
