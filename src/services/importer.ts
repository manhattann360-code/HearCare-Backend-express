import mammoth from 'mammoth';
import { marked } from 'marked';
import { AppError } from '../utils/errors';
import { saveImage } from './media';
import { sanitizeArticleHtml } from './content';

export interface ImportResult {
  title: string;
  html: string;
  warnings: string[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Pull the first heading out of the HTML and use it as the article title. */
function extractTitle(html: string, fallback: string): { title: string; html: string } {
  const m = html.match(/^\s*<h[12][^>]*>([\s\S]*?)<\/h[12]>/i);
  if (m) {
    return { title: m[1].replace(/<[^>]+>/g, '').trim() || fallback, html: html.slice(m[0].length) };
  }
  return { title: fallback, html };
}

const baseName = (n: string) => n.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();

export async function importDocument(file: { originalname: string; buffer: Buffer }): Promise<ImportResult> {
  const name = file.originalname.toLowerCase();
  const warnings: string[] = [];
  let html = '';

  if (name.endsWith('.docx')) {
    const result = await mammoth.convertToHtml(
      { buffer: file.buffer },
      {
        convertImage: mammoth.images.imgElement(async (img) => {
          const data = await img.read();
          const saved = await saveImage(data as Buffer, 'doc-image');
          return { src: `/media/${saved.id}` };
        }),
        styleMap: [
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Heading 1'] => h2:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
          "p[style-name='Quote'] => blockquote > p:fresh",
          "p[style-name='Intense Quote'] => blockquote > p:fresh",
        ],
      },
    );
    html = result.value;
    if (result.messages.some((m) => m.type === 'warning')) {
      warnings.push('Some formatting in the Word file could not be copied exactly. Please check the text below.');
    }
  } else if (name.endsWith('.md') || name.endsWith('.markdown')) {
    html = await marked.parse(file.buffer.toString('utf8'));
    if (/!\[[^\]]*\]\((?!https?:)/.test(file.buffer.toString('utf8'))) {
      warnings.push('This file refers to pictures stored on your computer. Please add pictures using the picture button.');
    }
  } else if (name.endsWith('.txt')) {
    html = textToHtml(file.buffer.toString('utf8'), true);
  } else if (name.endsWith('.pdf')) {
    // deep import avoids pdf-parse's debug code that reads a test file on require()
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js' as string)).default as (b: Buffer) => Promise<{ text: string }>;
    const parsed = await pdfParse(file.buffer);
    html = textToHtml(parsed.text, false);
    warnings.push(
      'Text was copied from the PDF. Pictures and special formatting are not copied — please add headings and pictures yourself.',
    );
  } else {
    throw new AppError(400, 'VALIDATION_ERROR', 'Please upload a Word (.docx), Markdown (.md), text (.txt) or PDF file.');
  }

  const extracted = extractTitle(html, baseName(file.originalname));
  const clean = sanitizeArticleHtml(extracted.html);
  if (!clean) warnings.push('We could not find any text in this file.');
  return { title: extracted.title, html: clean, warnings };
}

function textToHtml(text: string, firstLineIsTitle: boolean): string {
  const paragraphs = text
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n(?!\s*[-•*\d])/g, ' ').trim())
    .filter(Boolean);
  const out: string[] = [];
  paragraphs.forEach((p, i) => {
    const lines = p.split('\n').map((l) => l.trim());
    if (lines.length > 1 && lines.every((l) => /^[-•*]\s+/.test(l))) {
      out.push(`<ul>${lines.map((l) => `<li>${esc(l.replace(/^[-•*]\s+/, ''))}</li>`).join('')}</ul>`);
    } else if (i === 0 && (firstLineIsTitle || p.length < 100)) {
      out.push(`<h2>${esc(p)}</h2>`);
    } else if (p.length < 70 && !/[.!?:,;]$/.test(p) && i > 0) {
      out.push(`<h2>${esc(p)}</h2>`);
    } else {
      out.push(`<p>${esc(p)}</p>`);
    }
  });
  return out.join('\n');
}
