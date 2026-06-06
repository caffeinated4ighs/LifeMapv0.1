// ═══════════════════════════════════════════════════════════════════════════
// shop.js — shop modal
// Owns: shop grid rendering, buy logic, gold-check disable states
// ═══════════════════════════════════════════════════════════════════════════

let _shopState = { items: [], availableGold: 0 }

// ── Render a single shop item card ───────────────────────────────────────────
function renderShopItem(item, availableGold) {
  const canAfford   = availableGold >= item.cost_gold
  const isDayOff    = item.type === 'day_off'
  const alreadyBought = isDayOff && item.purchased_today > 0

  const card = el('div', { class: `shop-item${!canAfford ? ' disabled' : ''}` })

  card.appendChild(el('div', { class: 'shop-item-name', text: item.name }))
  card.appendChild(el('div', { class: 'shop-item-desc', text: item.description }))

  const footer = el('div', { class: 'shop-item-footer' })

  const left = el('div')
  left.appendChild(el('div', { class: 'shop-item-cost', text: `◆ ${item.cost_gold}g` }))
  if (item.purchased_today > 0) {
    left.appendChild(el('div', {
      class: 'shop-item-meta',
      text: isDayOff ? '' : `Bought: ${item.purchased_today}×`,
    }))
  }
  footer.appendChild(left)

  if (alreadyBought) {
    footer.appendChild(el('span', { class: 'shop-active-badge', text: '✓ Active' }))
  } else {
    const btn = el('button', { class: 'shop-buy-btn' })
    btn.textContent = 'Buy'
    if (!canAfford) btn.disabled = true

    btn.addEventListener('click', async () => {
      btn.disabled = true
      btn.textContent = '...'
      try {
        await apiBuyItem(item.id)
        // Refresh shop + navbar gold
        await loadShop()
        if (typeof refreshNavbar === 'function') await refreshNavbar()
      } catch (err) {
        btn.textContent = 'Buy'
        btn.disabled = !canAfford
        console.error('buy error:', err)
        // Surface error briefly on the button
        btn.textContent = err.message.includes('gold') ? 'No gold' : 'Error'
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

// ── Load and render shop ─────────────────────────────────────────────────────
async function loadShop() {
  const grid = document.getElementById('shop-grid')
  grid.innerHTML = '<div class="task-empty">Loading...</div>'

  try {
    const [items, state] = await Promise.all([
      apiGetShop(),
      apiGetState(),
    ])

    _shopState = { items, availableGold: state.available_gold }

    // Update gold display in modal header
    const shopGoldDisplay = document.getElementById('shop-gold-display')
    if (shopGoldDisplay) shopGoldDisplay.textContent = `${state.available_gold}g available`

    grid.innerHTML = ''
    if (items.length === 0) {
      grid.appendChild(el('div', { class: 'task-empty', text: 'Shop is empty.' }))
      return
    }

    items.forEach(item => grid.appendChild(renderShopItem(item, state.available_gold)))
  } catch (err) {
    grid.innerHTML = ''
    grid.appendChild(el('div', { class: 'task-empty', text: 'Failed to load shop.' }))
    console.error('loadShop error:', err)
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
function initShop() {
  registerModalCallback('shop', loadShop)
}
