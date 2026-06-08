// addtask.js — Add Task modal
// Fixes: direct POST (no LLM), recurrence for routines, stuck button prevention

let _addTaskOpen = false

function openAddTask() {
  const overlay = document.getElementById('addtask-overlay')
  if (!overlay) return
  resetAddTaskForm()
  show(overlay)
  _addTaskOpen = true
  document.getElementById('addtask-title')?.focus()
}

function closeAddTask() {
  hide(document.getElementById('addtask-overlay'))
  _addTaskOpen = false
}

function resetAddTaskForm() {
  const titleInput = document.getElementById('addtask-title')
  if (titleInput) titleInput.value = ''
  document.querySelectorAll('.at-seg-btn').forEach(b => b.classList.remove('active'))
  document.querySelectorAll('.at-seg-btn[data-default]').forEach(b => b.classList.add('active'))
  hide(document.getElementById('addtask-scheduled-wrap'))
  hide(document.getElementById('addtask-time-wrap'))
  hide(document.getElementById('addtask-recurrence-field'))
  const dateInput = document.getElementById('addtask-date')
  const timeInput = document.getElementById('addtask-time')
  if (dateInput) dateInput.value = ''
  if (timeInput) timeInput.value = ''
  const toggle = document.getElementById('addtask-schedule-toggle')
  if (toggle) toggle.checked = false
  hideAddTaskError()
  const btn = document.getElementById('addtask-submit')
  if (btn) { btn.disabled = false; btn.textContent = 'Add Task' }
}

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

function initRecurrenceToggle() {
  document.querySelectorAll(`.at-seg-btn[data-group="task_type"]`).forEach(btn => {
    btn.addEventListener('click', () => {
      const recurrenceField = document.getElementById('addtask-recurrence-field')
      if (!recurrenceField) return
      if (btn.dataset.value === 'routine') {
        show(recurrenceField)
        const anyActive = document.querySelector(`.at-seg-btn[data-group="recurrence"].active`)
        if (!anyActive) document.querySelector(`.at-seg-btn[data-group="recurrence"][data-default]`)?.classList.add('active')
      } else {
        hide(recurrenceField)
      }
    })
  })
}

function initScheduleToggle() {
  document.getElementById('addtask-schedule-toggle')?.addEventListener('change', function () {
    const wrap     = document.getElementById('addtask-scheduled-wrap')
    const timeWrap = document.getElementById('addtask-time-wrap')
    if (this.checked) { show(wrap); show(timeWrap) } else { hide(wrap); hide(timeWrap) }
  })
}

function buildScheduledAt() {
  const dateVal = document.getElementById('addtask-date')?.value
  const timeVal = document.getElementById('addtask-time')?.value
  if (!dateVal) return null
  return timeVal ? `${dateVal}T${timeVal}:00` : `${dateVal}T09:00:00`
}

async function submitAddTask() {
  const btn = document.getElementById('addtask-submit')
  if (btn?.disabled) return  // prevent double-submit

  const title    = document.getElementById('addtask-title')?.value.trim()
  const taskType = getSegmentedValue('task_type')

  if (!title)    { showAddTaskError('Title is required.'); return }
  if (!taskType) { showAddTaskError('Task type is required.'); return }

  const priority    = getSegmentedValue('priority')   || 'P2'
  const difficulty  = getSegmentedValue('difficulty') || 'medium'
  const timeBlock   = getSegmentedValue('time_block')
  const recurrence  = getSegmentedValue('recurrence')
  const isScheduled = document.getElementById('addtask-schedule-toggle')?.checked
  const scheduledAt = isScheduled ? buildScheduledAt() : null

  const payload = { title, task_type: taskType, priority, difficulty }
  if (taskType === 'routine')        payload.recurrence_pattern = recurrence || 'daily'
  if (timeBlock && !isScheduled)     payload.time_block = timeBlock
  if (scheduledAt)                   payload.scheduled_at = scheduledAt

  if (btn) { btn.disabled = true; btn.textContent = 'Adding…' }
  hideAddTaskError()

  try {
    await apiAddTask(payload)
    closeAddTask()
    await loadTasks(_currentDate)
    if (typeof refreshNavbar === 'function') await refreshNavbar()
  } catch (err) {
    showAddTaskError(err.message || 'Failed to add task. Try again.')
    if (btn) { btn.disabled = false; btn.textContent = 'Add Task' }
  }
}

function showAddTaskError(msg) {
  const errEl = document.getElementById('addtask-error')
  if (!errEl) return
  errEl.textContent = msg
  show(errEl)
}

function hideAddTaskError() {
  const errEl = document.getElementById('addtask-error')
  if (!errEl) return
  hide(errEl)
  errEl.textContent = ''
}

function initAddTask() {
  initSegmented('task_type')
  initSegmented('priority')
  initSegmented('difficulty')
  initSegmented('time_block')
  initSegmented('recurrence')
  initRecurrenceToggle()
  initScheduleToggle()

  document.getElementById('addtask-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('addtask-overlay')) closeAddTask()
  })
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && _addTaskOpen) closeAddTask() })
  document.getElementById('addtask-close')?.addEventListener('click', closeAddTask)
  document.getElementById('addtask-cancel-btn')?.addEventListener('click', closeAddTask)
  document.getElementById('addtask-submit')?.addEventListener('click', submitAddTask)
  document.getElementById('addtask-title')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submitAddTask() }
  })
  document.getElementById('btn-add-task')?.addEventListener('click', openAddTask)
}
