-- Manual entries table for screenshots and text messages sent via SMS
CREATE TABLE IF NOT EXISTS manual_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  entry_type TEXT NOT NULL, -- 'text' or 'image'
  message_text TEXT, -- User's accompanying message
  image_url TEXT, -- Twilio media URL
  image_analysis TEXT, -- OpenAI Vision analysis of the image
  extracted_content TEXT NOT NULL -- Final extracted/combined content
);

-- Index for searching by date
CREATE INDEX IF NOT EXISTS idx_manual_entries_created_at ON manual_entries(created_at DESC);
