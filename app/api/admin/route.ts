import { NextRequest, NextResponse } from 'next/server';
import { validateAccessToken } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import {
    getArticles, addArticle, updateArticle, deleteArticle,
    getApps, addApp, updateApp, deleteApp,
    getAILabs, addAILab, updateAILab, deleteAILab,
    getSecurityTools, addSecurityTool, updateSecurityTool, deleteSecurityTool,
    generateId,
} from '@/lib/supabase-db';
import type { Article, APK, AILab, SecurityTool } from '@/lib/supabase-db';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

const ALLOWED_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || 'https://xel-studio.vercel.app';

const corsHeaders = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Revalidate pages after data changes
function revalidateAllPages() {
    try {
        revalidatePath('/', 'layout');
        revalidatePath('/articles');
        revalidatePath('/store');
        revalidatePath('/ai');
        revalidatePath('/shield');
        revalidatePath('/dashboard');
    } catch (e) {
        console.warn('Revalidation warning:', e);
    }
}

export async function OPTIONS() {
    return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { action, token, sessionToken, csrfToken, contentType, data, itemId, password } = body;

        // Use whichever token field the client sent
        const authToken = token || sessionToken;

        // ─── LOGIN ──────────────────────────────────────────
        if (action === 'login') {
            const { validatePassword, createSession, clearLoginAttempts, isLockedOut, recordFailedAttempt } = await import('@/lib/auth');

            const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';

            // Check lockout
            const lockStatus = isLockedOut(ip);
            if (lockStatus.locked) {
                return NextResponse.json({
                    error: `Too many attempts. Try again in ${lockStatus.remainingTime} minutes.`
                }, { status: 429, headers: corsHeaders });
            }

            if (!password || !(await validatePassword(password))) {
                const attempt = recordFailedAttempt(ip);
                return NextResponse.json({
                    error: attempt.locked
                        ? 'Account locked. Try again in 15 minutes.'
                        : `Invalid password. ${attempt.attemptsRemaining} attempts remaining.`
                }, { status: 401, headers: corsHeaders });
            }

            clearLoginAttempts(ip);
            const newSessionToken = createSession(ip);

            return NextResponse.json({
                sessionToken: newSessionToken,
                csrfToken: `csrf_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            }, { headers: corsHeaders });
        }

        // ─── LOGOUT ──────────────────────────────────────────
        if (action === 'logout') {
            return NextResponse.json({ success: true }, { headers: corsHeaders });
        }

        // Validate token for all data operations
        if (!validateAccessToken(authToken)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
        }

        // ─── CREATE ──────────────────────────────────────────
        if (action === 'add') {
            try {
                let result: Article | APK | AILab | SecurityTool;

                switch (contentType) {
                    case 'article':
                        result = await addArticle(data);
                        break;
                    case 'apk':
                        result = await addApp(data);
                        break;
                    case 'aiLab':
                        result = await addAILab(data);
                        break;
                    case 'securityTool':
                        result = await addSecurityTool(data);
                        break;
                    default:
                        return NextResponse.json({ error: 'Invalid content type' }, { status: 400, headers: corsHeaders });
                }

                revalidateAllPages();

                return NextResponse.json({
                    success: true,
                    data: result,
                    storage: 'supabase'
                }, { headers: corsHeaders });

            } catch (writeError) {
                console.error('Write error:', writeError);
                return NextResponse.json({
                    error: 'Failed to save content',
                    details: writeError instanceof Error ? writeError.message : 'Unknown error'
                }, { status: 500, headers: corsHeaders });
            }
        }

        // ─── UPDATE ──────────────────────────────────────────
        if (action === 'update') {
            try {
                let result: Article | APK | AILab | SecurityTool | null = null;

                switch (contentType) {
                    case 'article':
                        result = await updateArticle(itemId, data);
                        break;
                    case 'apk':
                        result = await updateApp(itemId, data);
                        break;
                    case 'aiLab':
                        result = await updateAILab(itemId, data);
                        break;
                    case 'securityTool':
                        result = await updateSecurityTool(itemId, data);
                        break;
                    default:
                        return NextResponse.json({ error: 'Invalid content type' }, { status: 400, headers: corsHeaders });
                }

                if (!result) {
                    return NextResponse.json({ error: 'Item not found' }, { status: 404, headers: corsHeaders });
                }

                revalidateAllPages();

                return NextResponse.json({
                    success: true,
                    data: result,
                    storage: 'supabase'
                }, { headers: corsHeaders });

            } catch (updateError) {
                console.error('Update error:', updateError);
                return NextResponse.json({
                    error: 'Failed to update content',
                    details: updateError instanceof Error ? updateError.message : 'Unknown error'
                }, { status: 500, headers: corsHeaders });
            }
        }

        // ─── DELETE ──────────────────────────────────────────
        if (action === 'delete') {
            try {
                let deleted = false;

                switch (contentType) {
                    case 'article':
                        deleted = await deleteArticle(itemId);
                        break;
                    case 'apk':
                        deleted = await deleteApp(itemId);
                        break;
                    case 'aiLab':
                        deleted = await deleteAILab(itemId);
                        break;
                    case 'securityTool':
                        deleted = await deleteSecurityTool(itemId);
                        break;
                    default:
                        return NextResponse.json({ error: 'Invalid content type' }, { status: 400, headers: corsHeaders });
                }

                if (!deleted) {
                    return NextResponse.json({ error: 'Item not found or delete failed' }, { status: 404, headers: corsHeaders });
                }

                revalidateAllPages();

                return NextResponse.json({ success: true, storage: 'supabase' }, { headers: corsHeaders });

            } catch (deleteError) {
                console.error('Delete error:', deleteError);
                return NextResponse.json({
                    error: 'Failed to delete content',
                    details: deleteError instanceof Error ? deleteError.message : 'Unknown error'
                }, { status: 500, headers: corsHeaders });
            }
        }

        // ─── GET ALL DATA (Admin Panel) ──────────────────────
        if (action === 'getData') {
            const [articles, apks, aiLabs, securityTools] = await Promise.all([
                getArticles(),
                getApps(),
                getAILabs(),
                getSecurityTools(),
            ]);

            return NextResponse.json({
                articles,
                apks,
                aiLabs,
                securityTools,
                downloadLogs: [],
                adminLogs: [],
                env: {
                    isVercel: process.env.VERCEL === '1',
                    storage: 'supabase'
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

    return NextResponse.json({
        valid: true,
        env: {
            isVercel: process.env.VERCEL === '1',
            storage: 'supabase'
        }
    }, { headers: corsHeaders });
}
