import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { validateAccessToken } from '@/lib/auth';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export const dynamic = 'force-dynamic';

// Max upload size: 10MB raw, compressed output << 1MB typically
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

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
        // Auth check — require admin token
        const token = req.headers.get('authorization')?.replace('Bearer ', '');
        if (!validateAccessToken(token)) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401, headers: corsHeaders }
            );
        }

        const formData = await req.formData();
        const file = formData.get('image') as File | null;

        if (!file) {
            return NextResponse.json(
                { error: 'No image file provided' },
                { status: 400, headers: corsHeaders }
            );
        }

        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
            return NextResponse.json(
                { error: `File too large. Max ${MAX_FILE_SIZE / 1024 / 1024}MB` },
                { status: 400, headers: corsHeaders }
            );
        }

        // Validate file type
        const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
        if (!validTypes.includes(file.type)) {
            return NextResponse.json(
                { error: 'Invalid image type. Supported: JPEG, PNG, WebP, GIF, AVIF' },
                { status: 400, headers: corsHeaders }
            );
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const originalSize = buffer.length;

        // ── Sharp Compression ──
        // Resize to max 1200px wide (articles don't need wider)
        // Convert to WebP with quality 88 (visually lossless, ~60% smaller)
        const optimized = await sharp(buffer)
            .resize({
                width: 1200,
                withoutEnlargement: true,  // don't upscale small images
                fit: 'inside',
            })
            .webp({
                quality: 88,               // visually lossless
                effort: 4,                 // compression effort (0-6, 4 is balanced)
            })
            .toBuffer();

        const compressedSize = optimized.length;
        const savings = Math.round((1 - compressedSize / originalSize) * 100);

        // Generate unique filename
        const timestamp = Date.now();
        const safeName = file.name
            .replace(/[^a-zA-Z0-9.-]/g, '-')
            .replace(/\.\w+$/, '.webp');
        const filename = `${timestamp}-${safeName}`;

        // Ensure upload directory exists
        const uploadDir = join(process.cwd(), 'public', 'uploads', 'articles');
        if (!existsSync(uploadDir)) {
            await mkdir(uploadDir, { recursive: true });
        }

        // Save compressed image
        const filepath = join(uploadDir, filename);
        await writeFile(filepath, optimized);

        const url = `/uploads/articles/${filename}`;

        console.log(
            `[Upload] ${file.name}: ${(originalSize / 1024).toFixed(0)}KB → ${(compressedSize / 1024).toFixed(0)}KB (${savings}% smaller)`
        );

        return NextResponse.json({
            url,
            filename,
            originalSize,
            compressedSize,
            savings: `${savings}%`,
            format: 'webp',
        }, { headers: corsHeaders });

    } catch (error) {
        console.error('Upload error:', error);
        return NextResponse.json(
            {
                error: 'Upload failed',
                details: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500, headers: corsHeaders }
        );
    }
}
