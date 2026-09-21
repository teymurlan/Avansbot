const EMPTY_DB = () => ({ version: 2, seq: 0, banquets: [], audit: [] });

export class AvansStore {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.lock = Promise.resolve();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const method = request.method;

    try {
      if (url.pathname === '/bootstrap' && method === 'GET') {
        const db = await this.read();
        return json(buildBootstrap(db));
      }

      if (url.pathname === '/audit' && method === 'GET') {
        const db = await this.read();
        return json({ items: db.audit.slice(0, 300) });
      }

      if (url.pathname === '/stats' && method === 'GET') {
        const db = await this.read();
        return json(stats(db));
      }

      if (url.pathname === '/create' && method === 'POST') {
        const payload = await request.json();
        return json(await this.withLock(async () => {
          const db = await this.read();
          const now = new Date().toISOString();
          const banquet = {
            id: nextId(db),
            client_name: payload.input.client_name,
            phone: payload.input.phone,
            banquet_date: payload.input.banquet_date,
            banquet_time: payload.input.banquet_time || '',
            comment: payload.input.comment || '',
            created_at: now,
            created_by_id: String(payload.actor.id),
            created_by_name: payload.actor.name,
            updated_at: now,
            updated_by_id: String(payload.actor.id),
            updated_by_name: payload.actor.name,
            advances: []
          };
          const advance = makeAdvance(db, payload.actor, payload.input.amount, now);
          banquet.advances.push(advance);
          db.banquets.push(banquet);
          addAudit(db, payload.actor, 'banquet', banquet.id, 'created', null, null, null, now);
          addAudit(db, payload.actor, 'advance', advance.id, 'created', 'amount', null, String(advance.amount), now);
          await this.write(db);
          return { banquet: banquetView(banquet), advance };
        }));
      }

      const banquetMatch = url.pathname.match(/^\/banquets\/(\d+)$/);
      if (banquetMatch && method === 'GET') {
        const db = await this.read();
        const banquet = db.banquets.find(b => b.id === Number(banquetMatch[1]));
        return banquet ? json({ banquet: banquetView(banquet) }) : json({ error: 'Банкет не найден' }, 404);
      }

      if (banquetMatch && method === 'PATCH') {
        const payload = await request.json();
        return json(await this.withLock(async () => {
          const db = await this.read();
          const banquet = db.banquets.find(b => b.id === Number(banquetMatch[1]));
          if (!banquet) return { error: 'Банкет не найден', status: 404 };
          const fields = ['client_name','phone','banquet_date','banquet_time','comment'];
          const changes = [];
          const now = new Date().toISOString();

          for (const field of fields) {
            if (!(field in payload.patch)) continue;
            const oldValue = String(banquet[field] ?? '');
            const newValue = String(payload.patch[field] ?? '').trim();
            if (oldValue === newValue) continue;
            banquet[field] = newValue;
            changes.push({ field, old_value: oldValue, new_value: newValue });
            addAudit(db, payload.actor, 'banquet', banquet.id, 'updated', field, oldValue, newValue, now);
          }

          if (changes.length) {
            banquet.updated_at = now;
            banquet.updated_by_id = String(payload.actor.id);
            banquet.updated_by_name = payload.actor.name;
            await this.write(db);
          }
          return { banquet: banquetView(banquet), changes };
        }));
      }

      const advanceMatch = url.pathname.match(/^\/banquets\/(\d+)\/advances$/);
      if (advanceMatch && method === 'POST') {
        const payload = await request.json();
        return json(await this.withLock(async () => {
          const db = await this.read();
          const banquet = db.banquets.find(b => b.id === Number(advanceMatch[1]));
          if (!banquet) return { error: 'Банкет не найден', status: 404 };
          const advance = makeAdvance(db, payload.actor, payload.amount, new Date().toISOString());
          banquet.advances.push(advance);
          banquet.updated_at = advance.received_at;
          banquet.updated_by_id = String(payload.actor.id);
          banquet.updated_by_name = payload.actor.name;
          addAudit(db, payload.actor, 'advance', advance.id, 'created', 'amount', null, String(advance.amount), advance.received_at);
          await this.write(db);
          return { banquet: banquetView(banquet), advance };
        }));
      }

      const cashboxMatch = url.pathname.match(/^\/advances\/(\d+)\/cashbox$/);
      if (cashboxMatch && method === 'POST') {
        const payload = await request.json();
        return json(await this.withLock(async () => {
          const db = await this.read();
          let banquet = null, advance = null;
          for (const b of db.banquets) {
            const a = (b.advances || []).find(x => x.id === Number(cashboxMatch[1]));
            if (a) { banquet = b; advance = a; break; }
          }
          if (!advance) return { error: 'Аванс не найден', status: 404 };

          const now = new Date().toISOString();
          const oldValue = advance.cashbox_done ? 'Сдано в кассу' : 'Не сдано';
          advance.cashbox_done = !advance.cashbox_done;
          advance.cashbox_marked_at = advance.cashbox_done ? now : null;
          advance.cashbox_marked_by_id = advance.cashbox_done ? String(payload.actor.id) : null;
          advance.cashbox_marked_by_name = advance.cashbox_done ? payload.actor.name : null;
          addAudit(db, payload.actor, 'advance', advance.id, 'cashbox', 'cashbox_status', oldValue, advance.cashbox_done ? 'Сдано в кассу' : 'Не сдано', now);
          await this.write(db);
          return { banquet: banquetView(banquet), advance };
        }));
      }

      if (url.pathname === '/import' && method === 'POST') {
        const payload = await request.json();
        return json(await this.withLock(async () => {
          const db = await this.read();
          const incoming = Array.isArray(payload.banquets) ? payload.banquets.slice(0, 200) : [];
          let imported = 0, skipped = 0;
          for (const source of incoming) {
            const duplicate = db.banquets.some(b =>
              b.phone === source.phone &&
              b.banquet_date === source.banquet_date &&
              Math.abs(totalAdvance(b) - totalAdvance(source)) < 1
            );
            if (duplicate) { skipped++; continue; }
            const now = new Date().toISOString();
            const banquet = {
              id: nextId(db),
              client_name: String(source.client_name || '').trim(),
              phone: String(source.phone || '').trim(),
              banquet_date: String(source.banquet_date || ''),
              banquet_time: String(source.banquet_time || ''),
              comment: String(source.comment || ''),
              created_at: source.created_at || now,
              created_by_id: String(payload.actor.id),
              created_by_name: payload.actor.name,
              updated_at: now,
              updated_by_id: String(payload.actor.id),
              updated_by_name: payload.actor.name,
              advances: []
            };
            for (const old of (source.advances || []).slice(0, 30)) {
              const a = makeAdvance(db, payload.actor, Number(old.amount || 0), old.received_at || now);
              a.cashbox_done = Boolean(old.cashbox_done);
              a.cashbox_marked_at = old.cashbox_marked_at || null;
              a.cashbox_marked_by_name = old.cashbox_marked_by || null;
              banquet.advances.push(a);
            }
            if (!banquet.client_name || !banquet.phone || !/^\d{4}-\d{2}-\d{2}$/.test(banquet.banquet_date) || !banquet.advances.length) {
              skipped++; continue;
            }
            db.banquets.push(banquet);
            addAudit(db, payload.actor, 'banquet', banquet.id, 'imported', null, null, null, now);
            imported++;
          }
          if (imported) await this.write(db);
          return { imported, skipped };
        }));
      }

      return json({ error: 'Маршрут хранилища не найден' }, 404);
    } catch (e) {
      console.error('Store error', e);
      return json({ error: e?.message || 'Ошибка общего хранилища' }, 500);
    }
  }

  async read() {
    const db = await this.ctx.storage.get('db');
    return db && Array.isArray(db.banquets) ? db : EMPTY_DB();
  }

  async write(db) {
    await this.ctx.storage.put('db', db);
  }

  async withLock(fn) {
    let release;
    const previous = this.lock;
    this.lock = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await fn(); }
    finally { release(); }
  }
}

function makeAdvance(db, actor, amount, receivedAt) {
  return {
    id: nextId(db),
    amount: Math.round(Number(amount)),
    received_at: receivedAt,
    created_by_id: String(actor.id),
    created_by_name: actor.name,
    cashbox_done: false,
    cashbox_marked_at: null,
    cashbox_marked_by_id: null,
    cashbox_marked_by_name: null
  };
}

function nextId(db) { db.seq = Number(db.seq || 0) + 1; return db.seq; }

function addAudit(db, actor, entityType, entityId, action, fieldName, oldValue, newValue, createdAt) {
  db.audit.unshift({
    id: nextId(db), entity_type: entityType, entity_id: entityId, action,
    field_name: fieldName, old_value: oldValue, new_value: newValue,
    actor_id: String(actor.id), actor_name: actor.name, created_at: createdAt
  });
  if (db.audit.length > 1000) db.audit.length = 1000;
}

function totalAdvance(b) {
  return (b.advances || []).reduce((sum, a) => sum + Number(a.amount || 0), 0);
}

function banquetView(b) {
  return {
    ...b,
    total_advance: totalAdvance(b),
    advance_count: (b.advances || []).length
  };
}

function buildBootstrap(db) {
  const today = moscowDate();
  const all = db.banquets.map(banquetView);
  const upcoming = all.filter(b => b.banquet_date >= today)
    .sort((a,b) => (a.banquet_date + (a.banquet_time || '99:99')).localeCompare(b.banquet_date + (b.banquet_time || '99:99')));
  return { stats: stats(db), upcoming, today_cashbox: cashboxItems(db, today), updated_at: new Date().toISOString() };
}

function stats(db) {
  const now = new Date();
  const { start, end } = moscowDayRange(now);
  const allAdvances = db.banquets.flatMap(b => b.advances || []);
  const receivedToday = allAdvances.filter(a => {
    const t = new Date(a.received_at).getTime();
    return t >= start && t < end;
  });
  const today = moscowDate(now);
  const todayCashbox = cashboxItems(db, today);
  const pending = todayCashbox.filter(x => !x.cashbox_done);
  return {
    today_amount: receivedToday.reduce((s,a)=>s + Number(a.amount || 0),0),
    today_count: receivedToday.length,
    total_amount: allAdvances.reduce((s,a)=>s + Number(a.amount || 0),0),
    total_count: allAdvances.length,
    banquet_count: db.banquets.length,
    cashbox_amount: pending.reduce((s,a)=>s + Number(a.amount || 0),0),
    cashbox_count: pending.length,
    cashbox_done_count: todayCashbox.length - pending.length,
    today_banquet_count: db.banquets.filter(b => b.banquet_date === today).length
  };
}

function cashboxItems(db, date) {
  return db.banquets
    .filter(b => b.banquet_date === date)
    .flatMap(b => (b.advances || []).map(a => ({
      ...a,
      banquet_id: b.id,
      client_name: b.client_name,
      phone: b.phone,
      banquet_time: b.banquet_time,
      comment: b.comment
    })))
    .sort((a,b) => Number(a.cashbox_done) - Number(b.cashbox_done) || String(a.banquet_time || '99:99').localeCompare(String(b.banquet_time || '99:99')));
}

function moscowDate(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone:'Europe/Moscow', year:'numeric', month:'2-digit', day:'2-digit'
  }).formatToParts(date).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function moscowDayRange(now = new Date()) {
  const date = moscowDate(now);
  const start = Date.parse(`${date}T00:00:00+03:00`);
  return { start, end: start + 86400000 };
}

function json(data, status = 200) {
  if (data?.status) { status = data.status; delete data.status; }
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' }
  });
}
