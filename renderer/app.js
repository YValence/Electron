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
const ROBOT_COLORS = ['#5b9bff', '#a78bfa', '#f5b544', '#3ecf8e', '#ff6b9d', '#22d3ee'];
function hashOf(seed) {
  let h = 0; const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function robotIcon(seed) { return ROBOTS[hashOf(seed) % ROBOTS.length]; }
function robotColor(seed) { return ROBOT_COLORS[hashOf(seed) % ROBOT_COLORS.length]; }

/* ============ Controles fenetre ============ */
$('minBtn').addEventListener('click', () => window.api.minimize());
$('closeBtn').addEventListener('click', () => window.api.close());
$('pinBtn').addEventListener('click', async () => {
  const pinned = await window.api.togglePin();
  $('pinBtn').classList.toggle('active', pinned);
});
$('pinBtn').classList.add('active'); // epingle par defaut

/* ============ Mode tiroir ============ */
// La fenetre se replie sur le bord droit ; seule la languette depasse.
// C'est le processus principal qui decide d'ouvrir/fermer (il suit la vraie
// position du curseur) : ici on se contente d'animer en CSS selon son signal.
let drawerMode = false;

// On se souvient du choix (tiroir ou fenetre classique) d'une fois sur l'autre.
function loadDrawerPref() { try { return localStorage.getItem('cockpit.drawer') === '1'; } catch { return false; } }
function saveDrawerPref(v) { try { localStorage.setItem('cockpit.drawer', v ? '1' : '0'); } catch {} }

async function setDrawerMode(on) {
  drawerMode = on;
  saveDrawerPref(on);
  document.body.classList.toggle('drawer', on);
  $('drawerBtn').classList.toggle('active', on);
  if (!on) document.body.classList.remove('drawer-open');   // retour fenetre normale
  await window.api.setDrawerMode(on);
  fitWindow();
}

// Le main nous dit quand ouvrir (true) ou fermer (false) : on glisse en CSS.
window.api.onDrawerState((open) => {
  document.body.classList.toggle('drawer-open', !!open);
});

$('drawerBtn').addEventListener('click', () => setDrawerMode(!drawerMode));
if (loadDrawerPref()) setDrawerMode(true);   // restaure le choix precedent

/* ============ Onglets ============ */
const panels = { agents: $('tab-agents'), git: $('tab-git') };
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', x === t));
  for (const k in panels) panels[k].hidden = (k !== t.dataset.tab);
  fitWindow();
}));

/* ============ Sessions Claude ============ */
function relTime(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return s + ' s';
  const m = Math.round(s / 60);
  if (m < 60) return m + ' min';
  return Math.round(m / 60) + ' h';
}
const STATUS_LABEL = { running: 'En cours', done: 'Termine', idle: 'En pause',
  ask: 'Question', perm: 'Permission', plan: 'Plan' };
const STATUS_CLASS = { running: 'run', done: 'done', idle: 'idle',
  ask: 'ask', perm: 'perm', plan: 'plan' };
const ST_CLASS = { completed: 'done', in_progress: 'doing', pending: 'todo' };

const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M7 14l5-5 5 5"/></svg>';

const cardCache = new Map();   // id -> element (rendu incremental, pas de rebuild complet)
let openId = null;             // accordeon : un seul agent ouvert a la fois

// Redimensionne la fenetre a la hauteur du contenu affiche.
function fitWindow() {
  requestAnimationFrame(() => {
    const titlebar = document.querySelector('.titlebar');
    const tabs = document.querySelector('.tabs');
    const body = [...document.querySelectorAll('.body')].find(b => !b.hidden);
    let h = titlebar.offsetHeight + tabs.offsetHeight + 2;
    if (body) {
      const cs = getComputedStyle(body);
      h += parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      for (const ch of body.children) {
        if (ch.hidden) continue;
        const m = getComputedStyle(ch);
        h += ch.offsetHeight + parseFloat(m.marginTop) + parseFloat(m.marginBottom);
      }
    }
    window.api.autosize(h);
  });
}

function applyOpenStates() {
  for (const [id, el] of cardCache) {
    const open = id === openId;
    el.classList.toggle('open', open);
    el.querySelector('.subtasks').hidden = !open;
  }
}

function createCard(a) {
  const el = document.createElement('div');
  el.className = 'agent enter';
  el.dataset.id = a.id;
  el.innerHTML =
    `<div class="agent-head">
       <div class="mono-badge">${robotIcon(a.project)}</div>
       <div class="a-main">
         <div class="a-name"></div>
         <div class="a-task"></div>
         <div class="a-meta"><span class="phase"></span><span class="sep"> · </span><span class="subcount"></span></div>
         <div class="progress" hidden><div class="segs"></div><span class="pfrac"></span></div>
       </div>
       <div class="a-side">
         <span class="status"><span class="dot"></span><span class="st-label"></span></span>
         <span class="time"></span>
       </div>
       <button class="expand" title="Derouler">${CHEVRON}</button>
     </div>
     <div class="waitbox" hidden></div>
     <div class="subtasks" hidden>
       <div class="sublist"></div>
       <div class="subfoot"><button class="wbtn open-code">Ouvrir dans VS Code</button></div>
     </div>`;
  el.querySelector('.agent-head').addEventListener('click', () => {
    openId = (openId === a.id) ? null : a.id;   // accordeon
    applyOpenStates();
    fitWindow();
  });
  el.querySelector('.open-code').addEventListener('click', (e) => {
    e.stopPropagation();
    window.api.openEditor(el.dataset.cwd);
  });
  el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
  return el;
}

function updateCard(el, a) {
  el.dataset.cwd = a.cwd || '';
  el.classList.toggle('working', a.status === 'running');  // contour jaune + robot anime
  el.classList.remove('wait-ask', 'wait-perm', 'wait-plan');
  if (a.waiting) el.classList.add('wait-' + a.waiting.kind);  // accent selon l'attente
  el.querySelector('.mono-badge').style.color = robotColor(a.project);
  el.querySelector('.a-name').textContent = a.project;
  el.querySelector('.a-task').textContent = a.last || '…';
  el.querySelector('.phase').textContent = a.turns + ' messages';

  const n = a.todos.length;
  const doneN = a.todos.filter(t => t.status === 'completed').length;
  el.querySelector('.sep').hidden = !n;
  el.querySelector('.subcount').textContent = n ? `${n} sous-tache${n > 1 ? 's' : ''}` : '';

  // Progression : un trait par sous-tache, remplis jusqu'a celles terminees.
  const prog = el.querySelector('.progress');
  prog.hidden = !n;
  if (n) {
    const segs = prog.querySelector('.segs');
    const segSig = n + '/' + doneN;
    if (segs._sig !== segSig) {
      segs._sig = segSig;
      segs.classList.toggle('full', doneN === n);
      segs.innerHTML = Array.from({ length: n },
        (_, i) => `<i class="${i < doneN ? 'on' : ''}"></i>`).join('');
    }
    prog.querySelector('.pfrac').textContent = `${doneN}/${n}`;
  }

  const st = el.querySelector('.status');
  st.className = 'status ' + STATUS_CLASS[a.status];
  st.querySelector('.st-label').textContent = STATUS_LABEL[a.status];
  el.querySelector('.time').textContent = relTime(a.ageMs);

  // Panneau d'attente : question / permission / plan (toujours visible, meme carte repliee).
  const wb = el.querySelector('.waitbox');
  if (a.waiting) {
    const w = a.waiting;
    const sig = [w.kind, w.title, w.detail, (w.options || []).join('~')].join('|');
    wb.hidden = false;
    wb.className = 'waitbox ' + w.kind;
    if (wb._sig !== sig) {
      wb._sig = sig;
      const detail = w.detail
        ? `<div class="wdetail${w.kind === 'perm' ? ' code' : ''}">${esc(w.detail)}</div>` : '';
      const opts = (w.options && w.options.length)
        ? `<ul class="wopts">${w.options.map(o => `<li>${esc(o)}</li>`).join('')}</ul>` : '';
      const copyBtn = w.detail
        ? `<button class="wbtn copy-detail">${w.kind === 'perm' ? 'Copier la commande' : 'Copier'}</button>`
        : '';
      wb.innerHTML =
        `<span class="wtag">${esc(w.title)}</span>${detail}${opts}` +
        `<div class="wactions">` +
          `<button class="wbtn pri open-code2">Ouvrir VS Code</button>${copyBtn}` +
        `</div>`;
      wb.querySelector('.open-code2').addEventListener('click', (e) => {
        e.stopPropagation();
        window.api.openEditor(el.dataset.cwd);
      });
      const cb = wb.querySelector('.copy-detail');
      if (cb) cb.addEventListener('click', (e) => {
        e.stopPropagation();
        window.api.copy(w.detail);
        cb.textContent = 'Copié';
        setTimeout(() => { cb.textContent = w.kind === 'perm' ? 'Copier la commande' : 'Copier'; }, 1200);
      });
    }
  } else {
    wb.hidden = true;
    wb._sig = null;
  }

  const sub = el.querySelector('.sublist');
  const sig = a.todos.map(t => t.status + ':' + t.content).join('|');
  if (sub._sig !== sig) {
    sub._sig = sig;
    sub.innerHTML = n
      ? a.todos.map(t => {
          const c = ST_CLASS[t.status] || 'todo';
          return `<div class="subtask ${c}"><span class="st-dot ${c}"></span><span class="st-txt">${esc(t.content)}</span></div>`;
        }).join('')
      : `<div class="subtask-empty">Pas de sous-taches detectees pour cette session.</div>`;
  }

  const open = a.id === openId;
  el.classList.toggle('open', open);
  el.querySelector('.subtasks').hidden = !open;
}

function renderAgents(agents) {
  $('count').textContent = agents.length + ' session' + (agents.length > 1 ? 's' : '');
  $('tabAgentsN').textContent = agents.length;
  $('agentsEmpty').hidden = agents.length > 0;

  const list = $('agentsList');
  const seen = new Set();
  agents.forEach((a, i) => {
    seen.add(a.id);
    let el = cardCache.get(a.id);
    if (!el) { el = createCard(a); cardCache.set(a.id, el); }
    updateCard(el, a);
    if (list.children[i] !== el) list.insertBefore(el, list.children[i] || null);
  });
  for (const [id, el] of cardCache) {
    if (!seen.has(id)) { el.remove(); cardCache.delete(id); if (openId === id) openId = null; }
  }
  fitWindow();
}

// Barre de defilement : visible seulement pendant le scroll, puis disparait.
document.querySelectorAll('.body').forEach(b => {
  let timer;
  b.addEventListener('scroll', () => {
    b.classList.add('is-scrolling');
    clearTimeout(timer);
    timer = setTimeout(() => b.classList.remove('is-scrolling'), 900);
  });
});

let lastAgents = [];   // derniere liste connue (sert aussi a detecter les depots Git)

async function refreshAgents() {
  const res = await window.api.listSessions();
  if (res.ok) {
    lastAgents = res.agents;
    renderAgents(res.agents);
    refreshRepos();   // met a jour les depots detectes a partir des cwd
  }
}
refreshAgents();
setInterval(refreshAgents, 3000); // live : toutes les 3 s

/* ============ Git ============ */
let currentRepo = null;
let repos = [];            // depots detectes { repo, name, current }
let reposSig = '';         // signature des dossiers scannes (evite un re-scan inutile)

// Memorisation (par navigateur) : depots ajoutes a la main + dernier depot choisi.
function loadManual() { try { return JSON.parse(localStorage.getItem('cockpit.manualRepos') || '[]'); } catch { return []; } }
function saveManual(a) { try { localStorage.setItem('cockpit.manualRepos', JSON.stringify(a)); } catch {} }
function getLastRepo() { try { return localStorage.getItem('cockpit.lastRepo') || ''; } catch { return ''; } }
function setLastRepo(r) { try { localStorage.setItem('cockpit.lastRepo', r); } catch {} }

// Scanne les dossiers des sessions + ajouts manuels -> liste de depots Git uniques.
async function refreshRepos(force) {
  const manual = loadManual();
  const dirs = [...new Set([...lastAgents.map(a => a.cwd).filter(Boolean), ...manual])];
  const sig = dirs.slice().sort().join('|');
  if (!force && sig === reposSig) return;   // rien de nouveau a scanner
  reposSig = sig;

  const res = dirs.length ? await window.api.gitRepos(dirs) : { ok: true, repos: [] };
  repos = res.ok ? res.repos : [];
  renderRepoMenu();

  // Choix du depot courant : garde l'actuel s'il existe encore, sinon dernier connu, sinon 1er.
  if (!currentRepo || !repos.some(r => r.repo === currentRepo)) {
    const pick = repos.find(r => r.repo === getLastRepo()) || repos[0];
    if (pick) { currentRepo = pick.repo; setLastRepo(currentRepo); loadGit(); }
    else { currentRepo = null; showGitEmpty(); }
  }
}

function renderRepoMenu() {
  const cur = repos.find(r => r.repo === currentRepo);
  $('curRepo').textContent = cur ? cur.name : (repos.length ? 'Choisir…' : 'Aucun depot');
  $('repoItems').innerHTML = repos.length
    ? repos.map(r => `
      <div class="bitem" data-repo="${esc(r.repo)}" data-tip="${esc(r.repo)}" ${r.repo === currentRepo ? 'aria-current="true"' : ''}>
        <span class="ln"></span><span class="nm">${esc(r.name)}</span>
        <span class="rbranch">${esc(r.current || '')}</span><span class="ck">&#10003;</span>
      </div>`).join('')
    : `<div class="rnone">Aucun depot detecte dans les sessions.</div>`;
  $('repoItems').querySelectorAll('.bitem').forEach(i =>
    i.addEventListener('click', () => selectRepo(i.dataset.repo)));
}

function selectRepo(repo) {
  openRepoMenu(false);
  if (repo === currentRepo) return;
  currentRepo = repo;
  setLastRepo(repo);
  loadGit();
}

function showGitEmpty() {
  $('gitEmpty').hidden = false;
  $('gitWrap').hidden = true;
  $('branchSwitch').hidden = true;
  fitWindow();
}

async function loadGit() {
  if (!currentRepo) { showGitEmpty(); return; }
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
  $('curRepo').textContent = data.name;
  $('tabGitN').textContent = data.commits.length;
  $('gitEmpty').hidden = true;
  $('gitWrap').hidden = false;
  $('branchSwitch').hidden = false;

  // commits
  const rows = $('gitRows');
  rows.innerHTML = data.commits.map(c => `
    <div class="commit-row" style="height:${ROW_H}px">
      <div class="commit-msg"><span class="subj">${esc(c.subject)}</span>${refChips(c.refs)}</div>
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

  fitWindow();
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
bbtn.addEventListener('click', e => { e.stopPropagation(); openRepoMenu(false); openMenu(menu.hidden); });
menu.addEventListener('click', e => e.stopPropagation());

/* menu depot (multi-depots) */
const rmenu = $('repoMenu'), rbtn = $('repoBtn');
function openRepoMenu(open) { rmenu.hidden = !open; rbtn.setAttribute('aria-expanded', open); }
rbtn.addEventListener('click', e => { e.stopPropagation(); openMenu(false); openRepoMenu(rmenu.hidden); });
rmenu.addEventListener('click', e => e.stopPropagation());
$('addRepoBtn').addEventListener('click', async e => {
  e.stopPropagation();
  openRepoMenu(false);
  const res = await window.api.pickRepo();
  if (!res.ok) { if (res.error) toast(res.error, false); return; }
  const m = loadManual();
  if (!m.includes(res.repo)) { m.push(res.repo); saveManual(m); }
  currentRepo = res.repo;
  setLastRepo(res.repo);
  await refreshRepos(true);   // re-scan immediat (le depot ajoute apparait)
  loadGit();
});

/* un clic ailleurs ferme les deux menus */
document.addEventListener('click', () => { openMenu(false); openRepoMenu(false); });

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

/* ============ Infobulle de survol ============ */
/* Revele l'info cachee (texte coupe par "...") dans une bulle sous la souris. */
const tip = document.createElement('div');
tip.className = 'tip';
tip.hidden = true;
document.body.appendChild(tip);

// Texte a reveler pour un element : data-tip explicite, sinon le texte si il est tronque.
function tipTextOf(el) {
  if (!el || el.nodeType !== 1) return null;
  if (el.dataset && el.dataset.tip) return el.dataset.tip;
  if (el.offsetParent !== null && el.scrollWidth > el.clientWidth + 1) {
    const cs = getComputedStyle(el);
    if (cs.textOverflow === 'ellipsis' || cs.whiteSpace === 'nowrap') {
      const t = el.textContent.trim();
      if (t) return t;
    }
  }
  return null;
}

function placeTip(x, y) {
  tip.style.left = '0px'; tip.style.top = '0px';   // mesurer d'abord
  const r = tip.getBoundingClientRect();
  let left = x + 2;
  let top = y + 20;                                 // juste sous la souris
  if (left + r.width > window.innerWidth - 8) left = window.innerWidth - 8 - r.width;
  if (left < 8) left = 8;
  if (top + r.height > window.innerHeight - 8) top = y - 14 - r.height;  // bascule au-dessus si pas la place
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

document.addEventListener('mousemove', (e) => {
  let node = e.target, txt = null;
  for (let i = 0; node && i < 5; i++, node = node.parentElement) {
    txt = tipTextOf(node);
    if (txt) break;
  }
  if (txt) {
    if (tip.textContent !== txt) tip.textContent = txt;
    tip.hidden = false;
    placeTip(e.clientX, e.clientY);
  } else if (!tip.hidden) {
    tip.hidden = true;
  }
});
// la bulle disparait des qu'on quitte la fenetre
document.addEventListener('mouseleave', () => { tip.hidden = true; });
