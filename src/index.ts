// IMPORTANT: Load environment variables FIRST before any other imports
import * as dotenv from 'dotenv';
dotenv.config();

// Now import everything else (these can safely use process.env)
import express from 'express';
import cron from 'node-cron';
import webhookRouter from './routes/webhook';
import { closePool } from './database/client';
import { sendCheckInReminder } from './services/reminder';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Mount webhook routes
app.use('/api', webhookRouter);

// Start the server
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📞 Twilio voice endpoint: http://localhost:${PORT}/api/twilio/voice`);
  console.log(`📝 Twilio recording endpoint: http://localhost:${PORT}/api/twilio/recording-complete`);
});

// Schedule SMS reminders every 4 hours during awake hours
// Runs at: 8am, 12pm, 4pm, 8pm (US Eastern Time)
// Cron format: minute hour day month weekday
// "0 8,12,16,20 * * *" = at minute 0 of hours 8, 12, 16, 20
cron.schedule('0 8,12,16,20 * * *', () => {
  console.log('⏰ Running scheduled reminder check...');
  sendCheckInReminder();
}, {
  timezone: "America/New_York" // Use Eastern Time
});

console.log('⏰ SMS reminders scheduled: 8am, 12pm, 4pm, 8pm ET');

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('\nShutting down gracefully...');
  server.close(async () => {
    await closePool();
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  server.close(async () => {
    await closePool();
    console.log('Server closed');
    process.exit(0);
  });
});
