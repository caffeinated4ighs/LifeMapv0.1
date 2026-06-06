// ═══════════════════════════════════════════════════════════════════════════
// api.js — all fetch calls to the backend
// One function per endpoint. Returns parsed JSON or throws with message.
// ═══════════════════════════════════════════════════════════════════════════

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

// ── Read endpoints ───────────────────────────────────────────────────────────

async function apiGetState() {
  return apiFetch('/state')
}

async function apiGetTasks(date) {
  const param = date ? `?date=${date}` : ''
  return apiFetch(`/tasks${param}`)
}

async function apiGetShop() {
  return apiFetch('/shop')
}

async function apiGetSkills() {
  return apiFetch('/skills')
}

async function apiGetStats() {
  return apiFetch('/stats')
}

async function apiGetSnapshots() {
  return apiFetch('/snapshots')
}

async function apiGetCalendar(month) {
  const param = month ? `?month=${month}` : ''
  return apiFetch(`/calendar${param}`)
}

// ── Write endpoints ──────────────────────────────────────────────────────────

async function apiPostChat(message, sessionId = 'web') {
  return apiFetch('/chat', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, message }),
  })
}

async function apiBuyItem(itemId) {
  return apiFetch(`/buy/${itemId}`, { method: 'POST' })
}

async function apiCompleteTask(taskId) {
  return apiFetch(`/complete/${taskId}`, { method: 'POST' })
}

async function apiCancelTask(taskId) {
  return apiFetch(`/cancel/${taskId}`, { method: 'POST' })
}
