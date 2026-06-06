// ═══════════════════════════════════════════════════════════════════════════
// calendar.js — calendar modal
// Owns: month grid rendering, task dot logic, month navigation
// ═══════════════════════════════════════════════════════════════════════════

let _calYear  = new Date().getFullYear()
let _calMonth = new Date().getMonth() + 1  // 1-indexed

// ── Month string (YYYY-MM) ───────────────────────────────────────────────────
function calMonthStr() {
  return `${_calYear}-${String(_calMonth).padStart(2, '0')}`
}

// ── Render the calendar grid ─────────────────────────────────────────────────
function renderCalendar(dayData) {
  const grid = document.getElementById('cal-days')
  const label = document.getElementById('cal-month-label')
  grid.innerHTML = ''

  const monthDate = new Date(_calYear, _calMonth - 1, 1)
  const monthName = monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  if (label) label.textContent = monthName.toUpperCase()

  const today = todayStr()

  // What weekday does the 1st fall on? (Mon=0 … Sun=6)
  let firstDow = monthDate.getDay() // 0=Sun
  firstDow = firstDow === 0 ? 6 : firstDow - 1  // shift to Mon-start

  const daysInMonth = new Date(_calYear, _calMonth, 0).getDate()

  // Empty cells before the 1st
  for (let i = 0; i < firstDow; i++) {
    grid.appendChild(el('div', { class: 'cal-day empty' }))
  }

  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calMonthStr()}-${String(d).padStart(2, '0')}`
    const isToday = dateStr === today
    const data    = dayData[dateStr]

    const cell = el('div', { class: `cal-day${isToday ? ' today' : ''}` })
    cell.dataset.date = dateStr

    cell.appendChild(el('span', { class: 'cal-day-num', text: String(d) }))

    // Dot row
    if (data && data.total > 0) {
      const dots = el('div', { class: 'cal-dot-row' })

      if (data.completed > 0) dots.appendChild(el('span', { class: 'cal-dot completed' }))
      if (data.carried   > 0) dots.appendChild(el('span', { class: 'cal-dot carried' }))
      if (data.missed    > 0) dots.appendChild(el('span', { class: 'cal-dot missed' }))

      cell.appendChild(dots)
    }

    // Click: update task list and close modal
    cell.addEventListener('click', () => {
      jumpToDate(dateStr)
      closeModal()
    })

    grid.appendChild(cell)
  }
}

// ── Load calendar data for current month ─────────────────────────────────────
async function loadCalendar() {
  const grid = document.getElementById('cal-days')
  grid.innerHTML = '<div class="task-empty" style="grid-column:1/-1">Loading...</div>'

  try {
    const dayData = await apiGetCalendar(calMonthStr())
    renderCalendar(dayData)
  } catch (err) {
    grid.innerHTML = '<div class="task-empty" style="grid-column:1/-1">Failed to load.</div>'
    console.error('loadCalendar error:', err)
  }
}

// ── Month navigation ─────────────────────────────────────────────────────────
function shiftCalMonth(delta) {
  _calMonth += delta
  if (_calMonth > 12) { _calMonth = 1;  _calYear++ }
  if (_calMonth < 1)  { _calMonth = 12; _calYear-- }
  loadCalendar()
}

// ── Init ─────────────────────────────────────────────────────────────────────
function initCalendar() {
  document.getElementById('cal-prev')?.addEventListener('click', () => shiftCalMonth(-1))
  document.getElementById('cal-next')?.addEventListener('click', () => shiftCalMonth(1))
  registerModalCallback('calendar', loadCalendar)
}
