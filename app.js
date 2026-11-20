import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

/* =====================================================================
   Kho Truyện
   - Biên tập viên: up truyện đã biên tập (tên + link Drive + ghi chú), xem kho và lịch,
     xoá truyện mình up khi còn chờ duyệt.
   - Admin: mọi quyền trên + lên lịch / bỏ lịch / xoá + quản lý thành viên.
   Quyền được khoá ở cơ sở dữ liệu (supabase/schema.sql), giao diện chỉ ẩn bớt nút.
   ===================================================================== */

const CFG = window.KHO_CONFIG || {};
const MIN_STOCK = Number(CFG.MIN_STOCK) || 5;
const $ = (s, root = document) => root.querySelector(s);
const appEl = $('#app');

/* ---------- Tiện ích ngày tháng & chữ ---------- */
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const fmt = (s) => { const d = parse(s); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const dowShort = (s) => DOW[parse(s).getDay()];
const dowLong = (s) => { const g = parse(s).getDay(); return g === 0 ? 'Chủ nhật' : 'Thứ ' + (g + 1); };
const localDate = (ts) => iso(new Date(ts));
const ago = (ts) => {
  const n = Math.round((parse(today()) - parse(localDate(ts))) / 864e5);
  return n <= 0 ? 'hôm nay' : n === 1 ? 'hôm qua' : `${n} ngày trước`;
};
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https:\/\//i.test(u || '') ? u : '#');

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', err);
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), err ? 4500 : 2400);
}

function viErr(error) {
  const msg = String(error?.message || error || '');
  if (error?.code === '23505' || /duplicate key/i.test(msg)) return 'Truyện này đã có trong kho (trùng tên hoặc trùng link Drive).';
  if (error?.code === '42501' || /row-level security|permission denied/i.test(msg)) return 'Bạn không có quyền làm việc này.';
  if (/rate limit|too many/i.test(msg)) return 'Gửi quá nhiều lần. Đợi vài phút rồi thử lại.';
  if (/failed to fetch|network/i.test(msg)) return 'Mất kết nối mạng. Kiểm tra mạng rồi thử lại.';
  if (/check constraint.*drive_url/i.test(msg)) return 'Link Drive phải bắt đầu bằng https://';
  return 'Có lỗi: ' + msg;
}

/* ---------- Kết nối Supabase ---------- */
if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
  card(`<h1>Kho Truyện</h1>
    <p>App chưa kết nối Supabase. Mở file <code>config.js</code> và điền <code>SUPABASE_URL</code> và <code>SUPABASE_ANON_KEY</code>.</p>`);
  throw new Error('Thiếu cấu hình Supabase trong config.js');
}
const sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

/* ---------- Trạng thái ---------- */
const S = {
  userId: null, email: '', role: null,
  stories: [], members: [],
  tab: 'cho-duyet', q: '',
  month: (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })(),
  pick: null, sel: null, armed: null,
  channel: null, live: false,
};
const isAdmin = () => S.role === 'admin';
const status = (s) => (!s.air_date ? 'wait' : s.air_date < today() ? 'aired' : 'sched');
const byId = (id) => S.stories.find((s) => s.id === Number(id));
const waiting = () => S.stories.filter((s) => status(s) === 'wait');

/* ---------- Màn hình đăng nhập / không có quyền ---------- */
function card(inner) {
  appEl.innerHTML = `<div class="center"><div class="card"><svg class="logo" aria-hidden="true"><use href="#lotus"/></svg>${inner}</div></div>`;
}

function showLogin(sentTo) {
  if (sentTo) {
    card(`<h1>Kiểm tra email</h1>
      <p>Đã gửi link đăng nhập tới <b>${esc(sentTo)}</b>. Mở email đó và bấm link là vào app. Không thấy thì xem thêm mục Spam.</p>
      <button class="btn btn-ghost" id="again">Dùng email khác</button>`);
    $('#again').onclick = () => showLogin();
    return;
  }
  card(`<h1>Kho Truyện</h1>
    <p>Nhập email đã được Admin cấp quyền. App sẽ gửi link đăng nhập vào email đó, không cần mật khẩu.</p>
    <form id="loginForm">
      <label class="sr" for="loginEmail">Email</label>
      <input class="field" id="loginEmail" type="email" required placeholder="ten@gmail.com" autocomplete="email">
      <button class="btn btn-ink" type="submit" id="loginBtn">Gửi link đăng nhập</button>
    </form>`);
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#loginEmail').value.trim().toLowerCase();
    const btn = $('#loginBtn');
    btn.disabled = true; btn.textContent = 'Đang gửi…';
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin + location.pathname },
    });
    if (error) { toast(viErr(error), true); btn.disabled = false; btn.textContent = 'Gửi link đăng nhập'; return; }
    showLogin(email);
  };
}

function showNoAccess() {
  card(`<h1>Chưa có quyền</h1>
    <p>Email <b>${esc(S.email)}</b> chưa được thêm vào app. Nhờ Admin thêm email này ở tab “Thành viên”, rồi tải lại trang.</p>
    <button class="btn btn-ghost" id="logout">Đăng xuất</button>`);
  $('#logout').onclick = logout;
}

async function logout() {
  if (S.channel) { sb.removeChannel(S.channel); S.channel = null; }
  await sb.auth.signOut();
}

/* ---------- Khung app sau khi đăng nhập ---------- */
function showApp() {
  appEl.innerHTML = `<div class="wrap">
    <header>
      <div class="brand">
        <svg aria-hidden="true"><use href="#lotus"/></svg>
        <div><h1>Kho Truyện</h1><p>Biên tập viên up truyện · Admin duyệt và lên lịch</p></div>
      </div>
      <div class="head-right">
        <button class="btn btn-ink" id="openUpload">+ Up truyện đã biên tập</button>
        <div class="user">
          <span class="live" id="live" title="Tự cập nhật khi có người up truyện">Trực tiếp</span>
          <span class="role ${isAdmin() ? 'admin' : ''}">${isAdmin() ? 'Admin' : 'Biên tập viên'}</span>
          <b title="${esc(S.email)}">${esc(S.email)}</b>
          <button class="mini" id="logout">Đăng xuất</button>
        </div>
      </div>
    </header>

    <form class="upload" id="upload" hidden autocomplete="off">
      <div class="lbl"><b>Up truyện đã biên tập xong</b><span>Truyện sẽ vào mục “Chờ Admin duyệt”</span></div>
      <div class="f"><label for="u-title">Tên truyện</label><input class="field" id="u-title" required maxlength="200" placeholder="VD: Ánh đèn dầu ở làng Vạc"></div>
      <div class="f"><label for="u-link">Link Google Drive</label><input class="field" id="u-link" type="url" required placeholder="https://docs.google.com/…"></div>
      <div class="f"><label for="u-note">Ghi chú cho Admin (không bắt buộc)</label><input class="field" id="u-note" maxlength="300" placeholder="VD: đã sửa đoạn kết"></div>
      <button class="btn btn-ink" type="submit" id="u-submit">Up lên</button>
    </form>

    <div class="clouds" aria-hidden="true"><svg><use href="#cloud"/></svg><svg><use href="#cloud"/></svg><svg><use href="#cloud"/></svg></div>
    <section class="stats" id="stats" aria-label="Số liệu"></section>
    <div>
      <div class="tabs-wrap"><div class="tabs" role="tablist" id="tabs"></div></div>
      <section class="panel-area" id="panel" role="tabpanel"></section>
    </div>
  </div>`;

  $('#logout').onclick = logout;
  $('#openUpload').onclick = () => {
    const f = $('#upload');
    f.hidden = !f.hidden;
    $('#openUpload').textContent = f.hidden ? '+ Up truyện đã biên tập' : 'Đóng';
    if (!f.hidden) $('#u-title').focus();
  };
  $('#upload').addEventListener('submit', onUpload);
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) setTab(b.dataset.tab); });
  wirePanel();

  const h = location.hash.slice(1);
  S.tab = tabs().some((t) => t.id === h) ? h : 'cho-duyet';
  updateLive();
}

/* ---------- Tab ---------- */
function tabs() {
  const list = [
    { id: 'cho-duyet', label: 'Chờ Admin duyệt', hot: true, f: (s) => status(s) === 'wait',
      desc: isAdmin()
        ? 'Truyện biên tập viên đã up. Biên tập lần cuối xong thì chọn ngày lên sóng, truyện tự sang Lịch.'
        : 'Truyện đã up, đang chờ Admin duyệt. Bạn xoá được truyện mình up khi truyện còn ở đây.' },
    { id: 'lich', label: 'Lịch lên sóng', f: (s) => status(s) === 'sched',
      desc: !isAdmin() ? 'Lịch lên sóng do Admin xếp.'
        : isPhone() ? 'Bấm “+ Thêm truyện” ở ngày trống để xếp lịch.'
        : 'Bấm “+ Thêm truyện” trong ô ngày, hoặc kéo truyện ở cột bên phải vào ô ngày.' },
    { id: 'da-len-song', label: 'Đã lên sóng', f: (s) => status(s) === 'aired',
      desc: 'Qua ngày lên sóng, truyện tự chuyển vào đây.' },
  ];
  if (isAdmin()) list.push({ id: 'thanh-vien', label: 'Thành viên', desc: 'Ai được vào app và với vai trò gì.' });
  return list;
}

function setTab(id) {
  S.tab = id; S.q = ''; S.pick = null; S.sel = null; S.armed = null;
  renderTabs(); renderPanel();
  try { history.replaceState(null, '', '#' + id); } catch (_) { /* bỏ qua */ }
}

function refresh() {
  if (!$('#panel')) return;
  renderStats(); renderTabs(); renderPanel();
}

function renderTabs() {
  $('#tabs').innerHTML = tabs().map((t) => {
    const n = t.f ? S.stories.filter(t.f).length : S.members.length;
    return `<button class="tab" role="tab" data-tab="${t.id}" aria-selected="${S.tab === t.id}">${t.label}<span class="cnt ${t.hot && n ? 'hot' : ''}">${n}</span></button>`;
  }).join('');
}

/* ---------- Số liệu ---------- */
function renderStats() {
  const t = today();
  const wait = S.stories.filter((s) => status(s) === 'wait').length;
  const sched = S.stories.filter((s) => status(s) === 'sched').length;
  const stock = wait + sched;
  const lastAir = S.stories.filter((s) => s.air_date && s.air_date >= t).map((s) => s.air_date).sort().pop();
  const d = parse(t);
  const monthStart = iso(new Date(d.getFullYear(), d.getMonth(), 1));
  const month = S.stories.filter((s) => localDate(s.created_at) >= monthStart).length;
  const week = S.stories.filter((s) => localDate(s.created_at) >= addDays(t, -6)).length;
  $('#stats').innerHTML = `
    <div class="stat main">
      <span class="eyebrow">Tồn kho chưa lên sóng</span>
      <div class="num">${stock}<small>tập</small></div>
      <span class="sub"><b>${wait}</b> chờ Admin duyệt · <b>${sched}</b> đã lên lịch${lastAir ? ` · lịch kín tới <b>${fmt(lastAir)}</b>` : ''}</span>
      ${stock < MIN_STOCK ? `<div class="seal" role="img" aria-label="Cảnh báo: tồn kho dưới ${MIN_STOCK} tập">Cạn kho<small>dưới ${MIN_STOCK} tập</small></div>` : ''}
    </div>
    <div class="stat">
      <span class="eyebrow">Đã biên tập tháng ${d.getMonth() + 1}</span>
      <div class="num">${month}<small>tập</small></div>
      <span class="sub">7 ngày qua: <b>${week} tập</b> · tổng cộng <b>${S.stories.length} tập</b></span>
    </div>`;
}

/* ---------- Nội dung tab ---------- */
function renderPanel() {
  const t = tabs().find((x) => x.id === S.tab) || tabs()[0];
  let h = `<div class="ptop"><p>${t.desc}</p>${t.f && t.id !== 'lich'
    ? `<label class="sr" for="q">Tìm truyện</label><input class="field search" id="q" type="search" placeholder="Tìm tên truyện…" value="${esc(S.q)}">` : ''}</div>`;
  if (t.id === 'lich') h += isPhone() ? agendaHTML() : calHTML();
  else if (t.id === 'thanh-vien') h += membersHTML();
  else h += `<ul class="list" id="list">${listHTML(t)}</ul>`;
  $('#panel').innerHTML = h;
}

const roleOf = (email) => S.members.find((m) => m.email === email)?.role;
function who(s) {
  const mine = s.uploaded_by === S.email;
  const admin = roleOf(s.uploaded_by) === 'admin';
  const label = mine ? 'Bạn' : admin ? 'Admin' : 'Biên tập viên';
  return `<div class="who"><span class="av ${admin ? 'admin' : ''}">${admin ? 'AD' : 'BT'}</span><span>${label}<small>up ${ago(s.created_at)}</small></span></div>`;
}
function titleCell(s) {
  return `<div class="c-title">
    <a class="title" href="${esc(safeUrl(s.drive_url))}" target="_blank" rel="noopener" title="Mở trên Google Drive">${esc(s.title)}<svg aria-hidden="true"><use href="#ext"/></svg></a>
    ${s.note ? `<div class="note-text">${esc(s.note)}</div>` : ''}
  </div>`;
}
const delBtn = (s) => `<button class="act danger ${S.armed === s.id ? 'armed' : ''}" data-act="del">${S.armed === s.id ? 'Bấm lần nữa để xoá' : 'Xoá'}</button>`;

function nextFree() {
  const t = today();
  for (let i = 0; i < 365; i++) { const d = addDays(t, i); if (!S.stories.some((s) => s.air_date === d)) return d; }
  return t;
}

function listHTML(t) {
  const q = norm(S.q);
  const rows = S.stories.filter(t.f).filter((s) => !q || norm(s.title + ' ' + (s.note || '')).includes(q));
  if (!rows.length) {
    const empty = { 'cho-duyet': ['Không còn truyện chờ duyệt', 'Biên tập viên up truyện lên thì truyện sẽ hiện ở đây.'],
      'da-len-song': ['Chưa có truyện nào lên sóng', ''] }[t.id] || ['Chưa có truyện nào', ''];
    return `<li class="empty-state"><b>${q ? 'Không tìm thấy truyện' : empty[0]}</b>${q ? 'Thử gõ từ khoá khác.' : empty[1]}</li>`;
  }
  if (t.id === 'cho-duyet') {
    rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (isAdmin()) {
      const nf = nextFree();
      return `<li class="row head"><span>Tên truyện</span><span>Người up</span><span>Chọn ngày lên sóng</span><span></span></li>` +
        rows.map((s) => `<li class="row" data-id="${s.id}">${titleCell(s)}${who(s)}
          <div><label class="sr" for="dt-${s.id}">Ngày lên sóng</label><input class="date" id="dt-${s.id}" type="date" min="${today()}" data-act="date"></div>
          <div class="acts"><button class="act go" data-act="next" title="Xếp vào ngày trống gần nhất">Lên lịch ${dowShort(nf)} ${fmt(nf)}</button>${delBtn(s)}</div></li>`).join('');
    }
    return `<li class="row head"><span>Tên truyện</span><span>Người up</span><span>Trạng thái</span><span></span></li>` +
      rows.map((s) => `<li class="row" data-id="${s.id}">${titleCell(s)}${who(s)}
        <div class="dtext">Chờ Admin duyệt</div>
        <div class="acts">${s.uploaded_by === S.email ? delBtn(s) : ''}</div></li>`).join('');
  }
  rows.sort((a, b) => b.air_date.localeCompare(a.air_date));
  return `<li class="row head"><span>Tên truyện</span><span>Người up</span><span>Lên sóng</span><span></span></li>` +
    rows.map((s) => `<li class="row" data-id="${s.id}">${titleCell(s)}${who(s)}
      <div class="dtext">${dowLong(s.air_date)}, ${fmt(s.air_date)}</div>
      <div class="acts">${isAdmin() ? delBtn(s) : ''}</div></li>`).join('');
}

/* ---------- Lịch (máy tính) ---------- */
const isPhone = () => matchMedia('(max-width: 700px)').matches;

function gcal(s) {
  const d = parse(s.air_date), n = new Date(d); n.setDate(d.getDate() + 1);
  const f = (x) => `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}`;
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent('Lên sóng: ' + s.title) +
    '&dates=' + f(d) + '/' + f(n) + '&details=' + encodeURIComponent('Kịch bản: ' + s.drive_url);
}

function pickSelect(k) {
  return `<label class="sr" for="pick-${k}">Chọn truyện cho ngày ${fmt(k)}</label>
    <select id="pick-${k}" data-pick="${k}"><option value="">Chọn truyện…</option>${waiting().map((s) => `<option value="${s.id}">${esc(s.title)}</option>`).join('')}</select>`;
}

function calHTML() {
  const t = today();
  const m = S.month, y = m.getFullYear(), mo = m.getMonth();
  const lead = (new Date(y, mo, 1).getDay() + 6) % 7, start = new Date(y, mo, 1 - lead);
  const weeks = Math.ceil((lead + new Date(y, mo + 1, 0).getDate()) / 7);
  const free = waiting();
  let g = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'].map((d) => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i); const k = iso(d);
    const st = S.stories.filter((s) => s.air_date === k);
    const out = d.getMonth() !== mo, past = k < t;
    let add = '';
    if (isAdmin() && !past && !out) add = S.pick === k ? pickSelect(k) : free.length ? `<button class="add" data-add="${k}">+ Thêm truyện</button>` : '';
    g += `<div class="cell ${out ? 'out' : ''} ${past ? 'past' : ''} ${k === t ? 'today' : ''}" data-date="${k}">
      <span class="dn">${d.getDate()}</span>
      ${st.map((s) => { const a = status(s) === 'aired';
        return `<button class="pill ${a ? 'p-aired' : 'p-sched'} ${S.sel === s.id ? 'on' : ''}" draggable="${isAdmin() && !a}" data-id="${s.id}">${esc(s.title)}${a ? '<small>Đã lên sóng</small>' : ''}</button>`; }).join('')}
      ${add}
    </div>`;
  }
  const sel = S.sel && byId(S.sel);
  return `<div class="cal-layout"><div>
      <div class="cal-head">
        <button class="mini" data-nav="-1" aria-label="Tháng trước">‹</button><h3>Tháng ${mo + 1}, ${y}</h3><button class="mini" data-nav="1" aria-label="Tháng sau">›</button>
        <button class="mini" data-nav="0">Hôm nay</button>
        <div class="legend"><span><i class="dot" style="background:var(--gold)"></i>Đã lên lịch</span><span><i class="dot" style="background:var(--leaf)"></i>Đã lên sóng</span></div>
      </div>
      <div class="cal-scroll"><div class="cal">${g}</div></div></div>
    <aside class="side">
      ${sel ? detailBox(sel) : ''}
      <div class="box"><h4>Chờ Admin duyệt</h4>
        <p>${isAdmin() ? 'Kéo vào ô ngày để lên lịch. Kéo ngược về đây để bỏ lịch.' : 'Admin sẽ xếp lịch cho các truyện này.'}</p>
        <div class="tray" id="tray">${free.length ? free.map((s) => `<button class="pill p-wait" draggable="${isAdmin()}" data-id="${s.id}">${esc(s.title)}<small>Up ${ago(s.created_at)}</small></button>`).join('') : '<p>Không còn truyện chờ duyệt.</p>'}</div>
      </div>
    </aside></div>`;
}

function detailBox(s) {
  const aired = status(s) === 'aired';
  return `<div class="box detail"><span class="eyebrow">${dowLong(s.air_date)}, ${fmt(s.air_date)}</span><span class="t">${esc(s.title)}</span>
    ${s.note ? `<p>${esc(s.note)}</p>` : ''}
    <div class="row-acts"><a class="mini" href="${esc(safeUrl(s.drive_url))}" target="_blank" rel="noopener">Mở Drive ↗</a>
    ${aired ? '' : `<a class="mini" href="${esc(gcal(s))}" target="_blank" rel="noopener">Thêm vào Google Lịch</a>${isAdmin() ? `<button class="mini" data-unsched="${s.id}">Bỏ lịch</button>` : ''}`}</div></div>`;
}

/* ---------- Lịch (điện thoại): danh sách 30 ngày tới ---------- */
function agendaHTML() {
  const t = today();
  const free = waiting();
  const later = S.stories.filter((s) => s.air_date && s.air_date > addDays(t, 29)).length;
  let h = `<ul class="agenda">`;
  for (let i = 0; i < 30; i++) {
    const k = addDays(t, i);
    const st = S.stories.filter((s) => s.air_date === k);
    h += `<li class="ag ${i === 0 ? 'today' : ''}" data-date="${k}">
      <div class="d">${i === 0 ? 'Hôm nay' : dowShort(k)}<b>${fmt(k)}</b></div>
      <div class="items">
        ${st.map((s) => `<div><a class="title" style="font-size:17px" href="${esc(safeUrl(s.drive_url))}" target="_blank" rel="noopener">${esc(s.title)}<svg aria-hidden="true"><use href="#ext"/></svg></a>
          ${isAdmin() ? ` <button class="mini" data-unsched="${s.id}">Bỏ lịch</button>` : ''}</div>`).join('')}
        ${!st.length ? (isAdmin() && free.length
          ? (S.pick === k ? pickSelect(k) : `<button class="add ag-add" data-add="${k}">Trống · + Thêm truyện</button>`)
          : '<span class="free">Trống</span>') : ''}
      </div></li>`;
  }
  h += `</ul>`;
  if (later) h += `<p class="muted" style="margin:0;font-size:12.5px">Còn ${later} truyện đã lên lịch sau 30 ngày tới. Xem trên máy tính để thấy lịch tháng.</p>`;
  return h;
}

/* ---------- Thành viên (chỉ Admin) ---------- */
function membersHTML() {
  return `<div class="members">
    <form class="madd" id="madd" autocomplete="off">
      <label class="sr" for="m-email">Email</label>
      <input class="field" id="m-email" type="email" required placeholder="email@gmail.com">
      <label class="sr" for="m-role">Vai trò</label>
      <select class="field" id="m-role"><option value="editor">Biên tập viên</option><option value="admin">Admin</option></select>
      <button class="btn btn-ink" type="submit">Thêm</button>
    </form>
    <ul class="list">${S.members.map((m) => {
      const me = m.email === S.email;
      return `<li class="mrow" data-email="${esc(m.email)}">
        <span class="email">${esc(m.email)}${me ? ' (bạn)' : ''}<small>Thêm ngày ${fmt(localDate(m.added_at))}</small></span>
        <span><label class="sr" for="r-${esc(m.email)}">Vai trò</label>
          <select class="field" id="r-${esc(m.email)}" data-role ${me ? 'disabled title="Không tự đổi vai trò của chính mình"' : ''}>
            <option value="editor" ${m.role === 'editor' ? 'selected' : ''}>Biên tập viên</option>
            <option value="admin" ${m.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select></span>
        <span class="acts">${me ? '' : `<button class="act danger ${S.armed === m.email ? 'armed' : ''}" data-mdel>${S.armed === m.email ? 'Bấm lần nữa để xoá' : 'Xoá'}</button>`}</span>
      </li>`; }).join('')}</ul>
    <div class="howto"><b>Cách cho người mới vào app</b>
      <ol><li>Thêm email của họ ở trên, chọn vai trò.</li><li>Gửi họ link app này.</li><li>Họ nhập email, mở hộp thư và bấm link đăng nhập là vào.</li></ol>
      Xoá một người khỏi danh sách thì lần mở app tiếp theo họ sẽ không xem được gì nữa.
    </div>
  </div>`;
}

/* ---------- Thao tác dữ liệu ---------- */
async function loadStories() {
  const { data, error } = await sb.from('stories').select('*').order('created_at', { ascending: false });
  if (error) { toast(viErr(error), true); return; }
  S.stories = data;
  refresh();
}

async function loadMembers() {
  if (!isAdmin()) return;
  const { data, error } = await sb.from('members').select('*').order('added_at');
  if (error) { toast(viErr(error), true); return; }
  S.members = data;
}

async function onUpload(e) {
  e.preventDefault();
  const title = $('#u-title').value.trim().replace(/\s+/g, ' ');
  const drive = $('#u-link').value.trim();
  const note = $('#u-note').value.trim();
  if (!title) { $('#u-title').focus(); return; }
  if (!/^https:\/\//i.test(drive)) { toast('Link Drive phải bắt đầu bằng https://', true); $('#u-link').focus(); return; }
  const dup = S.stories.find((s) => norm(s.title) === norm(title) || s.drive_url === drive);
  if (dup) { toast(`“${dup.title}” đã có trong kho (up ${ago(dup.created_at)}).`, true); return; }
  const btn = $('#u-submit'); btn.disabled = true; btn.textContent = 'Đang up…';
  const { data, error } = await sb.from('stories').insert({ title, drive_url: drive, note: note || null }).select().single();
  btn.disabled = false; btn.textContent = 'Up lên';
  if (error) { toast(viErr(error), true); return; }
  if (!byId(data.id)) S.stories.unshift(data);
  $('#u-title').value = ''; $('#u-link').value = ''; $('#u-note').value = '';
  $('#u-title').focus();
  toast(`Đã up “${title}”, đang chờ Admin duyệt`);
  if (S.tab !== 'cho-duyet') setTab('cho-duyet');
  refresh();
}

async function setAir(id, date) {
  const s = byId(id); if (!s) return;
  const prev = s.air_date;
  s.air_date = date; S.pick = null; S.sel = date && S.tab === 'lich' ? s.id : null;
  refresh();
  const { error } = await sb.from('stories').update({ air_date: date }).eq('id', s.id);
  if (error) { s.air_date = prev; refresh(); toast(viErr(error), true); return; }
  if (!date) { toast(`Đã bỏ lịch, “${s.title}” về Chờ Admin duyệt`); return; }
  const same = S.stories.filter((x) => x.air_date === date && x.id !== s.id).length;
  toast(`Đã lên lịch “${s.title}” vào ${dowLong(date)} ${fmt(date)}${same ? ` · ngày này đã có ${same} truyện khác` : ''}`);
}

async function removeStory(id) {
  const s = byId(id); if (!s) return;
  S.armed = null;
  S.stories = S.stories.filter((x) => x.id !== s.id);
  refresh();
  const { error } = await sb.from('stories').delete().eq('id', s.id);
  if (error) { S.stories.push(s); refresh(); toast(viErr(error), true); return; }
  toast(`Đã xoá “${s.title}”`);
}

function arm(key) {
  S.armed = key; renderPanel();
  clearTimeout(arm.t);
  arm.t = setTimeout(() => { if (S.armed === key) { S.armed = null; renderPanel(); } }, 4000);
}

/* ---------- Sự kiện trong vùng tab ---------- */
function wirePanel() {
  const panel = $('#panel');

  panel.addEventListener('input', (e) => {
    if (e.target.id === 'q') { S.q = e.target.value; const t = tabs().find((x) => x.id === S.tab); $('#list').innerHTML = listHTML(t); }
  });

  panel.addEventListener('click', async (e) => {
    const el = e.target.closest('button');
    if (!el) return;
    if (el.dataset.nav !== undefined) {
      const n = Number(el.dataset.nav), d = new Date();
      S.month = n === 0 ? new Date(d.getFullYear(), d.getMonth(), 1) : new Date(S.month.getFullYear(), S.month.getMonth() + n, 1);
      renderPanel(); return;
    }
    if (el.dataset.add) { S.pick = el.dataset.add; renderPanel(); $(`[data-pick="${el.dataset.add}"]`)?.focus(); return; }
    if (el.dataset.unsched) { setAir(el.dataset.unsched, null); return; }
    if (el.classList.contains('pill') && el.closest('.cell')) { S.sel = S.sel === Number(el.dataset.id) ? null : Number(el.dataset.id); renderPanel(); return; }
    if (el.hasAttribute('data-mdel')) {
      const email = el.closest('.mrow').dataset.email;
      if (S.armed !== email) { arm(email); return; }
      S.armed = null;
      const { error } = await sb.from('members').delete().eq('email', email);
      if (error) { toast(viErr(error), true); return; }
      S.members = S.members.filter((m) => m.email !== email);
      refresh(); toast(`Đã xoá ${email} khỏi app`);
      return;
    }
    const row = el.closest('.row'); if (!row) return;
    const id = Number(row.dataset.id);
    if (el.dataset.act === 'next') setAir(id, nextFree());
    if (el.dataset.act === 'del') { if (S.armed !== id) arm(id); else removeStory(id); }
  });

  panel.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.dataset.pick !== undefined) { if (el.value) setAir(el.value, el.dataset.pick); return; }
    if (el.dataset.act === 'date' && el.value) { setAir(el.closest('.row').dataset.id, el.value); return; }
    if (el.hasAttribute('data-role')) {
      const email = el.closest('.mrow').dataset.email;
      const { error } = await sb.from('members').update({ role: el.value }).eq('email', email);
      if (error) { toast(viErr(error), true); await loadMembers(); refresh(); return; }
      const m = S.members.find((x) => x.email === email); if (m) m.role = el.value;
      toast(`${email} giờ là ${el.value === 'admin' ? 'Admin' : 'Biên tập viên'}`);
    }
  });

  panel.addEventListener('focusout', (e) => {
    const k = e.target.dataset?.pick;
    if (k && !e.target.value && S.pick === k) setTimeout(() => { if (S.pick === k) { S.pick = null; renderPanel(); } }, 150);
  });

  panel.addEventListener('submit', async (e) => {
    if (e.target.id !== 'madd') return;
    e.preventDefault();
    const email = $('#m-email').value.trim().toLowerCase();
    const role = $('#m-role').value;
    if (S.members.some((m) => m.email === email)) { toast('Email này đã có trong danh sách', true); return; }
    const { data, error } = await sb.from('members').insert({ email, role }).select().single();
    if (error) { toast(viErr(error), true); return; }
    S.members.push(data);
    refresh(); toast(`Đã thêm ${email}. Gửi họ link app để đăng nhập.`);
  });
}

/* ---------- Kéo-thả trên lịch (chỉ Admin) ---------- */
let dragId = null;
document.addEventListener('dragstart', (e) => {
  const p = e.target.closest?.('.pill');
  if (!p || p.getAttribute('draggable') !== 'true') return;
  dragId = Number(p.dataset.id);
  e.dataTransfer.setData('text/plain', p.dataset.id);
  e.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragend', () => { dragId = null; document.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); });
const zone = (el) => el.closest?.('.cell:not(.past)') || el.closest?.('#tray');
document.addEventListener('dragover', (e) => {
  if (dragId == null) return;
  const z = zone(e.target); if (!z) return;
  e.preventDefault();
  document.querySelectorAll('.over').forEach((x) => x !== z && x.classList.remove('over'));
  z.classList.add('over');
});
document.addEventListener('drop', (e) => {
  if (dragId == null) return;
  const z = zone(e.target); if (!z) return;
  e.preventDefault();
  const id = dragId; dragId = null;
  setAir(id, z.id === 'tray' ? null : z.dataset.date);
});

/* ---------- Realtime: ai up / sửa truyện thì mọi người tự thấy ---------- */
let reloadT;
function subscribe() {
  if (S.channel) sb.removeChannel(S.channel);
  S.channel = sb.channel('kho-stories')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'stories' }, () => {
      clearTimeout(reloadT); reloadT = setTimeout(loadStories, 300);
    })
    .subscribe((st) => { S.live = st === 'SUBSCRIBED'; updateLive(); });
}
function updateLive() {
  const el = $('#live'); if (!el) return;
  el.classList.toggle('on', S.live);
  el.textContent = S.live ? 'Trực tiếp' : 'Đang kết nối…';
}

// Mở lại tab trình duyệt thì tải lại để trạng thái theo ngày luôn đúng
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.role) loadStories(); });
// Đổi giữa lịch tháng và lịch dạng danh sách khi xoay / thu nhỏ màn hình
matchMedia('(max-width: 700px)').addEventListener('change', () => { if (S.tab === 'lich' && $('#panel')) renderPanel(); });
window.addEventListener('hashchange', () => {
  const h = location.hash.slice(1);
  if (S.role && h !== S.tab && tabs().some((t) => t.id === h)) setTab(h);
});

/* ---------- Đăng nhập ---------- */
async function onSession(session) {
  if (!session) {
    S.userId = null; S.role = null; S.stories = []; S.members = [];
    if (S.channel) { sb.removeChannel(S.channel); S.channel = null; }
    showLogin();
    return;
  }
  if (S.userId === session.user.id && S.role) return; // đã tải rồi (ví dụ khi làm mới phiên)
  S.userId = session.user.id;
  S.email = (session.user.email || '').toLowerCase();
  const { data: role, error } = await sb.rpc('my_role');
  if (error) {
    card(`<h1>Không tải được</h1><p>${esc(viErr(error))}</p><button class="btn btn-ghost" id="retry">Thử lại</button>`);
    $('#retry').onclick = () => { S.userId = null; onSession(session); };
    return;
  }
  S.role = role;
  if (!role) { showNoAccess(); return; }
  showApp();
  await loadMembers();
  await loadStories();
  subscribe();
}

sb.auth.onAuthStateChange((event, session) => {
  // Gọi Supabase ngoài callback để tránh treo (khuyến nghị của supabase-js)
  if (['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT'].includes(event)) setTimeout(() => onSession(session), 0);
});
