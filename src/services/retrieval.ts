import { parseQuery } from './query-parser';
import {
  getPersonUpdates,
  getDailySummary,
  getVoiceEntriesByDate,
  getRecentVoiceEntries,
  searchManualEntriesByName,
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
 * Searches both voice entries (people table) AND manual entries (screenshots/texts)
 */
async function handlePersonQuery(personName: string): Promise<string> {
  // Search both sources in parallel
  const [voiceResult, manualEntries] = await Promise.all([
    getPersonUpdates(personName),
    searchManualEntriesByName(personName),
  ]);

  // Check if we found anything at all
  if (!voiceResult && manualEntries.length === 0) {
    return `I don't have any information about ${personName} yet.`;
  }

  let response = '';

  // Add voice-based updates if they exist
  if (voiceResult && voiceResult.updates.length > 0) {
    const { person, updates } = voiceResult;

    const updatesList = updates
      .slice(0, 5) // Show max 5 most recent
      .map((u) => `• ${u.update_text}`)
      .join('\n');

    const totalCount = updates.length;
    const moreText = totalCount > 5 ? ` (+${totalCount - 5} more)` : '';

    response += `${person.name} (${person.relationship}):\n\n`;
    response += `Voice entries${moreText}:\n${updatesList}`;
  }

  // Add manual entries (screenshots/texts) if they exist
  if (manualEntries.length > 0) {
    if (response) {
      response += '\n\n---\n\n';
    }

    response += `Screenshots & texts (${manualEntries.length}):\n\n`;

    // Show most recent 3 manual entries
    const recentEntries = manualEntries.slice(0, 3);

    for (const entry of recentEntries) {
      const date = entry.created_at.toISOString().split('T')[0];
      const preview = entry.extracted_content.substring(0, 200);
      const truncated = entry.extracted_content.length > 200 ? '...' : '';

      response += `[${date}] ${preview}${truncated}\n\n`;
    }

    if (manualEntries.length > 3) {
      response += `(+${manualEntries.length - 3} more entries)`;
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
