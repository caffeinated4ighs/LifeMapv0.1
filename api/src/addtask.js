// ═══════════════════════════════════════════════════════════════════════════
// addtask.js — Add Task modal
// Theme-native form with smart defaults. Non-required fields show as optional
// and will be autofilled by the model on submission if left blank.
// ═══════════════════════════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────────────────────────
let _addTaskOpen = false

// ── Open / Close ──────────────────────────────────────────────────────────
function openAddTask() {
  const overlay = document.getElementById('addtask-overlay')
  if (!overlay) return
  resetAddTaskForm()
  show(overlay)
  _addTaskOpen = true
  document.getElementById('addtask-title')?.focus()
}

function closeAddTask() {
  const overlay = document.getElementById('addtask-overlay')
  hide(overlay)
  _addTaskOpen = false
}

function resetAddTaskForm() {
  const form = document.getElementById('addtask-form')
  if (!form) return
  form.reset()
  // Reset visual state
  document.querySelectorAll('.at-seg-btn').forEach(b => b.classList.remove('active'))
  document.querySelectorAll('.at-seg-btn[data-default]').forEach(b => b.classList.add('active'))
  document.getElementById('addtask-scheduled-wrap')?.setAttribute('hidden', '')
  document.getElementById('addtask-time-wrap')?.setAttribute('hidden', '')
  document.getElementById('addtask-error')?.setAttribute('hidden', '')
  document.getElementById('addtask-error').textContent = ''
  // Reset autofill hints
  document.querySelectorAll('.at-autofill-hint').forEach(h => h.classList.remove('filled'))
}

// ── Segmented button helper ────────────────────────────────────────────────
function initSegmented(groupName) {
  document.querySelectorAll(`.at-seg-btn[data-group="${groupName}"]`).forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll(`.at-seg-btn[data-group="${groupName}"]`).forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
    })
  })
}

function getSegmentedValue(groupName) {
  const active = document.querySelector(`.at-seg-btn[data-group="${groupName}"].active`)
  return active?.dataset.value ?? null
}

// ── Schedule toggle ────────────────────────────────────────────────────────
function initScheduleToggle() {
  document.getElementById('addtask-schedule-toggle')?.addEventListener('change', function () {
    const wrap = document.getElementById('addtask-scheduled-wrap')
    const timeWrap = document.getElementById('addtask-time-wrap')
    if (this.checked) {
      show(wrap)
      show(timeWrap)
    } else {
      hide(wrap)
      hide(timeWrap)
    }
  })
}

// ── Build scheduled_at ISO string from date + time inputs ──────────────────
function buildScheduledAt() {
  const dateVal = document.getElementById('addtask-date')?.value
  const timeVal = document.getElementById('addtask-time')?.value
  if (!dateVal) return null
  const dt = timeVal ? `${dateVal}T${timeVal}:00` : `${dateVal}T09:00:00`
  // Treat as EST — append offset so Supabase stores correct UTC
  // Note: during DST America/New_York = -04:00, standard = -05:00
  // We use the server's TZ (set to America/New_York) to interpret,
  // so just send the local wall-clock time without offset and let
  // the server's timezone handle it via Date parsing
  return dt
}

// ── Submit ─────────────────────────────────────────────────────────────────
async function submitAddTask() {
  const title = document.getElementById('addtask-title')?.value.trim()
  if (!title) {
    showAddTaskError('Title is required.')
    return
  }

  const taskType  = getSegmentedValue('task_type')
  const priority  = getSegmentedValue('priority')
  const difficulty = getSegmentedValue('difficulty')
  const timeBlock = getSegmentedValue('time_block')
  const isScheduled = document.getElementById('addtask-schedule-toggle')?.checked
  const scheduledAt = isScheduled ? buildScheduledAt() : null
  const arcId = document.getElementById('addtask-arc')?.value || null

  const payload = { title, task_type: taskType }
  if (priority)    payload.priority    = priority
  if (difficulty)  payload.difficulty  = difficulty
  if (timeBlock && !isScheduled) payload.time_block = timeBlock
  if (scheduledAt) payload.scheduled_at = scheduledAt
  if (arcId)       payload.arc_id = parseInt(arcId, 10)

  // Mark optional unfilled fields for autofill
  const autofillNeeded = !priority || !difficulty

  const btn = document.getElementById('addtask-submit')
  btn.disabled = true
  btn.textContent = autofillNeeded ? 'Adding + autofilling…' : 'Adding…'
  hideAddTaskError()

  try {
    await apiPostChat(
      `add task: "${title}" | type: ${taskType}` +
      (priority    ? ` | priority: ${priority}`    : ' | priority: auto') +
      (difficulty  ? ` | difficulty: ${difficulty}` : ' | difficulty: auto') +
      (timeBlock && !isScheduled ? ` | time_block: ${timeBlock}` : '') +
      (scheduledAt ? ` | scheduled_at: ${scheduledAt}` : '') +
      (arcId       ? ` | arc_id: ${arcId}`          : '')
    )
    closeAddTask()
    await loadTasks(_currentDate)
    if (typeof refreshNavbar === 'function') await refreshNavbar()
  } catch (err) {
    showAddTaskError(err.message)
    btn.disabled = false
    btn.textContent = 'Add Task'
  }
}

function showAddTaskError(msg) {
  const el = document.getElementById('addtask-error')
  if (!el) return
  el.textContent = msg
  show(el)
}

function hideAddTaskError() {
  const el = document.getElementById('addtask-error')
  if (el) hide(el)
}

// ── Init ───────────────────────────────────────────────────────────────────
function initAddTask() {
  // Segmented groups
  initSegmented('task_type')
  initSegmented('priority')
  initSegmented('difficulty')
  initSegmented('time_block')

  // Schedule toggle
  initScheduleToggle()

  // Close on overlay click
  document.getElementById('addtask-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('addtask-overlay')) closeAddTask()
  })

  // Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _addTaskOpen) closeAddTask()
  })

  // Close button
  document.getElementById('addtask-close')?.addEventListener('click', closeAddTask)
  document.getElementById('addtask-cancel-btn')?.addEventListener('click', closeAddTask)

  // Submit
  document.getElementById('addtask-submit')?.addEventListener('click', submitAddTask)

  // Title enter key
  document.getElementById('addtask-title')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submitAddTask() }
  })

  // FAB / nav button
  document.getElementById('btn-add-task')?.addEventListener('click', openAddTask)
}
