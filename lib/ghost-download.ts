/**
 * Ghost Download Utility - Shadow Integration Pattern
 * 
 * Downloads files without page redirects or new tabs using hidden anchor technique.
 * Creates seamless "native app" download experience.
 */

export interface DownloadOptions {
    url: string;
    filename?: string;
    onStart?: () => void;
    onComplete?: () => void;
    onError?: (error: Error) => void;
}

/**
 * Ghost Download - Hidden anchor pattern for seamless downloads
 * Creates temporary hidden anchor, triggers click, removes anchor
 */
export function ghostDownload(options: DownloadOptions): void {
    const { url, filename, onStart, onComplete, onError } = options;

    try {
        onStart?.();

        // Create hidden anchor
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.style.display = 'none';

        // Set download filename if provided
        if (filename) {
            anchor.download = filename;
        } else {
            anchor.download = '';
        }

        // Append to DOM (required for Firefox)
        document.body.appendChild(anchor);

        // Trigger download
        anchor.click();

        // Cleanup
        setTimeout(() => {
            document.body.removeChild(anchor);
            onComplete?.();
        }, 100);

    } catch (error) {
        onError?.(error instanceof Error ? error : new Error('Download failed'));
    }
}

/**
 * Fetch and download as blob - for cross-origin downloads
 * Uses our proxy API to stream the file
 */
export async function proxyDownload(options: DownloadOptions): Promise<void> {
    const { url, filename, onStart, onComplete, onError } = options;

    try {
        onStart?.();

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Download failed: ${response.status}`);
        }

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);

        // Use ghost download with blob URL
        ghostDownload({
            url: blobUrl,
            filename: filename || extractFilename(url),
            onComplete: () => {
                URL.revokeObjectURL(blobUrl);
                onComplete?.();
            },
            onError
        });

    } catch (error) {
        onError?.(error instanceof Error ? error : new Error('Download failed'));
    }
}

/**
 * Extract filename from URL
 */
function extractFilename(url: string): string {
    try {
        const pathname = new URL(url).pathname;
        const segments = pathname.split('/');
        return segments[segments.length - 1] || 'download';
    } catch {
        return 'download';
    }
}

/**
 * Smart Download - Tries ghost download first, falls back to iframe
 * Handles various browser compatibility issues
 */
export function smartDownload(options: DownloadOptions): void {
    const { url, filename, onStart, onComplete, onError } = options;

    try {
        onStart?.();

        // Try hidden anchor first (most browsers)
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename || '';
        anchor.style.display = 'none';

        // Check if download attribute is supported
        if ('download' in anchor) {
            document.body.appendChild(anchor);
            anchor.click();
            setTimeout(() => {
                document.body.removeChild(anchor);
                onComplete?.();
            }, 100);
        } else {
            // Fallback: hidden iframe for older browsers
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.src = url;
            document.body.appendChild(iframe);

            setTimeout(() => {
                document.body.removeChild(iframe);
                onComplete?.();
            }, 5000);
        }

    } catch (error) {
        onError?.(error instanceof Error ? error : new Error('Download failed'));
    }
}
