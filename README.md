# Agent Huddle

Popup flottant (always-on-top) pour suivre tes **agents Claude Code en temps réel** et explorer un **dépôt Git** avec un graphe type GitKraken.

![onglets](docs/preview.png)

## Ce que ça fait

- **Onglet Agents** — lit tes sessions Claude Code dans `~/.claude/projects/**/*.jsonl`
  et affiche, toutes les 3 secondes :
  - le projet, le dernier message, le nombre de messages,
  - un statut : 🔵 En cours · 🟢 Terminé · ⚪ En pause (heuristique basée sur l'activité récente du fichier).
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

## Limites connues (v0.1)

- Le statut des agents est une **heuristique** (récence du fichier). Claude Code
  n'expose pas d'API « en attente de permission / question » : à affiner plus tard
  en analysant plus finement le dernier événement du `.jsonl`.
- Le calcul des lanes du graphe est volontairement simple (lisible jusqu'à ~80 commits).

## Idées suivantes

- Détecter précisément « en attente d'une réponse / permission ».
- Bouton pour ouvrir la session dans VS Code.
- Mémoriser le dernier dépôt Git ouvert.
- Pull / fetch depuis l'onglet Git.
