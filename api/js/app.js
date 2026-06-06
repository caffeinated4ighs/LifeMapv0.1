// ═══════════════════════════════════════════════════════════════════════════
// app.js — application boot
// Loaded last. Calls init functions from every other module.
// Owns: navbar hydration, state refresh, global event wiring.
// ═══════════════════════════════════════════════════════════════════════════

// ── Rank titles (mirrors mechanics.json) ─────────────────────────────────────
const RANKS = [
  [1,  'Hatchling'],
  [5,  'Early Bird'],
  [10, 'Getting a Hang of It'],
  [15, 'Tutorial Complete'],
  [20, 'Showing Up'],
  [25, 'No Longer an Excuse'],
  [30, 'Half a Year In'],
  [35, 'Putting in Work'],
  [40, 'Built Different'],
  [45, 'Certified Grinder'],
  [50, 'Godlike'],
  [60, 'Legendary'],
  [70, 'Woah You Still Here??'],
  [80, 'Get a Life'],
  [90, 'Go Touch Grass'],
  [100,'Young Kind is Proud!'],
]

function getRank(level) {
  let rank = 'Hatchling'
  for (const [threshold, title] of RANKS) {
    if (level >= threshold) rank = title
    else break
  }
  return rank
}

// ── Hydrate navbar from state object ────────────────────────────────────────
function hydrateNavbar(state) {
  const { level, current_xp, xp_to_next, available_gold, energy, streak } = state

  // Energy
  const energyPct = xpPercent(energy.current, energy.max)
  setText('energy-value', `${energy.current}/${energy.max}`)
  setWidth('energy-bar-fill', energyPct)

  // Swap energy threshold class on nav-energy
  const navEnergy = document.getElementById('nav-energy')
  if (navEnergy) {
    navEnergy.className = `nav-stat ${energyClass(energy.threshold_label)}`
  }

  // Streak
  const streakEl = document.getElementById('streak-value')
  if (streakEl) {
    streakEl.textContent = formatStreak(streak.day_streak)
    streakEl.className   = `stat-value mono ${streakClass(streak.day_streak)}`
      .replace('decaying', 'negative')  // use same color
  }

  // Level + XP bar
  setText('level-value', `Lv.${level}`)
  const xpPct = xpPercent(current_xp, xp_to_next)
  setWidth('xp-bar-fill', xpPct)
  setText('xp-value', `${current_xp}/${xp_to_next}`)

  // Level dropdown
  setText('dropdown-rank', getRank(level))
  setText('dropdown-xp', `${current_xp} / ${xp_to_next} XP`)
  setWidth('dropdown-bar-fill', xpPct)

  // Gold
  setText('gold-value', formatGold(available_gold))

  if (typeof updateDayOffBadge === 'function') {
    updateDayOffBadge(state.day_off_granted ?? false)
  }
}

// ── Refresh navbar (called after any state-mutating action) ──────────────────
async function refreshNavbar() {
  try {
    const state = await apiGetState()
    hydrateNavbar(state)
  } catch (err) {
    console.error('refreshNavbar error:', err)
  }
}

// ── Level dropdown toggle ────────────────────────────────────────────────────
function initLevelDropdown() {
  const trigger  = document.getElementById('nav-level')
  const dropdown = document.getElementById('level-dropdown')

  trigger.addEventListener('click', () => {
    const isOpen = trigger.getAttribute('aria-expanded') === 'true'
    trigger.setAttribute('aria-expanded', String(!isOpen))
    toggle(dropdown, !isOpen)
  })

  // Close when clicking outside
  document.addEventListener('click', e => {
    if (!trigger.contains(e.target)) {
      trigger.setAttribute('aria-expanded', 'false')
      hide(dropdown)
    }
  })
}

// ── Auto-refresh state every 60 seconds ──────────────────────────────────────
function startRefreshCycle() {
  setInterval(async () => {
    try {
      const state = await apiGetState()
      hydrateNavbar(state)
    } catch (_) { /* silent — don't interrupt the user */ }
  }, 60_000)
}

// ── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  // Init all modules
  initModals()
  initTasks()
  initChat()
  initShop()
  initStats()
  initSkills()
  initCalendar()
  initGraphs()
  initLevelDropdown()

  // Load initial data in parallel
  try {
    const [state] = await Promise.all([
      apiGetState(),
      loadTasks(),
    ])
    hydrateNavbar(state)
  } catch (err) {
    console.error('Boot error:', err)
  }

  startRefreshCycle()
}

// ── Go ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', boot)
