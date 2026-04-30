const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const W = 900, H = 600;
const RADIUS = 18;
const SPEED = 4;
const JAIL = { x: 20, y: 20, w: 140, h: 130 };
const FREE_ZONE = { x: W - 160, y: 20, w: 140, h: 130 };

let players = {};
let policeId = null;
let gameStarted = false;
let gameOverTimer = null;

function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function inRect(px, py, rect) {
  return px > rect.x && px < rect.x + rect.w && py > rect.y && py < rect.y + rect.h;
}

function randomSpawn() {
  return {
    x: 200 + Math.random() * (W - 400),
    y: 150 + Math.random() * (H - 300)
  };
}

function startGame() {
  if (gameOverTimer) { clearTimeout(gameOverTimer); gameOverTimer = null; }
  const ids = Object.keys(players);
  if (ids.length < 2) return;

  policeId = ids[Math.floor(Math.random() * ids.length)];
  gameStarted = true;

  ids.forEach(id => {
    const pos = randomSpawn();
    players[id].x = pos.x;
    players[id].y = pos.y;
    players[id].role = id === policeId ? 'police' : 'chor';
    players[id].keys = {};
  });

  io.emit('started', { policeId });
  broadcastState();
}

function broadcastState() {
  io.emit('state', {
    players: Object.values(players).map(p => ({
      id: p.id, name: p.name, x: p.x, y: p.y, role: p.role
    })),
    gameStarted,
    policeId
  });
}

io.on('connection', socket => {
  socket.on('join', name => {
    const pos = randomSpawn();
    players[socket.id] = {
      id: socket.id,
      name: name.slice(0, 16),
      x: pos.x, y: pos.y,
      role: 'waiting',
      keys: {}
    };
    broadcastState();

    if (Object.keys(players).length >= 2 && !gameStarted) {
      setTimeout(startGame, 1000);
    }
  });

  socket.on('keys', keys => {
    if (players[socket.id]) players[socket.id].keys = keys;
  });

  socket.on('restart', () => {
    if (Object.keys(players).length >= 2) startGame();
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    if (policeId === socket.id) {
      gameStarted = false;
      policeId = null;
    }
    // Restart if enough players remain
    if (gameStarted && Object.keys(players).length < 2) {
      gameStarted = false;
      policeId = null;
    }
    broadcastState();
  });
});

// Game loop at 60fps
setInterval(() => {
  if (!gameStarted) return;

  const police = players[policeId];
  if (!police) return;

  // Move players
  Object.values(players).forEach(p => {
    if (p.role === 'caught') return;
    if (p.keys['ArrowUp']    || p.keys['w']) p.y = Math.max(RADIUS, p.y - SPEED);
    if (p.keys['ArrowDown']  || p.keys['s']) p.y = Math.min(H - RADIUS, p.y + SPEED);
    if (p.keys['ArrowLeft']  || p.keys['a']) p.x = Math.max(RADIUS, p.x - SPEED);
    if (p.keys['ArrowRight'] || p.keys['d']) p.x = Math.min(W - RADIUS, p.x + SPEED);
  });

  // Police catches free Chor
  Object.values(players).forEach(p => {
    if (p.id === policeId || p.role !== 'chor') return;
    if (dist(police, p) < RADIUS * 2) {
      p.role = 'caught';
      p.x = JAIL.x + 30 + Math.random() * 80;
      p.y = JAIL.y + 30 + Math.random() * 70;
    }
  });

  // Free Chor rescues caught players by entering free zone
  Object.values(players).forEach(p => {
    if (p.id === policeId || p.role !== 'chor') return;
    if (inRect(p.x, p.y, FREE_ZONE)) {
      // Move caught players out of jail
      Object.values(players).forEach(c => {
        if (c.role === 'caught') {
          const pos = randomSpawn();
          c.role = 'chor';
          c.x = pos.x;
          c.y = pos.y;
        }
      });
    }
  });

  // Check win — all chor caught
  const freeChor = Object.values(players).filter(p => p.role === 'chor');
  const caught = Object.values(players).filter(p => p.role === 'caught');

  if (freeChor.length === 0 && caught.length > 0) {
    gameStarted = false;
    io.emit('gameover', { winner: players[policeId]?.name || 'Police' });
    gameOverTimer = setTimeout(() => {
      if (Object.keys(players).length >= 2) startGame();
    }, 4000);
  }

  broadcastState();
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Chor Police running at http://localhost:${PORT}`));
