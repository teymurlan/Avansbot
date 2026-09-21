const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const STORAGE_KEY = 'mangal_city_avansbot_demo_v1';
const state = {
  actor: { id: String(tg?.initDataUnsafe?.user?.id || 'demo'), name: [tg?.initDataUnsafe?.user?.first_name, tg?.initDataUnsafe?.user?.last_name].filter(Boolean).join(' ') || 'Демо администратор', role: 'admin' },
  stats: null, upcoming: [], current: null
};
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmt = n => `${new Intl.NumberFormat('ru-RU').format(Number(n || 0))} ₽`;
const month = d => new Intl.DateTimeFormat('ru-RU',{month:'short'}).format(new Date(`${d}T12:00:00`)).replace('.','');
const day = d => String(Number(d.split('-')[2]));
const dateRu = d => d ? d.split('-').reverse().join('.') : '—';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nowIso = () => new Date().toISOString();

function loadDb() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { banquets: Array.isArray(raw.banquets) ? raw.banquets : [], audit: Array.isArray(raw.audit) ? raw.audit : [], seq: Number(raw.seq || 0) };
  } catch { return { banquets: [], audit: [], seq: 0 }; }
}
function saveDb(db) { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); }
function nextId(db) { db.seq += 1; return db.seq; }
function normalizePhone(value='') {
  const digits = String(value).replace(/\D/g,'');
  if (digits.length === 11 && (digits[0] === '8' || digits[0] === '7')) return '+7' + digits.slice(1);
  if (digits.length === 10) return '+7' + digits;
  return String(value).trim();
}
function totalAdvance(b) { return (b.advances || []).reduce((s,a)=>s+Number(a.amount||0),0); }
function banquetView(b) { return { ...b, total_advance: totalAdvance(b), advance_count:(b.advances||[]).length }; }
function currentStats(db) {
  const range = moscowDayRange(new Date());
  const todayAdv = db.banquets.flatMap(b => b.advances || []).filter(a => {
    const t = new Date(a.received_at).getTime(); return t >= range.start && t < range.end;
  });
  const all = db.banquets.flatMap(b => b.advances || []);
  const banquetToday = todayMoscow();
  const cashbox = db.banquets
    .filter(b => b.banquet_date === banquetToday)
    .flatMap(b => (b.advances || []).filter(a => !a.cashbox_done));
  return {
    today_amount: todayAdv.reduce((s,a)=>s+Number(a.amount||0),0),
    today_count: todayAdv.length,
    total_amount: all.reduce((s,a)=>s+Number(a.amount||0),0),
    total_count: all.length,
    cashbox_amount: cashbox.reduce((s,a)=>s+Number(a.amount||0),0),
    cashbox_count: cashbox.length
  };
}
function moscowDayRange(now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(x=>[x.type,x.value]));
  const start = Date.parse(`${p.year}-${p.month}-${p.day}T00:00:00+03:00`);
  return { start, end:start+86400000 };
}
function todayMoscow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function refreshState() {
  const db = loadDb();
  state.stats = currentStats(db);
  state.upcoming = db.banquets.map(banquetView)
    .filter(b => b.banquet_date >= todayMoscow())
    .sort((a,b)=>(a.banquet_date+a.banquet_time).localeCompare(b.banquet_date+b.banquet_time));
  render();
}
function toast(text) {
  const el = $('#toast'); el.textContent = text; el.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(()=>el.classList.remove('show'),2400);
}
function haptic(type='light'){ try{ tg?.HapticFeedback?.impactOccurred(type); }catch{} }
function switchTab(tab) {
  $$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${tab}`));
  $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  if (tab==='history') loadHistory();
  if (tab==='calendar') renderCalendar();
  window.scrollTo({top:0,behavior:'smooth'});
}
function card(b) {
  return `<button class="banquet-card" data-banquet="${b.id}">
    <div class="date-badge"><strong>${day(b.banquet_date)}</strong><small>${esc(month(b.banquet_date))}</small></div>
    <div class="card-main"><strong>${esc(b.client_name)}</strong><span>${esc(b.banquet_time || 'Время не указано')} · ${esc(b.phone)}</span></div>
    <div class="amount">${fmt(b.total_advance)}<small>${b.advance_count} ав.</small></div>
  </button>`;
}
function bindCards(root=document){ root.querySelectorAll('[data-banquet]').forEach(el=>el.onclick=()=>openDetail(Number(el.dataset.banquet))); }
function render() {
  const s = state.stats || {};
  $('#cashboxAmount').textContent = fmt(s.cashbox_amount);
  $('#cashboxCount').textContent = s.cashbox_count || 0;
  $('#todayAmount').textContent = fmt(s.today_amount);
  $('#todayCountLabel').textContent = `${s.today_count || 0} предоплат`;
  $('#totalAmount').textContent = fmt(s.total_amount);
  $('#totalCountLabel').textContent = `${s.total_count || 0} предоплат`;
  $('#userPill').textContent = state.actor.name;
  renderCashbox();
  const near = state.upcoming.slice(0,5);
  $('#nearestList').innerHTML = near.length ? near.map(card).join('') : '<div class="empty">Ближайших банкетов пока нет</div>';
  bindCards($('#nearestList')); renderCalendar();
  $('#historyNav').style.display = '';
  $('#bottomNav').classList.remove('staff');
}

function renderCashbox() {
  const db = loadDb();
  const items = db.banquets
    .filter(b => b.banquet_date === todayMoscow())
    .flatMap(b => (b.advances || []).map(a => ({
      ...a,
      banquet_id:b.id,
      client_name:b.client_name,
      banquet_time:b.banquet_time
    })))
    .sort((a,b) => Number(a.cashbox_done) - Number(b.cashbox_done) || String(a.banquet_time||'99:99').localeCompare(String(b.banquet_time||'99:99')));

  $('#cashboxList').innerHTML = items.length ? items.map(a => `
    <div class="cashbox-row ${a.cashbox_done ? 'done' : ''}">
      <div class="cashbox-main">
        <div class="cashbox-name">${esc(a.client_name)}</div>
        <div class="cashbox-meta">${esc(a.banquet_time || 'Время не указано')} · ${a.cashbox_done ? 'Сдано в кассу' : 'Нужно сдать в кассу'}</div>
      </div>
      <div class="cashbox-actions">
        <div class="cashbox-sum">${fmt(a.amount)}</div>
        <button class="cashbox-check" data-cashbox-id="${a.id}" aria-label="${a.cashbox_done ? 'Вернуть в кассу' : 'Отметить сданным'}">${a.cashbox_done ? '✓' : '○'}</button>
      </div>
    </div>
  `).join('') : '<div class="empty">На сегодня авансов по банкетам нет</div>';

  $('#cashboxList').querySelectorAll('[data-cashbox-id]').forEach(btn => {
    btn.onclick = () => toggleCashbox(Number(btn.dataset.cashboxId));
  });
}

function toggleCashbox(advanceId) {
  const db = loadDb();
  let found = null;
  for (const b of db.banquets) {
    const a = (b.advances || []).find(x => x.id === advanceId);
    if (a) { found = a; break; }
  }
  if (!found) return;
  const oldValue = found.cashbox_done ? 'Сдано в кассу' : 'Не сдано';
  found.cashbox_done = !found.cashbox_done;
  found.cashbox_marked_at = found.cashbox_done ? nowIso() : null;
  found.cashbox_marked_by = found.cashbox_done ? state.actor.name : null;
  audit(db,'updated','advance',found.id,'cashbox_status',oldValue,found.cashbox_done ? 'Сдано в кассу' : 'Не сдано');
  saveDb(db);
  refreshState();
  toast(found.cashbox_done ? 'Аванс отмечен как сданный в кассу' : 'Аванс возвращён в список кассы');
  haptic('medium');
}
function renderCalendar() {
  const filter = $('#dateFilter').value;
  const items = filter ? state.upcoming.filter(x=>x.banquet_date===filter) : state.upcoming;
  $('#calendarList').innerHTML = items.length ? items.map(card).join('') : '<div class="empty">На эту дату записей нет</div>';
  bindCards($('#calendarList'));
}
function audit(db, action, entityType, entityId, fieldName=null, oldValue=null, newValue=null) {
  db.audit.unshift({ id:nextId(db), action, entity_type:entityType, entity_id:entityId, field_name:fieldName, old_value:oldValue, new_value:newValue, actor_id:state.actor.id, actor_name:state.actor.name, created_at:nowIso() });
}
function createAdvance(form) {
  const db = loadDb();
  const amount = Math.round(Number(form.amount));
  if (!form.client_name.trim()) throw new Error('Укажите имя клиента');
  if (!form.phone.trim()) throw new Error('Укажите телефон');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Укажите корректную сумму аванса');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.banquet_date)) throw new Error('Укажите дату банкета');
  const banquetId = nextId(db), received = nowIso();
  const b = {
    id:banquetId, client_name:form.client_name.trim(), phone:normalizePhone(form.phone), banquet_date:form.banquet_date,
    banquet_time:form.banquet_time||'', comment:(form.comment||'').trim(), created_at:received, created_by_name:state.actor.name,
    updated_at:received, advances:[]
  };
  const adv = { id:nextId(db), amount, received_at:received, created_by_name:state.actor.name, created_by_id:state.actor.id, cashbox_done:false, cashbox_marked_at:null, cashbox_marked_by:null };
  b.advances.push(adv); db.banquets.push(b);
  audit(db,'created','banquet',banquetId);
  audit(db,'created','advance',adv.id,'amount',null,String(amount));
  saveDb(db); return b;
}
$('#advanceForm').addEventListener('submit', e => {
  e.preventDefault(); const btn=$('#submitAdvance'); btn.disabled=true;
  try {
    const form = Object.fromEntries(new FormData(e.currentTarget).entries());
    createAdvance(form); e.currentTarget.reset(); setMinDate(); refreshState(); switchTab('home'); toast('Предоплата сохранена на этом устройстве'); haptic('medium');
  } catch(err){ toast(err.message); haptic('heavy'); }
  finally { btn.disabled=false; }
});
function openDetail(id) {
  const db=loadDb(), b=db.banquets.find(x=>x.id===id); if(!b)return;
  state.current=b; renderDetail(b,false); $('#modalBackdrop').hidden=false; haptic();
}
function renderDetail(b,editing=false) {
  const advances=(b.advances||[]).slice().sort((a,b)=>b.received_at.localeCompare(a.received_at)).map(a=>`<div class="advance-row ${a.cashbox_done ? 'done' : ''}"><div><strong>${fmt(a.amount)}</strong><small>${esc(a.created_by_name)}${a.cashbox_done ? ' · ✓ в кассе' : ''}</small></div><div><small>${new Date(a.received_at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</small></div></div>`).join('');
  const normal=`<div class="detail-head"><div><small class="eyebrow">БАНКЕТ #${b.id}</small><h3>${esc(b.client_name)}</h3><div class="muted">${dateRu(b.banquet_date)}${b.banquet_time?` • ${esc(b.banquet_time)}`:''}</div></div><button class="icon-btn" id="editBtn">Изменить</button></div>
    <div class="detail-meta"><div><span>Телефон</span><strong>${esc(b.phone)}</strong></div><div><span>Получено всего</span><strong>${fmt(totalAdvance(b))}</strong></div>${b.comment?`<div><span>Комментарий</span><strong>${esc(b.comment)}</strong></div>`:''}</div>
    <h4>Предоплаты</h4><div class="advance-list">${advances || '<div class="empty">Нет предоплат</div>'}</div>
    <div class="inline-add"><input id="extraAmount" inputmode="numeric" placeholder="Добавить ещё, ₽"><button class="primary-btn" id="addExtra">Добавить</button></div>`;
  const edit=`<div class="detail-head"><div><small class="eyebrow">РЕДАКТИРОВАНИЕ</small><h3>Изменить запись</h3></div><button class="icon-btn" id="cancelEdit">Отмена</button></div>
    <form class="edit-form" id="editForm"><label>Имя<input name="client_name" value="${esc(b.client_name)}" required></label><label>Телефон<input name="phone" value="${esc(b.phone)}" required></label>
    <div class="two-col"><label>Дата<input name="banquet_date" type="date" value="${esc(b.banquet_date)}" required></label><label>Время<input name="banquet_time" type="time" value="${esc(b.banquet_time||'')}"></label></div>
    <label>Комментарий<textarea name="comment" rows="3">${esc(b.comment||'')}</textarea></label><button class="primary-btn" type="submit">Сохранить изменения</button></form>`;
  $('#detailContent').innerHTML = editing ? edit : normal;
  if(editing){ $('#cancelEdit').onclick=()=>renderDetail(b,false); $('#editForm').onsubmit=saveEdit; }
  else { $('#editBtn').onclick=()=>renderDetail(b,true); $('#addExtra').onclick=addExtra; }
}
function saveEdit(e) {
  e.preventDefault(); const db=loadDb(), b=db.banquets.find(x=>x.id===state.current.id); if(!b)return;
  const values=Object.fromEntries(new FormData(e.currentTarget).entries());
  const labels=['client_name','phone','banquet_date','banquet_time','comment'];
  for(const f of labels){
    let nv=String(values[f]??'').trim(); if(f==='phone')nv=normalizePhone(nv);
    const ov=String(b[f]??''); if(nv!==ov){ audit(db,'updated','banquet',b.id,f,ov,nv); b[f]=nv; }
  }
  b.updated_at=nowIso(); saveDb(db); state.current=b; renderDetail(b,false); refreshState(); toast('Изменения сохранены'); haptic('medium');
}
function addExtra() {
  const amount=Math.round(Number($('#extraAmount').value)); if(!Number.isFinite(amount)||amount<=0)return toast('Введите сумму');
  const db=loadDb(), b=db.banquets.find(x=>x.id===state.current.id); if(!b)return;
  const adv={id:nextId(db),amount,received_at:nowIso(),created_by_name:state.actor.name,created_by_id:state.actor.id,cashbox_done:false,cashbox_marked_at:null,cashbox_marked_by:null};
  b.advances.push(adv); audit(db,'created','advance',adv.id,'amount',null,String(amount)); saveDb(db); state.current=b;
  renderDetail(b,false); refreshState(); toast('Предоплата добавлена'); haptic('medium');
}
function loadHistory() {
  const db=loadDb(), labels={client_name:'имя',phone:'телефон',banquet_date:'дату банкета',banquet_time:'время банкета',comment:'комментарий',amount:'аванс',cashbox_status:'статус кассы'};
  $('#historyList').innerHTML=db.audit.length?db.audit.map(x=>{
    let text=x.action==='created'?(x.entity_type==='advance'?`Добавил предоплату ${fmt(x.new_value)}`:'Создал банкет'):`Изменил ${labels[x.field_name]||x.field_name}: «${esc(x.old_value||'—')}» → «${esc(x.new_value||'—')}»`;
    return `<div class="timeline-item"><strong>${esc(x.actor_name)}</strong><p>${text}</p><small>${new Date(x.created_at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})}</small></div>`;
  }).join(''):'<div class="empty">История пока пустая</div>';
}
$('#modalBackdrop').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.hidden=true});
$('.nav-btn').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
$('#quickAdd').onclick=()=>switchTab('add');
$('[data-go]').forEach(b=>b.onclick=()=>switchTab(b.dataset.go));
$('#dateFilter').onchange=renderCalendar; $('#clearDate').onclick=()=>{$('#dateFilter').value='';renderCalendar()};
function setMinDate(){ document.querySelectorAll('[name="banquet_date"]').forEach(i=>i.min=todayMoscow()); }
setMinDate();
refreshState();
toast('Демо-режим: данные хранятся только на этом устройстве');
