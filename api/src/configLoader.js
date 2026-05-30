import fs from 'fs';
import path from 'path';
import url from 'url';

let _config = null;

export function loadConfig() {
  if (_config !== null) {
    return _config;
  }

  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
  const configDir = path.join(__dirname, '../../config');

  const files = {
    persona: 'persona.json',
    vocabulary: 'vocabulary.json',
    mechanics: 'mechanics.json',
    theme: 'theme.json',
    runtime: 'runtime.json'
  };

  _config = {};

  for (const [key, filename] of Object.entries(files)) {
    const filePath = path.join(configDir, filename);
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      _config[key] = JSON.parse(fileContent);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Config file missing: ${filename}`);
      }
      throw new Error(`Failed to load config file ${filename}: ${error.message}`);
    }
  }

  return _config;
}

export function getConfig() {
  if (_config === null) {
    throw new Error('loadConfig() must be called before getConfig()');
  }
  return _config;
}

export function buildSystemPrompt() {
  const config = getConfig();
  const { persona, vocabulary } = config;

  let prompt = `You are ${persona.name}, a personal operating system.\n`;

  prompt += `Tone: ${persona.tone}\n\n`;

  // Rules as numbered list
  prompt += "Rules:\n";
  persona.rules.forEach((rule, index) => {
    prompt += `${index + 1}. ${rule}\n`;
  });
  prompt += "\n";

  // Vocabulary - flat object
  prompt += "Vocabulary - Use these terms naturally:\n";
  Object.entries(vocabulary).forEach(([term, definition]) => {
    prompt += `- ${term}: ${definition}\n`;
  });
  prompt += "\n";

  // Reply style
  prompt += "Reply Style:\n";
  Object.entries(persona.reply_style).forEach(([style, instruction]) => {
    prompt += `- ${style}: ${instruction}\n`;
  });

  return prompt;
}

export function getRank(level) {
  const config = getConfig();
  const ranks = config.mechanics.ranks;

  const eligibleRanks = ranks.filter(rank => rank.level <= level);
  
  if (eligibleRanks.length === 0) return ranks[0].title;

  return eligibleRanks[eligibleRanks.length - 1].title;
}

export function getRuntime() {
  const config = getConfig();
  
  return config.runtime;
}