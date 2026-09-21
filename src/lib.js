const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

export function parseIdList(value = '') {
  return new Set(String(value).split(',').map(v => v.trim()).filter(Boolean));
}

export function isAdmin(userId, env) {
  return parseIdList(env.ADMIN_IDS).has(String(userId));
}

export function isAllowed(userId, env) {
  const admins = parseIdList(env.ADMIN_IDS);
  const staff = parseIdList(env.ALLOWED_IDS);
  return admins.has(String(userId)) || staff.has(String(userId));
}

export function moscowDayRange(now = new Date()) {
  const shifted = new Date(now.getTime() + MOSCOW_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  const start = new Date(Date.UTC(y, m, d) - MOSCOW_OFFSET_MS);
  const end = new Date(Date.UTC(y, m, d + 1) - MOSCOW_OFFSET_MS);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function formatMoney(value) {
  return `${new Intl.NumberFormat('ru-RU').format(Number(value || 0))} ₽`;
}

export function formatMoscowDateTime(value = new Date()) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value)).replace(',', ' •');
}

export function formatBanquetDate(date, time = '') {
  if (!date) return '—';
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}${time ? ` • ${time}` : ''}`;
}

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

export function normalizePhone(value = '') {
  const digits = String(value).replace(/\D/g, '');
  if (digits.length === 11 && (digits[0] === '8' || digits[0] === '7')) return `+7${digits.slice(1)}`;
  if (digits.length === 10) return `+7${digits}`;
  return String(value).trim();
}

export function validateAdvanceInput(body) {
  const amount = Math.round(Number(body.amount));
  if (!String(body.client_name || '').trim()) throw new Error('Укажите имя клиента');
  if (!String(body.phone || '').trim()) throw new Error('Укажите телефон');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Укажите корректную сумму аванса');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.banquet_date || ''))) throw new Error('Укажите дату банкета');
  if (body.banquet_time && !/^\d{2}:\d{2}$/.test(String(body.banquet_time))) throw new Error('Некорректное время банкета');
  return {
    client_name: String(body.client_name).trim(),
    phone: normalizePhone(body.phone),
    amount,
    banquet_date: String(body.banquet_date),
    banquet_time: String(body.banquet_time || '').trim(),
    comment: String(body.comment || '').trim(),
  };
}
