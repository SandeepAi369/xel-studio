/**
 * Prepare text for TTS (Text-to-Speech) consumption.
 *
 * Handles ALL content types — from clean AI-generated news summaries
 * to rich user-written articles from the admin panel that may contain
 * HTML tags, entities, URLs, bullets, markdown, and other formatting.
 *
 * Goal: produce clean, natural-sounding plain text that edge_tts
 * can read without stuttering, pausing oddly, or reading nonsense.
 */

/** Common HTML entity → readable text mapping */
const HTML_ENTITIES: Record<string, string> = {
    '&amp;': 'and',
    '&lt;': '',
    '&gt;': '',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&mdash;': ' — ',
    '&ndash;': ' - ',
    '&hellip;': '...',
    '&laquo;': '"',
    '&raquo;': '"',
    '&ldquo;': '"',
    '&rdquo;': '"',
    '&lsquo;': "'",
    '&rsquo;': "'",
    '&bull;': '. ',
    '&copy;': '',
    '&reg;': '',
    '&trade;': '',
};

/**
 * Deep-clean text for natural TTS playback.
 * Strips HTML, markdown, URLs, special chars, and normalizes spacing.
 */
function sanitizeForTTS(text: string): string {
    let t = text;

    // ── 1. Strip HTML ────────────────────────────────────────────
    // Remove script/style blocks entirely
    t = t.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
    // Convert <br>, <br/>, <p>, </p>, <div>, </div> to sentence breaks
    t = t.replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, '. ');
    // Remove all remaining HTML tags
    t = t.replace(/<[^>]+>/g, ' ');

    // ── 2. Decode HTML entities ──────────────────────────────────
    for (const [entity, replacement] of Object.entries(HTML_ENTITIES)) {
        t = t.replaceAll(entity, replacement);
    }
    // Decode numeric entities (&#123; or &#x1F4A1;)
    t = t.replace(/&#x?[0-9a-fA-F]+;/g, ' ');

    // ── 3. Strip markdown ────────────────────────────────────────
    t = t.replace(/#{1,6}\s*/g, '');               // headings
    t = t.replace(/\*\*([^*]+)\*\*/g, '$1');        // bold
    t = t.replace(/\*([^*]+)\*/g, '$1');             // italic
    t = t.replace(/__([^_]+)__/g, '$1');             // bold underscores
    t = t.replace(/_([^_]+)_/g, '$1');               // italic underscores
    t = t.replace(/`([^`]+)`/g, '$1');               // inline code
    t = t.replace(/```[\s\S]*?```/g, '');            // code blocks
    t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');   // links [text](url)
    t = t.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');    // images
    t = t.replace(/[[\]]/g, '');                     // remaining brackets

    // ── 4. Remove URLs (TTS reads them character by character) ───
    t = t.replace(/https?:\/\/\S+/g, '');
    t = t.replace(/www\.\S+/g, '');

    // ── 5. Clean up special characters ──────────────────────────
    // Bullet points → sentence breaks
    t = t.replace(/[•◦▪▸►▹➤➜→·∙⁃‣]/g, '. ');
    // Em/en dashes surrounded by spaces → comma (natural pause)
    t = t.replace(/\s[—–]\s/g, ', ');
    // Standalone dashes at start of line (list items)
    t = t.replace(/^\s*[-–—]\s+/gm, '');
    // Pipe separators (common in data)
    t = t.replace(/\s*\|\s*/g, ', ');
    // Excessive punctuation (... stays as 3, more gets trimmed)
    t = t.replace(/\.{4,}/g, '...');
    t = t.replace(/([!?])\1{2,}/g, '$1');
    // Remove decorative characters
    t = t.replace(/[~^=_*{}]/g, '');
    // Parenthetical URLs or references like (source: XYZ)
    t = t.replace(/\((?:source|via|ref|link|image|photo|credit)[^)]*\)/gi, '');

    // ── 6. Normalize whitespace and punctuation ─────────────────
    // Fix double periods from our conversions
    t = t.replace(/\.\s*\.\s*/g, '. ');
    // Remove periods immediately after other periods
    t = t.replace(/\.{2,}/g, '.');
    // Ensure sentences end with proper punctuation
    t = t.replace(/([a-zA-Z])\s*\.\s*\./g, '$1.');
    // Collapse all whitespace
    t = t.replace(/\s+/g, ' ');
    // Clean up spaces before punctuation
    t = t.replace(/\s+([.!?,;:])/g, '$1');
    // Ensure space after punctuation
    t = t.replace(/([.!?,;:])(?=[A-Za-z])/g, '$1 ');

    return t.trim();
}

/**
 * Prepare text for TTS playback.
 * Deep-cleans title and content, joins them with a period.
 * Produces clean plain text that sounds natural when spoken.
 */
export function prepareTTSText(title: string, content: string): string {
    const cleanTitle = sanitizeForTTS(title);
    const cleanContent = sanitizeForTTS(content);
    // Only add period separator if title doesn't already end with punctuation
    const separator = /[.!?]$/.test(cleanTitle) ? ' ' : '. ';
    return cleanTitle + separator + cleanContent;
}

/** Legacy export for backward compat */
export const stripMarkdown = sanitizeForTTS;
