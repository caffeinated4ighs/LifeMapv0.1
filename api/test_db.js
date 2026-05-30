import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const today = new Date().toISOString().split('T')[0]
const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]

console.log('Today:', today)
console.log('Tomorrow:', tomorrow)

const { data, error } = await supabase
  .from('active_tasks')
  .select('*')
  .or(`scheduled_at.gte.${today},scheduled_at.lt.${tomorrow},time_block.not.is.null`)
  .order('scheduled_at', { ascending: true, nullsFirst: false })

console.log('Error:', error)
console.log('Tasks:', JSON.stringify(data, null, 2))