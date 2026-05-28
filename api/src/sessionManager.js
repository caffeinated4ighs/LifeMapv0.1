import { config } from './config.js';

// private session store — not exported
const sessions = {};

export function createConversation(sessionId) {
  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      createdAt: new Date(),
      messages: []
    };
  }
}

export function conversationExists(sessionId) {
  return !!sessions[sessionId];
}

export function insertMessage(sessionId, role, content) {
  if (!sessions[sessionId]) return;

  const newMessage = {
    role: role,
    content: content,
    timestamp: new Date()
  };

  sessions[sessionId].messages.push(newMessage);

  if (sessions[sessionId].messages.length > config.session.maxMessages) {
    sessions[sessionId].messages = sessions[sessionId].messages.slice(-config.session.maxMessages);
  }
}

export function assembleContext(sessionId) {
  if (!sessions[sessionId]) {
    return [];
  }

  return sessions[sessionId].messages.map(msg => { 
    const processedText = renderSummaryAsText(msg.role, msg.content);

    return {
      role: msg.role,
      parts: [{ text: processedText }]
    };
  });
}

export function renderSummaryAsText(role, content) {
  if (role === 'user') {
    return `User said: "${content}"`;
  }

  if (role === 'model') {
    const truncatedContent = content.length > config.session.truncationLimit 
      ? content.slice(0, config.session.truncationLimit) + '...' 
      : content;

    return `Assistant replied: "${truncatedContent}"`;
  }

  return content;
}