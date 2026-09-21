import { moscowDayRange, normalizePhone } from './lib.js';

const EDITABLE_FIELDS = ['client_name', 'phone', 'banquet_date', 'banquet_time', 'comment'];

export async function createBanquetWithAdvance(env, actor, input) {
  const now = new Date().toISOString();
  const row = await env.DB.prepare(`INSERT INTO banquets (
    client_name,phone,banquet_date,banquet_time,comment,created_at,created_by_id,created_by_name,updated_at,updated_by_id,updated_by_name
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(
    input.client_name,input.phone,input.banquet_date,input.banquet_time,input.comment,
    now,String(actor.id),actor.name,now,String(actor.id),actor.name
  ).run();
  const banquetId = Number(row.meta.last_row_id);
  await audit(env, 'banquet', banquetId, 'created', null, null, null, actor, now);
  const advance = await insertAdvance(env, actor, banquetId, input.amount, now);
  return { banquet: await getBanquetDetail(env, banquetId), advance };
}

export async function addAdvance(env, actor, banquetId, amount) {
  const exists = await env.DB.prepare('SELECT id FROM banquets WHERE id=?').bind(banquetId).first();
  if (!exists) return null;
  const advance = await insertAdvance(env, actor, banquetId, amount, new Date().toISOString());
  return { banquet: await getBanquetDetail(env, banquetId), advance };
}

async function insertAdvance(env, actor, banquetId, amount, now) {
  const row = await env.DB.prepare(`INSERT INTO advances (banquet_id,amount,received_at,created_by_id,created_by_name) VALUES (?,?,?,?,?)`)
    .bind(banquetId, amount, now, String(actor.id), actor.name).run();
  const id = Number(row.meta.last_row_id);
  await audit(env, 'advance', id, 'created', 'amount', null, String(amount), actor, now);
  return env.DB.prepare('SELECT * FROM advances WHERE id=?').bind(id).first();
}

export async function updateBanquet(env, actor, id, body) {
  const current = await env.DB.prepare('SELECT * FROM banquets WHERE id=?').bind(id).first();
  if (!current) return null;
  const next = { ...current }, changes = [];
  for (const field of EDITABLE_FIELDS) {
    if (!(field in body)) continue;
    let value = String(body[field] ?? '').trim();
    if (field === 'phone') value = normalizePhone(value);
    if (field === 'client_name' && !value) throw new Error('Имя не может быть пустым');
    if (field === 'phone' && !value) throw new Error('Телефон не может быть пустым');
    if (field === 'banquet_date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Некорректная дата банкета');
    if (field === 'banquet_time' && value && !/^\d{2}:\d{2}$/.test(value)) throw new Error('Некорректное время банкета');
    if (String(current[field] ?? '') !== value) {
      changes.push({ field, old_value: String(current[field] ?? ''), new_value: value });
      next[field] = value;
    }
  }
  if (!changes.length) return { banquet: await getBanquetDetail(env,id), changes };
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE banquets SET client_name=?,phone=?,banquet_date=?,banquet_time=?,comment=?,updated_at=?,updated_by_id=?,updated_by_name=? WHERE id=?`)
    .bind(next.client_name,next.phone,next.banquet_date,next.banquet_time,next.comment,now,String(actor.id),actor.name,id).run();
  for (const c of changes) await audit(env,'banquet',id,'updated',c.field,c.old_value,c.new_value,actor,now);
  return { banquet: await getBanquetDetail(env,id), changes };
}

async function audit(env,type,id,action,field,oldValue,newValue,actor,createdAt) {
  await env.DB.prepare(`INSERT INTO audit_log (entity_type,entity_id,action,field_name,old_value,new_value,actor_id,actor_name,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(type,id,action,field,oldValue,newValue,String(actor.id),actor.name,createdAt).run();
}

export async function getBanquetDetail(env, id) {
  const banquet = await env.DB.prepare(`SELECT b.*,COALESCE(SUM(a.amount),0) total_advance,COUNT(a.id) advance_count
    FROM banquets b LEFT JOIN advances a ON a.banquet_id=b.id WHERE b.id=? GROUP BY b.id`).bind(id).first();
  if (!banquet) return null;
  const rows = await env.DB.prepare('SELECT * FROM advances WHERE banquet_id=? ORDER BY received_at DESC').bind(id).all();
  return { ...banquet, advances: rows.results || [] };
}

export async function getUpcoming(env) {
  const today = moscowDateISO();
  const rows = await env.DB.prepare(`SELECT b.*,COALESCE(SUM(a.amount),0) total_advance,COUNT(a.id) advance_count
    FROM banquets b LEFT JOIN advances a ON a.banquet_id=b.id WHERE b.banquet_date>=? GROUP BY b.id
    ORDER BY b.banquet_date,CASE WHEN b.banquet_time='' THEN '99:99' ELSE b.banquet_time END LIMIT 60`).bind(today).all();
  return rows.results || [];
}

export async function getStats(env) {
  const { start, end } = moscowDayRange();
  const today = await env.DB.prepare('SELECT COALESCE(SUM(amount),0) amount,COUNT(*) count FROM advances WHERE received_at>=? AND received_at<?').bind(start,end).first();
  const total = await env.DB.prepare('SELECT COALESCE(SUM(amount),0) amount,COUNT(*) count FROM advances').first();
  return { today_amount:Number(today?.amount||0), today_count:Number(today?.count||0), total_amount:Number(total?.amount||0), total_count:Number(total?.count||0) };
}

export async function getAudit(env) {
  const rows = await env.DB.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200').all();
  return rows.results || [];
}

function moscowDateISO(date=new Date()) {
  const p = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const m = Object.fromEntries(p.map(x=>[x.type,x.value]));
  return `${m.year}-${m.month}-${m.day}`;
}
