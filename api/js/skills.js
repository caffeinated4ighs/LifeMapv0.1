// ═══════════════════════════════════════════════════════════════════════════
// skills.js — skill tree modal
// Phase 9.3: renders parent skills with indented children beneath them.
// Parents are sorted by level desc. Children grouped under their parent.
// Orphan skills (no parent) are top-level.
// ═══════════════════════════════════════════════════════════════════════════

// ── Render a skill card ───────────────────────────────────────────────────
function renderSkillCard(skill, isChild = false) {
  const xpPct    = xpPercent(skill.current_xp, skill.xp_to_next)
  const sc       = streakClass(skill.current_streak)
  const streakTxt = `Streak: ${formatStreak(skill.current_streak)}`

  const card = el('div', { class: `skill-card${isChild ? ' skill-card-child' : ''}` })
  card.dataset.skillId = skill.id

  // Header
  const header = el('div', { class: 'skill-card-header' })

  // Child indent indicator
  if (isChild) {
    header.appendChild(el('span', { class: 'skill-child-arrow', text: '↳' }))
  }

  const nameEl = el('span', { class: 'skill-card-name', text: skill.name })
  header.appendChild(nameEl)

  if (skill.is_dynamic) {
    header.appendChild(el('span', { class: 'skill-badge', text: 'AUTO' }))
  }

  header.appendChild(el('span', { class: 'skill-level-label', text: `Lv.${skill.current_level}` }))

  // Rename button (dynamic skills only)
  if (skill.is_dynamic) {
    const renameBtn = el('button', { class: 'skill-rename-btn', text: '✎' })
    renameBtn.title = 'Rename skill'
    renameBtn.addEventListener('click', () => startRename(card, skill))
    header.appendChild(renameBtn)
  }

  card.appendChild(header)

  // XP bar
  const bar  = el('div', { class: 'skill-card-bar' })
  const fill = el('div', { class: 'skill-card-bar-fill' })
  fill.style.width = `${xpPct}%`
  bar.appendChild(fill)
  card.appendChild(bar)

  // Footer
  const footer = el('div', { class: 'skill-card-footer' })
  footer.appendChild(el('span', { class: 'skill-xp-label', text: `${Math.round(skill.current_xp)} / ${skill.xp_to_next} XP` }))
  footer.appendChild(el('span', { class: `skill-streak ${sc}`, text: streakTxt }))
  card.appendChild(footer)

  return card
}

// ── Build the skill tree and render ──────────────────────────────────────
function renderSkillTree(skills) {
  const list = document.getElementById('skills-list')
  list.innerHTML = ''

  if (!skills.length) {
    list.appendChild(el('div', { class: 'task-empty', text: 'No skills yet. Complete tasks to unlock them.' }))
    return
  }

  // Separate into parents (no parent_skill_id) and children
  const topLevel = skills.filter(s => !s.parent_skill_id)
  const children = skills.filter(s =>  s.parent_skill_id)

  // Build a map: parent_id → [child, child, ...]
  const childMap = new Map()
  for (const child of children) {
    const pid = child.parent_skill_id
    if (!childMap.has(pid)) childMap.set(pid, [])
    childMap.get(pid).push(child)
  }

  // Sort top-level by level desc
  topLevel.sort((a, b) => b.current_level - a.current_level)

  for (const parent of topLevel) {
    // Parent skill group wrapper
    const group = el('div', { class: 'skill-group' })

    // Parent card
    group.appendChild(renderSkillCard(parent, false))

    // Children sorted by level desc
    const kids = (childMap.get(parent.id) || [])
      .sort((a, b) => b.current_level - a.current_level)

    for (const child of kids) {
      group.appendChild(renderSkillCard(child, true))

      // Grandchildren (depth 2)
      const grandkids = (childMap.get(child.id) || [])
        .sort((a, b) => b.current_level - a.current_level)
      for (const gc of grandkids) {
        group.appendChild(renderSkillCard(gc, true))
      }
    }

    list.appendChild(group)
  }

  // Orphaned children (parent_skill_id set but parent not in list — edge case)
  const renderedIds = new Set(skills.map(s => s.id))
  const orphanedChildren = children.filter(c => !renderedIds.has(c.parent_skill_id))
  for (const oc of orphanedChildren) {
    list.appendChild(renderSkillCard(oc, false))
  }
}

// ── Inline rename ────────────────────────────────────────────────────────
function startRename(card, skill) {
  const header  = card.querySelector('.skill-card-header')
  const nameEl  = header.querySelector('.skill-card-name')
  const current = nameEl.textContent

  const input = el('input', { class: 'skill-rename-input', type: 'text' })
  input.value = current
  nameEl.replaceWith(input)
  input.focus()
  input.select()

  const confirmBtn = el('button', { class: 'skill-rename-confirm', text: '✓' })
  header.appendChild(confirmBtn)

  const renameBtn = header.querySelector('.skill-rename-btn')
  if (renameBtn) hide(renameBtn)

  const doRename = async () => {
    const newName = input.value.trim()
    if (!newName || newName === current) { cancelRename(); return }
    confirmBtn.disabled = true
    confirmBtn.textContent = '...'
    try {
      await apiPostChat(`rename skill ${skill.id} to "${newName}"`)
      await loadSkills()
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

// ── Load ─────────────────────────────────────────────────────────────────
async function loadSkills() {
  const list = document.getElementById('skills-list')
  list.innerHTML = '<div class="task-empty">Loading...</div>'

  try {
    const skills = await apiGetSkills()
    renderSkillTree(skills)
  } catch (err) {
    list.innerHTML = ''
    list.appendChild(el('div', { class: 'task-empty', text: 'Failed to load skills.' }))
    console.error('loadSkills error:', err)
  }
}

function initSkills() {
  registerModalCallback('skills', loadSkills)
}
