import { escapeHtml, formatBanquetDate, formatMoney, formatMoscowDateTime, isAllowed, parseIdList } from './lib.js';
import { getStats } from './db.js';

const LABEL={client_name:'Имя',phone:'Телефон',banquet_date:'Дата банкета',banquet_time:'Время банкета',comment:'Комментарий'};

export async function telegramWebhook(request, env, ctx) {
  if (env.WEBHOOK_SECRET && request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('Forbidden',{status:403});
  const update = await request.json().catch(()=>({}));
  const message = update.message;
  if (!message?.chat?.id) return new Response('OK');
  const text=String(message.text||'').trim(), userId=String(message.from?.id||message.chat.id), chatId=String(message.chat.id);
  if (/^\/id(?:@\w+)?$/i.test(text)) {
    ctx.waitUntil(sendTelegram(env,chatId,`🆔 Ваш Telegram ID: <code>${escapeHtml(userId)}</code>`));
    return new Response('OK');
  }
  if (/^\/start(?:@\w+)?/i.test(text)) {
    if (!isAllowed(userId,env)) {
      ctx.waitUntil(sendTelegram(env,chatId,`🔥 <b>Mangal City — Авансы</b>\n\nВаш ID: <code>${escapeHtml(userId)}</code>\nПередайте его администратору для доступа.`));
      return new Response('OK');
    }
    const appUrl=env.WEBAPP_URL||new URL(request.url).origin;
    ctx.waitUntil(sendTelegram(env,chatId,'🔥 <b>Mangal City — Авансы банкетов</b>\n\nОткройте приложение, чтобы внести или проверить предоплаты.',{inline_keyboard:[[{text:'Открыть приложение',web_app:{url:appUrl}}]]}));
  }
  return new Response('OK');
}

export async function notifyNewAdvance(env,actor,banquet,advance) {
  if(!advance)return;
  const text=[
    '🔥 <b>Mangal City — новая предоплата</b>','',
    `👤 ${escapeHtml(banquet.client_name)}`,`📞 ${escapeHtml(banquet.phone)}`,
    `💰 <b>${escapeHtml(formatMoney(advance.amount))}</b>`,
    `📅 Банкет: ${escapeHtml(formatBanquetDate(banquet.banquet_date,banquet.banquet_time))}`,
    `👨‍💼 Внёс: ${escapeHtml(actor.name)}`,`🕐 Получено: ${escapeHtml(formatMoscowDateTime(advance.received_at))}`,
    banquet.comment?`💬 ${escapeHtml(banquet.comment)}`:null,'',`Σ По этому банкету: <b>${escapeHtml(formatMoney(banquet.total_advance))}</b>`
  ].filter(Boolean).join('\n');
  await notifyAdmins(env,text);
}

export async function notifyBanquetChanges(env,actor,banquet,changes) {
  const lines=changes.map(c=>`• ${LABEL[c.field]||c.field}: ${escapeHtml(c.old_value||'—')} → <b>${escapeHtml(c.new_value||'—')}</b>`);
  await notifyAdmins(env,[
    '✏️ <b>Mangal City — запись изменена</b>','',`👤 ${escapeHtml(banquet.client_name)}`,
    `📅 ${escapeHtml(formatBanquetDate(banquet.banquet_date,banquet.banquet_time))}`,...lines,'',
    `👨‍💼 Изменил: ${escapeHtml(actor.name)}`,`🕐 ${escapeHtml(formatMoscowDateTime())}`
  ].join('\n'));
}

export async function sendDailySummary(env) {
  const s=await getStats(env);
  const date=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date());
  const lines=[`📊 <b>Итоги дня — ${escapeHtml(date)}</b>`,'',`💰 Получено сегодня: <b>${escapeHtml(formatMoney(s.today_amount))}</b>`,`🧾 Предоплат сегодня: <b>${s.today_count}</b>`];
  if(s.today_count===0)lines.push('Сегодня новых предоплат не было.');
  lines.push('',`💰 Общий итог получено: <b>${escapeHtml(formatMoney(s.total_amount))}</b>`,`🧾 Всего предоплат на сегодняшний день: <b>${s.total_count}</b>`);
  await notifyAdmins(env,lines.join('\n'));
}

async function notifyAdmins(env,text){await Promise.all([...parseIdList(env.ADMIN_IDS)].map(id=>sendTelegram(env,id,text)));}
async function sendTelegram(env,chatId,text,replyMarkup){
  if(!env.TELEGRAM_BOT_TOKEN)return console.warn('TELEGRAM_BOT_TOKEN is not configured');
  const payload={chat_id:chatId,text,parse_mode:'HTML',disable_web_page_preview:true}; if(replyMarkup)payload.reply_markup=replyMarkup;
  const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  if(!r.ok)console.error('Telegram sendMessage failed',await r.text());
}
