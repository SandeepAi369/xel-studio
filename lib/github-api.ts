/**
 * GitHub API Integration for Data Persistence
 * 
 * This module handles reading and writing data to GitHub repository.
 * Used on Vercel where filesystem is read-only.
 * 
 * Environment Variables Required:
 * - GITHUB_TOKEN: Personal Access Token with 'repo' scope
 * - GITHUB_REPO: Repository in format 'owner/repo' (e.g., 'Sandeepchch/PCL')
 */

const GITHUB_API = 'https://api.github.com';

// Get configuration from environment
function getConfig() {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPO || 'Sandeepchch/PCL';

    if (!token) {
        console.warn('GITHUB_TOKEN not set - GitHub API will not work');
    }

    return { token, repo };
}

/**
 * Read a file from GitHub repository
 */
export async function readFileFromGitHub(path: string): Promise<string | null> {
    const { token, repo } = getConfig();

    if (!token) {
        console.log('GitHub read skipped: No token');
        return null;
    }

    try {
        const response = await fetch(
            `${GITHUB_API}/repos/${repo}/contents/${path}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                },
                cache: 'no-store' // Always get fresh data
            }
        );

        if (!response.ok) {
            if (response.status === 404) {
                console.log(`GitHub: File not found - ${path}`);
                return null;
            }
            const errorText = await response.text();
            console.error(`GitHub read error (${response.status}):`, errorText);
            throw new Error(`GitHub API error: ${response.status}`);
        }

        const data = await response.json();

        // Decode base64 content
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        return content;

    } catch (error) {
        console.error('Error reading from GitHub:', error);
        return null;
    }
}

/**
 * Get the current SHA of a file in GitHub repository
 */
async function getFileSHA(path: string, token: string, repo: string): Promise<string | undefined> {
    try {
        const response = await fetch(
            `${GITHUB_API}/repos/${repo}/contents/${path}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                },
                cache: 'no-store'
            }
        );

        if (response.ok) {
            const data = await response.json();
            return data.sha;
        }
        return undefined;
    } catch {
        return undefined;
    }
}

/**
 * Write/Update a file in GitHub repository
 * Includes retry logic for SHA conflicts (409 errors)
 * Max 3 attempts with fresh SHA fetch on each retry
 */
export async function writeFileToGitHub(
    path: string,
    content: string,
    message: string
): Promise<boolean> {
    const { token, repo } = getConfig();
    const startTime = Date.now();
    const MAX_RETRIES = 3;

    if (!token) {
        console.error('[GitHub API] ERROR: GITHUB_TOKEN not set');
        return false;
    }

    console.log(`[GitHub API] Starting write to ${repo}/${path}`);
    console.log(`[GitHub API] Content size: ${content.length} chars (${Math.round(content.length / 1024)}KB)`);

    // Encode content to base64 (do this once)
    const encodedContent = Buffer.from(content, 'utf-8').toString('base64');

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`[GitHub API] Attempt ${attempt}/${MAX_RETRIES} - Fetching current SHA...`);

            // Get fresh SHA on each attempt
            const sha = await getFileSHA(path, token, repo);
            if (sha) {
                console.log(`[GitHub API] Found existing file, SHA: ${sha.substring(0, 8)}...`);
            } else {
                console.log('[GitHub API] File not found, will create new');
            }

            // Create request body
            const requestBody: Record<string, string | undefined> = {
                message: message,
                content: encodedContent,
                sha: sha,
                branch: 'main'
            };

            // PUT the file
            console.log('[GitHub API] Sending PUT request...');
            const response = await fetch(
                `${GITHUB_API}/repos/${repo}/contents/${path}`,
                {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'Content-Type': 'application/json',
                        'X-GitHub-Api-Version': '2022-11-28'
                    },
                    body: JSON.stringify(requestBody)
                }
            );

            const elapsed = Date.now() - startTime;

            if (response.ok) {
                const result = await response.json();
                console.log(`[GitHub API] SUCCESS after ${elapsed}ms (attempt ${attempt}). New SHA: ${result.content?.sha?.substring(0, 8)}`);
                return true;
            }

            // Handle conflict - retry with fresh SHA
            if (response.status === 409 && attempt < MAX_RETRIES) {
                console.warn(`[GitHub API] SHA conflict (409) on attempt ${attempt}, retrying...`);
                await new Promise(resolve => setTimeout(resolve, 500 * attempt)); // backoff
                continue;
            }

            const errorBody = await response.text();
            console.error(`[GitHub API] ERROR (${response.status}) after ${elapsed}ms: ${errorBody}`);

            // Don't retry on non-conflict errors
            if (response.status !== 409) {
                return false;
            }

        } catch (error) {
            const elapsed = Date.now() - startTime;
            console.error(`[GitHub API] EXCEPTION on attempt ${attempt} after ${elapsed}ms:`, error);

            if (attempt === MAX_RETRIES) {
                return false;
            }
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        }
    }

    return false;
}

/**
 * Check if running on Vercel (serverless)
 */
export function isVercel(): boolean {
    return process.env.VERCEL === '1' || process.env.VERCEL_ENV !== undefined;
}

/**
 * Check if GitHub API is available
 */
export function isGitHubApiAvailable(): boolean {
    return !!process.env.GITHUB_TOKEN;
}
