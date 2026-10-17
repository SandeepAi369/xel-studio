declare namespace NodeJS {
    interface ProcessEnv {
        // Admin auth (admin link: /xel-admin#token=<ADMIN_TOKEN>, then password)
        ADMIN_TOKEN?: string;
        ADMIN_PASSWORD?: string;          // bcrypt hash recommended ($2…); plaintext still accepted
        SESSION_SECRET?: string;

        // Firebase (client)
        NEXT_PUBLIC_FIREBASE_API_KEY?: string;
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?: string;
        NEXT_PUBLIC_FIREBASE_PROJECT_ID?: string;
        NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?: string;
        NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?: string;
        NEXT_PUBLIC_FIREBASE_APP_ID?: string;
        NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID?: string;

        // Firebase Admin (server) — either the JSON blob or the three fields
        FIREBASE_SERVICE_ACCOUNT?: string;
        FIREBASE_PROJECT_ID?: string;
        FIREBASE_CLIENT_EMAIL?: string;
        FIREBASE_PRIVATE_KEY?: string;

        // Supabase
        NEXT_PUBLIC_SUPABASE_URL?: string;
        NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
        SUPABASE_SERVICE_ROLE_KEY?: string;

        // GitHub (dispatches deepAI-Articles sync + syndication workflows)
        GITHUB_PAT?: string;

        // Cloudinary (admin uploads) — CLOUDINARY_URL or the three fields
        CLOUDINARY_URL?: string;
        CLOUDINARY_CLOUD_NAME?: string;
        CLOUDINARY_API_KEY?: string;
        CLOUDINARY_API_SECRET?: string;

        // Gemini (chat)
        GEMINI_API_KEY?: string;
        GEMINI_CHAT_API_KEY?: string;

        // Cron + on-demand revalidation
        CRON_SECRET?: string;
        REVALIDATION_SECRET?: string;

        // Feature flags
        ENABLE_ADVANCED_AIO?: string;     // "false" disables llms.txt / .md mirrors / slug aliases

        // Vercel system
        VERCEL_URL?: string;
        VERCEL?: string;

        // Site URL (for CORS)
        NEXT_PUBLIC_SITE_URL?: string;
    }
}
