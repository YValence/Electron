// Lecture des sessions Claude Code depuis ~/.claude/projects/**/*.jsonl
// On en deduit, pour chaque session recente, un statut lisible dans le popup.
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// Fenetres de temps (ms) pour classer l'activite
const ACTIVE_MS = 25 * 1000;         // modifie il y a moins de 25s -> en cours
const RECENT_MS = 45 * 60 * 1000;    // on n'affiche que les sessions des 45 dernieres minutes
const MAX_AGENTS = 8;

// Nom de projet lisible a partir du dossier encode par Claude Code
// ex: "C--Users-pc-Documents-perso-Electron" -> "Electron"
function prettyProject(encoded) {
  const parts = encoded.split('-').filter(Boolean);
  return parts[parts.length - 1] || encoded;
}

// Initiales pour le badge mono (ex: "Electron" -> "EL")
function initials(name) {
  const clean = name.replace(/[^a-zA-Z0-9 ]/g, ' ').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (clean.slice(0, 2) || '??').toUpperCase();
}

// Extrait le texte d'un message (user/assistant) quel que soit le format
function messageText(msg) {
  if (!msg) return '';
  const content = msg.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const textPart = content.find(p => p && p.type === 'text' && p.text);
    if (textPart) return textPart.text;
    const toolUse = content.find(p => p && p.type === 'tool_use');
    if (toolUse) return '[outil] ' + (toolUse.name || '');
    const toolRes = content.find(p => p && p.type === 'tool_result');
    if (toolRes) return '[resultat outil]';
  }
  return '';
}

// Lit les dernieres lignes utiles d'un .jsonl (on evite de tout charger si enorme)
async function readTail(file, maxLines = 400) {
  const raw = await fsp.readFile(file, 'utf8');
  const lines = raw.split('\n').filter(l => l.trim());
  return lines.slice(-maxLines);
}

// Analyse une session -> objet agent, ou null si trop vieille / illisible
async function analyze(file, encodedProject) {
  const stat = await fsp.stat(file);
  const age = Date.now() - stat.mtimeMs;
  if (age > RECENT_MS) return null;

  let lines;
  try { lines = await readTail(file); } catch { return null; }
  if (!lines.length) return null;

  let lastText = '';
  let lastRole = '';
  let lastType = '';
  let turns = 0;
  let waitingTool = false;

  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    const type = ev.type;
    lastType = type;
    if (type === 'user' || type === 'assistant') {
      turns++;
      const txt = messageText(ev.message);
      if (txt) { lastText = txt; lastRole = type; }
      // un tool_use en dernier = l'agent est en train d'agir
      const content = ev.message && ev.message.content;
      if (Array.isArray(content)) {
        waitingTool = content.some(p => p && p.type === 'tool_use');
      }
    }
  }

  // Heuristique de statut (honnete : basee sur la recence + le dernier evenement)
  let status;
  if (age < ACTIVE_MS) {
    status = waitingTool ? 'running' : 'running';
  } else if (lastRole === 'assistant') {
    status = 'done';   // l'agent a rendu la main
  } else {
    status = 'idle';
  }

  const project = prettyProject(encodedProject);
  return {
    id: path.basename(file, '.jsonl'),
    project,
    badge: initials(project),
    last: (lastText || '').replace(/\s+/g, ' ').trim().slice(0, 90),
    turns,
    status,
    mtime: stat.mtimeMs,
    ageMs: age
  };
}

async function listAgents() {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  const projectDirs = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
  const agents = [];

  for (const d of projectDirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(PROJECTS_DIR, d.name);
    let files;
    try { files = await fsp.readdir(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      try {
        const a = await analyze(path.join(dir, f), d.name);
        if (a) agents.push(a);
      } catch { /* on ignore une session illisible */ }
    }
  }

  // plus recent d'abord, et on limite
  agents.sort((a, b) => b.mtime - a.mtime);
  return agents.slice(0, MAX_AGENTS);
}

module.exports = { listAgents, PROJECTS_DIR };
