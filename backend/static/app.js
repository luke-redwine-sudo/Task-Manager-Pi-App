const $ = (sel) => document.querySelector(sel);
const taskList = $("#taskList");
const completedList = $("#completedList");
const modal = $("#taskModal");
const form = $("#taskForm");
let editingId = null;


function tickClock(){
    const d = new Date();
    $("#clock").textContent = d.toLocaleString();
}
setInterval(tickClock, 1000); tickClock();


async function fetchTasks(){
    const res = await fetch('/api/tasks');
    const data = await res.json();
    render(data);
}


function render(tasks){
    taskList.innerHTML = '';
    completedList.innerHTML = '';
    const recent = [...tasks].filter(t => t.last_done).sort((a,b)=> b.last_done.localeCompare(a.last_done)).slice(0,8);


    tasks.forEach(t => {
        const row = document.createElement('div');
        row.className = 'card task';


        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = t.title;


        const meta = document.createElement('div');
        meta.className = 'meta';
        const last = t.last_done ? new Date(t.last_done).toLocaleString() : 'never';
        const due = new Date(t.due_at);
        const now = new Date();
        const badge = document.createElement('span');
        badge.className = 'badge ' + (t.is_due ? 'due' : 'ok');
        badge.textContent = t.is_due ? 'Due' : `Due ${due.toLocaleString()}`;
        meta.textContent = `Last: ${last} • Every ${t.freq_value} ${t.freq_unit}`;


        const left = document.createElement('div');
        left.append(title, meta);


        const doneBtn = document.createElement('button');
        doneBtn.className = 'iconbtn';
        doneBtn.title = 'Mark complete';
        doneBtn.textContent = '✓';
        doneBtn.onclick = async () => {
            await fetch(`/api/tasks/${t.id}/complete`, {method:'POST'});
            await fetchTasks();
        }


        const editBtn = document.createElement('button');
        editBtn.className = 'iconbtn';
        editBtn.title = 'Edit';
        editBtn.textContent = '✎';
        editBtn.onclick = () => openEdit(t);


        row.append(left, badge, doneBtn, editBtn);
        taskList.append(row);
    });


    recent.forEach(t => {
        const row = document.createElement('div');
        row.className = 'card';
        const last = t.last_done ? new Date(t.last_done).toLocaleString() : '';
        row.textContent = `${t.title} — done ${last}`;


        completedList.append(row);
    });
}


function openAdd(){
    editingId = null;
    $("#modalTitle").textContent = 'Add Task';
    form.reset();
    modal.showModal();
}


function openEdit(t){
    editingId = t.id;
    $("#modalTitle").textContent = 'Edit Task';
    form.title.value = t.title;
    form.notes.value = t.notes || '';
    form.freq_value.value = t.freq_value;
    form.freq_unit.value = t.freq_unit;
    modal.showModal();
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
    modal.close();
    await fetchTasks();
});


$("#addBtn").onclick = openAdd;
$("#removeBtn").onclick = async () => {
    const id = prompt('Enter Task ID to remove');
    if(!id) return;
        await fetch(`/api/tasks/${id}`, {method:'DELETE'});
        await fetchTasks();
}
$("#editBtn").onclick = async () => {
    const id = prompt('Enter Task ID to edit');
    if(!id) return;
    const res = await fetch('/api/tasks');
    const tasks = await res.json();
    const t = tasks.find(x => x.id == id);
    if(t) openEdit(t);
};


fetchTasks();