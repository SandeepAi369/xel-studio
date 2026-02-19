/**
 * Prepare text for TTS (Text-to-Speech) consumption.
 *
 * - Strips markdown formatting characters (#, *, `, [], etc.)
 * - Cleans up excessive whitespace
 * - Preserves paragraph breaks for SSML generation on the backend
 *
 * NOTE: The actual speech pacing (pauses between paragraphs, prosody)
 * is handled via SSML in the Python backend (api/stream_audio.py).
 * This module only handles text cleanup on the frontend.
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
 * Prepare text for TTS playback.
 * Strips markdown from title and content, joins them with a period.
 * The backend handles SSML wrapping for natural speech pacing.
 */
export function prepareTTSText(title: string, content: string): string {
    const cleanTitle = stripMarkdown(title);
    const cleanContent = stripMarkdown(content);
    return cleanTitle + '. ' + cleanContent;
}
