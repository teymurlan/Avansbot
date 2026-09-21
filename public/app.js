const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const state = { actor: null, stats: null, upcoming: [], current: null };
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const initData = tg?.initData || '';
const fmt = n => `${new Intl.NumberFormat('ru-RU').format(Number(n || 0))} ₽`;
const month = d => new Intl.DateTimeFormat('ru-RU',{month:'short'}).format(new Date(`${d}T12:00:00`)).replace('.','');
const day = d => String(Number(d.split('-')[2]));
const dateRu = d => d ? d.split('-').reverse().join('.') : '—';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function api(path, options={}) {
  const res = await fetch(path, { ...options, headers: { 'content-type':'application/json', 'X-Telegram-Init-Data': initData, ...(options.headers||{}) } });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

function toast(text) {
  const el = $('#toast'); el.textContent = text; el.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(()=>el.classList.remove('show'), 2400);
}

function haptic(type='light'){ try{ tg?.HapticFeedback?.impactOccurred(type); }catch{} }

function switchTab(tab) {
  $$('.view').forEach(v=>v.classList.toggle('active', v.id === `view-${tab}`));
  $$('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'history' && state.actor?.role === 'admin') loadHistory();
  if (tab === 'calendar') renderCalendar();
  window.scrollTo({top:0,behavior:'smooth'});
}

function card(b) {
  return `<button class="banquet-card" data-banquet="${b.id}">
    <div class="date-badge"><strong>${day(b.banquet_date)}</strong><small>${esc(month(b.banquet_date))}</small></div>
    <div class="card-main"><strong>${esc(b.client_name)}</strong><span>${esc(b.banquet_time || 'Время не указано')} · ${esc(b.phone)}</span></div>
    <div class="amount">${fmt(b.total_advance)}<small>${Number(b.advance_count)} ав.</small></div>
  </button>`;
}

function bindCards(root=document) { root.querySelectorAll('[data-banquet]').forEach(el=>el.onclick=()=>openDetail(el.dataset.banquet)); }

function render() {
  const s = state.stats || {};
  $('#todayAmount').textContent = fmt(s.today_amount); $('#todayCount').textContent = s.today_count || 0;
  $('#totalAmount').textContent = fmt(s.total_amount); $('#totalCount').textContent = s.total_count || 0;
  $('#userPill').textContent = state.actor?.name || '—';
  const near = state.upcoming.slice(0,5);
  $('#nearestList').innerHTML = near.length ? near.map(card).join('') : '<div class="empty">Ближайших банкетов пока нет</div>';
  bindCards($('#nearestList'));
  renderCalendar();

  const admin = state.actor?.role === 'admin';
  $('#historyNav').style.display = admin ? '' : 'none';
  $('#bottomNav').classList.toggle('staff', !admin);
}

function renderCalendar() {
  const filter = $('#dateFilter').value;
  const items = filter ? state.upcoming.filter(x=>x.banquet_date===filter) : state.upcoming;
  $('#calendarList').innerHTML = items.length ? items.map(card).join('') : '<div class="empty">На эту дату записей нет</div>';
  bindCards($('#calendarList'));
}

async function refresh() {
  const data = await api('/api/bootstrap');
  state.actor = data.actor; state.stats = data.stats; state.upcoming = data.upcoming || [];
  render();
}

$('#advanceForm').addEventListener('submit', async e => {
  e.preventDefault(); const btn = $('#submitAdvance'); btn.disabled = true;
  const body = Object.fromEntries(new FormData(e.currentTarget).entries());
  try {
    await api('/api/advances',{method:'POST',body:JSON.stringify(body)});
    haptic('medium'); e.currentTarget.reset(); setMinDate(); await refresh(); switchTab('home'); toast('Предоплата сохранена');
  } catch(err){ toast(err.message); haptic('heavy'); }
  finally{ btn.disabled=false; }
});

async function openDetail(id) {
  try {
    const data = await api(`/api/banquets/${id}`); state.current = data.banquet; renderDetail(data.banquet); $('#modalBackdrop').hidden=false; haptic();
  } catch(e){ toast(e.message); }
}

function renderDetail(b, editing=false) {
  const advances = (b.advances||[]).map(a=>`<div class="advance-row"><div><strong>${fmt(a.amount)}</strong><small>${esc(a.created_by_name)}</small></div><div><small>${new Date(a.received_at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</small></div></div>`).join('');
  const normal = `<div class="detail-head"><div><small class="eyebrow">БАНКЕТ #${b.id}</small><h3>${esc(b.client_name)}</h3><div class="muted">${dateRu(b.banquet_date)}${b.banquet_time?` • ${esc(b.banquet_time)}`:''}</div></div><button class="icon-btn" id="editBtn">Изменить</button></div>
    <div class="detail-meta"><div><span>Телефон</span><strong>${esc(b.phone)}</strong></div><div><span>Получено всего</span><strong>${fmt(b.total_advance)}</strong></div>${b.comment?`<div><span>Комментарий</span><strong>${esc(b.comment)}</strong></div>`:''}</div>
    <h4>Предоплаты</h4><div class="advance-list">${advances || '<div class="empty">Нет предоплат</div>'}</div>
    <div class="inline-add"><input id="extraAmount" inputmode="numeric" placeholder="Добавить ещё, ₽"><button class="primary-btn" id="addExtra">Добавить</button></div>`;
  const edit = `<div class="detail-head"><div><small class="eyebrow">РЕДАКТИРОВАНИЕ</small><h3>Изменить запись</h3></div><button class="icon-btn" id="cancelEdit">Отмена</button></div>
    <form class="edit-form" id="editForm">
      <label>Имя<input name="client_name" value="${esc(b.client_name)}" required></label>
      <label>Телефон<input name="phone" value="${esc(b.phone)}" required></label>
      <div class="two-col"><label>Дата<input name="banquet_date" type="date" value="${esc(b.banquet_date)}" required></label><label>Время<input name="banquet_time" type="time" value="${esc(b.banquet_time||'')}"></label></div>
      <label>Комментарий<textarea name="comment" rows="3">${esc(b.comment||'')}</textarea></label>
      <button class="primary-btn" type="submit">Сохранить изменения</button>
    </form>`;
  $('#detailContent').innerHTML = editing ? edit : normal;
  if (editing) {
    $('#cancelEdit').onclick=()=>renderDetail(b,false);
    $('#editForm').onsubmit=saveEdit;
  } else {
    $('#editBtn').onclick=()=>renderDetail(b,true);
    $('#addExtra').onclick=addExtra;
  }
}

async function saveEdit(e) {
  e.preventDefault(); const body=Object.fromEntries(new FormData(e.currentTarget).entries());
  try { const d=await api(`/api/banquets/${state.current.id}`,{method:'PATCH',body:JSON.stringify(body)}); state.current=d.banquet; renderDetail(d.banquet,false); await refresh(); toast(d.changes.length?'Изменения сохранены':'Ничего не изменилось'); haptic('medium'); } catch(err){ toast(err.message); }
}

async function addExtra() {
  const amount = Number($('#extraAmount').value); if (!amount || amount<=0) return toast('Введите сумму');
  try { const d=await api(`/api/banquets/${state.current.id}/advances`,{method:'POST',body:JSON.stringify({amount})}); state.current=d.banquet; renderDetail(d.banquet,false); await refresh(); toast('Предоплата добавлена'); haptic('medium'); } catch(err){ toast(err.message); }
}

async function loadHistory() {
  $('#historyList').innerHTML='<div class="empty">Загрузка…</div>';
  try {
    const data=await api('/api/audit');
    const labels={client_name:'имя',phone:'телефон',banquet_date:'дату банкета',banquet_time:'время банкета',comment:'комментарий',amount:'аванс'};
    $('#historyList').innerHTML=data.items.length?data.items.map(x=>{
      let text=x.action==='created' ? (x.entity_type==='advance'?`Добавил предоплату ${fmt(x.new_value)}`:'Создал банкет') : `Изменил ${labels[x.field_name]||x.field_name}: «${esc(x.old_value||'—')}» → «${esc(x.new_value||'—')}»`;
      return `<div class="timeline-item"><strong>${esc(x.actor_name)}</strong><p>${text}</p><small>${new Date(x.created_at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})}</small></div>`;
    }).join(''):'<div class="empty">История пока пустая</div>';
  } catch(e){ $('#historyList').innerHTML=`<div class="empty">${esc(e.message)}</div>`; }
}

$('#modalBackdrop').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.hidden=true});
$$('.nav-btn').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
$$('[data-go]').forEach(b=>b.onclick=()=>switchTab(b.dataset.go));
$('#dateFilter').onchange=renderCalendar; $('#clearDate').onclick=()=>{$('#dateFilter').value='';renderCalendar()};

function setMinDate(){ const now=new Date(); const local=new Date(now.getTime()+3*3600*1000).toISOString().slice(0,10); document.querySelector('[name="banquet_date"]').min=local; }

setMinDate();
refresh().catch(err=>{ document.querySelector('main').innerHTML=`<div class="empty" style="margin-top:80px"><b>Не удалось открыть приложение</b><br><br>${esc(err.message)}<br><br>Откройте WebApp кнопкой из Telegram-бота.</div>`; });
