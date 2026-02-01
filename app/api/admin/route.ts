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
    addArticle, updateArticle, deleteArticle,
    addAPK, updateAPK, deleteAPK,
    addAILab, updateAILab, deleteAILab,
    addSecurityTool, deleteSecurityTool,
    logAdminAction,
    getArticles, getAPKs, getAILabs, getSecurityTools,
    readDB
} from '@/lib/db';

// CORS headers for Vercel deployment
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Handle OPTIONS preflight request (for CORS)
export async function OPTIONS() {
    return NextResponse.json({}, { headers: corsHeaders });
}

// Login endpoint
export async function POST(request: NextRequest) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';

    try {
        const body = await request.json();
        const { action, password, sessionToken, csrfToken, data, contentType, itemId } = body;

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
                logAdminAction('login_failed', `Invalid password attempt (${attemptResult.attemptsRemaining} remaining)`, ip);

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
            logAdminAction('login_success', 'Admin logged in', ip);

            return NextResponse.json({
                success: true,
                sessionToken: session,
                csrfToken: csrf
            }, { headers: corsHeaders });
        }

        // All other actions require valid session
        if (!validateSession(sessionToken, ip)) {
            return NextResponse.json({ error: 'Session expired' }, { status: 401, headers: corsHeaders });
        }

        // Handle logout
        if (action === 'logout') {
            destroySession();
            logAdminAction('logout', 'Admin logged out', ip);
            return NextResponse.json({ success: true }, { headers: corsHeaders });
        }

        // Handle content operations
        if (action === 'add') {
            let result;
            switch (contentType) {
                case 'article':
                    result = addArticle(data);
                    break;
                case 'apk':
                    result = addAPK(data);
                    break;
                case 'aiLab':
                    result = addAILab(data);
                    break;
                case 'securityTool':
                    result = addSecurityTool(data);
                    break;
                default:
                    return NextResponse.json({ error: 'Invalid content type' }, { status: 400, headers: corsHeaders });
            }
            logAdminAction('add', `Added ${contentType}: ${JSON.stringify(data).substring(0, 100)}`, ip);
            return NextResponse.json({ success: true, data: result }, { headers: corsHeaders });
        }

        if (action === 'update') {
            let result;
            switch (contentType) {
                case 'article':
                    result = updateArticle(itemId, data);
                    break;
                case 'apk':
                    result = updateAPK(itemId, data);
                    break;
                case 'aiLab':
                    result = updateAILab(itemId, data);
                    break;
                default:
                    return NextResponse.json({ error: 'Invalid content type' }, { status: 400, headers: corsHeaders });
            }
            if (!result) {
                return NextResponse.json({ error: 'Item not found' }, { status: 404, headers: corsHeaders });
            }
            logAdminAction('update', `Updated ${contentType} ${itemId}`, ip);
            return NextResponse.json({ success: true, data: result }, { headers: corsHeaders });
        }

        if (action === 'delete') {
            let success;
            switch (contentType) {
                case 'article':
                    success = deleteArticle(itemId);
                    break;
                case 'apk':
                    success = deleteAPK(itemId);
                    break;
                case 'aiLab':
                    success = deleteAILab(itemId);
                    break;
                case 'securityTool':
                    success = deleteSecurityTool(itemId);
                    break;
                default:
                    return NextResponse.json({ error: 'Invalid content type' }, { status: 400, headers: corsHeaders });
            }
            if (!success) {
                return NextResponse.json({ error: 'Item not found' }, { status: 404, headers: corsHeaders });
            }
            logAdminAction('delete', `Deleted ${contentType} ${itemId}`, ip);
            return NextResponse.json({ success: true }, { headers: corsHeaders });
        }

        if (action === 'getData') {
            const db = readDB();
            return NextResponse.json({
                articles: getArticles(),
                apks: getAPKs(),
                aiLabs: getAILabs(),
                securityTools: getSecurityTools(),
                downloadLogs: db.downloadLogs?.slice(-50) || [],
                adminLogs: db.adminLogs?.slice(-50) || []
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

    return NextResponse.json({ valid: true }, { headers: corsHeaders });
}
