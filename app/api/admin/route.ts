import { NextRequest, NextResponse } from 'next/server';
import {
    validateAccessToken,
    validatePassword,
    createSession,
    validateSession,
    destroySession,
    generateCSRFToken,
    isLockedOut,
    recordFailedAttempt,
    clearLoginAttempts
} from '@/lib/auth';
import {
    addArticleAsync, updateArticleAsync, deleteArticleAsync,
    addAPKAsync, updateAPKAsync, deleteAPKAsync,
    addAILabAsync, updateAILabAsync, deleteAILabAsync,
    addSecurityToolAsync, deleteSecurityToolAsync,
    logAdminActionAsync,
    getArticlesAsync, getAPKsAsync, getAILabsAsync, getSecurityToolsAsync,
    readDBAsync, initializeDB
} from '@/lib/db';
import { isVercel, isGitHubApiAvailable } from '@/lib/github-api';

// CORS headers for Vercel deployment
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Force dynamic
export const dynamic = 'force-dynamic';

// Increase body size limit for large articles (default is 1MB)
export const maxDuration = 30; // Increase timeout for large payloads

// Route segment config - allow up to 10MB request body
export async function generateStaticParams() {
    return [];
}

// Handle OPTIONS preflight request (for CORS)
export async function OPTIONS() {
    return NextResponse.json({}, { headers: corsHeaders });
}

// Login endpoint
export async function POST(request: NextRequest) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';

    try {
        // Initialize database cache on first request
        await initializeDB();

        const body = await request.json();
        const { action, password, sessionToken, data, contentType, itemId } = body;

        // Handle login
        if (action === 'login') {
            // Check if IP is locked out
            const lockStatus = isLockedOut(ip);
            if (lockStatus.locked) {
                return NextResponse.json({
                    error: `Too many failed attempts. Try again in ${lockStatus.remainingTime} minutes.`
                }, { status: 429, headers: corsHeaders });
            }

            const isValid = await validatePassword(password);
            if (!isValid) {
                const attemptResult = recordFailedAttempt(ip);
                await logAdminActionAsync('login_failed', `Invalid password attempt (${attemptResult.attemptsRemaining} remaining)`, ip);

                if (attemptResult.locked) {
                    return NextResponse.json({
                        error: 'Account locked for 15 minutes due to failed attempts.'
                    }, { status: 429, headers: corsHeaders });
                }

                return NextResponse.json({
                    error: `Invalid credentials. ${attemptResult.attemptsRemaining} attempts remaining.`
                }, { status: 401, headers: corsHeaders });
            }

            // Clear failed attempts on successful login
            clearLoginAttempts(ip);

            const session = createSession(ip);
            const csrf = generateCSRFToken();
            await logAdminActionAsync('login_success', 'Admin logged in', ip);

            // Return environment info for debugging
            return NextResponse.json({
                success: true,
                sessionToken: session,
                csrfToken: csrf,
                env: {
                    isVercel: isVercel(),
                    hasGitHubToken: isGitHubApiAvailable()
                }
            }, { headers: corsHeaders });
        }

        // All other actions require valid session
        if (!validateSession(sessionToken, ip)) {
            return NextResponse.json({ error: 'Session expired' }, { status: 401, headers: corsHeaders });
        }

        // Handle logout
        if (action === 'logout') {
            destroySession();
            await logAdminActionAsync('logout', 'Admin logged out', ip);
            return NextResponse.json({ success: true }, { headers: corsHeaders });
        }

        // Handle content operations
        if (action === 'add') {
            let result;
            try {
                switch (contentType) {
                    case 'article':
                        result = await addArticleAsync(data);
                        break;
                    case 'apk':
                        result = await addAPKAsync(data);
                        break;
                    case 'aiLab':
                        result = await addAILabAsync(data);
                        break;
                    case 'securityTool':
                        result = await addSecurityToolAsync(data);
                        break;
                    default:
                        return NextResponse.json({ error: 'Invalid content type' }, { status: 400, headers: corsHeaders });
                }

                if (!result) {
                    return NextResponse.json({
                        error: 'Failed to save content',
                        details: isVercel() && !isGitHubApiAvailable()
                            ? 'GITHUB_TOKEN not configured on Vercel'
                            : 'Unknown write error'
                    }, { status: 500, headers: corsHeaders });
                }

                await logAdminActionAsync('add', `Added ${contentType}: ${JSON.stringify(data).substring(0, 100)}`, ip);
                return NextResponse.json({
                    success: true,
                    data: result,
                    storage: isVercel() ? 'github' : 'filesystem'
                }, { headers: corsHeaders });

            } catch (writeError) {
                console.error('Write error:', writeError);
                return NextResponse.json({
                    error: 'Failed to save content',
                    details: writeError instanceof Error ? writeError.message : 'Unknown error'
                }, { status: 500, headers: corsHeaders });
            }
        }

        if (action === 'update') {
            let result;
            try {
                switch (contentType) {
                    case 'article':
                        result = await updateArticleAsync(itemId, data);
                        break;
                    case 'apk':
                        result = await updateAPKAsync(itemId, data);
                        break;
                    case 'aiLab':
                        result = await updateAILabAsync(itemId, data);
                        break;
                    default:
                        return NextResponse.json({ error: 'Invalid content type' }, { status: 400, headers: corsHeaders });
                }
                if (!result) {
                    return NextResponse.json({ error: 'Item not found' }, { status: 404, headers: corsHeaders });
                }
                await logAdminActionAsync('update', `Updated ${contentType} ${itemId}`, ip);
                return NextResponse.json({
                    success: true,
                    data: result,
                    storage: isVercel() ? 'github' : 'filesystem'
                }, { headers: corsHeaders });
            } catch (updateError) {
                console.error('Update error:', updateError);
                return NextResponse.json({
                    error: 'Failed to update content',
                    details: updateError instanceof Error ? updateError.message : 'Unknown error'
                }, { status: 500, headers: corsHeaders });
            }
        }

        if (action === 'delete') {
            let success;
            try {
                switch (contentType) {
                    case 'article':
                        success = await deleteArticleAsync(itemId);
                        break;
                    case 'apk':
                        success = await deleteAPKAsync(itemId);
                        break;
                    case 'aiLab':
                        success = await deleteAILabAsync(itemId);
                        break;
                    case 'securityTool':
                        success = await deleteSecurityToolAsync(itemId);
                        break;
                    default:
                        return NextResponse.json({ error: 'Invalid content type' }, { status: 400, headers: corsHeaders });
                }
                if (!success) {
                    return NextResponse.json({ error: 'Item not found or delete failed' }, { status: 404, headers: corsHeaders });
                }
                await logAdminActionAsync('delete', `Deleted ${contentType} ${itemId}`, ip);
                return NextResponse.json({ success: true }, { headers: corsHeaders });
            } catch (deleteError) {
                console.error('Delete error:', deleteError);
                return NextResponse.json({
                    error: 'Failed to delete content',
                    details: deleteError instanceof Error ? deleteError.message : 'Unknown error'
                }, { status: 500, headers: corsHeaders });
            }
        }

        if (action === 'getData') {
            const db = await readDBAsync();
            return NextResponse.json({
                articles: await getArticlesAsync(),
                apks: await getAPKsAsync(),
                aiLabs: await getAILabsAsync(),
                securityTools: await getSecurityToolsAsync(),
                downloadLogs: db.downloadLogs?.slice(-50) || [],
                adminLogs: db.adminLogs?.slice(-50) || [],
                env: {
                    isVercel: isVercel(),
                    hasGitHubToken: isGitHubApiAvailable()
                }
            }, { headers: corsHeaders });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400, headers: corsHeaders });

    } catch (error) {
        console.error('Admin API error:', error);
        return NextResponse.json({
            error: 'Internal server error',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500, headers: corsHeaders });
    }
}

// Validate token endpoint
export async function GET(request: NextRequest) {
    const token = request.nextUrl.searchParams.get('token');

    if (!validateAccessToken(token)) {
        return NextResponse.json({ valid: false }, { headers: corsHeaders });
    }

    // Return environment info for debugging
    return NextResponse.json({
        valid: true,
        env: {
            isVercel: isVercel(),
            hasGitHubToken: isGitHubApiAvailable()
        }
    }, { headers: corsHeaders });
}
