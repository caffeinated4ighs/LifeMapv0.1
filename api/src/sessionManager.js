import { supabase } from './supabaseClient.js'
import { getRuntime } from './configLoader.js'


export async function createConversation(sessionId) { 
  const { error } = await supabase
    .from('llm_session')
    .upsert(
      { session_key: sessionId, updated_at: new Date().toISOString() },
      { onConflict: 'session_key' }
    )
  
  if (error) {
    console.error('createConversation failed:', error)
    throw error
  }
}

export async function conversationExists(sessionId) {
  const { data, error } = await supabase
    .from('llm_session')
    .select('session_key')
    .eq('session_key', sessionId)
    .limit(1);

  if (error) {
    console.error('Error checking conversation existence:', error);
    throw error;
  }

  return data && data.length > 0;
}

export async function insertMessage(sessionId, role, content) {
  // Step 1: Get internal session id
  const { data: sessionData, error: sessionError } = await supabase
    .from('llm_session')
    .select('id')
    .eq('session_key', sessionId)
    .single();

  if (sessionError || !sessionData) {
    console.error('Session not found for insertMessage:', sessionError);
    throw new Error(`Session not found: ${sessionId}`);
  }

  const sessionInternalId = sessionData.id;

  // Step 2: Get current max order_index
  const { data: maxData, error: maxError } = await supabase
    .from('llm_context_chunk')
    .select('order_index')
    .eq('session_id', sessionInternalId)
    .order('order_index', { ascending: false })
    .limit(1);

  if (maxError) {
    console.error('Error fetching max order_index:', maxError);
    throw maxError;
  }

  const currentMax = maxData && maxData.length > 0 ? maxData[0].order_index : 0;
  const newOrderIndex = currentMax + 1;

  // Step 3: Insert new message
  const { error: insertError } = await supabase
  .from('llm_context_chunk')
  .insert({
    session_id: sessionInternalId,
    order_index: newOrderIndex,
    role: role,
    content: renderSummaryAsText(role, content),
    token_count: Math.ceil(content.length / 4)
  });

  if (insertError) {
    console.error('Error inserting message:', insertError);
    throw insertError;
  }

  // Step 4: Trim oldest messages if over limit
  const maxMessages = getRuntime().session.maxMessages;

  const { count, error: countError } = await supabase
    .from('llm_context_chunk')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionInternalId)

  if (countError) {
    console.error('Error counting messages:', countError);
    throw countError;
  }

  const messageCount = count || 0

  if (messageCount > maxMessages) {
  const excess = messageCount - maxMessages

  const { data: oldestRows } = await supabase
    .from('llm_context_chunk')
    .select('id')
    .eq('session_id', sessionInternalId)
    .order('order_index', { ascending: true })
    .limit(excess)

  const idsToDelete = oldestRows.map(r => r.id)

  await supabase
    .from('llm_context_chunk')
    .delete()
    .in('id', idsToDelete)
  }
}

export async function assembleContext(sessionId) {
  // Step 1: Get internal session id
  const { data: sessionData, error: sessionError } = await supabase
    .from('llm_session')
    .select('id')
    .eq('session_key', sessionId)
    .single();

  if (sessionError || !sessionData) {
    console.warn('Session not found for assembleContext:', sessionId);
    return [];
  }

  const sessionInternalId = sessionData.id;

  // Step 2: Get all context chunks ordered by order_index
  const { data: chunks, error: chunksError } = await supabase
    .from('llm_context_chunk')
    .select('role, content')
    .eq('session_id', sessionInternalId)
    .order('order_index', { ascending: true });

  if (chunksError) {
    console.error('Error fetching context chunks:', chunksError);
    throw chunksError;
  }

  if (!chunks || chunks.length === 0) {
    return [];
  }

  return chunks.map(chunk => ({
    role: chunk.role,
    parts: [{ text: chunk.content }]
  }));

}

export function renderSummaryAsText(role, content) {
  if (role === 'user') {
    return `User said: "${content}"`;
  }

  if (role === 'model') {
    const truncatedContent = content.length > getRuntime().session.truncationLimit 
      ? content.slice(0, getRuntime().session.truncationLimit) + '...' 
      : content;

    return `Assistant replied: "${truncatedContent}"`;
  }

  return content;
}