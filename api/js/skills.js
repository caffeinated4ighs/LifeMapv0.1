// ═══════════════════════════════════════════════════════════════════════════
// skills.js — skills modal
// Owns: skill card rendering, XP bars, streaks, inline rename flow
// ═══════════════════════════════════════════════════════════════════════════

// ── Render a single skill card ────────────────────────────────────────────────
function renderSkillCard(skill) {
  const xpPct  = xpPercent(skill.current_xp, skill.xp_to_next)
  const sc     = streakClass(skill.current_streak)
  const streakTxt = `Streak: ${formatStreak(skill.current_streak)}`

  const card = el('div', { class: 'skill-card' })
  card.dataset.skillId = skill.id

  // ── Header ────────────────────────────────────────────────────────────────
  const header = el('div', { class: 'skill-card-header' })

  const nameEl = el('span', { class: 'skill-card-name', text: skill.name })
  header.appendChild(nameEl)

  if (skill.is_dynamic) {
    header.appendChild(el('span', { class: 'skill-badge', text: 'AUTO' }))
  }

  header.appendChild(el('span', { class: 'skill-level-label', text: `Lv.${skill.current_level}` }))

  // Rename button (only on dynamic skills per spec)
  if (skill.is_dynamic) {
    const renameBtn = el('button', { class: 'skill-rename-btn', text: '✎' })
    renameBtn.title = 'Rename skill'
    renameBtn.addEventListener('click', () => startRename(card, skill))
    header.appendChild(renameBtn)
  }

  card.appendChild(header)

  // ── XP bar ────────────────────────────────────────────────────────────────
  const bar = el('div', { class: 'skill-card-bar' })
  const fill = el('div', { class: 'skill-card-bar-fill' })
  fill.style.width = `${xpPct}%`
  bar.appendChild(fill)
  card.appendChild(bar)

  // ── Footer ────────────────────────────────────────────────────────────────
  const footer = el('div', { class: 'skill-card-footer' })
  footer.appendChild(el('span', {
    class: 'skill-xp-label',
    text: `${skill.current_xp} / ${skill.xp_to_next} XP`,
  }))
  footer.appendChild(el('span', { class: `skill-streak ${sc}`, text: streakTxt }))
  card.appendChild(footer)

  return card
}

// ── Inline rename flow ────────────────────────────────────────────────────────
function startRename(card, skill) {
  const header = card.querySelector('.skill-card-header')
  const nameEl = header.querySelector('.skill-card-name')
  const currentName = nameEl.textContent

  // Replace name span with input
  const input = el('input', {
    class: 'skill-rename-input',
    type: 'text',
  })
  input.value = currentName
  nameEl.replaceWith(input)
  input.focus()
  input.select()

  // Confirm button
  const confirmBtn = el('button', { class: 'skill-rename-confirm', text: '✓' })
  header.appendChild(confirmBtn)

  // Hide rename trigger button while editing
  const renameBtn = header.querySelector('.skill-rename-btn')
  if (renameBtn) hide(renameBtn)

  const doRename = async () => {
    const newName = input.value.trim()
    if (!newName || newName === currentName) {
      cancelRename()
      return
    }

    confirmBtn.disabled = true
    confirmBtn.textContent = '...'

    try {
      // Route through chat so the LLM handles the rename + re-embedding
      await apiPostChat(`rename skill ${skill.id} to "${newName}"`)
      await loadSkills() // re-render the list
    } catch (err) {
      console.error('rename error:', err)
      cancelRename()
    }
  }

  const cancelRename = () => {
    input.replaceWith(nameEl)
    confirmBtn.remove()
    if (renameBtn) show(renameBtn)
  }

  confirmBtn.addEventListener('click', doRename)
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); doRename() }
    if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
  })
}

// ── Load and render skills ────────────────────────────────────────────────────
async function loadSkills() {
  const list = document.getElementById('skills-list')
  list.innerHTML = '<div class="task-empty">Loading...</div>'

  try {
    const skills = await apiGetSkills()
    list.innerHTML = ''

    if (!skills.length) {
      list.appendChild(el('div', { class: 'task-empty', text: 'No skills yet. Complete tasks to unlock them.' }))
      return
    }

    skills.forEach(skill => list.appendChild(renderSkillCard(skill)))
  } catch (err) {
    list.innerHTML = ''
    list.appendChild(el('div', { class: 'task-empty', text: 'Failed to load skills.' }))
    console.error('loadSkills error:', err)
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
function initSkills() {
  registerModalCallback('skills', loadSkills)
}
