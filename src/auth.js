import { isAdmin, isAllowed } from './lib.js';

const encoder = new TextEncoder();

export async function requireActor(request, env) {
  const actor = await authenticateWebApp(request, env);
  if (!actor) return { error: 'Откройте приложение из Telegram', status: 401 };
  if (!isAllowed(actor.id, env)) return { error: 'Нет доступа. Отправьте администратору команду /id.', status: 403 };
  return { actor: { ...actor, role: isAdmin(actor.id, env) ? 'admin' : 'staff' } };
}

async function authenticateWebApp(request, env) {
  if (env.DEV_AUTH_ID) return { id: String(env.DEV_AUTH_ID), name: env.DEV_AUTH_NAME || 'Dev User' };
  const initData = request.headers.get('X-Telegram-Init-Data');
  if (!initData || !env.TELEGRAM_BOT_TOKEN) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const authDate = Number(params.get('auth_date') || 0);
  const maxAge = Number(env.INIT_DATA_MAX_AGE_SECONDS || 86400);
  if (!authDate || Math.abs(Date.now() / 1000 - authDate) > maxAge) return null;

  const check = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = await hmac('WebAppData', env.TELEGRAM_BOT_TOKEN, true);
  const signature = await hmac(secret, check, false);
  if (signature !== hash.toLowerCase()) return null;

  try {
    const user = JSON.parse(params.get('user') || '{}');
    if (!user.id) return null;
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || String(user.id);
    return { id: String(user.id), name, username: user.username || '' };
  } catch {
    return null;
  }
}

async function hmac(key, data, bytes) {
  const raw = typeof key === 'string' ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const result = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  if (bytes) return new Uint8Array(result);
  return [...new Uint8Array(result)].map(b => b.toString(16).padStart(2, '0')).join('');
}
