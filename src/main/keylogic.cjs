'use strict';
// Pure helpers for API key handling (no Electron imports, so they can be unit tested).

const REGISTER_URL = 'https://physiology.presagetech.com/auth/register';
const ALLOWED_HOST = 'physiology.presagetech.com';

// Precedence: key entered this session, then saved key, then PRESAGE_API_KEY from .env, then simulation.
function resolveKey({ session, saved, env } = {}) {
  const clean = (k) => (typeof k === 'string' ? k.trim() : '');
  if (clean(session)) return { key: clean(session), source: 'session' };
  if (clean(saved)) return { key: clean(saved), source: 'saved' };
  if (clean(env)) return { key: clean(env), source: 'env' };
  return { key: '', source: 'none' };
}

// Never reveals more than the last 4 characters, and nothing at all for short keys.
function maskKey(key) {
  const k = typeof key === 'string' ? key.trim() : '';
  if (!k) return '';
  if (k.length < 12) return '••••';
  return '••••' + k.slice(-4);
}

function validateKey(key) {
  if (typeof key !== 'string') return { ok: false, reason: 'Key must be text.' };
  const k = key.trim();
  if (k.length < 8) return { ok: false, reason: 'That key looks too short.' };
  if (k.length > 256) return { ok: false, reason: 'That key looks too long.' };
  if (/\s/.test(k)) return { ok: false, reason: 'Keys do not contain spaces.' };
  return { ok: true, key: k };
}

function statusLine(source) {
  switch (source) {
    case 'session': return 'Using key entered this session';
    case 'saved': return 'Using saved key';
    case 'env': return 'Using the configured key';
    default: return 'No key: simulation only';
  }
}

// Only the Presage registration page over https may be opened externally.
function isAllowedExternal(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === ALLOWED_HOST && !u.username && !u.password && (u.port === '' || u.port === '443');
  } catch { return false; }
}

module.exports = { resolveKey, maskKey, validateKey, statusLine, isAllowedExternal, REGISTER_URL, ALLOWED_HOST };
