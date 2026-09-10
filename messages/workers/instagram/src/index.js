import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { IgApiClient, IgCheckpointError, IgLoginRequiredError } from 'instagram-private-api';
import {
  DEFAULT_DB_PATH,
  MessageWriter,
  SESSIONS_DIR,
  logEvent,
  migrate,
  prepareWorkerProcess,
} from '@openclaw-messages/shared';

prepareWorkerProcess();

const SOURCE = 'instagram';
const SESSION_DIR = join(SESSIONS_DIR, 'instagram');
const SESSION_FILE = join(SESSION_DIR, 'session.json');
const POLL_MS = Number(process.env.INSTAGRAM_POLL_MS || 90_000);
const MAX_BACKOFF_MS = 60 * 60 * 1000;

mkdirSync(SESSION_DIR, { recursive: true });

function loadSession() {
  if (!existsSync(SESSION_FILE)) return null;
  return JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
}

async function saveSession(ig) {
  const serialized = await ig.state.serialize();
  delete serialized.constants;
  writeFileSync(SESSION_FILE, JSON.stringify(serialized), { mode: 0o600 });
}

function jitter(ms) {
  return ms + Math.floor(Math.random() * Math.min(15_000, ms * 0.2));
}

function itemBody(item) {
  if (item?.text) return item.text;
  if (item?.media?.caption?.text) return item.media.caption.text;
  if (item?.like) return null;
  if (item?.item_type === 'media' || item?.item_type === 'raven_media') return null;
  return item?.item_type ? `[${item.item_type}]` : null;
}

function itemType(item) {
  switch (item?.item_type) {
    case 'text':
      return 'text';
    case 'media':
    case 'raven_media':
      return item.media?.media_type === 2 ? 'video' : 'image';
    case 'voice_media':
      return 'audio';
    case 'like':
    case 'animated_media':
      return 'sticker';
    default:
      return item?.text ? 'text' : 'other';
  }
}

async function ingestInbox(ig, writer) {
  const inbox = ig.feed.directInbox();
  const threads = await inbox.items();
  let n = 0;
  for (const thread of threads) {
    const nativeId = String(thread.thread_id);
    const title = thread.thread_title || thread.users?.map((u) => u.username).join(', ') || nativeId;
    const threadType = thread.users && thread.users.length > 1 ? 'group' : 'dm';
    const items = thread.items || [];
    for (const item of items) {
      const senderPk = String(item.user_id ?? thread.viewer_id ?? '');
      const me = String(ig.state.cookieUserId || thread.viewer_id || '');
      const outbound = senderPk !== '' && senderPk === me;
      const sender = thread.users?.find((u) => String(u.pk) === senderPk);
      writer.upsertMessage({
        source: SOURCE,
        nativeId: String(item.item_id),
        conversationNativeId: nativeId,
        senderNativeId: senderPk || nativeId,
        senderDisplayName: outbound ? 'me' : sender?.username || sender?.full_name || null,
        senderHandle: sender?.username || null,
        direction: outbound ? 'outbound' : 'inbound',
        sentAt: item.timestamp ? Math.floor(Number(item.timestamp) / 1000) : Date.now(),
        messageType: itemType(item),
        body: itemBody(item),
        conversationTitle: title,
        threadType,
        raw: { item_type: item.item_type },
      });
      n += 1;
    }
  }
  return { threads: threads.length, messages: n };
}

async function restore(ig) {
  const saved = loadSession();
  if (!saved) {
    throw new Error('missing_session');
  }
  await ig.state.deserialize(saved);
}

async function start() {
  const db = migrate(DEFAULT_DB_PATH);
  const writer = new MessageWriter(db);
  const ig = new IgApiClient();
  const username = process.env.INSTAGRAM_USERNAME || 'local';
  ig.state.generateDevice(username);

  try {
    await restore(ig);
  } catch {
    logEvent('instagram', 'needs_session', { path: 'sessions/instagram/session.json' });
    await new Promise(() => {});
    return;
  }

  logEvent('instagram', 'started');
  let backoff = POLL_MS;
  for (;;) {
    try {
      const stats = await ingestInbox(ig, writer);
      saveSession(ig);
      logEvent('instagram', 'poll', stats);
      backoff = POLL_MS;
    } catch (err) {
      if (err instanceof IgCheckpointError || err?.name === 'IgCheckpointError') {
        backoff = Math.min(MAX_BACKOFF_MS, Math.max(backoff * 2, 60_000));
        logEvent('instagram', 'checkpoint', { backoffMs: backoff });
      } else if (err instanceof IgLoginRequiredError || err?.name === 'IgLoginRequiredError') {
        logEvent('instagram', 'login_required');
        backoff = MAX_BACKOFF_MS;
      } else {
        logEvent('instagram', 'poll_error', { name: err?.name });
        backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
      }
    }
    await new Promise((r) => setTimeout(r, jitter(backoff)));
  }
}

start().catch((err) => {
  logEvent('instagram', 'fatal', { name: err?.name });
  process.exit(1);
});
