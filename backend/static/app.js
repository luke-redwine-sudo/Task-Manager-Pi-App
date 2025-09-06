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
// Convert ISO from backend to a Date assuming UTC if offset is missing
function toUTCDate(v){
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const hasOffset = /[Zz]|[+-]\d\d:?\d\d$/.test(v);
    return new Date(hasOffset ? v : v + 'Z');
  }
  return new Date(v);
}
const formatET = (v) => fmtET.format(toUTCDate(v));

// Clock in ET
function tickClock(){ $("#clock").textContent = formatET(new Date()); }
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

// HOME view: only tasks due today; no due text
function renderHome(tasks, logs){
  taskList.innerHTML='';
  completedList.innerHTML='';

  tasks.filter(t => t.is_active && isDueToday(t.due_at))
       .sort((a,b)=> toUTCDate(a.due_at)-toUTCDate(b.due_at))
       .forEach(t => taskList.append(taskRow(t)));

  // Completed list times in ET
  logs.slice(0,20).forEach(l => {
    const row = document.createElement('div');
    row.className = 'card';
    row.textContent = `${l.title || '(untitled)'} — done ${formatET(l.done_at)}`;
    completedList.append(row);
  });
}

// MANAGE view: all tasks with edit/remove
function renderManage(tasks){
  manageList.innerHTML='';
  tasks.forEach(t => manageList.append(manageRow(t)));
}

function taskRow(t){
  const row = document.createElement('div');
  row.className = 'card task';

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = t.title;

  const meta = document.createElement('div');
  meta.className = 'meta';
  const last = t.last_done ? formatET(t.last_done) : 'never';
  meta.textContent = `Last: ${last} • Every ${t.freq_value} ${t.freq_unit}`;

  const left = document.createElement('div');
  left.append(title, meta);

  // Actions cluster (check, edit, trash)
  const actions = document.createElement('div');
  actions.className = 'actions';

  const doneBtn = iconBtn('✓', 'Mark complete', async () => {
    await fetch(`/api/tasks/${t.id}/complete`, {method:'POST'});
    await fetchAll();
  });
  const editBtn = iconBtn('✎', 'Edit', () => openEdit(t));
  const delBtn  = iconBtn('🗑', 'Delete', async () => {
    if(confirm(`Delete “${t.title}”?`)){
      await fetch(`/api/tasks/${t.id}`, {method:'DELETE'});
      await fetchAll();
    }
  });

  actions.append(doneBtn, editBtn, delBtn);
  row.append(left, actions);
  return row;
}

function manageRow(t){
  const row = document.createElement('div');
  row.className = 'card task';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = t.title;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `Every ${t.freq_value} ${t.freq_unit} • Active: ${t.is_active ? 'Yes' : 'No'}`;
  const left = document.createElement('div'); left.append(title, meta);
  const editBtn = iconBtn('✎', 'Edit', () => openEdit(t));
  const delBtn  = iconBtn('🗑', 'Delete', async () => {
    if(confirm(`Delete “${t.title}”?`)){
      await fetch(`/api/tasks/${t.id}`, {method:'DELETE'});
      await fetchAll();
    }
  });
  const actions = document.createElement('div'); actions.className='actions'; actions.append(editBtn, delBtn);
  row.append(left, actions);
  return row;
}

function iconBtn(text, title, onClick){
  const b = document.createElement('button');
  b.className = 'iconbtn'; b.title = title; b.textContent = text; b.onclick = onClick; return b;
}

/* ---------- Sheet open/close ---------- */
function openAdd(){
  editingId = null;
  $("#modalTitle").textContent = 'Add Task';
  form.reset();
  sheet.classList.remove('hidden');
  focusAtEnd(form.title);
}
function openEdit(t){
  editingId = t.id;
  $("#modalTitle").textContent = 'Edit Task';
  form.title.value = t.title;
  form.notes.value = t.notes || '';
  form.freq_value.value = t.freq_value;
  form.freq_unit.value = t.freq_unit;
  sheet.classList.remove('hidden');
  focusAtEnd(form.title);
}
function closeSheet(){
  sheet.classList.add('hidden');
  hideOSK();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    title: form.title.value.trim(),
    notes: form.notes.value.trim(),
    freq_value: Number(form.freq_value.value),
    freq_unit: form.freq_unit.value,
  };
  if(!payload.title) return;

  if(editingId){
    await fetch(`/api/tasks/${editingId}`, { method: 'PUT', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload)});
  } else {
    await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload)});
  }
  closeSheet();
  await fetchAll();
});

// Nav buttons
$("#addBtn").onclick = openAdd;
$("#manageBtn").onclick = () => { homeView.classList.add('hidden'); manageView.classList.remove('hidden'); };
$("#backHome").onclick = () => { manageView.classList.add('hidden'); homeView.classList.remove('hidden'); };
cancelSheet.onclick = closeSheet;

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
  oskRows.innerHTML='';
  layouts[oskLayout].forEach(keys => {
    const r=document.createElement('div'); r.className='osk-row';
    keys.forEach(k=>{
      const b=document.createElement('button'); b.type='button';
      b.className='osk-key'+(k==='space'?' space':'')+(k==='enter'?' wide':'');
      b.textContent=oskShift && k.length===1 ? k.toUpperCase():k; b.dataset.key=k;
      // Prevent input losing focus on mousedown/touchstart
      b.addEventListener('mousedown', (e)=>e.preventDefault());
      b.addEventListener('touchstart', (e)=>e.preventDefault(), {passive:false});
      b.addEventListener('click', onOskKey);
      r.appendChild(b);
    }); oskRows.appendChild(r);
  });
}

function showOSK(target){
  oskTarget = target;
  oskLayout = (target.type === 'number') ? 'number' : 'text';
  oskShift = false; buildOSK();
  sheet.appendChild(osk); // keep keyboard within sheet
  osk.hidden = false;
  focusAtEnd(oskTarget);
}
function hideOSK(){ osk.hidden = true; oskTarget=null; }

function focusAtEnd(el){
  el.focus({preventScroll:true});
  try {
    const len = (el.value || '').length;
    el.setSelectionRange(len, len);
  } catch(_) {
    /* setSelectionRange isn't supported on type=number in some browsers */
  }
}

function insertAtCursor(el, text){
  if (document.activeElement !== el) focusAtEnd(el);
  const supportsSel = (typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number');
  if (!supportsSel || el.type === 'number') {
    el.value = (el.value || '') + text;
    try { focusAtEnd(el); } catch(_) {}
  } else {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    el.value = before + text + after;
    const pos = start + text.length;
    try { el.setSelectionRange(pos, pos); } catch(_) {}
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

// Show OSK for relevant controls
function wantsOSK(el){ return el.matches('input[type="text"], input:not([type]), textarea, input[type="number"]'); }
document.addEventListener('focusin', (e) => {
  const t=e.target; if(!(t instanceof HTMLElement)) return; if(wantsOSK(t)) showOSK(t);
});

// Boot
fetchAll();
