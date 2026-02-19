-- =====================================================================
-- XeL Studio — Supabase Schema
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard)
-- =====================================================================

-- Articles table (permanent storage)
CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    title TEXT NOT NULL,
    image TEXT DEFAULT '',
    content TEXT NOT NULL,
    date TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD'),
    category TEXT DEFAULT 'general',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Apps (APKs) table (permanent storage)
CREATE TABLE IF NOT EXISTS apps (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '1.0',
    download_url TEXT NOT NULL,
    size TEXT DEFAULT '',
    icon TEXT DEFAULT '',
    description TEXT DEFAULT '',
    category TEXT DEFAULT 'general',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- AI Labs table (permanent storage)
CREATE TABLE IF NOT EXISTS ai_labs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'experimental', 'archived')),
    demo_url TEXT DEFAULT '',
    image TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Security Tools table (permanent storage)
CREATE TABLE IF NOT EXISTS security_tools (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    link TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security on all tables
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_labs ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_tools ENABLE ROW LEVEL SECURITY;

-- Public read access (anyone can read, only service role can write)
CREATE POLICY "Public read articles" ON articles FOR SELECT USING (true);
CREATE POLICY "Public read apps" ON apps FOR SELECT USING (true);
CREATE POLICY "Public read ai_labs" ON ai_labs FOR SELECT USING (true);
CREATE POLICY "Public read security_tools" ON security_tools FOR SELECT USING (true);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_apps_created_at ON apps (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_labs_created_at ON ai_labs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_tools_created_at ON security_tools (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles (category);
CREATE INDEX IF NOT EXISTS idx_apps_category ON apps (category);
