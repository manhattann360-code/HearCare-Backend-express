import * as cheerio from 'cheerio';
import sanitizeHtml from 'sanitize-html';
import { config } from '../config';

export type Run = { text: string; bold?: true; italic?: true; href?: string };
export type Block =
  | { type: 'heading'; level: 2 | 3; runs: Run[] }
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'list'; ordered: boolean; items: Run[][] }
  | { type: 'image'; url: string; caption: string | null }
  | { type: 'callout'; title: string | null; blocks: Block[] }
  | { type: 'divider' };

const MEDIA_RE = /https?:\/\/[^"'\s)]+?(\/media\/[a-f0-9]{24})/g;

/** Store media URLs relative so changing the server domain never breaks articles. */
export const toRelativeMedia = (s: string) => s.replace(MEDIA_RE, '$1');
export const absUrl = (u: string | null | undefined) =>
  !u ? null : u.startsWith('/') ? config.PUBLIC_URL.replace(/\/$/, '') + u : u;
export const toAbsoluteMediaHtml = (html: string) =>
  html.replace(/(src=")(\/media\/)/g, `$1${config.PUBLIC_URL.replace(/\/$/, '')}$2`);

export function sanitizeArticleHtml(html: string): string {
  const clean = sanitizeHtml(toRelativeMediaAttrs(html), {
    allowedTags: ['h2', 'h3', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'br', 'img', 'blockquote', 'hr'],
    allowedAttributes: { a: ['href'], img: ['src', 'alt'] },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    allowProtocolRelative: false,
    transformTags: {
      h1: 'h2',
      h4: 'h3',
      h5: 'h3',
      h6: 'h3',
      b: 'strong',
      i: 'em',
      a: (tag, attribs) => ({
        tagName: 'a',
        attribs: { href: attribs.href ?? '' },
      }),
    },
    exclusiveFilter: (f) =>
      (f.tag === 'p' || f.tag === 'h2' || f.tag === 'h3') && !f.text.trim() && !f.mediaChildren?.length ? true : false,
  });
  return clean.trim();
}

function toRelativeMediaAttrs(html: string) {
  return toRelativeMedia(html);
}

/* ------------------------------------------------------------------ */

function inlineRuns($: cheerio.CheerioAPI, nodes: any[], state: { bold?: boolean; italic?: boolean; href?: string } = {}): Run[] {
  const runs: Run[] = [];
  for (const n of nodes) {
    if (n.type === 'text') {
      const text = (n.data as string).replace(/\s+/g, ' ');
      if (text) runs.push(mkRun(text, state));
    } else if (n.type === 'tag') {
      if (n.name === 'br') runs.push(mkRun('\n', state));
      else if (n.name === 'img') continue;
      else {
        const next = { ...state };
        if (n.name === 'strong' || n.name === 'b') next.bold = true;
        if (n.name === 'em' || n.name === 'i') next.italic = true;
        if (n.name === 'a' && $(n).attr('href')) next.href = $(n).attr('href');
        runs.push(...inlineRuns($, n.children ?? [], next));
      }
    }
  }
  return trimRuns(mergeRuns(runs));
}

function mkRun(text: string, s: { bold?: boolean; italic?: boolean; href?: string }): Run {
  const r: Run = { text };
  if (s.bold) r.bold = true;
  if (s.italic) r.italic = true;
  if (s.href) r.href = s.href;
  return r;
}

function mergeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && !!last.bold === !!r.bold && !!last.italic === !!r.italic && last.href === r.href) last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

function trimRuns(runs: Run[]): Run[] {
  if (!runs.length) return runs;
  runs[0].text = runs[0].text.replace(/^\s+/, '');
  const l = runs[runs.length - 1];
  l.text = l.text.replace(/\s+$/, '');
  return runs.filter((r) => r.text.length > 0);
}

const plain = (runs: Run[]) => runs.map((r) => r.text).join('');

function blocksFrom($: cheerio.CheerioAPI, nodes: any[]): Block[] {
  const blocks: Block[] = [];
  for (const n of nodes) {
    if (n.type !== 'tag') continue;
    const el = $(n);
    switch (n.name) {
      case 'h2':
      case 'h3': {
        const runs = inlineRuns($, n.children ?? []);
        if (runs.length) blocks.push({ type: 'heading', level: n.name === 'h2' ? 2 : 3, runs });
        break;
      }
      case 'p': {
        // split around images so pictures become their own blocks
        let buffer: any[] = [];
        const flush = () => {
          const runs = inlineRuns($, buffer);
          if (runs.length) blocks.push({ type: 'paragraph', runs });
          buffer = [];
        };
        for (const c of n.children ?? []) {
          if (c.type === 'tag' && c.name === 'img') {
            flush();
            const src = $(c).attr('src');
            if (src) blocks.push({ type: 'image', url: src, caption: $(c).attr('alt')?.trim() || null });
          } else buffer.push(c);
        }
        flush();
        break;
      }
      case 'img': {
        const src = el.attr('src');
        if (src) blocks.push({ type: 'image', url: src, caption: el.attr('alt')?.trim() || null });
        break;
      }
      case 'ul':
      case 'ol': {
        const items: Run[][] = [];
        el.children('li').each((_, li) => {
          const runs = inlineRuns($, li.children ?? []);
          if (runs.length) items.push(runs);
        });
        if (items.length) blocks.push({ type: 'list', ordered: n.name === 'ol', items });
        break;
      }
      case 'blockquote': {
        const inner = blocksFrom($, n.children ?? []);
        let title: string | null = null;
        const first = inner[0];
        if (first && first.type === 'paragraph' && first.runs.length && first.runs.every((r) => r.bold)) {
          title = plain(first.runs);
          inner.shift();
        } else if (first && first.type === 'heading') {
          title = plain(first.runs);
          inner.shift();
        }
        const kept = inner.filter((b) => b.type === 'paragraph' || b.type === 'list');
        if (kept.length || title) blocks.push({ type: 'callout', title, blocks: kept as Block[] });
        break;
      }
      case 'hr':
        blocks.push({ type: 'divider' });
        break;
      default:
        break;
    }
  }
  return blocks;
}

export function htmlToBlocks(html: string): Block[] {
  const $ = cheerio.load(`<div id="root">${html}</div>`, null, false);
  return blocksFrom($, $('#root').get(0)?.children ?? []);
}

/** Turn relative /media/... image urls into absolute ones for API output. */
export function absBlocks(blocks: Block[]): Block[] {
  return (blocks ?? []).map((b) =>
    b.type === 'image' ? { ...b, url: absUrl(b.url)! } : b.type === 'callout' ? { ...b, blocks: absBlocks(b.blocks) } : b,
  );
}

export function plainTextOf(html: string): string {
  const $ = cheerio.load(`<div>${html}</div>`, null, false);
  return $.root().text().replace(/\s+/g, ' ').trim();
}

export function readMinutes(html: string): number {
  const words = plainTextOf(html).split(' ').filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}
