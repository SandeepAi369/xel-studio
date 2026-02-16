-- ============================================================
-- XeL Studio — User Feedback System
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard)
-- ============================================================

-- 1. Enable UUID extension (usually already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Create feedbacks table
-- Note: user_id stores the Firebase UID (text), NOT a Supabase auth UUID.
CREATE TABLE IF NOT EXISTS feedbacks (
  id         UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  content    TEXT        NOT NULL,
  user_email TEXT        NOT NULL,
  user_name  TEXT        NOT NULL,
  user_id    TEXT        NOT NULL
);

-- 3. Enable Row Level Security
ALTER TABLE feedbacks ENABLE ROW LEVEL SECURITY;

-- 4. All operations go through the Service Role Key (server-side),
--    which bypasses RLS entirely. No client-side policies needed.

-- 5. Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_feedbacks_created_at ON feedbacks(created_at DESC);
