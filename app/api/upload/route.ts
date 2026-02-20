import { NextRequest, NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';
import { validateAccessToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 30; // Allow up to 30s for large uploads

// Max upload size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Configure Cloudinary from environment variables
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

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

        // Validate Cloudinary config
        if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
            return NextResponse.json(
                { error: 'Cloudinary not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.' },
                { status: 500, headers: corsHeaders }
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

        // Upload to Cloudinary with automatic optimization
        // q_auto = best quality at smallest size (Cloudinary AI-powered)
        // f_auto = serve WebP/AVIF based on browser support
        const result = await new Promise<{ secure_url: string; bytes: number; format: string; width: number; height: number }>((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                {
                    folder: 'xel-studio/articles',        // organize in folder
                    resource_type: 'image',
                    quality: 'auto:good',                  // AI-powered quality (visually lossless)
                    fetch_format: 'auto',                  // serve WebP/AVIF automatically
                    transformation: [
                        {
                            width: 1200,
                            crop: 'limit',                 // max 1200px, no upscaling
                            quality: 'auto:good',
                            fetch_format: 'auto',
                        },
                    ],
                    unique_filename: true,
                    overwrite: false,
                },
                (error, uploadResult) => {
                    if (error) reject(error);
                    else if (uploadResult) resolve(uploadResult as { secure_url: string; bytes: number; format: string; width: number; height: number });
                    else reject(new Error('Upload returned no result'));
                }
            );
            uploadStream.end(buffer);
        });

        const compressedSize = result.bytes;
        const savings = Math.round((1 - compressedSize / originalSize) * 100);

        console.log(
            `[Cloudinary] ${file.name}: ${(originalSize / 1024).toFixed(0)}KB → ${(compressedSize / 1024).toFixed(0)}KB (${savings}% smaller) [${result.format}]`
        );

        return NextResponse.json({
            url: result.secure_url,                   // persistent CDN URL
            format: result.format,
            width: result.width,
            height: result.height,
            originalSize,
            compressedSize,
            savings: `${savings}%`,
        }, { headers: corsHeaders });

    } catch (error) {
        console.error('Cloudinary upload error:', error);
        return NextResponse.json(
            {
                error: 'Upload failed',
                details: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500, headers: corsHeaders }
        );
    }
}
