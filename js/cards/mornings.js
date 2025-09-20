// js/mornings.js
// Simple task table with localStorage persistence (per device/browser)

const STORAGE_KEY = 'morningTasks_v1';

const taskBody = document.getElementById('taskBody');
const addBtn   = document.getElementById('addTaskBtn');

let tasks = []; // [{ id: number, text: string }]

// ---- storage helpers ----
function loadTasks() 
{
  try 
  {
    const raw = localStorage.getItem(STORAGE_KEY);
    tasks = raw ? JSON.parse(raw) : [];
  } catch {
    tasks = [];
  }
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

// ---- rendering ----
function render() {
  taskBody.innerHTML = '';

  tasks.forEach((t, idx) => {
    const tr = document.createElement('tr');

    // NO column (1-based index)
    const tdNo = document.createElement('td');
    tdNo.textContent = String(idx + 1);
    tdNo.style.opacity = 0.85;
    tr.appendChild(tdNo);

    // Task column (editable input)
    const tdTask = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'task-input';
    input.value = t.text || '';
    input.placeholder = 'Type your task…';
    input.dataset.id = String(t.id);
    tdTask.appendChild(input);
    tr.appendChild(tdTask);

    // Status column (placeholder for later)
    const tdStatus = document.createElement('td');
    tdStatus.style.opacity = 0.7;
    tdStatus.textContent = '—'; // we’ll add icons later
    tr.appendChild(tdStatus);

    taskBody.appendChild(tr);
  });
}

// ---- interactions ----
function addTask() {
  const nextId = tasks.length ? Math.max(...tasks.map(t => t.id)) + 1 : 1;
  tasks.push({ id: nextId, text: '' });
  saveTasks();
  render();
  // focus the new input
  const lastInput = taskBody.querySelector('tr:last-child .task-input');
  if (lastInput) lastInput.focus();
}

function onTaskEdit(e) {
  if (!(e.target instanceof HTMLInputElement)) return;
  if (!e.target.classList.contains('task-input')) return;

  const id = Number(e.target.dataset.id);
  const t = tasks.find(x => x.id === id);
  if (t) {
    t.text = e.target.value;
    saveTasks();
  }
}

// ---- init ----
loadTasks();
render();

addBtn.addEventListener('click', addTask);
taskBody.addEventListener('input', onTaskEdit);
