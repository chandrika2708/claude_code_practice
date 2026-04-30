const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const W = 900, H = 600;
const RADIUS = 18;
const POLICE_SPEED = 6;
const CHOR_SPEED = 3;
const MAX_PLAYERS = 10;
const JAIL = { x: 20, y: 20, w: 140, h: 130 };
const FREE_ZONE = { x: W - 160, y: 20, w: 140, h: 130 };

let players = {};
let policeIds = [];
let gameStarted = false;
let gameOverTimer = null;
let countdownTimer = null;
let countdown = 0;

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

function policeCount(total) {
  // 1 police for every 5 chor
  return Math.max(1, Math.floor(total / 6));
}

function startCountdown() {
  if (countdownTimer || gameStarted) return;
  countdown = 15;
  io.emit('countdown', countdown);

  countdownTimer = setInterval(() => {
    countdown--;
    io.emit('countdown', countdown);
    if (countdown <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;
      startGame();
    }
  }, 1000);
}

function startGame() {
  if (gameOverTimer) { clearTimeout(gameOverTimer); gameOverTimer = null; }
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }

  const ids = Object.keys(players);
  if (ids.length < 2) return;

  const numPolice = policeCount(ids.length);
  const shuffled = [...ids].sort(() => Math.random() - 0.5);
  policeIds = shuffled.slice(0, numPolice);
  gameStarted = true;

  ids.forEach(id => {
    const pos = randomSpawn();
    players[id].x = pos.x;
    players[id].y = pos.y;
    players[id].role = policeIds.includes(id) ? 'police' : 'chor';
    players[id].keys = {};
  });

  io.emit('started', { policeIds });
  broadcastState();
}

function broadcastState() {
  io.emit('state', {
    players: Object.values(players).map(p => ({
      id: p.id, name: p.name, x: p.x, y: p.y, role: p.role
    })),
    gameStarted,
    policeIds,
    countdown
  });
}

io.on('connection', socket => {
  socket.on('join', name => {
    if (Object.keys(players).length >= MAX_PLAYERS) {
      socket.emit('full');
      return;
    }

    const pos = randomSpawn();
    players[socket.id] = {
      id: socket.id,
      name: name.slice(0, 16),
      x: pos.x, y: pos.y,
      role: gameStarted ? 'chor' : 'waiting',
      keys: {}
    };

    broadcastState();

    if (Object.keys(players).length >= 2 && !gameStarted && !countdownTimer) {
      startCountdown();
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
    policeIds = policeIds.filter(id => id !== socket.id);

    const ids = Object.keys(players);

    if (gameStarted && policeIds.length === 0) {
      // No police left — pick a new one
      if (ids.length > 0) {
        const newPolice = ids[Math.floor(Math.random() * ids.length)];
        policeIds = [newPolice];
        players[newPolice].role = 'police';
        io.emit('started', { policeIds });
      }
    }

    if (gameStarted && ids.length < 2) {
      gameStarted = false;
      policeIds = [];
      if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    }

    broadcastState();
  });
});

// Game loop at 60fps
setInterval(() => {
  if (!gameStarted) return;
  if (policeIds.length === 0) return;

  // Move players
  Object.values(players).forEach(p => {
    if (p.role === 'caught') return;
    const spd = p.role === 'police' ? POLICE_SPEED : CHOR_SPEED;
    if (p.keys['ArrowUp']    || p.keys['w']) p.y = Math.max(RADIUS, p.y - spd);
    if (p.keys['ArrowDown']  || p.keys['s']) p.y = Math.min(H - RADIUS, p.y + spd);
    if (p.keys['ArrowLeft']  || p.keys['a']) p.x = Math.max(RADIUS, p.x - spd);
    if (p.keys['ArrowRight'] || p.keys['d']) p.x = Math.min(W - RADIUS, p.x + spd);
  });

  // Each police catches free Chor
  policeIds.forEach(pid => {
    const police = players[pid];
    if (!police) return;
    Object.values(players).forEach(p => {
      if (policeIds.includes(p.id) || p.role !== 'chor') return;
      if (dist(police, p) < RADIUS * 2) {
        p.role = 'caught';
        p.x = JAIL.x + 30 + Math.random() * 80;
        p.y = JAIL.y + 30 + Math.random() * 70;
      }
    });
  });

  // Free Chor rescues caught players via free zone
  Object.values(players).forEach(p => {
    if (policeIds.includes(p.id) || p.role !== 'chor') return;
    if (inRect(p.x, p.y, FREE_ZONE)) {
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
    const policeNames = policeIds.map(id => players[id]?.name).filter(Boolean).join(' & ');
    io.emit('gameover', { winner: policeNames || 'Police' });
    gameOverTimer = setTimeout(() => {
      if (Object.keys(players).length >= 2) startGame();
    }, 4000);
  }

  broadcastState();
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Chor Police running at http://localhost:${PORT}`));
