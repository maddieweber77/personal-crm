# Voice-First Personal Memory CRM

A phone-based memory system that captures daily voice journals, extracts person updates, and generates summaries.

## How It Works

1. Call your Twilio number
2. Speak freely about your day and people you interacted with
3. Hang up
4. System automatically:
   - Downloads and transcribes the recording
   - Extracts structured data about people mentioned
   - Generates a daily summary
   - Stores everything in Postgres

## Tech Stack

- **Backend**: Node.js + TypeScript + Express
- **Database**: Postgres (Railway)
- **Telephony**: Twilio Voice
- **Transcription**: OpenAI Whisper API
- **LLM**: OpenAI GPT-4
- **Storage**: Local filesystem (audio files)

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

You'll need:
- **DATABASE_URL**: Get this from your Railway Postgres dashboard
- **OPENAI_API_KEY**: Get from https://platform.openai.com/api-keys
- **TWILIO_ACCOUNT_SID** and **TWILIO_AUTH_TOKEN**: Get from https://console.twilio.com/

### 3. Run Database Migrations

```bash
npm run migrate
```

This creates all the required tables in your Postgres database.

### 4. Start the Server

Development mode (with auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm run build
npm start
```

The server will start on port 3000 (or whatever you set in `PORT`).

### 5. Configure Twilio Webhook

1. Go to your Twilio console
2. Navigate to your phone number settings
3. Under "Voice & Fax" > "A Call Comes In", set it to your server URL
4. For the recording webhook, set:
   - **URL**: `https://your-server.com/api/twilio/recording-complete`
   - **Method**: POST

**For local development**: Use [ngrok](https://ngrok.com/) to expose your local server:
```bash
ngrok http 3000
```
Then use the ngrok URL in your Twilio webhook settings.

## Project Structure

```
personal-crm/
├── src/
│   ├── index.ts              # Main server entry point
│   ├── routes/
│   │   └── webhook.ts        # Twilio webhook handler (orchestrates everything)
│   ├── services/
│   │   ├── audio-downloader.ts   # Downloads recordings from Twilio
│   │   ├── transcription.ts      # Whisper API integration
│   │   └── llm.ts                # OpenAI GPT-4 (person extraction + summaries)
│   ├── database/
│   │   ├── client.ts             # Postgres queries
│   │   └── migrate.ts            # Migration runner
│   └── types/
│       └── index.ts              # TypeScript types
├── migrations/
│   └── 001_create_tables.sql     # Database schema
├── audio-files/                  # Local audio storage (gitignored)
└── .env.example                  # Environment variables template
```

## Database Schema

### `people`
Stores unique people mentioned in voice journals.
- `id` (uuid) - Primary key
- `name` (text) - Person's name
- `aliases` (text[]) - Nicknames/alternative names
- `relationship` (text) - friend | family | coworker | unknown
- `created_at`, `updated_at` (timestamptz)

### `voice_entries`
Stores each voice call recording and transcript.
- `id` (uuid) - Primary key
- `recorded_at` (timestamptz) - When the call happened
- `audio_path` (text) - Local file path to audio
- `transcript` (text) - Full transcription
- `created_at` (timestamptz)

### `person_updates`
Stores individual updates about people.
- `id` (uuid) - Primary key
- `person_id` (uuid) - FK to people
- `voice_entry_id` (uuid) - FK to voice_entries
- `update_text` (text) - The update/information
- `context` (text) - Additional context
- `created_at` (timestamptz)

### `daily_summaries`
Stores daily summaries (one per date).
- `date` (date) - Primary key (YYYY-MM-DD)
- `summary` (text) - 3-4 sentence summary
- `created_at` (timestamptz)

## Data Flow

1. **Twilio calls webhook** → POST to `/api/twilio/recording-complete`
2. **Download recording** → Save to `audio-files/`
3. **Transcribe** → OpenAI Whisper API
4. **Store voice entry** → Insert into `voice_entries` table
5. **LLM Pass A: Extract people** → Parse transcript, identify people and updates
6. **Find or create people** → Check if person exists by name/alias, create if new
7. **Store updates** → Insert into `person_updates` table
8. **LLM Pass B: Generate summary** → Create daily summary
9. **Upsert summary** → Update `daily_summaries` for today's date

## Phase 2 TODOs

### 1. Cloud Storage (S3)
Currently audio files are stored locally. Move to S3:
- Install `@aws-sdk/client-s3`
- Update `src/services/audio-downloader.ts` to upload to S3
- Store S3 URL in `voice_entries.audio_path` instead of local path

### 2. Embeddings & Semantic Search
Enable searching memories by meaning, not just keywords:
- Install `pgvector` extension in Postgres
- Add `embedding` column (vector) to `person_updates` table
- Generate embeddings in `src/services/llm.ts` using OpenAI embeddings API
- Create search functions using cosine similarity
- Example use case: "When did I last talk about work stress?"

### 3. Web UI
Build a simple interface to:
- View daily summaries (calendar view)
- Browse people and their updates
- Search across all memories
- See timeline of interactions with each person

Tech suggestions: Next.js + Tailwind + React Query

### 4. Duplicate Person Detection
Currently, each mention creates a potential new person. Add:
- Fuzzy matching on names (e.g., "Bob" vs "Robert")
- Manual merge interface in UI
- Confidence scoring on person matches

### 5. Rich Metadata Extraction
Extract additional data:
- Dates mentioned ("saw John last Tuesday")
- Locations ("went to the coffee shop")
- Sentiment/tone analysis
- Topics/tags (work, health, family, etc.)

### 6. Twilio Incoming Call Flow
Add TwiML response to guide the user:
- Play a greeting message
- Start recording automatically
- Set recording status callback URL

### 7. Error Handling & Retries
Production-grade reliability:
- Retry failed LLM calls with exponential backoff
- Dead letter queue for failed webhook processing
- Monitoring/alerting (e.g., Sentry)

### 8. Multi-User Support
Currently single-user. To support multiple users:
- Add `users` table
- Add authentication (e.g., phone number verification)
- Scope all queries by user_id
- Separate audio storage per user

### 9. Export Functionality
Allow users to export their data:
- JSON export of all data
- CSV export of person updates
- Audio file download

### 10. Analytics Dashboard
Show insights:
- Most mentioned people
- Interaction frequency over time
- Sentiment trends
- Word clouds

## Troubleshooting

### "Cannot connect to database"
- Check your `DATABASE_URL` in `.env`
- Verify your Railway Postgres instance is running
- Test connection: `psql $DATABASE_URL`

### "OpenAI API error"
- Verify your `OPENAI_API_KEY` is valid
- Check your OpenAI account has credits
- Review rate limits: https://platform.openai.com/account/limits

### "Twilio webhook not receiving calls"
- Ensure your server is publicly accessible (use ngrok for local dev)
- Check Twilio webhook logs in console
- Verify webhook URL is correct in Twilio settings

### "Audio file not found"
- Ensure `audio-files/` directory exists
- Check file permissions
- Verify Twilio credentials are correct for downloading recordings

## Security Notes

⚠️ **Important**: This MVP has no authentication. Do not deploy to production without:
- Adding user authentication
- Securing webhook endpoints (validate Twilio signatures)
- Using environment-specific secrets (don't commit `.env`)
- Implementing rate limiting
- Adding input validation and sanitization
