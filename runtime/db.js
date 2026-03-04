// Glyph Runtime — Database connection
// Drop this in your output directory alongside generated files.
// Expects DATABASE_URL in environment.

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/glyph_dev',
});

export const db = {
  query: (text, params) => pool.query(text, params),
  pool,
};
