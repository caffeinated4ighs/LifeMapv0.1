// ═══════════════════════════════════════════════════════════════════════════
// ui.js — shared utilities, formatters, and DOM helpers
// Loaded first. No dependencies on other JS modules.
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
  // dateStr: 'YYYY-MM-DD'
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
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

// ── XP reward computation (mirrors backend logicAgent, frontend display only) ──
// Priority base gold: P0=15, P1=10, P2=6, P3=3
// Difficulty offset:  low=-2, medium=0, high=+5 | Floor: 1g
// XP base: mandatory=10, habit=12, project=15, bonus=6, anchor=15, routine=4
const XP_BASE = { mandatory: 10, habit: 12, project: 15, bonus: 6, anchor: 10, routine: 4 }
const GOLD_BASE = { P0: 15, P1: 10, P2: 6, P3: 3 }
const DIFF_OFFSET = { low: -2, medium: 0, high: 5 }

function computeDisplayRewards(task) {
  if (task.task_type === 'routine') return { xp: 4, gold: 2 }
  const xp = XP_BASE[task.task_type] ?? 0
  const gold = Math.max(1, (GOLD_BASE[task.priority] ?? 3) + (DIFF_OFFSET[task.difficulty] ?? 0))
  return { xp, gold }
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
