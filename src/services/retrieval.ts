import { parseQuery } from './query-parser';
import {
  getPersonUpdates,
  getDailySummary,
  getVoiceEntriesByDate,
  getRecentVoiceEntries,
  searchManualEntriesByName,
  getPersonEvents,
  getPersonSituations,
} from '../database/client';

/**
 * Handles a user query and returns a formatted response
 */
export async function handleQuery(userQuery: string): Promise<string> {
  try {
    console.log(`Processing query: "${userQuery}"`);

    // Parse the query to understand what they want
    const parsed = await parseQuery(userQuery);

    if (parsed.type === 'person' && parsed.personName) {
      return await handlePersonQuery(parsed.personName);
    }

    if (parsed.type === 'date' && parsed.date) {
      return await handleDateQuery(parsed.date);
    }

    if (parsed.type === 'recent') {
      const days = parsed.days || 7;
      return await handleRecentQuery(days);
    }

    // Unknown or couldn't parse
    return "Sorry, I couldn't understand what you're asking for. Try:\n\n• \"Tell me about [person name]\"\n• \"What did I do yesterday?\"\n• \"What happened this week?\"";
  } catch (error) {
    console.error('Query handling failed:', error);
    return 'Sorry, something went wrong processing your request.';
  }
}

/**
 * Handle queries about a specific person
 * Returns ALL information: person details, events, situations, updates, and manual entries
 */
async function handlePersonQuery(personName: string): Promise<string> {
  // First, get the person record
  const voiceResult = await getPersonUpdates(personName);

  if (!voiceResult) {
    return `I don't have any information about ${personName} yet.`;
  }

  const { person, updates } = voiceResult;

  // Get all related data in parallel
  const [events, situations, manualEntries] = await Promise.all([
    getPersonEvents(person.id),
    getPersonSituations(person.id),
    searchManualEntriesByName(personName),
  ]);

  let response = '';

  // === SECTION 1: Person Overview ===
  response += `${person.name} (${person.relationship})\n`;
  response += `Priority: ${person.priority_level}\n`;
  if (person.last_contact_date) {
    response += `Last contact: ${person.last_contact_date.toISOString().split('T')[0]}\n`;
  } else {
    response += `Last contact: Never recorded\n`;
  }

  // === SECTION 2: Upcoming Events ===
  if (events.length > 0) {
    response += '\n---\n\n📅 UPCOMING EVENTS:\n\n';
    for (const event of events) {
      const dateStr = event.event_date
        ? event.event_date.toISOString().split('T')[0]
        : event.event_date_approximate || 'Date TBD';
      response += `• ${event.event_description} (${dateStr})\n`;
      response += `  Type: ${event.event_type}${event.is_recurring ? ' (recurring)' : ''}\n\n`;
    }
  }

  // === SECTION 3: Active Situations ===
  const activeSituations = situations.filter(s => s.status === 'active');
  if (activeSituations.length > 0) {
    response += '\n---\n\n💙 ACTIVE SITUATIONS:\n\n';
    for (const situation of activeSituations) {
      const daysSince = Math.floor(
        (Date.now() - new Date(situation.started_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      response += `• ${situation.situation_description}\n`;
      response += `  Type: ${situation.situation_type} | Severity: ${situation.severity}\n`;
      response += `  Duration: ${daysSince} days\n\n`;
    }
  }

  // === SECTION 4: Recent Updates ===
  if (updates.length > 0) {
    response += '\n---\n\n📝 RECENT UPDATES:\n\n';
    const recentUpdates = updates.slice(0, 5);
    for (const update of recentUpdates) {
      response += `• ${update.update_text}\n`;
    }
    if (updates.length > 5) {
      response += `\n(+${updates.length - 5} more updates)\n`;
    }
  }

  // === SECTION 5: Screenshots & Texts ===
  if (manualEntries.length > 0) {
    response += '\n---\n\n📸 SCREENSHOTS & TEXTS:\n\n';
    for (const entry of manualEntries) {
      const date = entry.created_at.toISOString().split('T')[0];
      response += `[${date}]\n${entry.extracted_content}\n\n`;
    }
  }

  return response;
}

/**
 * Handle queries about a specific date
 */
async function handleDateQuery(date: string): Promise<string> {
  // Get daily summary for that date
  const summary = await getDailySummary(date);

  if (!summary) {
    // Check if there are voice entries for that date
    const entries = await getVoiceEntriesByDate(date);

    if (entries.length === 0) {
      return `No entries found for ${date}.`;
    }

    // If we have entries but no summary, return the transcripts
    const transcripts = entries.map((e, i) => `Entry ${i + 1}:\n${e.transcript}`).join('\n\n');
    return `${date}:\n\n${transcripts}`;
  }

  return `${date}:\n\n${summary}`;
}

/**
 * Handle queries about recent activity
 */
async function handleRecentQuery(days: number): Promise<string> {
  const entries = await getRecentVoiceEntries(days);

  if (entries.length === 0) {
    return `No entries in the last ${days} days.`;
  }

  // Group by date
  const byDate: { [date: string]: string[] } = {};

  for (const entry of entries) {
    const date = entry.recorded_at.toISOString().split('T')[0];
    if (!byDate[date]) {
      byDate[date] = [];
    }
    byDate[date].push(entry.transcript);
  }

  // Format response
  const datesSummary = Object.entries(byDate)
    .map(([date, transcripts]) => {
      return `${date}: ${transcripts.length} entry(ies)`;
    })
    .join('\n');

  return `Last ${days} days:\n\n${datesSummary}\n\nTotal: ${entries.length} entries`;
}
