// Acces Git via la CLI : log de toutes les branches, branche courante, checkout.
// Le calcul des "lanes" (colonnes du graphe) se fait cote renderer a partir des commits.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(repo, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: repo, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).trim()));
      resolve(stdout);
    });
  });
}

async function isRepo(repo) {
  if (!repo || !fs.existsSync(repo)) return false;
  try {
    const out = await run(repo, ['rev-parse', '--is-inside-work-tree']);
    return out.trim() === 'true';
  } catch {
    return false;
  }
}

// Racine du depot qui contient `dir` (dir peut etre un sous-dossier), ou null.
async function repoRoot(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  try {
    const out = await run(dir, ['rev-parse', '--show-toplevel']);
    return out.trim() ? path.normalize(out.trim()) : null;
  } catch {
    return null;
  }
}

// A partir d'une liste de dossiers (les cwd des sessions + depots ajoutes),
// deduit la liste des depots Git uniques (racine, nom, branche courante).
async function detectRepos(dirs) {
  const seen = new Map();   // racine -> { repo, name, current }
  for (const d of dirs || []) {
    const root = await repoRoot(d);
    if (!root || seen.has(root)) continue;
    let current = '';
    try { current = (await run(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim(); } catch {}
    seen.set(root, { repo: root, name: path.basename(root), current });
  }
  return [...seen.values()];
}

const SEP = '\x1f';   // separateur de champ
const MAX_COMMITS = 80;

async function graph(repo) {
  // branche courante
  let current = '';
  try { current = (await run(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim(); } catch {}

  // branches locales
  let branches = [];
  try {
    const out = await run(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
    branches = out.split('\n').map(s => s.trim()).filter(Boolean);
  } catch {}

  // commits de toutes les branches, en ordre topologique
  // %ae = email auteur, %cI = date ISO (pour afficher la date complete au clic)
  const fmt = ['%H', '%P', '%an', '%ae', '%ar', '%cI', '%D', '%s'].join(SEP);
  const out = await run(repo, [
    'log', '--all', '--date-order', `--max-count=${MAX_COMMITS}`, `--pretty=format:${fmt}`
  ]);

  const commits = out.split('\n').filter(Boolean).map(line => {
    const [hash, parents, an, ae, ar, iso, refs, subject] = line.split(SEP);
    return {
      hash,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      an,
      ae,
      ar,
      iso,
      refs: refs ? refs.split(',').map(s => s.trim()).filter(Boolean) : [],
      subject
    };
  });

  return { repo, name: path.basename(repo), current, branches, commits };
}

async function checkout(repo, branch) {
  await run(repo, ['checkout', branch]);
}

module.exports = { isRepo, repoRoot, detectRepos, graph, checkout };
