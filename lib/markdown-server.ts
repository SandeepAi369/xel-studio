/**
 * Server-side Markdown → safe HTML converter (Phase 3).
 *
 * Replaces the old `formatContent()` regex stripper that destroyed all
 * heading structure, breaking screen-reader document outlines.
 *
 * Lightweight and dependency-free so we don't add install surface.
 * It supports only the subset that the existing articles actually use:
 *
 *   # … ######     → <h1>…<h6>
 *   **bold**       → <strong>
 *   *italic*       → <em>
 *   `code`         → <code>
 *   [text](url)    → <a>  (URLs are validated; javascript: is stripped)
 *   > blockquote   → <blockquote>
 *   - / * list     → <ul><li>
 *   1. 2.          → <ol><li>
 *   ---            → <hr>
 *   ```lang … ```  → <pre><code>
 *   plain text     → <p> / split on blank lines
 *
 * HTML already embedded in the source is **escaped**, then re-emitted
 * safely. No innerHTML injection vector.
 */

const AMP = String.fromCharCode(38) + 'amp;';
const LT = String.fromCharCode(38) + 'lt;';
const GT = String.fromCharCode(38) + 'gt;';
const QUOT = String.fromCharCode(38) + 'quot;';
const APOS = String.fromCharCode(38) + '#39;';

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, AMP)
        .replace(/</g, LT)
        .replace(/>/g, GT)
        .replace(/"/g, QUOT)
        .replace(/'/g, APOS);
}

function safeUrl(url: string): string | null {
    const trimmed = url.trim();
    // Allow http(s), mailto, relative. Block javascript:, data:, vbscript:.
    if (/^(javascript|data|vbscript):/i.test(trimmed)) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^mailto:/i.test(trimmed)) return trimmed;
    if (trimmed.startsWith('/') || trimmed.startsWith('#')) return trimmed;
    return null;
}

/** Inline transform: bold → em → code → links. */
function inline(text: string): string {
    let s = escapeHtml(text);

    // Inline code first (so its content is protected from further transforms).
    s = s.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);

    // Bold.
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic (avoid greedy match across words).
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

    // Links: [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => {
        const safe = safeUrl(url);
        if (!safe) return escapeHtml(label);
        return `<a href="${escapeHtml(safe)}" rel="noopener noreferrer">${label}</a>`;
    });

    return s;
}

export function markdownToSafeHtml(src: string): string {
    if (!src) return '';
    const text = src.replace(/\r\n/g, '\n').replace(/\t/g, ' ');
    const lines = text.split('\n');

    const out: string[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed === '') { i++; continue; }

        // Fenced code block ```lang\n…\n```
        if (/^```/.test(trimmed)) {
            const lang = trimmed.replace(/^```/, '').trim();
            i++;
            const codeLines: string[] = [];
            while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
                codeLines.push(lines[i]);
                i++;
            }
            i++; // skip closing fence
            const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
            out.push(`<pre><code${cls}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
            continue;
        }

        // Horizontal rule
        if (/^(\*\s*\*\s*\*|-{3,}|_{3,})\s*$/.test(trimmed)) {
            out.push('<hr />');
            i++;
            continue;
        }

        // Headings ###### … #
        const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            const level = heading[1].length;
            out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
            i++;
            continue;
        }

        // Blockquote (one or more lines starting with >)
        if (/^>\s?/.test(trimmed)) {
            const buf: string[] = [];
            while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
                buf.push(lines[i].trim().replace(/^>\s?/, ''));
                i++;
            }
            out.push(`<blockquote><p>${inline(buf.join(' '))}</p></blockquote>`);
            continue;
        }

        // Unordered list (- or *)
        if (/^[-*]\s+/.test(trimmed)) {
            const items: string[] = [];
            while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
                items.push(`<li>${inline(lines[i].trim().replace(/^[-*]\s+/, ''))}</li>`);
                i++;
            }
            out.push(`<ul>${items.join('')}</ul>`);
            continue;
        }

        // Ordered list (1. 2. ...)
        if (/^\d+\.\s+/.test(trimmed)) {
            const items: string[] = [];
            while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
                items.push(`<li>${inline(lines[i].trim().replace(/^\d+\.\s+/, ''))}</li>`);
                i++;
            }
            out.push(`<ol>${items.join('')}</ol>`);
            continue;
        }

        // Numbered item starting with "1. text" inside paragraph (legacy format)
        if (/^\d+\.\s/.test(trimmed)) {
            out.push(`<p class="numbered-item">${inline(trimmed)}</p>`);
            i++;
            continue;
        }

        // Plain paragraph: gather contiguous non-empty lines until blank.
        const buf: string[] = [trimmed];
        i++;
        while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}\s|>\s?|[-*]\s|\d+\.\s|```)/.test(lines[i].trim())) {
            buf.push(lines[i].trim());
            i++;
        }
        out.push(`<p>${inline(buf.join(' '))}</p>`);
    }

    return out.join('\n');
}
