// skills.js — Phase 9.3: skill tree with parent/child hierarchy

function renderSkillCard(skill, depth = 0) {
  const xpPct   = xpPercent(skill.current_xp, skill.xp_to_next)
  const sc      = streakClass(skill.current_streak)
  const isChild = depth > 0

  const card = el('div', { class: `skill-card${isChild ? ' skill-card-child' : ''}` })
  card.dataset.skillId = skill.id
  if (depth > 0) card.style.marginLeft = `${Math.min(depth, 3) * 16}px`

  const header = el('div', { class: 'skill-card-header' })

  if (isChild) {
    header.appendChild(el('span', { class: 'skill-tree-connector', text: '└─' }))
  }

  header.appendChild(el('span', { class: 'skill-card-name', text: skill.name }))

  if (skill.is_dynamic) {
    header.appendChild(el('span', { class: 'skill-badge', text: isChild ? 'SPEC' : 'AUTO' }))
  }

  header.appendChild(el('span', { class: 'skill-level-label', text: `Lv.${skill.current_level}` }))

  if (skill.is_dynamic) {
    const renameBtn = el('button', { class: 'skill-rename-btn', text: '✎' })
    renameBtn.title = 'Rename skill'
    renameBtn.addEventListener('click', () => startRename(card, skill))
    header.appendChild(renameBtn)
  }
  card.appendChild(header)

  const bar  = el('div', { class: 'skill-card-bar' })
  const fill = el('div', { class: `skill-card-bar-fill${isChild ? ' skill-card-bar-fill-child' : ''}` })
  fill.style.width = `${xpPct}%`
  bar.appendChild(fill)
  card.appendChild(bar)

  const footer = el('div', { class: 'skill-card-footer' })
  footer.appendChild(el('span', { class: 'skill-xp-label', text: `${Math.round(skill.current_xp)} / ${skill.xp_to_next} XP` }))
  footer.appendChild(el('span', { class: `skill-streak ${sc}`, text: `Streak: ${formatStreak(skill.current_streak)}` }))
  card.appendChild(footer)

  return card
}

function startRename(card, skill) {
  const header      = card.querySelector('.skill-card-header')
  const nameEl      = header.querySelector('.skill-card-name')
  const currentName = nameEl.textContent

  const input = el('input', { class: 'skill-rename-input', type: 'text' })
  input.value = currentName
  nameEl.replaceWith(input)
  input.focus(); input.select()

  const confirmBtn = el('button', { class: 'skill-rename-confirm', text: '✓' })
  header.appendChild(confirmBtn)

  const renameBtn = header.querySelector('.skill-rename-btn')
  if (renameBtn) hide(renameBtn)

  const doRename = async () => {
    const newName = input.value.trim()
    if (!newName || newName === currentName) { cancelRename(); return }
    confirmBtn.disabled = true; confirmBtn.textContent = '...'
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

function buildSkillTree(skills) {
  const roots    = skills.filter(s => !s.parent_skill_id)
  const children = skills.filter(s =>  s.parent_skill_id)

  const childMap = new Map()
  for (const child of children) {
    const pid = child.parent_skill_id
    if (!childMap.has(pid)) childMap.set(pid, [])
    childMap.get(pid).push(child)
  }

  const fragments = []

  function renderBranch(skill, depth) {
    fragments.push({ skill, depth })
    const kids = (childMap.get(skill.id) || []).sort((a, b) => b.current_level - a.current_level)
    for (const kid of kids) renderBranch(kid, depth + 1)
  }

  roots.sort((a, b) => b.current_level - a.current_level)
  for (const root of roots) renderBranch(root, 0)

  return fragments
}

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

    const tree = buildSkillTree(skills)
    let lastRootId = null

    for (const { skill, depth } of tree) {
      if (depth === 0 && lastRootId !== null) {
        list.appendChild(el('div', { class: 'skill-tree-separator' }))
      }
      if (depth === 0) lastRootId = skill.id
      list.appendChild(renderSkillCard(skill, depth))
    }
  } catch (err) {
    list.innerHTML = ''
    list.appendChild(el('div', { class: 'task-empty', text: 'Failed to load skills.' }))
    console.error('loadSkills error:', err)
  }
}

function initSkills() {
  registerModalCallback('skills', loadSkills)
}
