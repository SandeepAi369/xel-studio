declare namespace NodeJS {
    interface ProcessEnv {
        // Admin auth
        ADMIN_TOKEN?: string;
        ADMIN_PASSWORD?: string;
        SESSION_SECRET?: string;

        // Firebase
        NEXT_PUBLIC_FIREBASE_API_KEY?: string;
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?: string;
        NEXT_PUBLIC_FIREBASE_PROJECT_ID?: string;
        NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?: string;
        NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?: string;
        NEXT_PUBLIC_FIREBASE_APP_ID?: string;
        NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID?: string;

        // Supabase
        NEXT_PUBLIC_SUPABASE_URL?: string;
        SUPABASE_SERVICE_ROLE_KEY?: string;

        // Cerebras
        CEREBRAS_API_KEY?: string;

        // Groq (chat fallback)
        GROQ_API_KEY?: string;

        // GitHub
        GITHUB_TOKEN?: string;
        GITHUB_REPO?: string;

        // Cloudinary
        CLOUDINARY_CLOUD_NAME?: string;

        // Unsplash
        UNSPLASH_ACCESS_KEY?: string;

        // Cron
        CRON_SECRET?: string;

        // Tavily
        TAVILY_API_KEY?: string;
    }
}
