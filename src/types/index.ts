// Database types
export interface Person {
  id: string;
  name: string;
  aliases: string[];
  relationship: 'friend' | 'family' | 'coworker' | 'unknown';
  last_contact_date: Date | null;
  priority_level: 'high' | 'normal';
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

export interface ManualEntry {
  id: string;
  created_at: Date;
  entry_type: 'text' | 'image';
  message_text: string | null;
  image_url: string | null;
  image_analysis: string | null;
  extracted_content: string;
}

export interface FriendEvent {
  id: string;
  person_id: string;
  event_type: 'birthday' | 'wedding' | 'trip' | 'interview' | 'surgery' | 'other';
  event_description: string;
  event_date: Date | null;
  event_date_approximate: string | null;
  is_recurring: boolean;
  reminder_sent_1week: boolean;
  reminder_sent_1day: boolean;
  reminder_sent_dayof: boolean;
  source_entry_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface FriendSituation {
  id: string;
  person_id: string;
  situation_type: 'breakup' | 'sick_family' | 'wedding_planning' | 'new_job' | 'tough_time' | 'other';
  situation_description: string;
  severity: 'high' | 'medium' | 'low';
  status: 'active' | 'resolved';
  started_at: Date;
  resolved_at: Date | null;
  last_reminder_sent: Date | null;
  source_entry_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ReminderLog {
  id: string;
  reminder_type: 'event' | 'situation' | 'last_contact';
  person_id: string | null;
  related_event_id: string | null;
  related_situation_id: string | null;
  message_sent: string;
  sent_at: Date;
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
  events?: {
    event_type: 'birthday' | 'wedding' | 'trip' | 'interview' | 'surgery' | 'other';
    event_description: string;
    event_date: string | null; // ISO date string or null
    event_date_approximate: string | null; // "next month", "in a few weeks"
  }[];
  situations?: {
    situation_type: 'breakup' | 'sick_family' | 'wedding_planning' | 'new_job' | 'tough_time' | 'other';
    situation_description: string;
    severity: 'high' | 'medium' | 'low';
    started_at: string; // ISO date string
  }[];
}

export interface PersonExtractionResult {
  people: ExtractedPerson[];
  mentioned_contact: boolean; // True if user mentioned talking to/seeing someone
}
