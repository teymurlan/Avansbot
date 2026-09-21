import { telegramWebhook } from './telegram.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'avansbot', mode: 'demo-no-db', telegram: Boolean(env.TELEGRAM_BOT_TOKEN) });
    }

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      return telegramWebhook(request, env, ctx);
    }

    if (url.pathname === '/telegram/setup' && request.method === 'GET') {
      return setupTelegramWebhook(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};

async function setupTelegramWebhook(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return json({ ok: false, error: 'TELEGRAM_BOT_TOKEN не настроен в Cloudflare' }, 500);
  }

  const origin = new URL(request.url).origin;
  const payload = {
    url: `${origin}/telegram/webhook`,
    allowed_updates: ['message'],
    drop_pending_updates: false
  };
  if (env.WEBHOOK_SECRET) payload.secret_token = env.WEBHOOK_SECRET;

  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));

  return json({
    ok: Boolean(response.ok && data.ok),
    telegram: data,
    webhook: payload.url
  }, response.ok && data.ok ? 200 : 502);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
