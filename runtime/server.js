// Glyph Runtime — Server
// Auto-mounts all generated routers.
// Usage: node server.js

import express from 'express';
import { routers } from './routes.js';

const app = express();
app.use(express.json());

// Mount all generated service routers
for (const [path, router] of Object.entries(routers)) {
  app.use(path, router);
  console.log(`  mounted ${path}`);
}

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`\nGlyph service running on http://localhost:${port}`);
});
