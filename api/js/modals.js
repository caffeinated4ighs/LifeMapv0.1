// ═══════════════════════════════════════════════════════════════════════════
// modals.js — modal open/close system
// One overlay, multiple panes. Only one pane visible at a time.
// ═══════════════════════════════════════════════════════════════════════════

const MODAL_PANE_IDS = ['modal-shop', 'modal-stats', 'modal-skills', 'modal-calendar', 'modal-graphs']

let _currentModal = null

// Map from data-modal attribute value → pane id
const MODAL_MAP = {
  shop:     'modal-shop',
  stats:    'modal-stats',
  skills:   'modal-skills',
  calendar: 'modal-calendar',
  graphs:   'modal-graphs',
}

// Callbacks fired when a modal opens — modules register here to lazy-load data
const _openCallbacks = {}

function registerModalCallback(name, fn) {
  _openCallbacks[name] = fn
}

function openModal(name) {
  const paneId = MODAL_MAP[name]
  if (!paneId) return

  // Hide all panes, show the right one
  MODAL_PANE_IDS.forEach(id => {
    const pane = document.getElementById(id)
    if (pane) hide(pane)
  })

  const pane = document.getElementById(paneId)
  if (!pane) return

  show(pane)
  show(document.getElementById('modal-overlay'))
  _currentModal = name

  // Fire the registered open callback (loads data for this modal)
  if (_openCallbacks[name]) _openCallbacks[name]()
}

function closeModal() {
  hide(document.getElementById('modal-overlay'))
  _currentModal = null
}

function initModals() {
  // Close button
  document.getElementById('modal-close').addEventListener('click', closeModal)

  // Backdrop click
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal()
  })

  // Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _currentModal) closeModal()
  })

  // Nav buttons — data-modal attribute drives which pane opens
  document.querySelectorAll('[data-modal]').forEach(btn => {
    btn.addEventListener('click', e => {
      const name = e.currentTarget.dataset.modal
      if (name) openModal(name)
    })
  })

  // Calendar icon inside date selector
  const calIcon = document.querySelector('.cal-icon')
  if (calIcon) {
    calIcon.addEventListener('click', e => {
      e.stopPropagation()
      openModal('calendar')
    })
  }
}
