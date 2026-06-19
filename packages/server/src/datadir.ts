// Where persistent JSON lives (users, sessions, ratings, matches, feedback).
// Defaults to packages/server/data for local dev; in production set
// LISKAT_DATA_DIR to a mounted volume (e.g. /data on Fly) so data survives
// redeploys and restarts.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = process.env.LISKAT_DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
