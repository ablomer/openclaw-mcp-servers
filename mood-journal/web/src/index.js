import { logEvent, migrate } from '@openclaw-mood-journal/shared';
import { createApp } from './app.js';

const password = process.env.MOOD_JOURNAL_WEB_PASSWORD;
if (!password) {
  logEvent('web', 'missing_password', {});
  process.exit(1);
}

const DB_PATH = process.env.MOOD_JOURNAL_DB_PATH || '/data/mood-journal.sqlite';
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openDb() {
  for (;;) {
    try {
      return migrate(DB_PATH);
    } catch (err) {
      logEvent('web', 'db_open_retry', { name: err?.name });
      await sleep(2000);
    }
  }
}

const db = await openDb();
const app = createApp({ db, password });
app.listen(PORT, HOST, () => {
  logEvent('web', 'listen', { host: HOST, port: PORT, db: 'mood-journal.sqlite' });
});
