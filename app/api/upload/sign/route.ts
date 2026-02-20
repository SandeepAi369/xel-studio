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

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

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

        // 2. Validate Cloudinary config
        const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
        const apiKey = process.env.CLOUDINARY_API_KEY;
        const apiSecret = process.env.CLOUDINARY_API_SECRET;

        if (!cloudName || !apiKey || !apiSecret) {
            return NextResponse.json(
                { error: 'Cloudinary not configured' },
                { status: 500, headers: corsHeaders }
            );
        }

        // 3. Generate signed upload params
        const timestamp = Math.round(Date.now() / 1000);
        const params = {
            timestamp,
            folder: 'xel-studio/articles',
            transformation: 'w_1200,c_limit,q_auto:good,f_auto',
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
            transformation: params.transformation,
        }, { headers: corsHeaders });

    } catch (error) {
        console.error('Signing error:', error);
        return NextResponse.json(
            { error: 'Failed to generate upload signature' },
            { status: 500, headers: corsHeaders }
        );
    }
}
