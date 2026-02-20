/**
 * Supabase Data Layer — XeL Studio
 * 
 * Replaces the old JSON file + GitHub API approach.
 * All CRUD operations go directly to Supabase PostgreSQL.
 * 
 * Uses the service-role client (server-side only) for writes.
 * Reads are public via RLS policies.
 */

import { getSupabaseAdmin } from './supabase';

// ─── Type Definitions ────────────────────────────────────────
// Re-export compatible types (camelCase for app, snake_case mapped to DB)

export interface Article {
    id: string;
    title: string;
    image: string;
    content: string;
    date: string;
    category?: string;
    created_at?: string;
}

export interface APK {
    id: string;
    name: string;
    version: string;
    downloadUrl: string;
    size: string;
    icon?: string;
    description?: string;
    category?: string;
    created_at?: string;
}

export interface AILab {
    id: string;
    name: string;
    description: string;
    icon?: string;
    url?: string;
    category?: string;
    created_at?: string;
}

export interface SecurityTool {
    id: string;
    title: string;
    description: string;
    icon?: string;
    url?: string;
    category?: string;
    created_at?: string;
}

// ─── Helpers: DB ↔ App Field Mapping ─────────────────────────
// Supabase uses snake_case, our app uses camelCase

function dbToApp_APK(row: Record<string, unknown>): APK {
    return {
        id: row.id as string,
        name: row.name as string,
        version: row.version as string,
        downloadUrl: (row.download_url as string) || '',
        size: (row.size as string) || '',
        icon: (row.icon as string) || '',
        description: (row.description as string) || '',
        category: (row.category as string) || 'general',
        created_at: row.created_at as string,
    };
}

function appToDB_APK(apk: Partial<APK>): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    if (apk.id !== undefined) row.id = apk.id;
    if (apk.name !== undefined) row.name = apk.name;
    if (apk.version !== undefined) row.version = apk.version;
    if (apk.downloadUrl !== undefined) row.download_url = apk.downloadUrl;
    if (apk.size !== undefined) row.size = apk.size;
    if (apk.icon !== undefined) row.icon = apk.icon;
    if (apk.description !== undefined) row.description = apk.description;
    if (apk.category !== undefined) row.category = apk.category;
    return row;
}

// AILab fields now match DB columns directly — no mapping needed
// SecurityTool fields now match DB columns directly — no mapping needed

// Articles and SecurityTools use matching field names (no mapping needed)
// except created_at which is auto-added by DB

// ─── Generate ID (matching existing format) ──────────────────
export function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// =====================================================================
// ARTICLES
// =====================================================================

export async function getArticles(): Promise<Article[]> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
        .from('articles')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching articles:', error);
        return [];
    }
    return (data || []) as Article[];
}

export async function getArticleById(id: string): Promise<Article | null> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
        .from('articles')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        console.error('Error fetching article:', error);
        return null;
    }
    return data as Article;
}

export async function addArticle(article: Omit<Article, 'id' | 'created_at'>): Promise<Article> {
    const supabase = getSupabaseAdmin();
    const newArticle = {
        id: generateId(),
        ...article,
    };

    const { data, error } = await supabase
        .from('articles')
        .insert(newArticle)
        .select()
        .single();

    if (error) {
        console.error('Error adding article:', error);
        throw new Error(`Failed to add article: ${error.message}`);
    }
    return data as Article;
}

export async function updateArticle(id: string, updates: Partial<Article>): Promise<Article | null> {
    const supabase = getSupabaseAdmin();
    // Remove id and created_at from updates
    const { id: _id, created_at: _ca, ...safeUpdates } = updates;
    void _id; void _ca;

    const { data, error } = await supabase
        .from('articles')
        .update(safeUpdates)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        console.error('Error updating article:', error);
        return null;
    }
    return data as Article;
}

export async function deleteArticle(id: string): Promise<boolean> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
        .from('articles')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('Error deleting article:', error);
        return false;
    }
    return true;
}

// =====================================================================
// APPS (APKs)
// =====================================================================

export async function getApps(): Promise<APK[]> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
        .from('apps')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching apps:', error);
        return [];
    }
    return (data || []).map(dbToApp_APK);
}

export async function addApp(app: Omit<APK, 'id' | 'created_at'>): Promise<APK> {
    const supabase = getSupabaseAdmin();
    const newApp = {
        ...appToDB_APK(app),
        id: generateId(),
    };

    const { data, error } = await supabase
        .from('apps')
        .insert(newApp)
        .select()
        .single();

    if (error) {
        console.error('Error adding app:', error);
        throw new Error(`Failed to add app: ${error.message}`);
    }
    return dbToApp_APK(data as Record<string, unknown>);
}

export async function updateApp(id: string, updates: Partial<APK>): Promise<APK | null> {
    const supabase = getSupabaseAdmin();
    const dbUpdates = appToDB_APK(updates);
    delete dbUpdates.id;

    const { data, error } = await supabase
        .from('apps')
        .update(dbUpdates)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        console.error('Error updating app:', error);
        return null;
    }
    return dbToApp_APK(data as Record<string, unknown>);
}

export async function deleteApp(id: string): Promise<boolean> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
        .from('apps')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('Error deleting app:', error);
        return false;
    }
    return true;
}

// =====================================================================
// AI LABS
// =====================================================================

export async function getAILabs(): Promise<AILab[]> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
        .from('ai_labs')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching AI labs:', error);
        return [];
    }
    return (data || []) as AILab[];
}

export async function addAILab(lab: Omit<AILab, 'id' | 'created_at'>): Promise<AILab> {
    const supabase = getSupabaseAdmin();
    const newLab = {
        id: generateId(),
        ...lab,
    };

    const { data, error } = await supabase
        .from('ai_labs')
        .insert(newLab)
        .select()
        .single();

    if (error) {
        console.error('Error adding AI lab:', error);
        throw new Error(`Failed to add AI lab: ${error.message}`);
    }
    return data as AILab;
}

export async function updateAILab(id: string, updates: Partial<AILab>): Promise<AILab | null> {
    const supabase = getSupabaseAdmin();
    const { id: _id, created_at: _ca, ...safeUpdates } = updates;
    void _id; void _ca;

    const { data, error } = await supabase
        .from('ai_labs')
        .update(safeUpdates)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        console.error('Error updating AI lab:', error);
        return null;
    }
    return data as AILab;
}

export async function deleteAILab(id: string): Promise<boolean> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
        .from('ai_labs')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('Error deleting AI lab:', error);
        return false;
    }
    return true;
}

// =====================================================================
// SECURITY TOOLS
// =====================================================================

export async function getSecurityTools(): Promise<SecurityTool[]> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
        .from('security_tools')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching security tools:', error);
        return [];
    }
    return (data || []) as SecurityTool[];
}

export async function addSecurityTool(tool: Omit<SecurityTool, 'id' | 'created_at'>): Promise<SecurityTool> {
    const supabase = getSupabaseAdmin();
    const newTool = {
        id: generateId(),
        ...tool,
    };

    const { data, error } = await supabase
        .from('security_tools')
        .insert(newTool)
        .select()
        .single();

    if (error) {
        console.error('Error adding security tool:', error);
        throw new Error(`Failed to add security tool: ${error.message}`);
    }
    return data as SecurityTool;
}

export async function updateSecurityTool(id: string, updates: Partial<SecurityTool>): Promise<SecurityTool | null> {
    const supabase = getSupabaseAdmin();
    const { id: _id, created_at: _ca, ...safeUpdates } = updates;
    void _id; void _ca;

    const { data, error } = await supabase
        .from('security_tools')
        .update(safeUpdates)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        console.error('Error updating security tool:', error);
        return null;
    }
    return data as SecurityTool;
}

export async function deleteSecurityTool(id: string): Promise<boolean> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
        .from('security_tools')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('Error deleting security tool:', error);
        return false;
    }
    return true;
}
