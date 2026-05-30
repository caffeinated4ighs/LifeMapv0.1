import { GoogleGenerativeAI } from '@google/generative-ai'
import { supabase } from './src/supabaseClient.js'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)

async function embedSeed() {
  console.log('🚀 Starting embedding seed process...')

  // 1. Get all stats
  const { data: stats, error: statsError } = await supabase
    .schema('public')
    .from('stat')
    .select('id, name, description')

  if (statsError) {
    console.error('❌ Error fetching stats:', statsError)
    process.exit(1)
  }

  console.log(`Found ${stats.length} stats to embed.`)

  const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' })

  for (const stat of stats) {
    const text = `${stat.name}. ${stat.description}`

    try {
      console.log(`Embedding: ${stat.name}...`)
      
      const result = await model.embedContent(text)
      const embedding = result.embedding.values
      console.log(`Vector length: ${embedding.length}`)

      const { error: updateError } = await supabase
        .schema('public')
        .from('stat')
        .update({ embedding_vector: embedding })
        .eq('id', stat.id)

      if (updateError) {
        console.error(`❌ Failed to update ${stat.name}:`, updateError)
      } else {
        console.log(`✅ Embedded ${stat.name}`)
      }
    } catch (err) {
      console.error(`❌ Embedding failed for ${stat.name}:`, err)
    }
  }

  console.log('\n🎉 Embedding seed completed!')
}

// Run the script
embedSeed()
  .catch(console.error)