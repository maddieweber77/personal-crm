import { analyzeImage } from './image-analyzer';
import { extractPeopleFromTranscript } from './llm';
import {
  createManualEntry,
  findPersonByNameOrAlias,
  createPerson,
  createPersonUpdate,
  updateLastContactDate,
  createFriendEvent,
  createFriendSituation,
} from '../database/client';

/**
 * Handles storing information sent by the user (text or screenshots)
 */
export async function handleStoreRequest(
  messageText: string,
  mediaUrls: string[]
): Promise<string> {
  try {
    console.log('Processing store request...');

    let extractedContent = '';
    let imageAnalysis: string | null = null;
    let entryType: 'text' | 'image' = 'text';

    if (mediaUrls.length > 0) {
      // User sent image(s)
      entryType = 'image';
      console.log(`Analyzing ${mediaUrls.length} image(s)...`);

      const analyses: string[] = [];

      for (const mediaUrl of mediaUrls) {
        const analysis = await analyzeImage(mediaUrl, messageText);
        analyses.push(analysis);
      }

      imageAnalysis = analyses.join('\n\n---\n\n');

      // Combine user message with image analysis
      if (messageText && messageText.trim()) {
        extractedContent = `User context: ${messageText}\n\n${imageAnalysis}`;
      } else {
        extractedContent = imageAnalysis;
      }
    } else {
      // User sent just text
      extractedContent = messageText;
    }

    // Store in database
    const entry = await createManualEntry(
      entryType,
      messageText || null,
      mediaUrls[0] || null, // Store first image URL
      imageAnalysis,
      extractedContent
    );

    console.log(`✓ Manual entry stored: ${entry.id}`);

    // Extract people and update people table (just like voice calls do)
    try {
      const personExtractionResult = await extractPeopleFromTranscript(extractedContent);

      for (const extractedPerson of personExtractionResult.people) {
        // Try to find existing person by name or alias
        let person = await findPersonByNameOrAlias(extractedPerson.name);

        // If not found, create new person
        if (!person) {
          person = await createPerson(
            extractedPerson.name,
            extractedPerson.aliases,
            extractedPerson.relationship
          );
          console.log(`✓ Created new person: ${person.name}`);
        } else {
          console.log(`✓ Found existing person: ${person.name}`);
        }

        // Update last contact date if contact was mentioned
        if (personExtractionResult.mentioned_contact) {
          await updateLastContactDate(person.id, new Date());
          console.log(`✓ Updated last contact date for ${person.name}`);
        }

        // Create person_updates for each update
        for (const update of extractedPerson.updates) {
          await createPersonUpdate(
            person.id,
            entry.id,
            update.update_text,
            update.context
          );
        }
        console.log(`✓ Created ${extractedPerson.updates.length} updates for ${person.name}`);

        // Create friend events
        if (extractedPerson.events && extractedPerson.events.length > 0) {
          for (const event of extractedPerson.events) {
            const eventDate = event.event_date ? new Date(event.event_date) : null;
            const isRecurring = event.event_type === 'birthday';

            await createFriendEvent(
              person.id,
              event.event_type,
              event.event_description,
              eventDate,
              event.event_date_approximate,
              isRecurring,
              entry.id
            );
          }
          console.log(`✓ Created ${extractedPerson.events.length} events for ${person.name}`);
        }

        // Create friend situations
        if (extractedPerson.situations && extractedPerson.situations.length > 0) {
          for (const situation of extractedPerson.situations) {
            const startedAt = new Date(situation.started_at);

            await createFriendSituation(
              person.id,
              situation.situation_type,
              situation.situation_description,
              situation.severity,
              startedAt,
              entry.id
            );
          }
          console.log(`✓ Created ${extractedPerson.situations.length} situations for ${person.name}`);
        }
      }
    } catch (extractionError) {
      console.error('Failed to extract people from manual entry:', extractionError);
      // Don't fail the whole request if extraction fails
    }

    // Generate friendly confirmation
    if (entryType === 'image') {
      return `✓ Got it! I've analyzed and saved your screenshot${mediaUrls.length > 1 ? 's' : ''}. The information has been stored and I can recall it when you ask me about it later.`;
    } else {
      return `✓ Noted! I've saved that information and will remember it for future reference.`;
    }
  } catch (error) {
    console.error('Store request handling failed:', error);
    return 'Sorry, I had trouble saving that information. Please try again.';
  }
}
