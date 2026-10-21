'use strict';
// Codenames for Ops-play: a zero-dependency, real-time multiplayer server.
// Run with `node server.js` (set PORT to change the default of 3000).
// The browser gets live updates over Server-Sent Events and sends moves as POSTs.
// The key card never leaves the server for operatives, so nobody can peek via devtools.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const DEFAULT_WORDS = require('./words');

const PORT = Number(process.env.PORT) || 3000;
const INDEX_HTML = path.join(__dirname, 'public', 'index.html');
const ROOM_IDLE_MS = 12 * 60 * 60 * 1000;
const PLAYER_IDLE_MS = 2 * 60 * 60 * 1000;
// Limits for when the game is hosted on the public internet.
const MAX_ROOMS = 100;
const MAX_PLAYERS = 40;
const MAX_CONNECTIONS = 80;
const TEAMS = ['red', 'blue'];
const ROLES = ['spymaster', 'operative'];

const other = t => (t === 'red' ? 'blue' : 'red');
const cap = s => s[0].toUpperCase() + s.slice(1);
const rooms = new Map();

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Custom words go in first, then the default pool fills whatever is left.
function pickWords(custom) {
  const seen = new Set();
  const out = [];
  for (const w of [...shuffle(custom.slice()), ...shuffle(DEFAULT_WORDS.slice())]) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length === 25) break;
  }
  return out;
}

function createGame(custom) {
  const start = crypto.randomInt(2) ? 'red' : 'blue';
  return {
    words: pickWords(custom),
    key: shuffle([
      ...Array(9).fill(start),
      ...Array(8).fill(other(start)),
      ...Array(7).fill('neutral'),
      'assassin',
    ]),
    revealed: Array(25).fill(false),
    marks: Array.from({ length: 25 }, () => []),
    startTeam: start,
    turn: start,
    clue: null,
    guessesLeft: 0, // null means unlimited (clue number 0 or ∞)
    winner: null,
    winReason: '',
  };
}

// Returns null when the server is full, so a public link can't be used to pile up rooms.
function getRoom(id) {
  let room = rooms.get(id);
  if (!room) {
    if (rooms.size >= MAX_ROOMS) return null;
    room = { id, players: new Map(), clients: new Set(), customWords: [], gameNo: 1, log: [] };
    room.game = createGame([]);
    rooms.set(id, room);
  }
  room.lastActive = Date.now();
  return room;
}

function log(room, text, team = null) {
  room.log.push({ at: Date.now(), text, team });
  if (room.log.length > 150) room.log.splice(0, room.log.length - 150);
}

const remaining = (g, team) => g.key.filter((k, i) => k === team && !g.revealed[i]).length;
const isOnline = (room, pid) => [...room.clients].some(c => c.pid === pid);
const clearMarks = (g, pid) => g.marks.forEach(m => m.splice(0, m.length, ...m.filter(id => pid && id !== pid)));

function passTurn(g) {
  g.turn = other(g.turn);
  g.clue = null;
  g.guessesLeft = 0;
  clearMarks(g);
}

// Each player gets their own view: spymasters (and everyone, once the game ends) see the key.
function viewFor(room, pid) {
  const g = room.game;
  const you = room.players.get(pid) || null;
  const seeKey = (you && you.role === 'spymaster') || !!g.winner;
  const nameOf = id => room.players.get(id)?.name || '?';
  return {
    room: room.id,
    gameNo: room.gameNo,
    you: you && { id: you.id, name: you.name, team: you.team, role: you.role },
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, team: p.team, role: p.role, online: isOnline(room, p.id),
    })),
    cards: g.words.map((word, i) => ({
      word,
      revealed: g.revealed[i],
      color: g.revealed[i] || seeKey ? g.key[i] : null,
      marks: g.marks[i].map(nameOf),
      markedByYou: g.marks[i].includes(pid),
    })),
    startTeam: g.startTeam,
    turn: g.turn,
    clue: g.clue,
    guessesLeft: g.guessesLeft,
    winner: g.winner,
    winReason: g.winReason,
    remaining: { red: remaining(g, 'red'), blue: remaining(g, 'blue') },
    customWords: room.customWords,
    log: room.log.slice(-60),
  };
}

function broadcast(room) {
  for (const c of room.clients) c.res.write(`data: ${JSON.stringify(viewFor(room, c.pid))}\n\n`);
}

function cleanName(s) {
  return String(s || '').replace(/[\u0000-\u001f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 20);
}

// Applies one move. Returns an error message for the player, or null on success.
function act(room, pid, a) {
  const g = room.game;

  if (a.type === 'join') {
    const name = cleanName(a.name);
    if (!name) return 'Pick a name first';
    let p = room.players.get(pid);
    if (p) {
      if (p.name !== name) log(room, `${p.name} is now called ${name}`);
      p.name = name;
    } else {
      if (room.players.size >= MAX_PLAYERS) return 'This room is full';
      const count = t => [...room.players.values()].filter(x => x.team === t).length;
      const team = count('red') <= count('blue') ? 'red' : 'blue';
      p = { id: pid, name, team, role: 'operative' };
      room.players.set(pid, p);
      log(room, `${name} joined ${team}`, team);
    }
    p.lastSeen = Date.now();
    return null;
  }

  const p = room.players.get(pid);
  if (!p) return 'Join the room first';
  p.lastSeen = Date.now();
  const idx = Number.isInteger(a.index) && a.index >= 0 && a.index < 25 ? a.index : -1;
  const guessCheck = () => {
    if (g.winner) return 'The game is over. Start a new one!';
    if (p.team !== g.turn) return `It's ${g.turn}'s turn`;
    if (p.role !== 'operative') return "Spymasters can't pick cards";
    if (!g.clue) return "Wait for your spymaster's clue";
    return null;
  };

  switch (a.type) {
    case 'setRole': {
      if (!TEAMS.includes(a.team) || !ROLES.includes(a.role)) return 'Unknown team or role';
      if (p.team === a.team && p.role === a.role) return null;
      p.team = a.team;
      p.role = a.role;
      clearMarks(g, pid);
      log(room, `${p.name} is now ${a.team} ${a.role}`, a.team);
      return null;
    }

    case 'clue': {
      if (g.winner) return 'The game is over. Start a new one!';
      if (p.team !== g.turn || p.role !== 'spymaster') return `Only the ${g.turn} spymaster can give a clue right now`;
      if (g.clue) return 'A clue was already given this turn';
      const word = String(a.word || '').trim().replace(/\s+/g, ' ').toUpperCase();
      if (!word || word.length > 30) return 'The clue must be 1 to 30 characters';
      if (g.words.some((w, i) => !g.revealed[i] && w === word)) return "You can't use a word that's on the board";
      const n = a.number === 'inf' ? 'inf' : Number(a.number);
      if (n !== 'inf' && !(Number.isInteger(n) && n >= 0 && n <= 9)) return 'The number must be 0 to 9 or ∞';
      g.clue = { word, number: n, by: p.name, team: p.team };
      g.guessesLeft = n === 'inf' || n === 0 ? null : n + 1;
      log(room, `${p.name} clued ${word} ${n === 'inf' ? '∞' : n}`, p.team);
      return null;
    }

    case 'mark': {
      const err = guessCheck();
      if (err) return err;
      if (idx < 0 || g.revealed[idx]) return "That card can't be picked";
      const m = g.marks[idx];
      const at = m.indexOf(pid);
      if (at >= 0) m.splice(at, 1);
      else m.push(pid);
      return null;
    }

    case 'reveal': {
      const err = guessCheck();
      if (err) return err;
      if (idx < 0 || g.revealed[idx]) return "That card can't be picked";
      const team = g.turn;
      const color = g.key[idx];
      g.revealed[idx] = true;
      g.marks[idx] = [];
      log(room, `${p.name} picked ${g.words[idx]}: ${color === 'assassin' ? 'the ASSASSIN' : color}`, team);
      if (color === 'assassin') {
        g.winner = other(team);
        g.winReason = `${cap(team)} found the assassin`;
      } else if (!remaining(g, 'red')) {
        g.winner = 'red';
        g.winReason = 'All red agents found';
      } else if (!remaining(g, 'blue')) {
        g.winner = 'blue';
        g.winReason = 'All blue agents found';
      } else if (color !== team) {
        passTurn(g);
      } else if (g.guessesLeft !== null && --g.guessesLeft === 0) {
        passTurn(g);
      }
      if (g.winner) {
        clearMarks(g);
        log(room, `${cap(g.winner)} wins! ${g.winReason}`, g.winner);
      }
      return null;
    }

    case 'endTurn': {
      const err = guessCheck();
      if (err) return err;
      log(room, `${p.name} ended ${g.turn}'s turn`, g.turn);
      passTurn(g);
      return null;
    }

    case 'newGame': {
      room.game = createGame(room.customWords);
      room.gameNo++;
      log(room, `${p.name} started game #${room.gameNo}. ${cap(room.game.startTeam)} goes first`, room.game.startTeam);
      return null;
    }

    case 'setWords': {
      const list = [...new Set(String(a.text || '')
        .split(/[\n,;]+/)
        .map(w => w.trim().replace(/\s+/g, ' ').toUpperCase())
        .filter(w => w && w.length <= 24))].slice(0, 500);
      room.customWords = list;
      log(room, list.length
        ? `${p.name} set ${list.length} custom word${list.length === 1 ? '' : 's'} (used from the next game)`
        : `${p.name} cleared the custom words`);
      return null;
    }

    case 'shuffleTeams': {
      const online = shuffle([...room.players.values()].filter(x => isOnline(room, x.id)));
      online.forEach((x, i) => {
        x.team = i % 2 ? 'blue' : 'red';
        x.role = i < 2 ? 'spymaster' : 'operative';
      });
      clearMarks(g);
      log(room, `${p.name} shuffled the teams`);
      return null;
    }

    default:
      return 'Unknown action';
  }
}

const roomId = s => String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'ops-play';
const validPid = s => typeof s === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(s);

function json(res, status, body) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', chunk => {
      s += chunk;
      if (s.length > 64000) reject(new Error('Body too large'));
    });
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      fs.createReadStream(INDEX_HTML).pipe(res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      const pid = url.searchParams.get('pid');
      if (!validPid(pid)) return json(res, 400, { error: 'Bad player id' });
      const room = getRoom(roomId(url.searchParams.get('room')));
      if (!room || room.clients.size >= MAX_CONNECTIONS) return json(res, 503, { error: 'The server is full' });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      const client = { res, pid };
      room.clients.add(client);
      broadcast(room);
      req.on('close', () => {
        room.clients.delete(client);
        const p = room.players.get(pid);
        if (p) p.lastSeen = Date.now();
        broadcast(room);
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/action') {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (!validPid(body.pid)) return json(res, 400, { error: 'Bad player id' });
      const room = getRoom(roomId(body.room));
      if (!room) return json(res, 503, { error: 'The server is full. Try an existing room' });
      const error = act(room, body.pid, body);
      if (error) return json(res, 409, { error });
      broadcast(room);
      return json(res, 200, { ok: true });
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch {
    json(res, 400, { error: 'Bad request' });
  }
});

// Keep SSE connections alive through idle periods, and forget stale rooms and players.
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const c of room.clients) c.res.write(': ping\n\n');
    if (!room.clients.size && now - room.lastActive > ROOM_IDLE_MS) {
      rooms.delete(room.id);
      continue;
    }
    for (const p of room.players.values()) {
      if (!isOnline(room, p.id) && now - (p.lastSeen || 0) > PLAYER_IDLE_MS) room.players.delete(p.id);
    }
  }
}, 25000).unref();

server.listen(PORT, '0.0.0.0', () => {
  // Render sets RENDER_EXTERNAL_URL to the service's public address.
  if (process.env.RENDER_EXTERNAL_URL) {
    console.log(`Codenames is running at ${process.env.RENDER_EXTERNAL_URL}/?room=ops-play`);
    return;
  }
  const addrs = Object.values(os.networkInterfaces()).flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal)
    .map(a => `  http://${a.address}:${PORT}/?room=ops-play`);
  console.log(`Codenames is running.\n\nOn this computer:\n  http://localhost:${PORT}/?room=ops-play\n`);
  if (addrs.length) console.log(`Share one of these with your team:\n${addrs.join('\n')}\n`);
  console.log('Press Ctrl+C to stop.');
});
