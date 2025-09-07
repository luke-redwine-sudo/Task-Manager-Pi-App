const $ = (sel) => document.querySelector(sel);

// Views & lists
const homeView = $("#homeView");
const manageView = $("#manageView");
const taskList = $("#taskList");
const completedList = $("#completedList");
const manageList = $("#manageList");

// Sheet & form
const sheet = $("#taskSheet");
const form = $("#taskForm");
const cancelSheet = $("#cancelSheet");
const freqUnitSel = document.getElementById("freqUnit");
const onceRow      = document.getElementById("onceRow");
const dueDateInput = document.getElementById("dueDate");
const dueTimeInput = document.getElementById("dueTime");
let editingId = null;

// OSK
const osk = $("#osk");
const oskRows = $("#oskRows");
let oskShift = false;
let oskLayout = 'text';
let oskTarget = null;

/* ---- Eastern Time formatter + safe UTC parsing ---- */
const fmtET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  dateStyle: 'short',
  timeStyle: 'medium',
});
function toUTCDate(v){
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const hasOffset = /[Zz]|[+-]\d\d:?\d\d$/.test(v);
    return new Date(hasOffset ? v : v + 'Z');
  }
  return new Date(v);
}
const formatET = (v) => fmtET.format(toUTCDate(v));

/* --- ET day key helpers (YYYY-MM-DD in ET) --- */
const dayKeyETFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit'
});
const etDayKey = (v) => dayKeyETFmt.format(toUTCDate(v));
let currentDayKey = etDayKey(new Date());

/* ---- Congrats banner ---- */
const banner = document.getElementById('congratsBanner');
let bannerTimer = null;
function showCongrats(msg = "🎉 Congratulations, you did it!") {
  if (banner) {
    banner.textContent = msg;
    banner.classList.add('show');
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => banner.classList.remove('show'), 4500);
  }

  // 🦄 swap unicorn image briefly
  if (unicornImg) {
    const idle = unicornImg.dataset.srcIdle || unicornImg.src;
    const party = unicornImg.dataset.srcCelebrate || idle;
    unicornImg.src = party;
    clearTimeout(unicornImg._swapTimer);
    unicornImg._swapTimer = setTimeout(() => { unicornImg.src = idle; }, 4000);
  }
}
if (banner) banner.addEventListener('click', () => banner.classList.remove('show'));

// Clock in ET (auto-refresh lists at midnight ET)
function tickClock(){
  const now = new Date();
  $("#clock").textContent = formatET(now);
  const key = etDayKey(now);
  if (key !== currentDayKey) {
    currentDayKey = key;   // new day in ET
    fetchAll();            // re-render so Completed clears for the new day
  }
}
setInterval(tickClock, 1000); tickClock();

// Fetch
async function fetchAll(){
  const [tasksRes, logsRes] = await Promise.all([
    fetch('/api/tasks'),
    fetch('/api/logs')
  ]);
  const [tasks, logs] = await Promise.all([tasksRes.json(), logsRes.json()]);
  renderHome(tasks, logs);
  renderManage(tasks);
}

function isDueToday(dueISO){
  const now = new Date();
  const end = new Date(now);
  end.setHours(23,59,59,999);
  const due = toUTCDate(dueISO);
  return due <= end; // includes overdue
}

/* ---------- Frequency → class ---------- */
function freqClass(unit){
  const u = (unit || '').toLowerCase();
  if (u === 'days' || u === 'day') return 'freq-days';
  if (u === 'weeks' || u === 'week') return 'freq-weeks';
  if (u === 'months' || u === 'month') return 'freq-months';
  if (u === 'once') return 'freq-once';
  return '';
}

/* ---------- HOME view ---------- */
function renderHome(tasks, logs){
  taskList.innerHTML='';
  completedList.innerHTML='';

  // Map task_id -> freq_unit for log coloring
  const freqMap = new Map(tasks.map(t => [t.id, t.freq_unit]));

  // Tasks due today
  tasks
    .filter(t => t.is_active && isDueToday(t.due_at))
    .sort((a,b)=> toUTCDate(a.due_at)-toUTCDate(b.due_at))
    .forEach(t => taskList.append(taskRow(t)));

  // Completed list (today only in ET, color-coded)
  logs
    .filter(l => etDayKey(l.done_at) === currentDayKey)
    .slice(0,20)
    .forEach(l => {
      const fc = freqClass(freqMap.get(l.task_id));
      const row = document.createElement('div');
      row.className = 'card task';
      if (fc) row.classList.add(fc);

      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = l.title || '(untitled)';

      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `Completed: ${formatET(l.done_at)}`;

      const left = document.createElement('div');
      left.append(title, meta);

      row.append(left); // no actions for completed items
      completedList.append(row);
    });
}

/* ---------- MANAGE view ---------- */
function renderManage(tasks){
  manageList.innerHTML='';
  // Hide completed one-off tasks from Manage
  tasks
    .filter(t => !(t.freq_unit === 'once' && !t.is_active))
    .forEach(t => manageList.append(manageRow(t)));
}

function taskRow(t){
  const row = document.createElement('div');
  row.className = 'card task';
  const fc = freqClass(t.freq_unit);
  if (fc) row.classList.add(fc);

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = t.title;

  const meta = document.createElement('div');
  meta.className = 'meta';
  const last = t.last_done ? formatET(t.last_done) : 'never';
  const freqLabel = (t.freq_unit === 'once') ? 'One-off' :
                    (t.freq_unit === 'months' || t.freq_unit === 'month') ?
                    `Every ${t.freq_value} months` : `Every ${t.freq_value} ${t.freq_unit}`;
  meta.textContent = `Last: ${last} • ${freqLabel}`;

  const left = document.createElement('div');
  left.append(title, meta);

  // Actions cluster (✓ green, ✎ yellow, 🗑 red)
  const actions = document.createElement('div');
  actions.className = 'actions';

  const doneBtn = iconBtn('✓', 'Mark complete', async () => {
    const res = await fetch(`/api/tasks/${t.id}/complete`, {method:'POST'});
    if (res.ok) showCongrats();
    await fetchAll();
  }, 'ok');
  const editBtn = iconBtn('✎', 'Edit', () => openEdit(t), 'warn');
  const delBtn  = iconBtn('🗑', 'Delete', async () => {
    if(confirm(`Delete “${t.title}”?`)){
      await fetch(`/api/tasks/${t.id}`, {method:'DELETE'});
      await fetchAll();
    }
  }, 'danger');

  actions.append(doneBtn, editBtn, delBtn);
  row.append(left, actions);
  return row;
}

function manageRow(t){
  const row = document.createElement('div');
  row.className = 'card task';

  // frequency-based color on manage page
  const fc = freqClass(t.freq_unit);
  if (fc) row.classList.add(fc);

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = t.title;

  const meta = document.createElement('div');
  meta.className = 'meta';
  const freqLabel = (t.freq_unit === 'once') ? 'One-off' :
                    (t.freq_unit === 'months' || t.freq_unit === 'month')
                      ? `Every ${t.freq_value} months`
                      : `Every ${t.freq_value} ${t.freq_unit}`;
  meta.textContent = `${freqLabel} • Active: ${t.is_active ? 'Yes' : 'No'}`;

  const left = document.createElement('div'); left.append(title, meta);

  // colored action buttons
  const editBtn = iconBtn('✎', 'Edit', () => openEdit(t), 'warn');
  const delBtn  = iconBtn('🗑', 'Delete', async () => {
    if (confirm(`Delete “${t.title}”?`)) {
      await fetch(`/api/tasks/${t.id}`, { method: 'DELETE' });
      await fetchAll();
    }
  }, 'danger');

  const actions = document.createElement('div');
  actions.className='actions';
  actions.append(editBtn, delBtn);

  row.append(left, actions);
  return row;
}

function iconBtn(text, title, onClick, colorClass=''){
  const b = document.createElement('button');
  b.className = 'iconbtn' + (colorClass ? ' ' + colorClass : '');
  b.title = title;
  b.textContent = text;
  b.onclick = onClick;
  return b;
}

/* ---------- One-off helpers ---------- */
function toUTCFromLocalDateTime(dateStr, timeStr){
  if(!dateStr) return null;
  let [y,m,d] = dateStr.split("-").map(Number);
  let hh = 0, mm = 0;
  if (timeStr && timeStr.includes(":")) {
    [hh, mm] = timeStr.split(":").map(Number);
  }
  const local = new Date(y, (m||1)-1, d||1, hh||0, mm||0, 0);
  return new Date(local.getTime() - local.getTimezoneOffset()*60000).toISOString();
}
function setOneOffFieldsFromISO(iso){
  if(!iso || !dueDateInput || !dueTimeInput) return;
  const d = toUTCDate(iso);
  const pad = n => String(n).padStart(2,"0");
  dueDateInput.value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  dueTimeInput.value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function syncOnceVisibility(){
  if (!freqUnitSel || !onceRow) return;
  const isOnce = freqUnitSel.value === 'once';
  onceRow.style.display = isOnce ? '' : 'none';
  if (form.freq_value) form.freq_value.required = !isOnce;
  if (dueDateInput) dueDateInput.required = isOnce;
  if (dueTimeInput) dueTimeInput.required = isOnce;
}
if (freqUnitSel) freqUnitSel.addEventListener('change', syncOnceVisibility);

/* ---------- Sheet open/close ---------- */
function openAdd(){
  editingId = null;
  $("#modalTitle").textContent = 'Add Task';
  form.reset();
  if (freqUnitSel) freqUnitSel.value = 'days';
  syncOnceVisibility();

  // default one-off fields to today / next quarter-hour
  if (dueDateInput && dueTimeInput){
    const now = new Date();
    const pad = n => String(n).padStart(2,"0");
    const roundedMin = Math.ceil(now.getMinutes()/15)*15;
    dueDateInput.value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
    const hh = (roundedMin === 60) ? (now.getHours()+1) % 24 : now.getHours();
    const mm = (roundedMin === 60) ? 0 : roundedMin;
    dueTimeInput.value = `${pad(hh)}:${pad(mm)}`;
  }

  sheet.classList.remove('hidden');
  focusAtEnd(form.title);
}
function openEdit(t){
  editingId = t.id;
  $("#modalTitle").textContent = 'Edit Task';
  form.title.value = t.title;
  if (form.notes) form.notes.value = t.notes || '';
  if (form.freq_value) form.freq_value.value = t.freq_value;
  if (form.freq_unit) form.freq_unit.value = t.freq_unit;
  syncOnceVisibility();

  if ((t.freq_unit === 'once') && t.due_at) {
    setOneOffFieldsFromISO(t.due_at);
  } else if (dueDateInput && dueTimeInput) {
    dueDateInput.value = '';
    dueTimeInput.value = '';
  }

  sheet.classList.remove('hidden');
  focusAtEnd(form.title);
}
function closeSheet(){
  sheet.classList.add('hidden');
  hideOSK();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const isOnce = form.freq_unit && form.freq_unit.value === 'once';

  const payload = {
    title: form.title.value.trim(),
    notes: form.notes ? form.notes.value.trim() : '',
    freq_value: isOnce ? 0 : Number(form.freq_value ? form.freq_value.value : 0),
    freq_unit: form.freq_unit ? form.freq_unit.value : 'days',
  };

  if (isOnce) {
    const dueISO = toUTCFromLocalDateTime(
      dueDateInput ? dueDateInput.value : '',
      dueTimeInput ? dueTimeInput.value : ''
    );
    if (!dueISO) { alert('Please choose a due date & time'); return; }
    payload.due_at = dueISO;
  }

  if(!payload.title) return;

  if(editingId){
    await fetch(`/api/tasks/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
  } else {
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
  }
  closeSheet();
  await fetchAll();
});

// Nav buttons
const addBtn = $("#addBtn");
if (addBtn) addBtn.onclick = openAdd;
const manageBtn = $("#manageBtn");
if (manageBtn) manageBtn.onclick = () => { homeView.classList.add('hidden'); manageView.classList.remove('hidden'); };
const backHome = $("#backHome");
if (backHome) backHome.onclick = () => { manageView.classList.add('hidden'); homeView.classList.remove('hidden'); };
if (cancelSheet) cancelSheet.onclick = closeSheet;

/* -------- On-Screen Keyboard (OSK) -------- */
const layouts = {
  text: [
    ['q','w','e','r','t','y','u','i','o','p'],
    ['a','s','d','f','g','h','j','k','l'],
    ['⇧','z','x','c','v','b','n','m','⌫'],
    ['123','space','enter','✕']
  ],
  number: [
    ['1','2','3'],
    ['4','5','6'],
    ['7','8','9'],
    ['⌫','0','✕']
  ]
};

function buildOSK(){
  if (!oskRows) return;
  oskRows.innerHTML='';
  layouts[oskLayout].forEach(keys => {
    const r=document.createElement('div'); r.className='osk-row';
    keys.forEach(k=>{
      const b=document.createElement('button'); b.type='button';
      b.className='osk-key'+(k==='space'?' space':'')+(k==='enter'?' wide':'');
      b.textContent=oskShift && k.length===1 ? k.toUpperCase():k; b.dataset.key=k;
      b.addEventListener('mousedown', (e)=>e.preventDefault());
      b.addEventListener('touchstart', (e)=>e.preventDefault(), {passive:false});
      b.addEventListener('click', onOskKey);
      r.appendChild(b);
    }); oskRows.appendChild(r);
  });
}

function showOSK(target){
  if (!osk) return;
  oskTarget = target;
  oskLayout = (target.type === 'number') ? 'number' : 'text';
  oskShift = false; buildOSK();
  sheet.appendChild(osk);
  osk.hidden = false;
  focusAtEnd(oskTarget);
}
function hideOSK(){ if (osk) osk.hidden = true; oskTarget=null; }

function focusAtEnd(el){
  el.focus({preventScroll:true});
  try { const len = (el.value || '').length; el.setSelectionRange(len, len); } catch(_){}
}

function insertAtCursor(el, text){
  if (document.activeElement !== el) focusAtEnd(el);
  const supportsSel = (typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number');
  if (!supportsSel || el.type === 'number') {
    el.value = (el.value || '') + text;
    try { focusAtEnd(el); } catch(_){}
  } else {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    el.value = before + text + after;
    const pos = start + text.length;
    try { el.setSelectionRange(pos, pos); } catch(_){}
  }
  el.dispatchEvent(new Event('input',{bubbles:true}));
}

function onOskKey(e){
  e.preventDefault();
  if(!oskTarget) return;
  focusAtEnd(oskTarget);

  const key=e.currentTarget.dataset.key;
  if(key==='✕' || key==='close'){ hideOSK(); return; }
  if(key==='⌫'){
    const supportsSel = (typeof oskTarget.selectionStart === 'number' && typeof oskTarget.selectionEnd === 'number');
    if (!supportsSel || oskTarget.type === 'number') {
      oskTarget.value = (oskTarget.value || '').slice(0, -1);
      oskTarget.dispatchEvent(new Event('input',{bubbles:true}));
      focusAtEnd(oskTarget);
      return;
    }
    const s=oskTarget.selectionStart??oskTarget.value.length;
    const en=oskTarget.selectionEnd??oskTarget.value.length;
    if(s===en && s>0){
      oskTarget.value=oskTarget.value.slice(0,s-1)+oskTarget.value.slice(en);
      const pos=s-1; try{ oskTarget.setSelectionRange(pos,pos);}catch(_){}
    } else {
      oskTarget.value=oskTarget.value.slice(0,s)+oskTarget.value.slice(en);
      try{ oskTarget.setSelectionRange(s,s);}catch(_){}
    }
    oskTarget.dispatchEvent(new Event('input',{bubbles:true}));
    return;
  }
  if(key==='space'){ insertAtCursor(oskTarget,' '); return; }
  if(key==='enter'){
    if(oskTarget.tagName==='TEXTAREA') insertAtCursor(oskTarget,'\n');
    else oskTarget.blur();
    return;
  }
  if(key==='⇧'){ oskShift=!oskShift; buildOSK(); return; }
  if(key==='123' || key==='ABC'){ oskLayout = oskLayout==='text' ? 'number' : 'text'; buildOSK(); return; }
  const char = oskShift ? key.toUpperCase() : key;
  insertAtCursor(oskTarget, char);
}

const unicornImg = document.getElementById('unicornImg');
if (unicornImg) {
  unicornImg.dataset.srcIdle = unicornImg.getAttribute('src');
  if (!unicornImg.dataset.srcCelebrate) {
    unicornImg.dataset.srcCelebrate = '/img/unicorn_celebrate.png';
  }
}

// Show OSK for relevant controls
document.addEventListener('focusin', (e) => {
  const t=e.target; if(!(t instanceof HTMLElement)) return;
  const wants = t.matches('input[type="text"], input:not([type]), textarea, input[type="number"]');
  if (wants) showOSK(t);
});

/* ---------- Custom Date/Time Picker (for platforms without native pickers) ---------- */
const picker = $('#picker');
const pickerTitle = $('#pickerTitle');
const pickerCal = $('#pickerCalendar');
const pickerPrev = $('#pickerPrev');
const pickerNext = $('#pickerNext');
const pickerCancel = $('#pickerCancel');
const pickerOk = $('#pickerOk');
const hVal = $('#hVal'), mVal = $('#mVal');
const hInc = $('#hInc'), hDec = $('#hDec'), mInc = $('#mInc'), mDec = $('#mDec');

let pickDate; // Date object (local)
let pickHour = 0, pickMin = 0;
let activeTarget = null; // 'date' | 'time' | 'both'

function openPicker(mode){
  activeTarget = mode;
  const now = new Date();
  const seedDate = (dueDateInput && dueDateInput.value)
      ? new Date(dueDateInput.value+'T00:00:00')
      : now;
  pickDate = new Date(seedDate.getFullYear(), seedDate.getMonth(), seedDate.getDate());
  if (dueTimeInput && dueTimeInput.value) {
    const [hh,mm] = dueTimeInput.value.split(':').map(x=>parseInt(x,10)||0);
    pickHour = hh; pickMin = mm;
  } else {
    pickHour = now.getHours();
    pickMin = Math.ceil(now.getMinutes()/15)*15; if (pickMin===60){pickMin=0; pickHour=(pickHour+1)%24;}
  }
  updateTimeDisplays();
  buildCalendar();
  picker.classList.remove('hidden');
  hideOSK();
}
function closePicker(){ picker.classList.add('hidden'); }

function monthTitle(d){
  return d.toLocaleString(undefined,{month:'long', year:'numeric'});
}
function buildCalendar(){
  pickerTitle.textContent = monthTitle(pickDate);
  const y = pickDate.getFullYear(), m = pickDate.getMonth();
  const first = new Date(y,m,1);
  const startIdx = (first.getDay()+6)%7; // Mon=0
  const daysInMonth = new Date(y,m+1,0).getDate();

  const dow = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  pickerCal.innerHTML = '';
  dow.forEach(d=>{
    const el = document.createElement('div');
    el.className = 'dow';
    el.textContent = d;
    pickerCal.appendChild(el);
  });

  for (let i=0;i<startIdx;i++){
    const b = document.createElement('div'); b.className='day off'; pickerCal.appendChild(b);
  }
  for (let day=1; day<=daysInMonth; day++){
    const d = document.createElement('button');
    d.type='button'; d.className='day';
    d.textContent = String(day);
    if (day===pickDate.getDate()) d.classList.add('sel');
    d.onclick = ()=>{
      pickDate = new Date(y,m,day);
      if (activeTarget==='date'){
        applyPickToInputs();
        closePicker();
      } else {
        buildCalendar();
      }
    };
    pickerCal.appendChild(d);
  }
}

function updateTimeDisplays(){
  const pad=n=>String(n).padStart(2,'0');
  hVal.textContent = pad(pickHour);
  mVal.textContent = pad(pickMin);
}
hInc.onclick = ()=>{ pickHour=(pickHour+1)%24; updateTimeDisplays(); };
hDec.onclick = ()=>{ pickHour=(pickHour+23)%24; updateTimeDisplays(); };
mInc.onclick = ()=>{ pickMin=(pickMin+15)%60; updateTimeDisplays(); };
mDec.onclick = ()=>{ pickMin=(pickMin+45)%60; updateTimeDisplays(); };

pickerPrev.onclick = ()=>{ pickDate = new Date(pickDate.getFullYear(), pickDate.getMonth()-1, Math.min(28,pickDate.getDate())); buildCalendar(); };
pickerNext.onclick = ()=>{ pickDate = new Date(pickDate.getFullYear(), pickDate.getMonth()+1, Math.min(28,pickDate.getDate())); buildCalendar(); };
pickerCancel.onclick = closePicker;
pickerOk.onclick = ()=>{ applyPickToInputs(); closePicker(); };

function applyPickToInputs(){
  if (dueDateInput){
    const pad=n=>String(n).padStart(2,'0');
    dueDateInput.value = `${pickDate.getFullYear()}-${pad(pickDate.getMonth()+1)}-${pad(pickDate.getDate())}`;
  }
  if (dueTimeInput){
    const pad=n=>String(n).padStart(2,'0');
    dueTimeInput.value = `${pad(pickHour)}:${pad(pickMin)}`;
  }
  dueDateInput?.dispatchEvent(new Event('input',{bubbles:true}));
  dueTimeInput?.dispatchEvent(new Event('input',{bubbles:true}));
}

// Always use our picker on Pi (more reliable), but still keep inputs for value display
if (dueDateInput){
  dueDateInput.addEventListener('focus', (e)=>{ e.preventDefault(); dueDateInput.blur(); openPicker('date'); });
  dueDateInput.addEventListener('click', (e)=>{ e.preventDefault(); dueDateInput.blur(); openPicker('date'); });
}
if (dueTimeInput){
  dueTimeInput.addEventListener('focus', (e)=>{ e.preventDefault(); dueTimeInput.blur(); openPicker('time'); });
  dueTimeInput.addEventListener('click', (e)=>{ e.preventDefault(); dueTimeInput.blur(); openPicker('time'); });
}

// Boot
fetchAll();
