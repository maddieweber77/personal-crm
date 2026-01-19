import sendgrid from '@sendgrid/mail';
import {
  getUpcomingEvents,
  getActiveSituations,
  getPeopleNeedingContact,
  logReminder,
  markEventReminderSent,
  updateSituationReminderSent,
} from '../database/client';

/**
 * Main function to check and send all friend-related reminders
 * Called daily by cron job
 */
export async function checkAndSendFriendReminders(): Promise<void> {
  console.log('\n=== Running Friend Reminders Check ===');

  try {
    await Promise.all([
      checkEventReminders(),
      checkSituationReminders(),
      checkLastContactReminders(),
    ]);

    console.log('=== Friend Reminders Check Complete ===\n');
  } catch (error) {
    console.error('Friend reminders check failed:', error);
  }
}

/**
 * Check for upcoming events and send reminders
 */
async function checkEventReminders(): Promise<void> {
  const events = await getUpcomingEvents(14); // Look ahead 2 weeks

  for (const event of events) {
    if (!event.event_date) continue;

    const daysUntil = getDaysUntil(event.event_date);

    // 1 week before reminder
    if (daysUntil === 7 && !event.reminder_sent_1week) {
      const message = formatEventReminder(event, '1 week');
      await sendEmailReminder('Event Reminder (1 Week)', message);
      await logReminder('event', event.person_id, event.id, null, message);
      await markEventReminderSent(event.id, '1week');
      console.log(`✓ Sent 1-week reminder for: ${event.event_description}`);
    }

    // 1 day before reminder
    if (daysUntil === 1 && !event.reminder_sent_1day) {
      const message = formatEventReminder(event, '1 day');
      await sendEmailReminder('Event Reminder (Tomorrow!)', message);
      await logReminder('event', event.person_id, event.id, null, message);
      await markEventReminderSent(event.id, '1day');
      console.log(`✓ Sent 1-day reminder for: ${event.event_description}`);
    }

    // Day of reminder
    if (daysUntil === 0 && !event.reminder_sent_dayof) {
      const message = formatEventReminder(event, 'today');
      await sendEmailReminder('Event Reminder (TODAY!)', message);
      await logReminder('event', event.person_id, event.id, null, message);
      await markEventReminderSent(event.id, 'dayof');
      console.log(`✓ Sent day-of reminder for: ${event.event_description}`);
    }
  }
}

/**
 * Check active situations and send follow-up reminders
 */
async function checkSituationReminders(): Promise<void> {
  const situations = await getActiveSituations();

  for (const situation of situations) {
    const daysSinceLastReminder = situation.last_reminder_sent
      ? getDaysSince(situation.last_reminder_sent)
      : 999; // Large number if never sent

    // Determine reminder frequency based on severity
    let reminderInterval: number;
    switch (situation.severity) {
      case 'high':
        // Breakup, major loss - Daily for 2 weeks, then weekly for 2 months
        const daysSinceStart = getDaysSince(situation.started_at);
        reminderInterval = daysSinceStart <= 14 ? 1 : 7;
        break;
      case 'medium':
        // Wedding planning, new job - Every 7 days
        reminderInterval = 7;
        break;
      case 'low':
        // Minor issues - Every 14 days
        reminderInterval = 14;
        break;
    }

    // Send reminder if enough time has passed
    if (daysSinceLastReminder >= reminderInterval) {
      const message = formatSituationReminder(situation);
      await sendEmailReminder('Friend Support Reminder', message);
      await logReminder('situation', situation.person_id, null, situation.id, message);
      await updateSituationReminderSent(situation.id);
      console.log(`✓ Sent situation reminder for: ${situation.name} - ${situation.situation_description}`);
    }
  }
}

/**
 * Check people who haven't been contacted recently
 */
async function checkLastContactReminders(): Promise<void> {
  // Priority friends: 14 days, Normal friends: 28 days
  const people = await getPeopleNeedingContact(14, 28);

  if (people.length === 0) {
    console.log('✓ All friends have been contacted recently');
    return;
  }

  // Group by priority for better email formatting
  const highPriority = people.filter(p => p.priority_level === 'high');
  const normalPriority = people.filter(p => p.priority_level === 'normal');

  if (highPriority.length > 0) {
    const message = formatLastContactReminder(highPriority, 'high');
    await sendEmailReminder('Check In With Close Friends', message);

    for (const person of highPriority) {
      await logReminder('last_contact', person.id, null, null, message);
    }

    console.log(`✓ Sent check-in reminder for ${highPriority.length} priority friends`);
  }

  if (normalPriority.length > 0) {
    const message = formatLastContactReminder(normalPriority, 'normal');
    await sendEmailReminder('Check In With Friends', message);

    for (const person of normalPriority) {
      await logReminder('last_contact', person.id, null, null, message);
    }

    console.log(`✓ Sent check-in reminder for ${normalPriority.length} normal friends`);
  }
}

/**
 * Format event reminder message
 */
function formatEventReminder(
  event: any,
  timing: string
): string {
  const dateStr = event.event_date.toISOString().split('T')[0];

  return `🎉 Reminder: ${event.event_description}

Who: ${event.name} (${event.relationship})
When: ${dateStr} (${timing})
Type: ${event.event_type}

Consider reaching out to show your support!`;
}

/**
 * Format situation reminder message
 */
function formatSituationReminder(situation: any): string {
  const daysSinceStart = getDaysSince(situation.started_at);

  let supportTip = '';
  switch (situation.situation_type) {
    case 'breakup':
      supportTip = daysSinceStart < 14
        ? 'Early days - just listen and be present. Avoid giving advice unless asked.'
        : 'Check in on how they\'re doing. Invite them to do something fun.';
      break;
    case 'sick_family':
      supportTip = 'Ask specific questions: "How is [family member] doing?" "How are YOU holding up?" Offer concrete help.';
      break;
    case 'wedding_planning':
      supportTip = 'Be excited for them! Ask how planning is going. Offer to help if you can.';
      break;
    case 'new_job':
      supportTip = daysSinceStart < 30
        ? 'Ask how the first few weeks are going. Be encouraging.'
        : 'Check in on how they\'re settling in.';
      break;
    case 'tough_time':
      supportTip = 'Reach out with a simple "Thinking of you" message. Offer to chat or hang out.';
      break;
  }

  return `💙 ${situation.name} needs your support

Situation: ${situation.situation_description}
Severity: ${situation.severity}
Duration: ${daysSinceStart} days

${supportTip}

Consider reaching out today!`;
}

/**
 * Format last contact reminder message
 */
function formatLastContactReminder(
  people: any[],
  priority: 'high' | 'normal'
): string {
  const threshold = priority === 'high' ? '2 weeks' : '4 weeks';

  let message = `📱 You haven't talked to these ${priority === 'high' ? 'close' : ''} friends in over ${threshold}:\n\n`;

  for (const person of people) {
    const lastContactStr = person.last_contact_date
      ? `Last contact: ${person.last_contact_date.toISOString().split('T')[0]}`
      : 'No contact recorded yet';

    message += `• ${person.name} (${person.relationship}) - ${lastContactStr}\n`;
  }

  message += '\nConsider reaching out to catch up!';

  return message;
}

/**
 * Send reminder via email
 */
async function sendEmailReminder(subject: string, message: string): Promise<void> {
  try {
    const sendgridApiKey = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL || 'maddieweber7@gmail.com';
    const toEmail = 'maddieweber7@gmail.com';

    if (!sendgridApiKey) {
      console.error('⚠️ SendGrid API key not configured - email disabled');
      return;
    }

    sendgrid.setApiKey(sendgridApiKey);

    await sendgrid.send({
      from: fromEmail,
      to: toEmail,
      subject: `CRM: ${subject}`,
      text: message,
    });
  } catch (error) {
    console.error('Failed to send email reminder:', error);
  }
}

/**
 * Calculate days until a future date
 */
function getDaysUntil(date: Date): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const diffMs = target.getTime() - now.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Calculate days since a past date
 */
function getDaysSince(date: Date): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const past = new Date(date);
  past.setHours(0, 0, 0, 0);
  const diffMs = now.getTime() - past.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}
