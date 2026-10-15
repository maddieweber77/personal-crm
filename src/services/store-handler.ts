import { analyzeImage } from './image-analyzer';
import { processEntry, type ProcessResult } from './apply-extraction';
import { createManualEntry } from '../database/client';

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

    // Find who was mentioned (matched against saved people) and save what's new
    let people: ProcessResult | null = null;
    try {
      people = await processEntry(extractedContent, { kind: 'manual', entryId: entry.id }, new Date());
    } catch (extractionError) {
      // Don't fail the whole request if extraction fails: the note itself is saved
      console.error('Failed to extract people from manual entry:', extractionError instanceof Error ? extractionError.message : String(extractionError));
    }
    const unsure = people && people.pending.length
      ? `\n\nI wasn't sure who ${people.pending.map(n => `"${n}"`).join(', ')} ${people.pending.length === 1 ? 'is' : 'are'}, so I'll ask before saving those details.`
      : '';

    // Generate friendly confirmation
    if (entryType === 'image') {
      return `✓ Got it! I've analyzed and saved your screenshot${mediaUrls.length > 1 ? 's' : ''}. The information has been stored and I can recall it when you ask me about it later.${unsure}`;
    } else {
      return `✓ Noted! I've saved that information and will remember it for future reference.${unsure}`;
    }
  } catch (error) {
    console.error('Store request handling failed:', error);
    return 'Sorry, I had trouble saving that information. Please try again.';
  }
}
