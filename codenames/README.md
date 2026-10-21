# Codenames for Ops-play

A Codenames clone for Friday game time. The server runs somewhere everyone can
reach, and players just open a link in their browser. Nothing to install for
players.

## Hosting online with Render (recommended)

Render's free plan runs the game at a public address like
`https://ops-codenames.onrender.com`, so it works for people in the office and
on the VPN alike. One-time setup takes about 10 minutes. Use a **personal**
GitHub account and email for this, not a work one.

### 1. Put the code on GitHub

1. Sign in at [github.com](https://github.com) (or create a free account).
2. Click **New repository**, name it `mini-games`, and create it. Public or
   private both work. There's nothing secret in it.
3. On the new, empty repo page, click **uploading an existing file**.
4. In File Explorer, open your `Mini-games` folder and drag the `codenames`
   folder and the `.gitignore` file onto the upload page. GitHub keeps the
   folder structure.
5. Click **Commit changes**.

### 2. Create the service on Render

1. Go to [render.com](https://render.com) and sign up with **GitHub**.
2. Click **New** > **Web Service**, then pick the `mini-games` repo. If it isn't
   listed, use **Configure account** to give Render access to it.
3. Fill in:

   | Setting        | Value                                        |
   | -------------- | -------------------------------------------- |
   | Name           | `ops-codenames` (this becomes the web address) |
   | Region         | Oregon (US West), the closest to Utah        |
   | Branch         | `main`                                       |
   | Root Directory | `codenames`                                  |
   | Runtime        | Node                                         |
   | Build Command  | `npm install`                                |
   | Start Command  | `npm start`                                  |
   | Instance Type  | **Free**                                     |

4. Click **Deploy Web Service**. After a minute or two the log says
   `Codenames is running at https://...`. That's your link.

### 3. Share it

Send the team `https://<your-service>.onrender.com/?room=ops-play`.

- **Test it before Friday** from one machine in the office and one on the VPN.
  The company web filter may block some sites, and it's better to find out early.
- **Wake it up early.** Free services sleep after about 15 minutes with nobody
  connected. Open the link 5 minutes before game time. The first load can take
  up to a minute.
- **Updating the game:** change the files on GitHub (edit in the browser or
  upload new copies). Render redeploys automatically, which resets any game in
  progress.

## Hosting on your own machine

1. Double-click **Start Codenames.cmd** (or run `node server.js` in this folder).
   Needs Node.js 20 or newer.
2. The window prints links like `http://192.168.x.x:3000/?room=ops-play`.
   Send one to the team.
3. Leave the window open while you play. Closing it ends the game.

This only works when teammates can reach your computer directly, for example
on the same home or office network. On the company VPN (GlobalProtect), one
user's laptop usually can't reach another's, which is why online hosting is
the better default.

To use a different port: `set PORT=8080` then `node server.js`.

## Playing

- Everyone enters a name and lands on a team. Use the **Join as spymaster** /
  **Join as operative** buttons, or **Shuffle teams** to randomize.
- Spymasters see the key. Operatives only ever receive the colors of revealed
  cards, so nobody can peek with browser dev tools.
- Operatives click a card to suggest it (the whole team sees who suggested
  what) and click it again to reveal.
- **Custom words** mixes your own words (team inside jokes, tool names, and so
  on) into the next game.
- Want two games at once? Change the room in the URL, for example
  `?room=table-2`.

## Notes

- Game state lives in memory. If the server restarts or Render puts it to
  sleep, players reconnect automatically with the same names, but the board
  resets.
- Anyone with the link can join, so treat it like a meeting link. The server
  caps itself at 100 rooms and 40 players per room so a stray link can't
  overload it.
