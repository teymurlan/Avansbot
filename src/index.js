import { requireActor } from './auth.js';
import { isAdmin, normalizePhone, validateAdvanceInput } from './lib.js';
import { storeCall } from './store-client.js';
import { AvansStore } from './store.js';
import {
  notifyBanquetChanges,
  notifyCashboxChange,
  notifyNewAdvance,
  sendDailySummary,
  telegramWebhook
} from './telegram.js';

export { AvansStore };

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      if (url.pathname === '/health') {
        const store = await storeCall(env, '/stats').catch(() => null);
        return json({
          ok: true,
          service: 'avansbot',
          mode: 'shared-store',
          telegram: Boolean(env.TELEGRAM_BOT_TOKEN),
          shared_store: Boolean(store)
        });
      }

      if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
        return telegramWebhook(request, env, ctx);
      }

      if (url.pathname === '/telegram/setup' && request.method === 'GET') {
        return setupTelegramWebhook(request, env);
      }

      if (url.pathname.startsWith('/api/')) {
        return api(request, env, url, ctx);
      }

      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error(e);
      return json({ ok: false, error: e?.message || 'Внутренняя ошибка' }, 500);
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(sendDailySummary(env));
  }
};

async function api(request, env, url, ctx) {
  const auth = await requireActor(request, env);
  if (auth.error) return json({ ok:false, error:auth.error }, auth.status);
  const actor = auth.actor;

  if (url.pathname === '/api/bootstrap' && request.method === 'GET') {
    const data = await storeCall(env, '/bootstrap');
    return json({ ok:true, actor, ...data });
  }

  if (url.pathname === '/api/advances' && request.method === 'POST') {
    const input = validateAdvanceInput(await body(request));
    const result = await storeCall(env, '/create', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({ actor, input })
    });
    ctx.waitUntil(notifyNewAdvance(env, actor, result.banquet, result.advance));
    return json({ ok:true, ...result }, 201);
  }

  const banquet = url.pathname.match(/^\/api\/banquets\/(\d+)$/);
  if (banquet && request.method === 'GET') {
    const result = await storeCall(env, `/banquets/${banquet[1]}`);
    return json({ ok:true, ...result });
  }

  if (banquet && request.method === 'PATCH') {
    const raw = await body(request);
    const patch = {};

    if ('client_name' in raw) {
      const value = String(raw.client_name || '').trim();
      if (!value) return json({ ok:false, error:'Имя не может быть пустым' }, 400);
      patch.client_name = value;
    }
    if ('phone' in raw) {
      const value = normalizePhone(raw.phone);
      if (!value) return json({ ok:false, error:'Телефон не может быть пустым' }, 400);
      patch.phone = value;
    }
    if ('banquet_date' in raw) {
      const value = String(raw.banquet_date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return json({ ok:false, error:'Некорректная дата банкета' }, 400);
      patch.banquet_date = value;
    }
    if ('banquet_time' in raw) {
      const value = String(raw.banquet_time || '').trim();
      if (value && !/^\d{2}:\d{2}$/.test(value)) return json({ ok:false, error:'Некорректное время банкета' }, 400);
      patch.banquet_time = value;
    }
    if ('comment' in raw) patch.comment = String(raw.comment || '').trim();

    const result = await storeCall(env, `/banquets/${banquet[1]}`, {
      method:'PATCH',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({ actor, patch })
    });
    if (result.changes?.length) {
      ctx.waitUntil(notifyBanquetChanges(env, actor, result.banquet, result.changes));
    }
    return json({ ok:true, ...result });
  }

  const addAdvance = url.pathname.match(/^\/api\/banquets\/(\d+)\/advances$/);
  if (addAdvance && request.method === 'POST') {
    const payload = await body(request);
    const amount = Math.round(Number(payload.amount));
    if (!Number.isFinite(amount) || amount <= 0) return json({ ok:false, error:'Укажите корректную сумму аванса' }, 400);

    const result = await storeCall(env, `/banquets/${addAdvance[1]}/advances`, {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({ actor, amount })
    });
    ctx.waitUntil(notifyNewAdvance(env, actor, result.banquet, result.advance));
    return json({ ok:true, ...result }, 201);
  }

  const cashbox = url.pathname.match(/^\/api\/advances\/(\d+)\/cashbox$/);
  if (cashbox && request.method === 'POST') {
    if (!isAdmin(actor.id, env)) return json({ ok:false, error:'Отмечать кассу может только администратор' }, 403);
    const result = await storeCall(env, `/advances/${cashbox[1]}/cashbox`, {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({ actor })
    });
    ctx.waitUntil(notifyCashboxChange(env, actor, result.banquet, result.advance));
    return json({ ok:true, ...result });
  }

  if (url.pathname === '/api/audit' && request.method === 'GET') {
    if (!isAdmin(actor.id, env)) return json({ ok:false, error:'История доступна только администратору' }, 403);
    const result = await storeCall(env, '/audit');
    return json({ ok:true, ...result });
  }

  if (url.pathname === '/api/import-local' && request.method === 'POST') {
    const payload = await body(request);
    const result = await storeCall(env, '/import', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({ actor, banquets:payload.banquets })
    });
    return json({ ok:true, ...result });
  }

  return json({ ok:false, error:'Маршрут не найден' }, 404);
}

async function setupTelegramWebhook(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return json({ ok:false, error:'TELEGRAM_BOT_TOKEN не настроен в Cloudflare' }, 500);
  }

  const origin = new URL(request.url).origin;
  const payload = {
    url: `${origin}/telegram/webhook`,
    allowed_updates:['message'],
    drop_pending_updates:false
  };
  if (env.WEBHOOK_SECRET) payload.secret_token = env.WEBHOOK_SECRET;

  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));

  return json({
    ok:Boolean(response.ok && data.ok),
    telegram:data,
    webhook:payload.url
  }, response.ok && data.ok ? 200 : 502);
}

async function body(request) {
  try { return await request.json(); }
  catch { return {}; }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store'
    }
  });
}
