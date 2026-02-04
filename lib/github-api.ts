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
 * Write/Update a file in GitHub repository
 */
export async function writeFileToGitHub(
    path: string,
    content: string,
    message: string
): Promise<boolean> {
    const { token, repo } = getConfig();

    if (!token) {
        console.error('GITHUB_TOKEN not set - cannot write to GitHub');
        return false;
    }

    try {
        // First, get the current file SHA (required for updates)
        let sha: string | undefined;

        const getResponse = await fetch(
            `${GITHUB_API}/repos/${repo}/contents/${path}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            }
        );

        if (getResponse.ok) {
            const existingFile = await getResponse.json();
            sha = existingFile.sha;
        }

        // Encode content to base64
        const encodedContent = Buffer.from(content, 'utf-8').toString('base64');

        // Create or update file
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
                body: JSON.stringify({
                    message: message,
                    content: encodedContent,
                    sha: sha, // Include SHA for updates, undefined for new files
                    branch: 'main'
                })
            }
        );

        if (!response.ok) {
            const error = await response.json();
            console.error('GitHub write error:', error);
            return false;
        }

        console.log(`GitHub: Successfully wrote ${path}`);
        return true;

    } catch (error) {
        console.error('Error writing to GitHub:', error);
        return false;
    }
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
