require('dotenv').config({ path: '.env.local' });
// Also try .env as fallback (for Render deployment)
require('dotenv').config({ path: '.env' });

const next = require('next');
const { initBot } = require('./lib/bot/index.js');

const dev = process.env.NODE_ENV !== 'production';
const nextApp = next({ dev });
const handle = nextApp.getRequestHandler();

nextApp.prepare().then(() => {
  const { app: slackApp, receiver } = initBot();

  // Next.js catch-all (AFTER Slack routes are registered by ExpressReceiver)
  // Use middleware-style handler (no path pattern) to avoid path-to-regexp issues
  receiver.router.use((req, res) => handle(req, res));

  const port = process.env.PORT || 3000;
  slackApp.start(port).then(() => {
    console.log(`Server running on port ${port} (${dev ? 'development' : 'production'})`);
  });
}).catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
