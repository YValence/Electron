# Cockpit

Popup flottant (always-on-top) pour suivre tes **agents Claude Code en temps réel** et explorer un **dépôt Git** avec un graphe type GitKraken.

![onglets](docs/preview.png)

## Ce que ça fait

- **Onglet Agents** — lit tes sessions Claude Code dans `~/.claude/projects/**/*.jsonl`
  et affiche, toutes les 3 secondes :
  - le projet, le dernier message, le nombre de messages,
  - un statut : 🔵 En cours · 🟢 Terminé · ⚪ En pause, **ou** 🟡 Question / Permission · 🟣 Plan
    quand l'agent attend une action de ta part,
  - les **sous-tâches** (todos) avec une barre de progression segmentée,
  - le détail de l'attente (la question et ses options, la commande à autoriser, le plan),
  - un bouton **Ouvrir dans VS Code** pour aller répondre.
  > Cockpit ne fait que **lire** les fichiers : il te montre ce qui attend et t'amène
  > au bon endroit, mais il ne peut pas répondre à la place de l'agent.
- **Onglet Git** — choisis un dépôt, vois le graphe des branches/merges,
  change de branche d'un clic (`git checkout`).
- Fenêtre **sans cadre, déplaçable, épinglée par-dessus** les autres apps.

## Lancer

```bash
npm install
npm start
```

> Node 18+ requis. L'app utilise la CLI `git` déjà installée sur ta machine.

## Structure

```
main.js            # processus principal Electron (fenêtre + IPC)
preload.js         # pont sécurisé renderer <-> main
lib/sessions.js    # lecture des .jsonl de Claude Code
lib/git.js         # commandes git (log --all, branches, checkout)
renderer/
  index.html       # structure du popup
  styles.css       # style monochrome + accents couleur
  app.js           # UI, polling des sessions, calcul du graphe (lanes)
```

## Limites connues

- Les états « Question » et « Plan » sont **sûrs** (outil `AskUserQuestion` / `ExitPlanMode`
  sans réponse). L'état « Permission » est une **heuristique** : un outil sensible (Bash,
  Write, Edit…) sans résultat depuis plus de 30 s. Ça peut rarement se tromper si une
  commande est juste longue.
- Les boutons n'agissent pas sur l'agent (Cockpit lit les fichiers, il n'a pas de canal
  vers le terminal où tourne Claude) : ils t'amènent dans VS Code pour répondre toi-même.
- Le calcul des lanes du graphe est volontairement simple (lisible jusqu'à ~80 commits).

## Idées suivantes

- Mémoriser le dernier dépôt Git ouvert.
- Pull / fetch depuis l'onglet Git.
