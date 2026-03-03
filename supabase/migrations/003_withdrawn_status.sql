-- Migration 003: Add 'withdrawn' status to quotes
-- Run in Supabase SQL Editor

ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
ALTER TABLE quotes ADD CONSTRAINT quotes_status_check
  CHECK (status IN ('pending', 'accepted', 'rejected', 'expired', 'withdrawn'));
