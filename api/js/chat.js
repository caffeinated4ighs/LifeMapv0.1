// ═══════════════════════════════════════════════════════════════════════════
// chat.js — chat interface
// Owns: message rendering, send, typing indicator, auto-scroll
// ═══════════════════════════════════════════════════════════════════════════

let _isSending = false

// ── Render a single message bubble ──────────────────────────────────────────
function renderMessage(role, text) {
  const messages = document.getElementById('chat-messages')

  // Clear welcome state on first real message
  const welcome = messages.querySelector('.chat-welcome')
  if (welcome) welcome.remove()

  const wrapper = el('div', { class: `message ${role}` })
  const bubble  = el('div', { class: 'message-bubble', text })
  wrapper.appendChild(bubble)
  messages.appendChild(wrapper)

  scrollToBottom()
  return wrapper
}

function scrollToBottom() {
  const messages = document.getElementById('chat-messages')
  messages.scrollTop = messages.scrollHeight
}

// ── Typing indicator ─────────────────────────────────────────────────────────
function showTyping() {
  const indicator = document.getElementById('typing-indicator')
  show(indicator)
  scrollToBottom()
}

function hideTyping() {
  const indicator = document.getElementById('typing-indicator')
  hide(indicator)
}

// ── Send a message ───────────────────────────────────────────────────────────
async function sendMessage() {
  if (_isSending) return

  const input = document.getElementById('chat-input')
  const sendBtn = document.getElementById('chat-send')
  const text = input.value.trim()
  if (!text) return

  _isSending = true
  sendBtn.disabled = true
  input.value = ''
  resizeTextarea(input)

  renderMessage('user', text)
  showTyping()

  try {
    const { reply } = await apiPostChat(text)
    hideTyping()
    renderMessage('system', reply)

    // Refresh tasks and state after any chat response —
    // the LLM may have completed a task, added one, etc.
    await loadTasks()
    if (typeof refreshNavbar === 'function') await refreshNavbar()

  } catch (err) {
    hideTyping()
    renderMessage('system', `⚠ Error: ${err.message}`)
    console.error('chat send error:', err)
  } finally {
    _isSending = false
    sendBtn.disabled = false
    input.focus()
  }
}

// ── Textarea auto-resize ─────────────────────────────────────────────────────
function resizeTextarea(ta) {
  ta.style.height = 'auto'
  ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`
}

// ── Init ─────────────────────────────────────────────────────────────────────
function initChat() {
  const input   = document.getElementById('chat-input')
  const sendBtn = document.getElementById('chat-send')

  // Send on button click
  sendBtn.addEventListener('click', sendMessage)

  // Send on Enter (Shift+Enter = newline)
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  })

  // Auto-resize textarea as user types
  input.addEventListener('input', () => resizeTextarea(input))
}
