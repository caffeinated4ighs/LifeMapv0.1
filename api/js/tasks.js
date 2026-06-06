// ═══════════════════════════════════════════════════════════════════════════
// tasks.js — task list + next task card
// Owns: date state, task fetching, rendering, overdue detection
// ═══════════════════════════════════════════════════════════════════════════

let _currentDate = todayStr()

// ── Overdue detection (per spec) ─────────────────────────────────────────────
function isOverdue(task) {
  if (task.status !== 'pending') return false
  if (task.scheduled_at && new Date(task.scheduled_at) < new Date()) return true
  if (task.time_block) {
    const hour = new Date().getHours()
    const blockEnd = { morning: 12, noon: 14, evening: 19, night: 22, midnight: 24 }
    return hour >= (blockEnd[task.time_block] ?? 25)
  }
  return false
}

// ── Row status class ─────────────────────────────────────────────────────────
function taskRowClass(task) {
  if (task.status === 'completed')              return 'status-completed'
  if (task.late_multiplier != null && task.late_multiplier < 1.0) return 'status-carried'
  if (isOverdue(task))                          return 'status-overdue'
  return ''
}

// ── Render a single task row ─────────────────────────────────────────────────
function renderTaskRow(task) {
  const { xp, gold } = computeDisplayRewards(task)
  const statusClass   = taskRowClass(task)
  const isCompleted   = task.status === 'completed'

  const row = el('div', { class: `task-row type-${task.task_type} ${statusClass}` })

  // Icon
  row.appendChild(el('span', { class: 'task-icon', text: getTypeIcon(task.task_type) }))

  // Body
  const body = el('div', { class: 'task-body' })

  // Title row
  const titleRow = el('div', { class: 'task-title-row' })

  const title = el('span', {
    class: `task-title${isCompleted ? ' completed-title' : ''}`,
    text: task.title,
  })
  titleRow.appendChild(title)

  // Rewards
  const rewards = el('div', { class: 'task-rewards' })
  rewards.appendChild(el('span', { class: 'reward xp-reward mono', text: formatXP(xp) }))
  rewards.appendChild(el('span', { class: 'reward gold-reward mono', text: formatGold(gold) }))
  titleRow.appendChild(rewards)
  body.appendChild(titleRow)

  // Sub row: priority + timeblock
  if (task.task_type !== 'routine') {
    const sub = el('div', { class: 'task-sub' })

    if (task.priority) {
      sub.appendChild(el('span', {
        class: `task-priority priority-${task.priority}`,
        text: task.priority,
      }))
    }

    const timeLabel = task.scheduled_at
      ? formatTime(task.scheduled_at)
      : task.time_block
        ? task.time_block
        : null

    if (timeLabel) {
      sub.appendChild(el('span', { class: 'task-timeblock', text: timeLabel }))
    }

    body.appendChild(sub)
  }

  row.appendChild(body)
  return row
}

// ── Render next task card ────────────────────────────────────────────────────
function renderNextTask(tasks) {
  const next = tasks.find(t => t.status === 'pending')

  if (!next) {
    setText('next-task-title', 'All clear.')
    setText('next-type-label', '—')
    setText('next-priority', '')
    setText('next-difficulty', '')
    setText('next-timeblock', '')
    setText('next-xp', '')
    setText('next-gold', '')
    return
  }

  const { xp, gold } = computeDisplayRewards(next)

  setText('next-task-title', next.title)
  setText('next-type-label', next.task_type?.toUpperCase() ?? '—')

  // Priority tag
  const priorityEl = document.getElementById('next-priority')
  if (priorityEl) {
    priorityEl.textContent = next.priority ?? ''
    priorityEl.className = `meta-tag priority-tag priority-${next.priority}`
  }

  setText('next-difficulty', next.difficulty ?? '')
  setText('next-timeblock', next.time_block ?? (next.scheduled_at ? formatTime(next.scheduled_at) : ''))
  setText('next-xp', `+${xp} XP`)
  setText('next-gold', formatGold(gold))
}

// ── Render full task list ────────────────────────────────────────────────────
function renderTaskList(tasks) {
  const list = document.getElementById('task-list')
  const count = document.getElementById('task-count')

  list.innerHTML = ''

  if (!tasks || tasks.length === 0) {
    list.appendChild(el('div', { class: 'task-empty', text: 'No tasks for this day.' }))
    if (count) count.textContent = '0'
    return
  }

  // Sort: completed last, pending by schedule order
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

// ── Fetch and render ─────────────────────────────────────────────────────────
async function loadTasks(date) {
  _currentDate = date || todayStr()

  // Show skeletons while loading
  const list = document.getElementById('task-list')
  list.innerHTML = ''
  for (let i = 0; i < 3; i++) {
    list.appendChild(el('div', { class: 'task-skeleton' }))
  }

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

// ── Date selector ────────────────────────────────────────────────────────────
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
  updateDateDisplay(_currentDate)
}

// Called by calendar.js when user clicks a date
function jumpToDate(dateStr) {
  _currentDate = dateStr
  updateDateDisplay(dateStr)
  loadTasks(dateStr)
}
