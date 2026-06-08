// api.js — all fetch calls to the backend

async function apiFetch(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

async function apiGetState()          { return apiFetch('/state') }
async function apiGetTasks(date)      { return apiFetch(`/tasks${date ? `?date=${date}` : ''}`) }
async function apiGetShop()           { return apiFetch('/shop') }
async function apiGetSkills()         { return apiFetch('/skills') }
async function apiGetStats()          { return apiFetch('/stats') }
async function apiGetSnapshots()      { return apiFetch('/snapshots') }
async function apiGetCalendar(month)  { return apiFetch(`/calendar${month ? `?month=${month}` : ''}`) }
async function fetchConfig()          { return apiFetch('/config') }

async function apiPostChat(message, sessionId = 'web') {
  return apiFetch('/chat', { method: 'POST', body: JSON.stringify({ session_id: sessionId, message }) })
}

// Direct task creation — no LLM, < 500ms
async function apiAddTask(taskData) {
  return apiFetch('/tasks', { method: 'POST', body: JSON.stringify(taskData) })
}

// Direct task edit — PATCH /tasks/:id
async function apiEditTask(taskId, updates) {
  return apiFetch(`/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(updates) })
}

async function apiBuyItem(itemId)       { return apiFetch(`/buy/${itemId}`, { method: 'POST' }) }
async function apiCompleteTask(taskId)  { return apiFetch(`/complete/${taskId}`, { method: 'POST' }) }
async function apiCancelTask(taskId)    { return apiFetch(`/cancel/${taskId}`, { method: 'POST' }) }
