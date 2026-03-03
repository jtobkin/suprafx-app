-- Migration 002: Update quotes table for marketplace flow
-- Run in Supabase SQL Editor

-- Add rate column if it does not exist (schema may already have it)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'quotes' AND column_name = 'rate') THEN
    ALTER TABLE quotes ADD COLUMN rate numeric(18,6);
  END IF;
END $$;

-- Drop bid_rate/ask_rate if they exist (old schema)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'quotes' AND column_name = 'bid_rate') THEN
    ALTER TABLE quotes DROP COLUMN bid_rate;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'quotes' AND column_name = 'ask_rate') THEN
    ALTER TABLE quotes DROP COLUMN ask_rate;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'quotes' AND column_name = 'expires_at') THEN
    -- already exists, no-op
    NULL;
  ELSE
    ALTER TABLE quotes ADD COLUMN expires_at timestamptz;
  END IF;
END $$;

-- Add index on rfq_id for fast quote lookups
CREATE INDEX IF NOT EXISTS idx_quotes_rfq_id ON quotes(rfq_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);

-- Enable realtime on quotes
ALTER PUBLICATION supabase_realtime ADD TABLE quotes;
