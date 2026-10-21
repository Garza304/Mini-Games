# Mini-games

Quick, easy-to-learn browser games for Ops-play on Fridays. Each game lives in
its own folder with its own README.

| Game | Players | What it is |
| ---- | ------- | ---------- |
| [Codenames](codenames/README.md) | 4+ in two teams | Spymasters give one-word clues; teams find their agents and avoid the assassin. |

## Hosting

Each game is a small Node.js app with no extra packages. On Render, every game
is its own free web service from this same GitHub repo: create a new Web
Service and set **Root Directory** to that game's folder. See the Codenames
README for the full walkthrough.
