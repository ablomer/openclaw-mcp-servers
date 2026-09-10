export function prepareWorkerProcess() {
  process.umask(0o027);
  process.on('unhandledRejection', (err) => {
    console.error(JSON.stringify({ ts: Date.now(), scope: 'worker', event: 'unhandled_rejection', name: err?.name }));
  });
}

export const DEFAULT_DB_PATH = process.env.MESSAGES_DB_PATH || '/data/messages.sqlite';
export const SESSIONS_DIR = process.env.SESSIONS_DIR || '/sessions';
