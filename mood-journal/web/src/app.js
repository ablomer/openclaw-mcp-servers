import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { logEvent } from '@openclaw-mood-journal/shared';
import {
  COOKIE,
  createLoginLimiter,
  passwordsMatch,
  readCookie,
  sessionCookie,
  signSession,
  verifySession,
} from './auth.js';
import { createJournal } from './entries.js';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '../public');

function asyncRoute(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function clientStatus(err) {
  if (err?.status) return err.status;
  if (err?.message === 'Unknown entry') return 404;
  if (err?.code) return 500;
  return 400;
}

export function createApp({ db, password }) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('MOOD_JOURNAL_WEB_PASSWORD is required');
  }

  const journal = createJournal(db);
  const limiter = createLoginLimiter();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'");
    next();
  });

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.post('/login', (req, res) => {
    const ip = req.ip || 'unknown';
    if (limiter.isLimited(ip)) {
      logEvent('web', 'login_limited', { status: 429 });
      return res.status(429).json({ error: 'too_many_attempts' });
    }
    const given = req.body?.password;
    if (typeof given !== 'string' || !passwordsMatch(given, password)) {
      limiter.recordFailure(ip);
      logEvent('web', 'login_failed', { status: 401 });
      return res.status(401).json({ error: 'unauthorized' });
    }
    limiter.clear(ip);
    res.setHeader('Set-Cookie', sessionCookie(signSession(password), { secure: req.secure }));
    logEvent('web', 'login', { status: 204 });
    return res.status(204).end();
  });

  app.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', sessionCookie('', { secure: req.secure, clear: true }));
    logEvent('web', 'logout', { status: 204 });
    res.status(204).end();
  });

  app.use('/api', (req, res, next) => {
    const token = readCookie(req.headers.cookie, COOKIE);
    if (!verifySession(token, password)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    next();
  });

  app.get('/api/entries', asyncRoute(async (req, res) => {
    const page = journal.list({
      from: req.query.from,
      to: req.query.to,
      before: req.query.before,
      q: req.query.q,
    });
    res.json(page);
  }));

  app.post('/api/entries', asyncRoute(async (req, res) => {
    const entry = journal.create(req.body);
    res.status(201).json({ entry });
  }));

  app.get('/api/entries/:id', asyncRoute(async (req, res) => {
    const entry = journal.get(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Unknown entry' });
    res.json({ entry });
  }));

  app.patch('/api/entries/:id', asyncRoute(async (req, res) => {
    const entry = journal.update(req.params.id, req.body);
    res.json({ entry });
  }));

  app.delete('/api/entries/:id', asyncRoute(async (req, res) => {
    res.json(journal.remove(req.params.id));
  }));

  app.get('/api/tags', asyncRoute(async (_req, res) => {
    res.json({ tags: journal.tags() });
  }));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.use(express.static(publicDir));

  app.use((err, _req, res, _next) => {
    if (res.headersSent) return;
    const status = clientStatus(err);
    if (status >= 500) logEvent('web', 'request_error', { status, name: err?.name });
    res.status(status).json({ error: status >= 500 ? 'request_failed' : err.message || 'request failed' });
  });

  return app;
}
