const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  try { tg.setHeaderColor?.('#f6f1e8'); tg.setBackgroundColor?.('#f6f1e8'); } catch {}
}

const LEGACY_STORAGE_KEY = 'mangal_city_avansbot_demo_v1';
const state = {
  actor: null,
  stats: {},
  upcoming: [],
  todayCashbox: [],
  current: null,
  filter: 'all',
  syncing: false,
  lastSync: null
};

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const initData = tg?.initData || '';
const fmt = n => `${new Intl.NumberFormat('ru-RU').format(Number(n || 0))} ₽`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateRu = d => d ? d.split('-').reverse().join('.') : '—';
const day = d => String(Number(String(d).split('-')[2] || 0));
const month = d => new Intl.DateTimeFormat('ru-RU',{month:'short'}).format(new Date(`${d}T12:00:00+03:00`)).replace('.','');

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type':'application/json',
      'X-Telegram-Init-Data': initData,
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

function haptic(type='light') {
  try { tg?.HapticFeedback?.impactOccurred(type); } catch {}
}

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2300);
}

function todayMoscow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{
    timeZone:'Europe/Moscow', year:'numeric', month:'2-digit', day:'2-digit'
  }).formatToParts(new Date()).map(x => [x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function addDays(dateStr, days) {
  const dt = new Date(`${dateStr}T00:00:00+03:00`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0,10);
}

function normalizePhone(value='') {
  const digits = String(value).replace(/\D/g,'');
  if (digits.length === 11 && (digits[0] === '8' || digits[0] === '7')) return '+7' + digits.slice(1);
  if (digits.length === 10) return '+7' + digits;
  return String(value).trim();
}

function humanDate(date) {
  const today = todayMoscow();
  if (date === today) return 'Сегодня';
  if (date === addDays(today,1)) return 'Завтра';
  return dateRu(date);
}

function setSync(status, label) {
  const button = $('#syncButton');
  button.dataset.status = status;
  $('#syncText').textContent = label;
}

async function refresh({quiet=false} = {}) {
  if (state.syncing) return;
  state.syncing = true;
  if (!quiet) setSync('loading','Обновление…');

  try {
    const data = await api('/api/bootstrap');
    state.actor = data.actor;
    state.stats = data.stats || {};
    state.upcoming = data.upcoming || [];
    state.todayCashbox = data.today_cashbox || [];
    state.lastSync = new Date();
    render();
    setSync('ok','Обновлено');
    setTimeout(() => {
      if (state.lastSync) {
        setSync('ok', state.lastSync.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}));
      }
    }, 1200);
  } catch (err) {
    setSync('error','Нет связи');
    if (!quiet) showFatal(err.message);
  } finally {
    state.syncing = false;
  }
}

function showFatal(message) {
  const main = document.querySelector('main');
  main.innerHTML = `
    <div class="fatal-card glass">
      <strong>Не удалось загрузить общую базу</strong>
      <p>${esc(message)}</p>
      <button class="primary-btn" id="retryButton" type="button">Попробовать снова</button>
    </div>`;
  $('#retryButton').onclick = () => location.reload();
}

function switchTab(tab) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${tab}`));
  $$('.nav-btn').forEach(b => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('active', active);
    if (active) b.setAttribute('aria-current','page');
    else b.removeAttribute('aria-current');
  });
  $('#quickAdd').classList.toggle('on-add', tab === 'add');

  if (tab === 'history' && state.actor?.role === 'admin') loadHistory();
  if (tab === 'calendar') renderCalendar();

  window.scrollTo({top:0,behavior:'smooth'});
  haptic('light');
}

function card(b) {
  const dateLabel = humanDate(b.banquet_date);
  return `
    <button class="banquet-card" data-banquet="${b.id}" type="button">
      <div class="date-badge">
        <strong>${day(b.banquet_date)}</strong>
        <small>${esc(month(b.banquet_date))}</small>
      </div>
      <div class="card-main">
        <div class="card-title-row">
          <strong>${esc(b.client_name)}</strong>
          ${dateLabel === 'Сегодня' ? '<span class="today-tag">Сегодня</span>' : ''}
        </div>
        <span>${esc(b.banquet_time || 'Время не указано')} · ${esc(b.phone)}</span>
      </div>
      <div class="amount">
        ${fmt(b.total_advance)}
        <small>${Number(b.advance_count || 0)} ав.</small>
      </div>
    </button>`;
}

function bindCards(root=document) {
  root.querySelectorAll('[data-banquet]').forEach(el => {
    el.onclick = () => openDetail(Number(el.dataset.banquet));
  });
}

function render() {
  const s = state.stats || {};
  $('#cashboxAmount').textContent = fmt(s.cashbox_amount);
  $('#cashboxCount').textContent = s.cashbox_count || 0;
  $('#cashboxCaption').textContent = s.cashbox_count
    ? `Осталось сдать · уже сдано ${s.cashbox_done_count || 0}`
    : 'По сегодняшним банкетам всё закрыто';

  $('#todayBanquetCount').textContent = s.today_banquet_count || 0;
  $('#todayAmount').textContent = fmt(s.today_amount);
  $('#todayCountLabel').textContent = `${s.today_count || 0} предоплат`;
  $('#totalAmount').textContent = fmt(s.total_amount);
  $('#totalCountLabel').textContent = `${s.total_count || 0} предоплат`;

  renderCashbox();

  const nearest = state.upcoming.slice(0,5);
  $('#nearestList').innerHTML = nearest.length
    ? nearest.map(card).join('')
    : '<div class="empty">Ближайших банкетов пока нет</div>';
  bindCards($('#nearestList'));

  const admin = state.actor?.role === 'admin';
  $('#historyNav').hidden = !admin;
  $('#bottomNav').classList.toggle('staff', !admin);

  renderCalendar();
  renderMigration();
}

function renderCashbox() {
  const items = state.todayCashbox || [];
  const admin = state.actor?.role === 'admin';

  if (!items.length) {
    $('#cashboxList').innerHTML = '<div class="empty compact">На сегодня авансов по банкетам нет</div>';
    return;
  }

  $('#cashboxList').innerHTML = items.map(a => `
    <div class="cashbox-row ${a.cashbox_done ? 'done' : ''}">
      <button class="cashbox-open" type="button" data-banquet="${a.banquet_id}">
        <div class="cashbox-name">${esc(a.client_name)}</div>
        <div class="cashbox-meta">${esc(a.banquet_time || 'Время не указано')} · ${esc(a.phone)}</div>
        ${a.cashbox_done && a.cashbox_marked_by_name ? `<div class="cashbox-by">Сдал: ${esc(a.cashbox_marked_by_name)}</div>` : ''}
      </button>
      <div class="cashbox-actions">
        <div class="cashbox-sum">${fmt(a.amount)}</div>
        <button class="cashbox-check" data-cashbox-id="${a.id}" type="button"
          ${admin ? '' : 'disabled'}
          aria-label="${a.cashbox_done ? 'Вернуть в список кассы' : 'Отметить сданным'}">
          ${a.cashbox_done ? '✓' : admin ? '○' : '•'}
        </button>
      </div>
    </div>
  `).join('');

  bindCards($('#cashboxList'));
  $('#cashboxList').querySelectorAll('[data-cashbox-id]').forEach(btn => {
    if (!admin) return;
    btn.onclick = e => {
      e.stopPropagation();
      toggleCashbox(Number(btn.dataset.cashboxId));
    };
  });
}

function renderCalendar() {
  const root = $('#calendarList');
  if (!root) return;

  let items = [...state.upcoming];
  const query = String($('#searchInput')?.value || '').trim().toLowerCase();
  const date = $('#dateFilter')?.value || '';
  const today = todayMoscow();

  if (state.filter === 'today') items = items.filter(x => x.banquet_date === today);
  if (state.filter === 'week') {
    const end = addDays(today,7);
    items = items.filter(x => x.banquet_date >= today && x.banquet_date <= end);
  }
  if (date) items = items.filter(x => x.banquet_date === date);
  if (query) {
    const digits = query.replace(/\D/g,'');
    items = items.filter(x =>
      String(x.client_name || '').toLowerCase().includes(query) ||
      String(x.phone || '').toLowerCase().includes(query) ||
      (digits && String(x.phone || '').replace(/\D/g,'').includes(digits))
    );
  }

  root.innerHTML = items.length
    ? items.map(card).join('')
    : '<div class="empty">Ничего не найдено</div>';
  bindCards(root);
}

async function submitAdvance(event) {
  event.preventDefault();
  const button = $('#submitAdvance');
  button.disabled = true;
  button.textContent = 'Сохраняем…';

  try {
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    await api('/api/advances', {
      method:'POST',
      body:JSON.stringify(payload)
    });

    event.currentTarget.reset();
    setMinDate();
    $('#duplicateHint').hidden = true;
    await refresh({quiet:true});
    switchTab('home');
    toast('Предоплата добавлена в общую базу');
    haptic('medium');
  } catch (err) {
    toast(err.message);
    haptic('heavy');
  } finally {
    button.disabled = false;
    button.textContent = 'Сохранить предоплату';
  }
}

async function openDetail(id) {
  try {
    const data = await api(`/api/banquets/${id}`);
    state.current = data.banquet;
    renderDetail(data.banquet, false);
    $('#modalBackdrop').hidden = false;
    haptic('light');
  } catch (err) {
    toast(err.message);
  }
}

function renderDetail(b, editing=false) {
  const advances = (b.advances || [])
    .slice()
    .sort((a,b) => String(b.received_at).localeCompare(String(a.received_at)))
    .map(a => `
      <div class="advance-row ${a.cashbox_done ? 'done' : ''}">
        <div>
          <strong>${fmt(a.amount)}</strong>
          <small>${esc(a.created_by_name)}${a.cashbox_done ? ' · ✓ в кассе' : ''}</small>
        </div>
        <div class="advance-time">
          <small>${new Date(a.received_at).toLocaleString('ru-RU',{
            timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'
          })}</small>
        </div>
      </div>
    `).join('');

  const normal = `
    <div class="detail-head">
      <div>
        <small class="eyebrow">БАНКЕТ #${b.id}</small>
        <h3>${esc(b.client_name)}</h3>
        <div class="muted">${dateRu(b.banquet_date)}${b.banquet_time ? ` • ${esc(b.banquet_time)}` : ''}</div>
      </div>
      <button class="icon-btn" id="editBtn" type="button">Изменить</button>
    </div>

    <div class="detail-actions">
      <a class="action-link" href="tel:${esc(b.phone)}">Позвонить</a>
      <button class="action-link" id="copyPhone" type="button">Копировать телефон</button>
    </div>

    <div class="detail-meta">
      <div><span>Телефон</span><strong>${esc(b.phone)}</strong></div>
      <div><span>Получено всего</span><strong>${fmt(b.total_advance)}</strong></div>
      <div><span>Предоплат</span><strong>${Number(b.advance_count || 0)}</strong></div>
      ${b.comment ? `<div><span>Комментарий</span><strong>${esc(b.comment)}</strong></div>` : ''}
    </div>

    <h4>Предоплаты</h4>
    <div class="advance-list">${advances || '<div class="empty compact">Предоплат нет</div>'}</div>

    <div class="inline-add">
      <input id="extraAmount" inputmode="numeric" placeholder="Добавить ещё, ₽" />
      <button class="primary-btn" id="addExtra" type="button">Добавить</button>
    </div>`;

  const edit = `
    <div class="detail-head">
      <div><small class="eyebrow">РЕДАКТИРОВАНИЕ</small><h3>Изменить запись</h3></div>
      <button class="icon-btn" id="cancelEdit" type="button">Отмена</button>
    </div>
    <form class="edit-form" id="editForm">
      <label>Имя<input name="client_name" value="${esc(b.client_name)}" required /></label>
      <label>Телефон<input name="phone" value="${esc(b.phone)}" required /></label>
      <div class="two-col">
        <label>Дата<input name="banquet_date" type="date" value="${esc(b.banquet_date)}" required /></label>
        <label>Время<input name="banquet_time" type="time" value="${esc(b.banquet_time || '')}" /></label>
      </div>
      <label>Комментарий<textarea name="comment" rows="3">${esc(b.comment || '')}</textarea></label>
      <button class="primary-btn" type="submit">Сохранить изменения</button>
    </form>`;

  $('#detailContent').innerHTML = editing ? edit : normal;

  if (editing) {
    $('#cancelEdit').onclick = () => renderDetail(b,false);
    $('#editForm').onsubmit = saveEdit;
  } else {
    $('#editBtn').onclick = () => renderDetail(b,true);
    $('#addExtra').onclick = addExtra;
    $('#copyPhone').onclick = async () => {
      try {
        await navigator.clipboard.writeText(b.phone);
        toast('Телефон скопирован');
      } catch { toast(b.phone); }
    };
  }
}

async function saveEdit(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());

  try {
    const data = await api(`/api/banquets/${state.current.id}`,{
      method:'PATCH',
      body:JSON.stringify(payload)
    });
    state.current = data.banquet;
    renderDetail(data.banquet,false);
    await refresh({quiet:true});
    toast(data.changes?.length ? 'Изменения сохранены' : 'Ничего не изменилось');
    haptic('medium');
  } catch (err) {
    toast(err.message);
  }
}

async function addExtra() {
  const amount = Math.round(Number($('#extraAmount').value));
  if (!Number.isFinite(amount) || amount <= 0) return toast('Введите сумму');

  try {
    const data = await api(`/api/banquets/${state.current.id}/advances`,{
      method:'POST',
      body:JSON.stringify({amount})
    });
    state.current = data.banquet;
    renderDetail(data.banquet,false);
    await refresh({quiet:true});
    toast('Предоплата добавлена');
    haptic('medium');
  } catch (err) {
    toast(err.message);
  }
}

async function toggleCashbox(advanceId) {
  try {
    await api(`/api/advances/${advanceId}/cashbox`, {method:'POST', body:'{}'});
    await refresh({quiet:true});
    toast('Статус кассы обновлён');
    haptic('medium');
  } catch (err) {
    toast(err.message);
  }
}

async function loadHistory() {
  const root = $('#historyList');
  root.innerHTML = '<div class="empty compact">Загрузка истории…</div>';

  try {
    const data = await api('/api/audit');
    const labels = {
      client_name:'имя',
      phone:'телефон',
      banquet_date:'дату банкета',
      banquet_time:'время банкета',
      comment:'комментарий',
      amount:'аванс',
      cashbox_status:'статус кассы'
    };

    root.innerHTML = data.items?.length ? data.items.map(x => {
      let text;
      if (x.action === 'created') {
        text = x.entity_type === 'advance'
          ? `Добавил предоплату ${fmt(x.new_value)}`
          : 'Создал банкет';
      } else if (x.action === 'imported') {
        text = 'Перенёс запись из старой локальной версии';
      } else if (x.action === 'cashbox') {
        text = `Касса: ${esc(x.old_value || '—')} → <b>${esc(x.new_value || '—')}</b>`;
      } else {
        text = `Изменил ${labels[x.field_name] || x.field_name}: «${esc(x.old_value || '—')}» → «${esc(x.new_value || '—')}»`;
      }

      return `
        <div class="timeline-item">
          <div class="timeline-top">
            <strong>${esc(x.actor_name)}</strong>
            <small>${new Date(x.created_at).toLocaleString('ru-RU',{
              timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'
            })}</small>
          </div>
          <p>${text}</p>
        </div>`;
    }).join('') : '<div class="empty">История пока пустая</div>';
  } catch (err) {
    root.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

function renderMigration() {
  const banner = $('#migrationBanner');
  let legacy;
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || 'null'); } catch {}
  const count = Array.isArray(legacy?.banquets) ? legacy.banquets.length : 0;

  if (!count || localStorage.getItem(LEGACY_STORAGE_KEY + '_imported') === '1') {
    banner.hidden = true;
    return;
  }

  $('#migrationText').textContent = `Найдено записей: ${count}. Перенести их в общую базу?`;
  banner.hidden = false;
}

async function importLocal() {
  let legacy;
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || 'null'); } catch {}
  if (!Array.isArray(legacy?.banquets) || !legacy.banquets.length) return;

  const btn = $('#importLocalButton');
  btn.disabled = true;
  btn.textContent = 'Переносим…';

  try {
    const data = await api('/api/import-local',{
      method:'POST',
      body:JSON.stringify({banquets:legacy.banquets})
    });
    localStorage.setItem(LEGACY_STORAGE_KEY + '_imported','1');
    $('#migrationBanner').hidden = true;
    await refresh({quiet:true});
    toast(`Перенесено: ${data.imported}, пропущено: ${data.skipped}`);
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Перенести';
  }
}

function checkDuplicatePhone() {
  const input = $('#phoneInput');
  const hint = $('#duplicateHint');
  const phone = normalizePhone(input.value);
  if (!phone || phone.replace(/\D/g,'').length < 10) {
    hint.hidden = true;
    return;
  }

  const match = state.upcoming.find(x => normalizePhone(x.phone) === phone);
  if (!match) {
    hint.hidden = true;
    return;
  }

  hint.innerHTML = `⚠️ На этот телефон уже есть банкет: <b>${esc(match.client_name)}</b>, ${dateRu(match.banquet_date)}${match.banquet_time ? ` в ${esc(match.banquet_time)}` : ''}.`;
  hint.hidden = false;
}

function setMinDate() {
  document.querySelectorAll('[name="banquet_date"]').forEach(i => i.min = todayMoscow());
}

$('#advanceForm').addEventListener('submit', submitAdvance);
$('#quickAdd').onclick = () => switchTab('add');
$('#syncButton').onclick = () => refresh();
$('#modalBackdrop').addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.hidden = true;
});

$$('.nav-btn').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
$$('[data-go]').forEach(b => b.onclick = () => switchTab(b.dataset.go));

$('#searchInput').oninput = renderCalendar;
$('#dateFilter').onchange = renderCalendar;
$('#clearDate').onclick = () => {
  $('#dateFilter').value = '';
  state.filter = 'all';
  $$('.filter-chip').forEach(x => x.classList.toggle('active',x.dataset.filter === 'all'));
  renderCalendar();
};

$$('.filter-chip').forEach(chip => {
  chip.onclick = () => {
    state.filter = chip.dataset.filter;
    $$('.filter-chip').forEach(x => x.classList.toggle('active', x === chip));
    $('#dateFilter').value = '';
    renderCalendar();
    haptic('light');
  };
});

$('#phoneInput').addEventListener('input', checkDuplicatePhone);
$('#importLocalButton').onclick = importLocal;

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh({quiet:true});
});

setInterval(() => {
  if (!document.hidden) refresh({quiet:true});
}, 15000);

setMinDate();
refresh();
