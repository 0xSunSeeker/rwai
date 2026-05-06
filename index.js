// index.js — single entry point for the full RWAI autonomous loop
// Starts both the 30-minute agent and the Telegram bot in one process.
// Run with: node index.js  (or: npm run dev)

import './src/agent.js';
import './src/bot.js';
