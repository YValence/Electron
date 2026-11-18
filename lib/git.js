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
  const fmt = ['%H', '%P', '%an', '%ar', '%D', '%s'].join(SEP);
  const out = await run(repo, [
    'log', '--all', '--date-order', `--max-count=${MAX_COMMITS}`, `--pretty=format:${fmt}`
  ]);

  const commits = out.split('\n').filter(Boolean).map(line => {
    const [hash, parents, an, ar, refs, subject] = line.split(SEP);
    return {
      hash,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      an,
      ar,
      refs: refs ? refs.split(',').map(s => s.trim()).filter(Boolean) : [],
      subject
    };
  });

  return { repo, name: path.basename(repo), current, branches, commits };
}

async function checkout(repo, branch) {
  await run(repo, ['checkout', branch]);
}

module.exports = { isRepo, graph, checkout };
