-- Syte Content Machine — Supabase Database Schema
-- Run this in your Supabase SQL Editor to set up the database.

-- Clients table
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  industry TEXT DEFAULT '',
  voice TEXT DEFAULT '',
  audience TEXT DEFAULT '',
  url TEXT DEFAULT '',
  location TEXT DEFAULT '',
  context TEXT DEFAULT '',
  rules TEXT DEFAULT '',
  articles_per_month INTEGER DEFAULT 4,
  wordcount TEXT DEFAULT '800-1200',
  focus TEXT DEFAULT 'mixed',
  email TEXT DEFAULT '',
  sitemap_raw TEXT DEFAULT '',
  sitemap_urls JSONB DEFAULT '[]',
  auto_generate BOOLEAN DEFAULT false,
  last_gen_month TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Generations table
CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  article_count INTEGER DEFAULT 0,
  topics JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Articles table
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  generation_id TEXT REFERENCES generations(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  primary_keyword TEXT DEFAULT '',
  secondary_keywords JSONB DEFAULT '[]',
  search_intent TEXT DEFAULT '',
  content TEXT NOT NULL,
  word_count INTEGER DEFAULT 0,
  topic_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Generated titles for deduplication
CREATE TABLE IF NOT EXISTS generated_titles (
  id SERIAL PRIMARY KEY,
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_generations_client_id ON generations(client_id);
CREATE INDEX IF NOT EXISTS idx_generations_month ON generations(month);
CREATE INDEX IF NOT EXISTS idx_articles_generation_id ON articles(generation_id);
CREATE INDEX IF NOT EXISTS idx_articles_client_id ON articles(client_id);
CREATE INDEX IF NOT EXISTS idx_generated_titles_client_id ON generated_titles(client_id);

-- Enable Row Level Security (optional — disable if using service key)
-- ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE generations ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE generated_titles ENABLE ROW LEVEL SECURITY;
