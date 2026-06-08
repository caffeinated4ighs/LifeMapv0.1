// ═══════════════════════════════════════════════════════════════════════════
// ui.js — shared utilities, formatters, and DOM helpers
// Loaded first. No dependencies on other JS modules.
// Phase 9.2: Display reward computation reads from window.LIFEMAP_CONFIG
// (populated at boot by app.js via GET /config). Hardcoded values are
// fallbacks only — they match mechanics.json exactly.
// ═══════════════════════════════════════════════════════════════════════════

// ── Type icons (from theme spec) ────────────────────────────────────────────
const TYPE_ICONS = {
  mandatory: '⚔',
  habit:     '🔄',
  project:   '📋',
  bonus:     '⭐',
  anchor:    '⚓',
  routine:   '🌿',
}

// ── Config accessor ──────────────────────────────────────────────────────────
// Returns the mechanics config from window.LIFEMAP_CONFIG if available,
// otherwise returns a safe fallback object that mirrors mechanics.json.
function getMechanics() {
  if (window.LIFEMAP_CONFIG?.mechanics) {
    return window.LIFEMAP_CONFIG.mechanics
  }
  // Fallback — must stay in sync with config/mechanics.json
  return {
    xp_base:                 { mandatory: 10, habit: 12, project: 15, bonus: 6, anchor: 10, routine: 4 },
    gold_base_routine:       2,
    gold_base:               { P0: 15, P1: 10, P2: 6, P3: 3 },
    gold_difficulty_offset:  { low: -2, medium: 0, high: 5 },
    gold_floor:              1,
    energy_drain_base:       { mandatory: 8, habit: 6, project: 10, bonus: 3, anchor: 10, routine: 2 },
    energy_drain_difficulty_offset: { low: -2, medium: 0, high: 4 },
    energy_drain_floor:      1,
  }
}

// ── Formatters ───────────────────────────────────────────────────────────────

function getTypeIcon(taskType) {
  return TYPE_ICONS[taskType] ?? '◈'
}

function formatGold(amount) {
  return `${amount ?? 0}g`
}

function formatXP(amount) {
  return `+${Math.round(amount ?? 0)} XP`
}

function formatStreak(n) {
  if (n == null) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n}`
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((d - today) / 86400000)

  if (diff === 0)  return 'Today'
  if (diff === -1) return 'Yesterday'
  if (diff === 1)  return 'Tomorrow'

  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatTime(isoStr) {
  if (!isoStr) return null
  const d = new Date(isoStr)
  return d.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: '2-digit', hour12: true
  })
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

// ── XP reward computation — reads from window.LIFEMAP_CONFIG ─────────────────
function computeDisplayRewards(task) {
  const m = getMechanics()

  if (task.task_type === 'routine') {
    return { xp: m.xp_base.routine, gold: m.gold_base_routine }
  }

  const xp   = m.xp_base[task.task_type] ?? 0
  const gold = Math.max(
    m.gold_floor,
    (m.gold_base[task.priority] ?? 3) + (m.gold_difficulty_offset[task.difficulty] ?? 0)
  )
  return { xp, gold }
}

// ── Energy cost display — reads from window.LIFEMAP_CONFIG ───────────────────
function computeDisplayEnergyCost(task) {
  const m = getMechanics()
  if (task.task_type === 'routine') return m.energy_drain_floor
  const base   = m.energy_drain_base[task.task_type] ?? 5
  const offset = m.energy_drain_difficulty_offset[task.difficulty] ?? 0
  return Math.max(m.energy_drain_floor, base + offset)
}

// ── Streak class helper ──────────────────────────────────────────────────────
function streakClass(n) {
  if (n == null || n === 0) return 'zero'
  if (n <= -7) return 'decaying'
  return n > 0 ? 'positive' : 'negative'
}

// ── Energy threshold class ───────────────────────────────────────────────────
function energyClass(threshold_label) {
  const map = {
    normal:     'energy-normal',
    reduced:    'energy-reduced',
    min_viable: 'energy-min',
    recovery:   'energy-recovery',
  }
  return map[threshold_label] ?? 'energy-normal'
}

// ── Day-off badge (navbar only) ──────────────────────────────────────────────
function updateDayOffBadge(dayOffGranted) {
  const BADGE_ID = 'day-off-badge'
  const energyEl = document.querySelector('.navbar-energy, #navbar-energy, [data-energy]')
  if (!energyEl) return

  let badge = document.getElementById(BADGE_ID)

  if (dayOffGranted) {
    if (!badge) {
      badge = document.createElement('span')
      badge.id = BADGE_ID
      badge.className = 'day-off-badge'
      badge.textContent = 'DAY OFF'
      energyEl.insertAdjacentElement('afterend', badge)
    }
  } else {
    badge?.remove()
  }
}

// ── XP bar width percentage (clamped 0–100) ──────────────────────────────────
function xpPercent(current, toNext) {
  if (!toNext || toNext === 0) return 0
  return Math.min(100, Math.max(0, (current / toNext) * 100))
}

// ── DOM helpers ──────────────────────────────────────────────────────────────
function $(selector, root = document) {
  return root.querySelector(selector)
}

function $$(selector, root = document) {
  return [...root.querySelectorAll(selector)]
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class')         node.className = v
    else if (k === 'text')     node.textContent = v
    else if (k === 'html')     node.innerHTML = v
    else if (k.startsWith('data-')) node.dataset[k.slice(5)] = v
    else                       node.setAttribute(k, v)
  }
  for (const child of children) {
    if (child == null) continue
    node.append(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return node
}

function setText(id, text) {
  const node = document.getElementById(id)
  if (node) node.textContent = text
}

function setWidth(id, pct) {
  const node = document.getElementById(id)
  if (node) node.style.width = `${pct}%`
}

function show(el) { el?.removeAttribute('hidden') }
function hide(el) { el?.setAttribute('hidden', '') }
function toggle(el, visible) { visible ? show(el) : hide(el) }
