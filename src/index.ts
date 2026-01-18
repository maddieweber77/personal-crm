// IMPORTANT: Load environment variables FIRST before any other imports
import * as dotenv from 'dotenv';
dotenv.config();

// Now import everything else (these can safely use process.env)
import express from 'express';
import webhookRouter from './routes/webhook';
import { closePool } from './database/client';

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
