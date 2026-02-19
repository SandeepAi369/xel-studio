declare namespace NodeJS {
    interface ProcessEnv {
        // Admin auth
        ADMIN_TOKEN?: string;
        ADMIN_PASSWORD?: string;
        SESSION_SECRET?: string;

        // Supabase
        NEXT_PUBLIC_SUPABASE_URL?: string;
        SUPABASE_SERVICE_ROLE_KEY?: string;

        // Gemini
        GEMINI_API_KEY?: string;
        GEMINI_CHAT_API_KEY?: string;

        // GitHub
        GITHUB_TOKEN?: string;
        GITHUB_REPO?: string;
    }
}
