// ═══════════════════════════════════════════════════════════════════════════
// tasks.js — task list + next task card + task detail drawer
// Phase 9.2 fixes:
//   - drawer wired correctly to #task-drawer (was referencing non-existent element)
//   - inline edit form added to drawer
//   - POST /tasks/:id wired to edit_task
// ═══════════════════════════════════════════════════════════════════════════

let _currentDate  = todayStr()
let _drawerTaskId = null
let _drawerEditMode = false

// ─────────────────────────────────────────────────────────────────────────────
// Drawer — open / close
// ─────────────────────────────────────────────────────────────────────────────

function openDrawer(task) {
  _drawerTaskId   = task.id
  _drawerEditMode = false

  const drawer = document.getElementById('task-drawer')
  if (!drawer) return

  renderDrawerView(task)
  show(drawer)
}

function closeDrawer() {
  const drawer = document.getElementById('task-drawer')
  hide(drawer)
  _drawerTaskId   = null
  _drawerEditMode = false
}

// ─────────────────────────────────────────────────────────────────────────────
// Drawer — read view
// ─────────────────────────────────────────────────────────────────────────────

function renderDrawerView(task) {
  const { xp, gold } = computeDisplayRewards(task)
  const energyCost   = computeDisplayEnergyCost(task)
  const isPending    = task.status === 'pending'
  const isToday      = _currentDate === todayStr()

  setText('drawer-title',       task.title)
  setText('drawer-type-icon',   getTypeIcon(task.task_type))
  setText('drawer-type-label',  task.task_type?.toUpperCase() ?? '—')
  setText('drawer-description', task.description || 'No description yet.')
  setText('drawer-xp',          formatXP(xp))
  setText('drawer-gold',        formatGold(gold))
  setText('drawer-energy',      `-${energyCost} ⚡`)

  // Badges
  const badges = document.getElementById('drawer-badges')
  badges.innerHTML = ''
  const addBadge = (text, extra = '') => {
    const span = el('span', { class: `meta-tag ${extra}`, text })
    badges.appendChild(span)
  }
  if (task.priority)    addBadge(task.priority,   `priority-tag priority-${task.priority}`)
  if (task.difficulty)  addBadge(task.difficulty)
  if (task.time_block)  addBadge(task.time_block)
  else if (task.scheduled_at) addBadge(formatTime(task.scheduled_at))
  if (task.is_recovery) addBadge('💤 recovery', 'recovery-tag')
  if (task.late_multiplier != null && task.late_multiplier < 1.0) {
    const pct = Math.round((1 - task.late_multiplier) * 100)
    addBadge(`−${pct}% late`, 'late-tag')
  }

  // Actions
  const actions = document.getElementById('drawer-actions')
  actions.innerHTML = ''

  if (task.status === 'completed') {
    actions.appendChild(el('div', { class: 'drawer-completed-label', text: '✓ Completed' }))
  } else if (isPending && isToday) {
    const completeBtn = el('button', { class: 'drawer-complete-btn', text: 'Mark Complete' })
    completeBtn.addEventListener('click', () => handleDrawerComplete(task.id))
    actions.appendChild(completeBtn)
  }

  // Edit button — available for any non-completed, non-cancelled task
  if (task.status !== 'completed' && task.status !== 'cancelled') {
    const editBtn = el('button', { class: 'drawer-edit-btn', text: '✎ Edit' })
    editBtn.addEventListener('click', () => renderDrawerEdit(task))
    actions.appendChild(editBtn)
  }

  // Cancel link
  if (isPending) {
    const cancelLink = el('button', { class: 'drawer-cancel-link', text: 'Cancel task' })
    cancelLink.addEventListener('click', () => handleDrawerCancel(task.id))
    actions.appendChild(cancelLink)
  }

  // Show the read view, hide any lingering edit form
  const readView = document.getElementById('drawer-read-view')
  const editView = document.getElementById('drawer-edit-view')
  if (readView) show(readView)
  if (editView) hide(editView)
}

// ─────────────────────────────────────────────────────────────────────────────
// Drawer — edit view
// ─────────────────────────────────────────────────────────────────────────────

function renderDrawerEdit(task) {
  _drawerEditMode = true

  const readView = document.getElementById('drawer-read-view')
  const editView = document.getElementById('drawer-edit-view')
  if (readView) hide(readView)
  if (!editView) return
  show(editView)

  // Pre-fill fields
  const titleInput = document.getElementById('edit-title')
  if (titleInput) titleInput.value = task.title || ''

  const descInput = document.getElementById('edit-description')
  if (descInput) descInput.value = task.description || ''

  // Segmented buttons
  const seg = (group, value) => {
    document.querySelectorAll(`.edit-seg-btn[data-group="${group}"]`).forEach(b => {
      b.classList.toggle('active', b.dataset.value === value)
    })
  }
  seg('edit_task_type',  task.task_type)
  seg('edit_priority',   task.priority)
  seg('edit_difficulty', task.difficulty)
  if (task.time_block) seg('edit_time_block', task.time_block)

  // Recovery toggle
  const recoveryToggle = document.getElementById('edit-is-recovery')
  if (recoveryToggle) recoveryToggle.checked = !!task.is_recovery

  // Scheduled time
  const schedInput = document.getElementById('edit-scheduled-at')
  if (schedInput && task.scheduled_at) {
    // Convert UTC ISO to local datetime-local value
    const d = new Date(task.scheduled_at)
    const pad = n => String(n).padStart(2, '0')
    schedInput.value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  } else if (schedInput) {
    schedInput.value = ''
  }

  // Wire save/cancel
  const saveBtn = document.getElementById('edit-save-btn')
  if (saveBtn) {
    saveBtn.onclick = () => submitDrawerEdit(task.id)
  }

  const cancelEditBtn = document.getElementById('edit-cancel-btn')
  if (cancelEditBtn) {
    cancelEditBtn.onclick = async () => {
      // Re-fetch task to get latest state before re-rendering view
      const tasks = await apiGetTasks(_currentDate !== todayStr() ? _currentDate : undefined)
      const refreshed = tasks.find(t => t.id === task.id)
      if (refreshed) renderDrawerView(refreshed)
      else closeDrawer()
    }
  }

  hideDrawerError()
}

// ─────────────────────────────────────────────────────────────────────────────
// Drawer — submit edit
// ─────────────────────────────────────────────────────────────────────────────

async function submitDrawerEdit(taskId) {
  const title = document.getElementById('edit-title')?.value.trim()
  if (!title) { showDrawerError('Title is required.'); return }

  const getEditSeg = (group) => {
    const active = document.querySelector(`.edit-seg-btn[data-group="${group}"].active`)
    return active?.dataset.value ?? null
  }

  const payload = {
    title,
    task_type:   getEditSeg('edit_task_type'),
    priority:    getEditSeg('edit_priority'),
    difficulty:  getEditSeg('edit_difficulty'),
    time_block:  getEditSeg('edit_time_block'),
    is_recovery: document.getElementById('edit-is-recovery')?.checked ?? false,
    description: document.getElementById('edit-description')?.value.trim() || null,
  }

  const schedVal = document.getElementById('edit-scheduled-at')?.value
  if (schedVal) payload.scheduled_at = new Date(schedVal).toISOString()
  else payload.scheduled_at = null

  // Strip nulls for time_block if scheduled_at set
  if (payload.scheduled_at && payload.time_block) delete payload.time_block

  const saveBtn = document.getElementById('edit-save-btn')
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…' }
  hideDrawerError()

  try {
    await apiEditTask(taskId, payload)
    // Refresh task list and re-render drawer in read mode
    const tasks = await loadTasks(_currentDate)
    const updated = tasks.find(t => t.id === taskId)
    if (updated) renderDrawerView(updated)
    else closeDrawer()
  } catch (err) {
    showDrawerError(err.message || 'Failed to save.')
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save' }
  }
}

function showDrawerError(msg) {
  const el2 = document.getElementById('drawer-error')
  if (!el2) return
  el2.textContent = msg
  show(el2)
}

function hideDrawerError() {
  const el2 = document.getElementById('drawer-error')
  if (el2) { hide(el2); el2.textContent = '' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Drawer — actions
// ─────────────────────────────────────────────────────────────────────────────

async function handleDrawerComplete(taskId) {
  const btn = document.querySelector('.drawer-complete-btn')
  if (btn) { btn.disabled = true; btn.textContent = 'Completing…' }
  try {
    await apiCompleteTask(taskId)
    closeDrawer()
    await loadTasks(_currentDate)
    await refreshNavbar()
  } catch (err) {
    console.error('Complete error:', err)
    if (btn) { btn.disabled = false; btn.textContent = 'Mark Complete' }
  }
}

async function handleDrawerCancel(taskId) {
  try {
    await apiCancelTask(taskId)
    closeDrawer()
    await loadTasks(_currentDate)
  } catch (err) {
    console.error('Cancel error:', err)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Overdue detection
// ─────────────────────────────────────────────────────────────────────────────

function isOverdue(task) {
  if (task.status !== 'pending') return false
  if (task.scheduled_at && new Date(task.scheduled_at) < new Date()) return true
  if (task.time_block) {
    const hour     = new Date().getHours()
    const blockEnd = { morning: 12, noon: 14, evening: 19, night: 22, midnight: 24 }
    return hour >= (blockEnd[task.time_block] ?? 25)
  }
  return false
}

function taskRowClass(task) {
  if (task.status === 'completed')                                    return 'status-completed'
  if (task.late_multiplier != null && task.late_multiplier < 1.0)    return 'status-carried'
  if (isOverdue(task))                                                return 'status-overdue'
  return ''
}

// ─────────────────────────────────────────────────────────────────────────────
// Task row rendering
// ─────────────────────────────────────────────────────────────────────────────

function renderTaskRow(task) {
  const { xp, gold }  = computeDisplayRewards(task)
  const statusClass   = taskRowClass(task)
  const isCompleted   = task.status === 'completed'
  const isRoutine     = task.task_type === 'routine'

  const row = el('div', { class: `task-row type-${task.task_type} ${statusClass}` })
  row.style.cursor = 'pointer'
  row.addEventListener('click', () => openDrawer(task))

  row.appendChild(el('span', { class: 'task-icon', text: getTypeIcon(task.task_type) }))

  const body = el('div', { class: 'task-body' })
  const titleRow = el('div', { class: 'task-title-row' })

  titleRow.appendChild(el('span', {
    class: `task-title${isCompleted ? ' completed-title' : ''}`,
    text: task.title,
  }))

  const rewards = el('div', { class: 'task-rewards' })
  rewards.appendChild(el('span', { class: 'reward xp-reward mono', text: formatXP(xp) }))
  rewards.appendChild(el('span', { class: 'reward gold-reward mono', text: formatGold(gold) }))
  titleRow.appendChild(rewards)
  body.appendChild(titleRow)

  if (!isRoutine) {
    const sub = el('div', { class: 'task-sub' })
    if (task.priority) {
      sub.appendChild(el('span', { class: `task-priority priority-${task.priority}`, text: task.priority }))
    }
    const timeLabel = task.scheduled_at
      ? formatTime(task.scheduled_at)
      : task.time_block ?? null
    if (timeLabel) {
      sub.appendChild(el('span', { class: 'task-timeblock', text: timeLabel }))
    }
    body.appendChild(sub)
  }

  row.appendChild(body)
  return row
}

// ─────────────────────────────────────────────────────────────────────────────
// Next task card
// ─────────────────────────────────────────────────────────────────────────────

function renderNextTask(tasks) {
  const next = tasks.find(t => t.status === 'pending')

  if (!next) {
    setText('next-task-title', 'All clear.')
    setText('next-type-label', '—')
    setText('next-priority',   '')
    setText('next-difficulty', '')
    setText('next-timeblock',  '')
    setText('next-xp',         '')
    setText('next-gold',       '')
    return
  }

  const { xp, gold } = computeDisplayRewards(next)
  setText('next-task-title', next.title)
  setText('next-type-label', next.task_type?.toUpperCase() ?? '—')

  const priorityEl = document.getElementById('next-priority')
  if (priorityEl) {
    priorityEl.textContent = next.priority ?? ''
    priorityEl.className   = `meta-tag priority-tag priority-${next.priority}`
  }

  setText('next-difficulty', next.difficulty ?? '')
  setText('next-timeblock',  next.time_block ?? (next.scheduled_at ? formatTime(next.scheduled_at) : ''))
  setText('next-xp',         `+${xp} XP`)
  setText('next-gold',       formatGold(gold))
}

// ─────────────────────────────────────────────────────────────────────────────
// Full task list
// ─────────────────────────────────────────────────────────────────────────────

function renderTaskList(tasks) {
  const list  = document.getElementById('task-list')
  const count = document.getElementById('task-count')

  list.innerHTML = ''

  if (!tasks || tasks.length === 0) {
    list.appendChild(el('div', { class: 'task-empty', text: 'No tasks for this day.' }))
    if (count) count.textContent = '0'
    return
  }

  const sorted = [...tasks].sort((a, b) => {
    if (a.status === 'completed' && b.status !== 'completed') return 1
    if (a.status !== 'completed' && b.status === 'completed') return -1
    const ta = a.scheduled_at ? new Date(a.scheduled_at) : Infinity
    const tb = b.scheduled_at ? new Date(b.scheduled_at) : Infinity
    return ta - tb
  })

  sorted.forEach(task => list.appendChild(renderTaskRow(task)))

  if (count) count.textContent = tasks.filter(t => t.status !== 'completed').length
}

// ─────────────────────────────────────────────────────────────────────────────
// Data fetching
// ─────────────────────────────────────────────────────────────────────────────

async function loadTasks(date) {
  _currentDate = date || todayStr()

  const list = document.getElementById('task-list')
  list.innerHTML = ''
  for (let i = 0; i < 3; i++) list.appendChild(el('div', { class: 'task-skeleton' }))

  try {
    const tasks = await apiGetTasks(_currentDate === todayStr() ? null : _currentDate)
    renderNextTask(tasks)
    renderTaskList(tasks)
    return tasks
  } catch (err) {
    console.error('loadTasks error:', err)
    list.innerHTML = ''
    list.appendChild(el('div', { class: 'task-empty', text: 'Failed to load tasks.' }))
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Date selector
// ─────────────────────────────────────────────────────────────────────────────

function updateDateDisplay(dateStr) {
  const label = document.getElementById('date-label')
  if (label) label.textContent = formatDate(dateStr)
}

function shiftDate(days) {
  const d = new Date(_currentDate + 'T00:00:00')
  d.setDate(d.getDate() + days)
  const newDate = d.toISOString().split('T')[0]
  updateDateDisplay(newDate)
  loadTasks(newDate)
}

function initTasks() {
  document.getElementById('date-prev')?.addEventListener('click', () => shiftDate(-1))
  document.getElementById('date-next')?.addEventListener('click', () => shiftDate(1))
  document.getElementById('drawer-close')?.addEventListener('click', closeDrawer)

  // Edit segmented buttons
  ;['edit_task_type', 'edit_priority', 'edit_difficulty', 'edit_time_block'].forEach(group => {
    document.querySelectorAll(`.edit-seg-btn[data-group="${group}"]`).forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll(`.edit-seg-btn[data-group="${group}"]`).forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
      })
    })
  })

  // Close drawer on overlay click (click outside the drawer panel)
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _drawerTaskId) closeDrawer()
  })

  updateDateDisplay(_currentDate)
}

// Called by calendar.js when user clicks a date
function jumpToDate(dateStr) {
  _currentDate = dateStr
  updateDateDisplay(dateStr)
  loadTasks(dateStr)
}
