// Renderer : pilote l'UI, interroge les sessions Claude et construit le graphe Git.
const $ = (id) => document.getElementById(id);

/* ============ Icônes robot (style ligne) ============ */
const RB = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="robot">${inner}</svg>`;
const D = (x, y, r = 1.1) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;
const ROBOTS = [
  // 1 — tête carree, antenne, oreilles
  RB(`<line x1="12" y1="2.5" x2="12" y2="5"/>${D(12,2.2,1)}<rect x="5" y="5" width="14" height="12" rx="2.6"/><path d="M5 9 H3 V13 H5"/><path d="M19 9 H21 V13 H19"/>${D(9.5,11,1.2)}${D(14.5,11,1.2)}<line x1="9.5" y1="14.3" x2="14.5" y2="14.3"/>`),
  // 2 — tête ronde, deux antennes à boule, yeux carres
  RB(`${D(7,3,1)}<line x1="7.4" y1="3.7" x2="9" y2="6"/>${D(17,3,1)}<line x1="16.6" y1="3.7" x2="15" y2="6"/><rect x="5" y="6" width="14" height="12" rx="6"/><rect x="8.4" y="10" width="2.3" height="2.3" rx=".6" fill="currentColor" stroke="none"/><rect x="13.3" y="10" width="2.3" height="2.3" rx=".6" fill="currentColor" stroke="none"/>`),
  // 3 — bot casque / visor
  RB(`<line x1="12" y1="2.2" x2="12" y2="4.6"/>${D(12,2,1)}<rect x="6" y="4.6" width="12" height="13" rx="5.5"/><path d="M6 9 H3.5 V14 H6"/><path d="M18 9 H20.5 V14 H18"/><rect x="8.6" y="9.8" width="6.8" height="3.6" rx="1.4"/>`),
  // 4 — tête TV, antennes en V, dents
  RB(`<line x1="8" y1="3" x2="9.6" y2="6"/><line x1="16" y1="3" x2="14.4" y2="6"/><rect x="4" y="6" width="16" height="11" rx="2"/>${D(9,11,1.5)}${D(15,11,1.5)}<path d="M7 14.4 H17"/><line x1="10" y1="14.4" x2="10" y2="16"/><line x1="14" y1="14.4" x2="14" y2="16"/>`),
  // 5 — ovale, antenne simple, œil unique
  RB(`<line x1="12" y1="2.4" x2="12" y2="5"/>${D(12,2.1,1.1)}<rect x="5" y="5" width="14" height="13" rx="4.5"/><circle cx="12" cy="11" r="2.1"/>${D(12,11,.7)}`),
  // 6 — sourire, bras latéraux
  RB(`<rect x="6" y="5" width="12" height="11" rx="3"/><path d="M6 8.5 H3"/><path d="M18 8.5 H21"/>${D(10,10,1)}${D(14,10,1)}<path d="M9.6 12.4 Q12 14.3 14.4 12.4"/><path d="M7 16 Q12 19 17 16"/>`)
];
function robotIcon(seed) {
  let h = 0; const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return ROBOTS[h % ROBOTS.length];
}

/* ============ Controles fenetre ============ */
$('minBtn').addEventListener('click', () => window.api.minimize());
$('closeBtn').addEventListener('click', () => window.api.close());
$('pinBtn').addEventListener('click', async () => {
  const pinned = await window.api.togglePin();
  $('pinBtn').classList.toggle('active', pinned);
});
$('pinBtn').classList.add('active'); // epingle par defaut

/* ============ Onglets ============ */
const panels = { agents: $('tab-agents'), git: $('tab-git') };
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', x === t));
  for (const k in panels) panels[k].hidden = (k !== t.dataset.tab);
}));

/* ============ Sessions Claude ============ */
function relTime(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return s + ' s';
  const m = Math.round(s / 60);
  if (m < 60) return m + ' min';
  return Math.round(m / 60) + ' h';
}
const STATUS_LABEL = { running: 'En cours', done: 'Termine', idle: 'En pause' };
const STATUS_CLASS = { running: 'run', done: 'done', idle: 'idle' };

function renderAgents(agents) {
  const list = $('agentsList');
  const active = agents.filter(a => a.status === 'running').length;
  $('count').textContent = agents.length + ' session' + (agents.length > 1 ? 's' : '');
  $('tabAgentsN').textContent = agents.length;
  $('agentsEmpty').hidden = agents.length > 0;

  list.innerHTML = agents.map(a => `
    <div class="agent">
      <div class="mono-badge">${robotIcon(a.project)}</div>
      <div class="a-main">
        <div class="a-name">${esc(a.project)}</div>
        <div class="a-task">${esc(a.last || '…')}</div>
        <div class="a-meta"><span class="phase">${a.turns} messages</span></div>
      </div>
      <div class="a-side">
        <span class="status ${STATUS_CLASS[a.status]}"><span class="dot"></span>${STATUS_LABEL[a.status]}</span>
        <span class="time">${relTime(a.ageMs)}</span>
      </div>
    </div>`).join('');
}

async function refreshAgents() {
  const res = await window.api.listSessions();
  if (res.ok) renderAgents(res.agents);
}
refreshAgents();
setInterval(refreshAgents, 3000); // live : toutes les 3 s

/* ============ Git ============ */
let currentRepo = null;

$('pickRepoBtn').addEventListener('click', async () => {
  const res = await window.api.pickRepo();
  if (res.ok) { currentRepo = res.repo; loadGit(); }
  else if (res.error) toast(res.error, false);
});

async function loadGit() {
  if (!currentRepo) return;
  const res = await window.api.gitData(currentRepo);
  if (!res.ok) { toast(res.error, false); return; }
  renderGit(res);
}

const LANE_COLORS = ['var(--fg)', '#5b9bff', '#a78bfa', '#f5b544', '#3ecf8e', '#ff6b9d', '#22d3ee'];
const ROW_H = 40, COL_W = 18, X0 = 14, Y0 = 20, R = 5;

// Attribue une colonne (lane) a chaque commit — algorithme "railway".
function assignLanes(commits) {
  const colOf = {};
  const lanes = []; // lanes[i] = hash attendu dans cette lane, ou null
  const freeOrNew = (val) => {
    let i = lanes.indexOf(val);
    if (i === -1) { i = lanes.indexOf(null); if (i === -1) { i = lanes.length; lanes.push(null); } }
    return i;
  };
  let maxCols = 1;
  commits.forEach(c => {
    let col = lanes.indexOf(c.hash);
    if (col === -1) col = freeOrNew(null);
    colOf[c.hash] = col;
    // les lanes qui attendaient ce commit (merges) se liberent
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === c.hash) lanes[i] = null;
    // 1er parent continue dans la colonne du commit
    lanes[col] = c.parents[0] || null;
    // parents suivants (merge) prennent une lane
    for (let k = 1; k < c.parents.length; k++) {
      const pc = freeOrNew(c.parents[k]);
      lanes[pc] = c.parents[k];
    }
    maxCols = Math.max(maxCols, lanes.length);
  });
  return { colOf, maxCols };
}

function x(col) { return X0 + col * COL_W; }
function y(row) { return Y0 + row * ROW_H; }

function renderGraph(commits, colOf, maxCols) {
  const svg = $('gitSvg');
  const width = X0 + (maxCols - 1) * COL_W + 14;
  const height = Y0 + commits.length * ROW_H;
  const rowOf = {};
  commits.forEach((c, i) => rowOf[c.hash] = i);

  const edges = [], nodes = [];
  commits.forEach((c, row) => {
    const cx = x(colOf[c.hash]), cy = y(row);
    const color = LANE_COLORS[colOf[c.hash] % LANE_COLORS.length];
    c.parents.forEach(p => {
      if (!(p in colOf)) { // parent tronque : petit trait vers le bas
        edges.push(`<path d="M${cx},${cy} L${cx},${cy + ROW_H/2}" stroke="${color}" stroke-width="2" fill="none"/>`);
        return;
      }
      const pr = rowOf[p], pcx = x(colOf[p]), pcy = y(pr), pcolor = LANE_COLORS[colOf[p] % LANE_COLORS.length];
      const stroke = (pcx === cx) ? color : pcolor;
      if (pcx === cx) {
        edges.push(`<path d="M${cx},${cy} L${pcx},${pcy}" stroke="${stroke}" stroke-width="2" fill="none"/>`);
      } else {
        // courbe type GitKraken : descend puis rejoint la colonne du parent
        const midY = cy + ROW_H * 0.6;
        edges.push(`<path d="M${cx},${cy} C${cx},${midY} ${pcx},${pcy - ROW_H*0.6} ${pcx},${pcy}" stroke="${stroke}" stroke-width="2" fill="none"/>`);
      }
    });
    nodes.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="var(--surface)" stroke="${color}" stroke-width="2"/>`);
  });

  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = edges.join('') + nodes.join('');
}

function refChips(refs) {
  return refs.map(r => {
    if (r.startsWith('tag:')) return `<span class="chip tag">${esc(r.replace('tag:', '').trim())}</span>`;
    if (r.includes('HEAD ->')) return `<span class="chip head">${esc(r.split('->').pop().trim())}</span>`;
    if (r === 'HEAD') return '';
    return `<span class="chip">${esc(r)}</span>`;
  }).join('');
}

function renderGit(data) {
  currentRepo = data.repo;
  $('repoName').textContent = data.name;
  $('tabGitN').textContent = data.commits.length;
  $('gitEmpty').hidden = true;
  $('gitWrap').hidden = false;
  $('branchSwitch').hidden = false;

  // commits
  const rows = $('gitRows');
  rows.innerHTML = data.commits.map(c => `
    <div class="commit-row" style="height:${ROW_H}px">
      <div class="commit-msg">${esc(c.subject)} ${refChips(c.refs)}</div>
      <div class="commit-sub"><span class="sha">${esc(c.hash.slice(0,7))}</span><span>${esc(c.an)}</span><span>${esc(c.ar)}</span></div>
    </div>`).join('');

  // graphe
  const { colOf, maxCols } = assignLanes(data.commits);
  renderGraph(data.commits, colOf, maxCols);

  // selecteur de branche
  const curColor = LANE_COLORS[1];
  $('curBranch').textContent = data.current || '(detached)';
  $('curDot').style.background = curColor;
  $('branchItems').innerHTML = data.branches.map(b => `
    <div class="bitem" data-branch="${esc(b)}" ${b === data.current ? 'aria-current="true"' : ''}>
      <span class="ln"></span><span class="nm">${esc(b)}</span><span class="ck">&#10003;</span>
    </div>`).join('');
  $('branchItems').querySelectorAll('.bitem').forEach(i =>
    i.addEventListener('click', () => doCheckout(i.dataset.branch)));
}

async function doCheckout(branch) {
  openMenu(false);
  const res = await window.api.gitCheckout(currentRepo, branch);
  if (res.ok) { toast('Bascule sur ' + branch, true); loadGit(); }
  else { toast(res.error, false); }
}

/* menu branche */
const menu = $('branchMenu'), bbtn = $('branchBtn');
function openMenu(open) { menu.hidden = !open; bbtn.setAttribute('aria-expanded', open); }
bbtn.addEventListener('click', e => { e.stopPropagation(); openMenu(menu.hidden); });
document.addEventListener('click', () => openMenu(false));
menu.addEventListener('click', e => e.stopPropagation());

/* toast */
let toastTimer;
function toast(txt, ok) {
  const el = $('checkoutToast');
  $('toastTxt').textContent = txt;
  el.querySelector('.ok').style.color = ok ? 'var(--done)' : '#ff6b6b';
  el.querySelector('.ok').textContent = ok ? '✓' : '✕';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

/* util */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
