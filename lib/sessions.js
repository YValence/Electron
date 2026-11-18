// Lecture des sessions Claude Code depuis ~/.claude/projects/**/*.jsonl
// On en deduit, pour chaque session recente, un statut lisible dans le popup.
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// Fenetres de temps (ms) pour classer l'activite
const ACTIVE_MS = 25 * 1000;         // modifie il y a moins de 25s -> en cours
const STUCK_MS = 30 * 1000;          // tool_use sans reponse depuis +30s -> sans doute une permission en attente
const RECENT_MS = 45 * 60 * 1000;    // on n'affiche que les sessions des 45 dernieres minutes
const MAX_AGENTS = 8;

// Outils qui demandent une permission avant de s'executer (pour l'etat "en attente de permission")
const PERM_TOOLS = /^(Bash|Write|Edit|MultiEdit|NotebookEdit)$/;

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

// Nettoie un texte pour l'affichage : retire emojis et marqueurs markdown.
function cleanText(s) {
  return String(s || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}]/gu, '')
    .replace(/[*_`#>]+/g, ' ')   // marqueurs markdown
    .replace(/\s+/g, ' ')
    .trim();
}

// Recupere la liste des sous-taches (TodoWrite ou plan) d'un message.
function extractTodos(content) {
  if (!Array.isArray(content)) return null;
  for (const p of content) {
    if (!p || p.type !== 'tool_use') continue;
    if (!/todo|plan/i.test(p.name || '')) continue;
    const items = (p.input && (p.input.todos || p.input.items)) || null;
    if (Array.isArray(items) && items.length) {
      return items.map(it => ({
        content: cleanText(it.content || it.activeForm || '').slice(0, 80),
        status: it.status || 'pending'
      }));
    }
  }
  return null;
}

// A partir des outils encore sans reponse, deduit si l'agent attend une action humaine.
// 3 cas : une question (AskUserQuestion), un plan a valider (ExitPlanMode),
// ou une permission (un outil sensible bloque depuis un moment).
function buildWaiting(tools, age) {
  const q = tools.find(t => /AskUserQuestion/i.test(t.name));
  if (q) {
    const first = q.input && Array.isArray(q.input.questions) && q.input.questions[0];
    if (first) {
      return {
        kind: 'ask',
        title: cleanText(first.header || 'Question').slice(0, 40) || 'Question',
        detail: cleanText(first.question).slice(0, 180),
        options: (first.options || []).slice(0, 5).map(o => cleanText(o.label).slice(0, 70))
      };
    }
  }

  const plan = tools.find(t => /ExitPlanMode/i.test(t.name));
  if (plan) {
    const txt = (plan.input && plan.input.plan) || '';
    return { kind: 'plan', title: 'Plan a valider', detail: cleanText(txt).slice(0, 200), options: [] };
  }

  // Permission : un outil sensible n'a pas de resultat et la session est calme depuis +30s.
  if (age > STUCK_MS) {
    const permList = tools.filter(t => PERM_TOOLS.test(t.name));
    const t = permList[permList.length - 1];
    if (t) {
      const detail = t.name === 'Bash'
        ? cleanText((t.input && t.input.command) || '').slice(0, 160)
        : cleanText((t.input && t.input.file_path) || '');
      return { kind: 'perm', title: 'Permission — ' + t.name, detail, options: [] };
    }
  }

  return null;
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
  let turns = 0;
  let todos = null;
  let cwd = '';
  // Un outil est "en attente" seulement s'il n'a AUCUN resultat nulle part.
  // (On ne se fie pas a l'ordre : les sessions reprises rejouent les tool_use.)
  const toolUses = new Map();   // id -> {name, input}  (dernier gagne)
  const resultIds = new Set();  // id des tool_use qui ont recu un resultat

  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    const type = ev.type;
    if (ev.cwd) cwd = ev.cwd;   // vrai chemin du projet (pour ouvrir VS Code)
    if (type === 'user' || type === 'assistant') {
      turns++;
      const txt = messageText(ev.message);
      if (txt) { lastText = txt; lastRole = type; }
      const content = ev.message && ev.message.content;
      if (Array.isArray(content)) {
        for (const p of content) {
          if (!p) continue;
          if (p.type === 'tool_use') toolUses.set(p.id, { name: p.name, input: p.input });
          else if (p.type === 'tool_result') resultIds.add(p.tool_use_id);
        }
        const found = extractTodos(content);
        if (found) todos = found;   // on garde la derniere liste de sous-taches
      }
    }
  }

  const pending = [...toolUses].filter(([id]) => !resultIds.has(id)).map(([, t]) => t);
  const waiting = buildWaiting(pending, age);

  // Statut : l'attente d'une action humaine prime, sinon recence + dernier evenement.
  let status;
  if (waiting) {
    status = waiting.kind;       // ask | perm | plan
  } else if (age < ACTIVE_MS) {
    status = 'running';
  } else if (lastRole === 'assistant') {
    status = 'done';             // l'agent a rendu la main
  } else {
    status = 'idle';
  }

  const project = prettyProject(encodedProject);
  return {
    id: path.basename(file, '.jsonl'),
    project,
    badge: initials(project),
    last: cleanText(lastText).slice(0, 90),
    turns,
    status,
    waiting,
    cwd,
    todos: todos || [],
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
