// ═══════════════════════════════════════════════════════════════════════════
// graphs.js — graphs modal
// Owns: Chart.js setup, progression and activity tabs
// ═══════════════════════════════════════════════════════════════════════════

// Track chart instances so we can destroy before re-rendering
const _charts = {}

// ── Shared Chart.js defaults ─────────────────────────────────────────────────
function applyChartDefaults() {
  Chart.defaults.color          = '#4a5568'
  Chart.defaults.borderColor    = 'rgba(99,179,237,0.07)'
  Chart.defaults.font.family    = "'JetBrains Mono', monospace"
  Chart.defaults.font.size      = 11
}

// ── Base chart options (shared) ──────────────────────────────────────────────
function baseLineOptions(title, yLabel) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: {
        display: true,
        text: title,
        color: '#64748b',
        font: { size: 11, weight: '700', family: "'Syne', sans-serif" },
        padding: { bottom: 10 },
      },
    },
    scales: {
      x: {
        grid: { color: 'rgba(99,179,237,0.06)' },
        ticks: { maxTicksLimit: 7, maxRotation: 0 },
      },
      y: {
        grid: { color: 'rgba(99,179,237,0.06)' },
        title: { display: !!yLabel, text: yLabel, color: '#4a5568' },
        beginAtZero: false,
      },
    },
  }
}

function baseBarOptions(title) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: {
        display: true,
        text: title,
        color: '#64748b',
        font: { size: 11, weight: '700', family: "'Syne', sans-serif" },
        padding: { bottom: 10 },
      },
    },
    scales: {
      x: { grid: { color: 'rgba(99,179,237,0.06)' }, ticks: { maxRotation: 0, maxTicksLimit: 10 } },
      y: { grid: { color: 'rgba(99,179,237,0.06)' }, beginAtZero: true },
    },
  }
}

// ── Destroy a chart if it exists ─────────────────────────────────────────────
function destroyChart(key) {
  if (_charts[key]) {
    _charts[key].destroy()
    delete _charts[key]
  }
}

// ── Build progression charts ─────────────────────────────────────────────────
function buildProgressionCharts(snapshots) {
  const labels = snapshots.map(s => s.date.slice(5))  // MM-DD
  const accent = '#4f8ef7'
  const gold   = '#f6c90e'
  const green  = '#48bb78'
  const warn   = '#ed8936'

  const makeGradient = (ctx, color) => {
    const g = ctx.createLinearGradient(0, 0, 0, 160)
    g.addColorStop(0, color + '40')
    g.addColorStop(1, color + '00')
    return g
  }

  // XP
  destroyChart('xp')
  const xpCtx = document.getElementById('chart-xp')?.getContext('2d')
  if (xpCtx) {
    const bg = makeGradient(xpCtx, accent)
    _charts.xp = new Chart(xpCtx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: snapshots.map(s => s.current_xp),
          borderColor: accent, backgroundColor: bg,
          borderWidth: 1.5, fill: true, tension: 0.35, pointRadius: 2,
        }],
      },
      options: baseLineOptions('XP', 'xp'),
    })
  }

  // Gold available
  destroyChart('gold')
  const goldCtx = document.getElementById('chart-gold')?.getContext('2d')
  if (goldCtx) {
    const bg = makeGradient(goldCtx, gold)
    _charts.gold = new Chart(goldCtx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: snapshots.map(s => s.available_gold),
          borderColor: gold, backgroundColor: bg,
          borderWidth: 1.5, fill: true, tension: 0.35, pointRadius: 2,
        }],
      },
      options: baseLineOptions('GOLD', 'g'),
    })
  }

  // Energy
  destroyChart('energy')
  const energyCtx = document.getElementById('chart-energy')?.getContext('2d')
  if (energyCtx) {
    const bg = makeGradient(energyCtx, green)
    _charts.energy = new Chart(energyCtx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: snapshots.map(s => s.energy),
          borderColor: green, backgroundColor: bg,
          borderWidth: 1.5, fill: true, tension: 0.35, pointRadius: 2,
        }],
      },
      options: { ...baseLineOptions('ENERGY'), scales: { ...baseLineOptions('ENERGY').scales, y: { ...baseLineOptions('ENERGY').scales.y, min: 0, max: 100 } } },
    })
  }

  // Streak (can go negative)
  destroyChart('streak')
  const streakCtx = document.getElementById('chart-streak')?.getContext('2d')
  if (streakCtx) {
    _charts.streak = new Chart(streakCtx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: snapshots.map(s => s.day_streak),
          borderColor: warn, backgroundColor: 'transparent',
          borderWidth: 1.5, fill: false, tension: 0.2, pointRadius: 2,
        }],
      },
      options: baseLineOptions('STREAK', 'days'),
    })
  }
}

// ── Build activity charts ────────────────────────────────────────────────────
function buildActivityCharts(snapshots) {
  const labels = snapshots.map(s => s.date.slice(5))

  // Tasks completed per day
  destroyChart('tasks')
  const tasksCtx = document.getElementById('chart-tasks')?.getContext('2d')
  if (tasksCtx) {
    _charts.tasks = new Chart(tasksCtx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: snapshots.map(s => s.tasks_completed),
          backgroundColor: 'rgba(79,142,247,0.5)',
          borderColor: '#4f8ef7',
          borderWidth: 1,
        }],
      },
      options: baseBarOptions('TASKS COMPLETED'),
    })
  }

  // Mandatory met per day (stacked: met=green, not met=red)
  destroyChart('mandatory')
  const mandCtx = document.getElementById('chart-mandatory')?.getContext('2d')
  if (mandCtx) {
    _charts.mandatory = new Chart(mandCtx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Met',
            data: snapshots.map(s => s.mandatory_met ? 1 : 0),
            backgroundColor: 'rgba(72,187,120,0.6)',
            borderColor: '#48bb78',
            borderWidth: 1,
          },
          {
            label: 'Missed',
            data: snapshots.map(s => s.mandatory_met ? 0 : 1),
            backgroundColor: 'rgba(229,62,62,0.4)',
            borderColor: '#e53e3e',
            borderWidth: 1,
          },
        ],
      },
      options: {
        ...baseBarOptions('MANDATORY MET'),
        plugins: {
          ...baseBarOptions('MANDATORY MET').plugins,
          legend: { display: true, labels: { color: '#4a5568', boxWidth: 10, font: { size: 10 } } },
        },
        scales: {
          x: { stacked: true, grid: { color: 'rgba(99,179,237,0.06)' }, ticks: { maxRotation: 0, maxTicksLimit: 10 } },
          y: { stacked: true, grid: { color: 'rgba(99,179,237,0.06)' }, beginAtZero: true, max: 1, ticks: { stepSize: 1 } },
        },
      },
    })
  }
}

// ── Load and render graphs ───────────────────────────────────────────────────
async function loadGraphs() {
  try {
    applyChartDefaults()
    const snapshots = await apiGetSnapshots()

    if (!snapshots.length) return

    buildProgressionCharts(snapshots)
    // Activity charts only built when tab is switched (lazy)
  } catch (err) {
    console.error('loadGraphs error:', err)
  }
}

// ── Tab switching ────────────────────────────────────────────────────────────
function initGraphTabs(snapshots) {
  document.querySelectorAll('.graph-tab').forEach(tab => {
    tab.addEventListener('click', async () => {
      document.querySelectorAll('.graph-tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')

      const which = tab.dataset.tab
      const progSection = document.getElementById('graphs-progression')
      const actSection  = document.getElementById('graphs-activity')

      if (which === 'progression') {
        show(progSection)
        hide(actSection)
      } else {
        hide(progSection)
        show(actSection)
        // Lazy-build activity charts on first visit
        if (!_charts.tasks) {
          try {
            const snaps = await apiGetSnapshots()
            applyChartDefaults()
            buildActivityCharts(snaps)
          } catch (err) {
            console.error('activity charts error:', err)
          }
        }
      }
    })
  })
}

// ── Init ─────────────────────────────────────────────────────────────────────
function initGraphs() {
  initGraphTabs()
  registerModalCallback('graphs', loadGraphs)
}
