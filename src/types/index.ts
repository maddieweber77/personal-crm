// Database types
export interface Person {
  id: string;
  name: string;
  aliases: string[];
  relationship: 'friend' | 'family' | 'coworker' | 'unknown';
  created_at: Date;
  updated_at: Date;
}

export interface VoiceEntry {
  id: string;
  recorded_at: Date;
  audio_path: string;
  transcript: string;
  created_at: Date;
}

export interface PersonUpdate {
  id: string;
  person_id: string;
  voice_entry_id: string;
  update_text: string;
  context: string | null;
  created_at: Date;
}

export interface DailySummary {
  date: string; // YYYY-MM-DD format
  summary: string;
  created_at: Date;
}

// LLM extraction types
export interface ExtractedPerson {
  name: string;
  aliases: string[];
  relationship: 'friend' | 'family' | 'coworker' | 'unknown';
  updates: {
    update_text: string;
    context: string;
  }[];
}

export interface PersonExtractionResult {
  people: ExtractedPerson[];
}
