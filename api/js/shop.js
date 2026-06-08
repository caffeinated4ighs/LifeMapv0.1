// shop.js — shop modal
// Phase 9.2: day_off items get green highlight when day_off_granted is active

let _shopState = { items: [], availableGold: 0, dayOffGranted: false }

function renderShopItem(item, availableGold, dayOffGranted) {
  const canAfford   = availableGold >= item.cost_gold
  const isDayOff    = item.type === 'day_off'
  // Day-off items show as "active" if day_off_granted is true (only relevant for day_off type)
  const isDayActive = isDayOff && dayOffGranted
  // Already bought today: disable re-buy only for day_off (one per day)
  const alreadyBought = isDayOff && item.purchased_today > 0

  const cardClasses = [
    'shop-item',
    !canAfford && !isDayActive ? 'disabled' : '',
    isDayActive ? 'day-off-active' : '',
  ].filter(Boolean).join(' ')

  const card = el('div', { class: cardClasses })

  card.appendChild(el('div', { class: 'shop-item-name', text: item.name }))
  card.appendChild(el('div', { class: 'shop-item-desc', text: item.description }))

  const footer = el('div', { class: 'shop-item-footer' })

  const left = el('div')
  left.appendChild(el('div', { class: 'shop-item-cost', text: `◆ ${item.cost_gold}g` }))
  if (item.purchased_today > 0 && !isDayOff) {
    left.appendChild(el('div', { class: 'shop-item-meta', text: `Bought: ${item.purchased_today}×` }))
  }
  footer.appendChild(left)

  if (isDayActive) {
    // Day-off is active today — show green "Active until EOD" badge
    const badge = el('span', { class: 'day-off-status-badge', text: 'Active until EOD' })
    footer.appendChild(badge)
  } else if (alreadyBought) {
    footer.appendChild(el('span', { class: 'shop-active-badge', text: '✓ Purchased' }))
  } else {
    const btn = el('button', { class: 'shop-buy-btn' })
    btn.textContent = 'Buy'
    if (!canAfford) btn.disabled = true

    btn.addEventListener('click', async () => {
      btn.disabled = true
      btn.textContent = '...'
      try {
        await apiBuyItem(item.id)
        await loadShop()
        if (typeof refreshNavbar === 'function') await refreshNavbar()
      } catch (err) {
        console.error('buy error:', err)
        const isGold = err.message?.toLowerCase().includes('gold')
        btn.textContent = isGold ? 'No gold' : 'Error'
        setTimeout(() => {
          btn.textContent = 'Buy'
          btn.disabled = !canAfford
        }, 2000)
      }
    })
    footer.appendChild(btn)
  }

  card.appendChild(footer)
  return card
}

async function loadShop() {
  const grid = document.getElementById('shop-grid')
  grid.innerHTML = '<div class="task-empty">Loading...</div>'

  try {
    const [items, state] = await Promise.all([apiGetShop(), apiGetState()])

    const dayOffGranted = state.day_off_granted || state.streak?.day_off_granted || false
    _shopState = { items, availableGold: state.available_gold, dayOffGranted }

    const shopGoldDisplay = document.getElementById('shop-gold-display')
    if (shopGoldDisplay) shopGoldDisplay.textContent = `${state.available_gold}g available`

    grid.innerHTML = ''

    if (items.length === 0) {
      grid.appendChild(el('div', { class: 'task-empty', text: 'Shop is empty.' }))
      return
    }

    items.forEach(item => grid.appendChild(renderShopItem(item, state.available_gold, dayOffGranted)))
  } catch (err) {
    grid.innerHTML = ''
    grid.appendChild(el('div', { class: 'task-empty', text: 'Failed to load shop.' }))
    console.error('loadShop error:', err)
  }
}

function initShop() {
  registerModalCallback('shop', loadShop)
}
