import { NextRequest, NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';
import { validateAccessToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Lightweight signing endpoint — NO file data passes through Vercel.
 *
 * Flow:
 *   1. Admin panel sends auth token here (tiny JSON request)
 *   2. We validate the admin token, then generate a Cloudinary signed upload signature
 *   3. Admin panel uses the signature to upload DIRECTLY to Cloudinary's CDN
 *
 * This means the file goes:  Browser → Cloudinary (at full browser speed)
 * Instead of:                Browser → Vercel → Cloudinary (bottlenecked by Vercel)
 */

/**
 * Parse CLOUDINARY_URL (format: cloudinary://API_KEY:API_SECRET@CLOUD_NAME)
 * Falls back to individual env vars. This ensures the upload works whether
 * Vercel has CLOUDINARY_URL (like the News pipeline) or individual vars.
 */
function getCloudinaryConfig(): { cloudName: string; apiKey: string; apiSecret: string } | null {
    // Try individual env vars first
    let cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    let apiKey = process.env.CLOUDINARY_API_KEY;
    let apiSecret = process.env.CLOUDINARY_API_SECRET;

    // Fallback: parse CLOUDINARY_URL if individual vars are missing
    if ((!cloudName || !apiKey || !apiSecret) && process.env.CLOUDINARY_URL) {
        try {
            // Format: cloudinary://API_KEY:API_SECRET@CLOUD_NAME
            const url = process.env.CLOUDINARY_URL;
            const match = url.match(/cloudinary:\/\/([^:]+):([^@]+)@(.+)/);
            if (match) {
                apiKey = apiKey || match[1];
                apiSecret = apiSecret || match[2];
                cloudName = cloudName || match[3];
            }
        } catch (e) {
            console.error('Failed to parse CLOUDINARY_URL:', e);
        }
    }

    if (!cloudName || !apiKey || !apiSecret) return null;
    return { cloudName, apiKey, apiSecret };
}

const config = getCloudinaryConfig();
if (config) {
    cloudinary.config({
        cloud_name: config.cloudName,
        api_key: config.apiKey,
        api_secret: config.apiSecret,
    });
}

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function POST(req: NextRequest) {
    try {
        // 1. Auth check — admin only
        const token = req.headers.get('authorization')?.replace('Bearer ', '');
        if (!validateAccessToken(token ?? null)) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401, headers: corsHeaders }
            );
        }

        // 2. Validate Cloudinary config (supports both CLOUDINARY_URL and individual env vars)
        const creds = getCloudinaryConfig();
        if (!creds) {
            return NextResponse.json(
                { error: 'Cloudinary not configured. Set CLOUDINARY_URL or individual CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET.' },
                { status: 500, headers: corsHeaders }
            );
        }

        const { cloudName, apiKey, apiSecret } = creds;

        // 3. Generate signed upload params
        //    NOTE: Only include params that Cloudinary uses for signature verification.
        //    'transformation' is applied via 'eager' (post-upload) to avoid signature mismatches.
        const timestamp = Math.round(Date.now() / 1000);
        const eager = 'w_1200,c_limit,q_auto:good,f_auto';
        const params: Record<string, string | number> = {
            timestamp,
            folder: 'xel-studio/articles',
            eager,
            unique_filename: 'true',
            overwrite: 'false',
        };

        // Cloudinary signature = SHA1 of sorted params + api_secret
        const signature = cloudinary.utils.api_sign_request(params, apiSecret);

        return NextResponse.json({
            signature,
            timestamp,
            cloudName,
            apiKey,
            folder: params.folder,
            eager,
        }, { headers: corsHeaders });

    } catch (error) {
        console.error('Signing error:', error);
        return NextResponse.json(
            { error: 'Failed to generate upload signature' },
            { status: 500, headers: corsHeaders }
        );
    }
}
