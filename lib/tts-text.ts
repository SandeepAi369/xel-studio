/**
 * Prepare text for TTS (Text-to-Speech) consumption.
 *
 * - Strips markdown formatting characters (#, *, `, [], etc.)
 * - Inserts a period (.) every ~10 words to create natural breathing
 *   pauses for screen readers and TTS engines like edge-tts.
 * - Cleans up excessive whitespace
 */

/** Strip markdown formatting from text */
export function stripMarkdown(text: string): string {
    return text
        .replace(/#{1,6}\s*/g, '')        // headings
        .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
        .replace(/\*([^*]+)\*/g, '$1')     // italic
        .replace(/__([^_]+)__/g, '$1')     // bold underscores
        .replace(/_([^_]+)_/g, '$1')       // italic underscores
        .replace(/`([^`]+)`/g, '$1')       // inline code
        .replace(/```[\s\S]*?```/g, '')    // code blocks
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links [text](url)
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1') // images
        .replace(/[[\]]/g, '')             // remaining brackets
        .replace(/https?:\/\/\S+/g, '')    // bare URLs
        .replace(/\s+/g, ' ')             // collapse whitespace
        .trim();
}

/**
 * Insert invisible pause dots every N words.
 * This causes TTS engines to add natural breathing pauses.
 */
export function addTTSPauses(text: string, everyNWords: number = 10): string {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const result: string[] = [];

    for (let i = 0; i < words.length; i++) {
        result.push(words[i]);
        // Add a period after every N words, but only if:
        // - Not at the end of the text
        // - The word doesn't already end with punctuation
        if (
            (i + 1) % everyNWords === 0 &&
            i < words.length - 1 &&
            !/[.!?,;:]$/.test(words[i])
        ) {
            // Add a period to create a TTS pause
            result[result.length - 1] = words[i] + '.';
        }
    }

    return result.join(' ');
}

/**
 * Prepare text for TTS playback.
 * Combines stripping markdown + adding pauses.
 */
export function prepareTTSText(title: string, content: string): string {
    const cleanTitle = stripMarkdown(title);
    const cleanContent = stripMarkdown(content);
    const full = cleanTitle + '. ' + cleanContent;
    return addTTSPauses(full);
}
