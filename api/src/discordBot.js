// Life Map v1 — discordBot.js
// Thin Discord webhook wrapper.
// No bot token, no OAuth — just a POST to a webhook URL.
// Set DISCORD_WEBHOOK_URL in .env to enable. Graceful no-op if not set.

export async function postToDiscord(message) {
  if (!process.env.DISCORD_WEBHOOK_URL) return

  try {
    const res = await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message })
    })

    if (!res.ok) {
      console.error(`Discord webhook failed: ${res.status} ${res.statusText}`)
    }
  } catch (error) {
    console.error('Discord webhook error:', error.message)
  }
}
