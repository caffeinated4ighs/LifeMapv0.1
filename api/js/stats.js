// ═══════════════════════════════════════════════════════════════════════════
// stats.js — stats modal
// Owns: stat card rendering, value bars, streak display
// ═══════════════════════════════════════════════════════════════════════════

// Stat icons (fall back to ◈ if not in map)
const STAT_ICONS = {
  STR: '💪', VIT: '❤️', AGI: '⚡', DEX: '🎯',
  INT: '🧠', PER: '👁',  CHA: '💬', WIL: '🔮',
}

function getStatIcon(name) {
  // Match by uppercase 3-letter abbreviation anywhere in the name
  const key = Object.keys(STAT_ICONS).find(k =>
    name?.toUpperCase().startsWith(k)
  )
  return STAT_ICONS[key] ?? '◈'
}

// ── Render a single stat card ────────────────────────────────────────────────
function renderStatCard(stat) {
  const pct      = Math.min(100, Math.max(0, stat.current_value ?? 0))
  const sc       = streakClass(stat.current_streak)
  const streakTxt = stat.current_streak == null
    ? ''
    : `Streak: ${formatStreak(stat.current_streak)}`

  const card = el('div', { class: 'stat-card' })

  // Header: icon + name
  const header = el('div', { class: 'stat-card-header' })
  header.appendChild(el('span', { class: 'stat-card-icon', text: getStatIcon(stat.name) }))
  header.appendChild(el('span', { class: 'stat-card-name', text: stat.name?.toUpperCase() ?? '—' }))
  card.appendChild(header)

  // Progress bar
  const bar = el('div', { class: 'stat-card-bar' })
  const fill = el('div', { class: 'stat-card-bar-fill' })
  fill.style.width = `${pct}%`
  bar.appendChild(fill)
  card.appendChild(bar)

  // Footer: value + streak
  const footer = el('div', { class: 'stat-card-footer' })
  footer.appendChild(el('span', { class: 'stat-card-value', text: Math.round(pct).toString() }))
  if (streakTxt) {
    footer.appendChild(el('span', { class: `stat-card-streak ${sc}`, text: streakTxt }))
  }
  card.appendChild(footer)

  // Description tooltip via title attr
  if (stat.description) card.title = stat.description

  return card
}

// ── Load and render stats ────────────────────────────────────────────────────
async function loadStats() {
  const grid = document.getElementById('stats-grid')
  grid.innerHTML = '<div class="task-empty">Loading...</div>'

  try {
    const stats = await apiGetStats()
    grid.innerHTML = ''
    if (!stats.length) {
      grid.appendChild(el('div', { class: 'task-empty', text: 'No stats found.' }))
      return
    }
    stats.forEach(stat => grid.appendChild(renderStatCard(stat)))
  } catch (err) {
    grid.innerHTML = ''
    grid.appendChild(el('div', { class: 'task-empty', text: 'Failed to load stats.' }))
    console.error('loadStats error:', err)
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
function initStats() {
  registerModalCallback('stats', loadStats)
}
