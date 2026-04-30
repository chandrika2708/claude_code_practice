const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

const W = 900, H = 600, R = 20, MAX = 10;

function dist(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }
function rpos(m = 80) { return { x: m + Math.random() * (W - m * 2), y: m + Math.random() * (H - m * 2) }; }
function rcolor() { return `hsl(${Math.floor(Math.random() * 360)},80%,60%)`; }
function move(p, speed, maxW = W, maxH = H) {
  if (p.keys['ArrowUp']    || p.keys['w']) p.y = Math.max(R, p.y - speed);
  if (p.keys['ArrowDown']  || p.keys['s']) p.y = Math.min(maxH - R, p.y + speed);
  if (p.keys['ArrowLeft']  || p.keys['a']) p.x = Math.max(R, p.x - speed);
  if (p.keys['ArrowRight'] || p.keys['d']) p.x = Math.min(maxW - R, p.x + speed);
}
function startCD(ns, state, onDone, secs = 10) {
  if (state.cdTimer || state.started) return;
  state.countdown = secs;
  state.cdTimer = setInterval(() => {
    state.countdown--;
    if (state.countdown <= 0) { clearInterval(state.cdTimer); state.cdTimer = null; onDone(); }
    else ns.emit('countdown', state.countdown);
  }, 1000);
}

// ── BOMB TAG ─────────────────────────────────────────────────────────────────
(function setupBomb(ns) {
  let players = {}, bombId = null, fuse = 20, started = false, cdTimer = null, countdown = 0, fuseTimer = null;
  const st = { get started() { return started; }, get cdTimer() { return cdTimer; }, set cdTimer(v) { cdTimer = v; }, get countdown() { return countdown; }, set countdown(v) { countdown = v; } };

  const bc = () => ns.emit('state', {
    players: Object.values(players).map(p => ({ id: p.id, name: p.name, x: p.x, y: p.y, alive: p.alive, color: p.color })),
    bombId, fuse, started, countdown
  });

  const explode = () => {
    if (!players[bombId]) return;
    ns.emit('boom', { x: players[bombId].x, y: players[bombId].y });
    players[bombId].alive = false;
    const alive = Object.values(players).filter(p => p.alive);
    if (alive.length <= 1) {
      started = false; bombId = null;
      if (fuseTimer) { clearInterval(fuseTimer); fuseTimer = null; }
      ns.emit('gameover', { winner: alive[0]?.name || 'Nobody' });
      setTimeout(() => { if (Object.keys(players).length >= 2) startGame(); }, 3500);
    } else {
      bombId = alive[Math.floor(Math.random() * alive.length)].id;
      fuse = 20;
      ns.emit('newbomb', { bombId });
    }
  };

  const startGame = () => {
    const ids = Object.keys(players);
    if (ids.length < 2) return;
    started = true;
    ids.forEach(id => { const p = rpos(); players[id] = { ...players[id], x: p.x, y: p.y, alive: true, keys: {} }; });
    bombId = ids[Math.floor(Math.random() * ids.length)];
    fuse = 20;
    ns.emit('started', { bombId });
    if (fuseTimer) clearInterval(fuseTimer);
    fuseTimer = setInterval(() => {
      if (!started) return;
      fuse--;
      ns.emit('tick', { fuse });
      if (fuse <= 0) explode();
    }, 1000);
    bc();
  };

  ns.on('connection', socket => {
    socket.on('join', name => {
      if (Object.keys(players).length >= MAX) { socket.emit('full'); return; }
      const p = rpos();
      players[socket.id] = { id: socket.id, name: name.slice(0, 14), x: p.x, y: p.y, alive: true, keys: {}, color: rcolor() };
      bc();
      if (Object.keys(players).length >= 2 && !started && !cdTimer) startCD(ns, st, startGame);
    });
    socket.on('keys', k => { if (players[socket.id]) players[socket.id].keys = k; });
    socket.on('disconnect', () => {
      delete players[socket.id];
      if (bombId === socket.id) {
        const alive = Object.values(players).filter(p => p.alive);
        if (alive.length >= 2) { bombId = alive[0].id; fuse = 20; ns.emit('newbomb', { bombId }); }
        else { started = false; bombId = null; }
      }
      bc();
    });
  });

  setInterval(() => {
    if (!started) return;
    Object.values(players).filter(p => p.alive).forEach(p => move(p, 4));
    const bomb = players[bombId];
    if (bomb) {
      Object.values(players).filter(p => p.alive && p.id !== bombId).forEach(p => {
        if (dist(bomb, p) < R * 2) { bombId = p.id; fuse = Math.max(fuse, 5); ns.emit('transfer', { bombId }); }
      });
    }
    bc();
  }, 1000 / 60);
})(io.of('/bomb'));

// ── COIN RUSH ────────────────────────────────────────────────────────────────
(function setupCoins(ns) {
  let players = {}, coins = [], gameTime = 60, started = false, cdTimer = null, countdown = 0, gameTimer = null;
  const st = { get started() { return started; }, get cdTimer() { return cdTimer; }, set cdTimer(v) { cdTimer = v; }, get countdown() { return countdown; }, set countdown(v) { countdown = v; } };

  const spawnCoin = () => { const p = rpos(40); coins.push({ id: Math.random().toString(36).slice(2), x: p.x, y: p.y }); };
  const bc = () => ns.emit('state', {
    players: Object.values(players).map(p => ({ id: p.id, name: p.name, x: p.x, y: p.y, score: p.score, color: p.color })),
    coins, gameTime, started, countdown
  });

  const startGame = () => {
    const ids = Object.keys(players);
    if (ids.length < 2) return;
    started = true; gameTime = 60;
    coins = []; for (let i = 0; i < 18; i++) spawnCoin();
    ids.forEach(id => { const p = rpos(); players[id] = { ...players[id], x: p.x, y: p.y, score: 0, keys: {} }; });
    ns.emit('started', {});
    if (gameTimer) clearInterval(gameTimer);
    gameTimer = setInterval(() => {
      if (!started) return;
      gameTime--;
      if (gameTime <= 0) {
        clearInterval(gameTimer); gameTimer = null; started = false;
        const sorted = Object.values(players).sort((a, b) => b.score - a.score);
        ns.emit('gameover', { winner: sorted[0]?.name || 'Nobody', scores: sorted.map(p => ({ name: p.name, score: p.score })) });
        setTimeout(() => { if (Object.keys(players).length >= 2) startGame(); }, 4000);
      }
    }, 1000);
    bc();
  };

  ns.on('connection', socket => {
    socket.on('join', name => {
      if (Object.keys(players).length >= MAX) { socket.emit('full'); return; }
      const p = rpos();
      players[socket.id] = { id: socket.id, name: name.slice(0, 14), x: p.x, y: p.y, score: 0, keys: {}, color: rcolor() };
      bc();
      if (Object.keys(players).length >= 2 && !started && !cdTimer) startCD(ns, st, startGame);
    });
    socket.on('keys', k => { if (players[socket.id]) players[socket.id].keys = k; });
    socket.on('disconnect', () => { delete players[socket.id]; bc(); });
  });

  setInterval(() => {
    if (!started) return;
    Object.values(players).forEach(p => move(p, 4));

    coins = coins.filter(coin => {
      for (const p of Object.values(players)) {
        if (dist(p, coin) < R + 14) {
          p.score++;
          ns.emit('collected', { playerId: p.id, x: coin.x, y: coin.y, color: p.color });
          setTimeout(spawnCoin, 500);
          return false;
        }
      }
      return true;
    });

    const arr = Object.values(players);
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      if (dist(arr[i], arr[j]) < R * 2) {
        const take = Math.min(3, Math.max(arr[j].score, arr[i].score));
        if (arr[i].score > arr[j].score) { arr[i].score -= take; arr[j].score += take; }
        else { arr[j].score -= take; arr[i].score += take; }
        arr[i].score = Math.max(0, arr[i].score);
        arr[j].score = Math.max(0, arr[j].score);
        ns.emit('bump', { a: arr[i].id, b: arr[j].id, ax: arr[i].x, ay: arr[i].y });
      }
    }
    bc();
  }, 1000 / 60);
})(io.of('/coins'));

// ── ZOMBIE APOCALYPSE ────────────────────────────────────────────────────────
(function setupZombie(ns) {
  let players = {}, gameTime = 90, started = false, cdTimer = null, countdown = 0, gameTimer = null;
  const st = { get started() { return started; }, get cdTimer() { return cdTimer; }, set cdTimer(v) { cdTimer = v; }, get countdown() { return countdown; }, set countdown(v) { countdown = v; } };

  const bc = () => ns.emit('state', {
    players: Object.values(players).map(p => ({ id: p.id, name: p.name, x: p.x, y: p.y, role: p.role })),
    gameTime, started, countdown
  });

  const startGame = () => {
    const ids = Object.keys(players);
    if (ids.length < 2) return;
    started = true; gameTime = 90;
    const zid = ids[Math.floor(Math.random() * ids.length)];
    ids.forEach(id => { const p = rpos(); players[id] = { ...players[id], x: p.x, y: p.y, role: id === zid ? 'zombie' : 'human', keys: {} }; });
    ns.emit('started', { zombieId: zid });
    if (gameTimer) clearInterval(gameTimer);
    gameTimer = setInterval(() => {
      if (!started) return;
      gameTime--;
      if (gameTime <= 0) {
        clearInterval(gameTimer); gameTimer = null; started = false;
        const humans = Object.values(players).filter(p => p.role === 'human');
        ns.emit('gameover', { winner: humans.length > 0 ? '🧑 Humans Survived!' : '🧟 Zombies Win!' });
        setTimeout(() => { if (Object.keys(players).length >= 2) startGame(); }, 4000);
      }
    }, 1000);
    bc();
  };

  ns.on('connection', socket => {
    socket.on('join', name => {
      if (Object.keys(players).length >= MAX) { socket.emit('full'); return; }
      const p = rpos();
      players[socket.id] = { id: socket.id, name: name.slice(0, 14), x: p.x, y: p.y, role: 'waiting', keys: {} };
      bc();
      if (Object.keys(players).length >= 2 && !started && !cdTimer) startCD(ns, st, startGame);
    });
    socket.on('keys', k => { if (players[socket.id]) players[socket.id].keys = k; });
    socket.on('disconnect', () => { delete players[socket.id]; bc(); });
  });

  setInterval(() => {
    if (!started) return;
    Object.values(players).forEach(p => move(p, p.role === 'zombie' ? 3 : 4));

    const zombies = Object.values(players).filter(p => p.role === 'zombie');
    Object.values(players).filter(p => p.role === 'human').forEach(h => {
      zombies.forEach(z => {
        if (dist(z, h) < R * 2) { h.role = 'zombie'; ns.emit('infected', { id: h.id, x: h.x, y: h.y }); }
      });
    });

    const humans = Object.values(players).filter(p => p.role === 'human');
    if (humans.length === 0 && started && Object.values(players).some(p => p.role === 'zombie')) {
      clearInterval(gameTimer); gameTimer = null; started = false;
      ns.emit('gameover', { winner: '🧟 Zombies Win!' });
      setTimeout(() => { if (Object.keys(players).length >= 2) startGame(); }, 4000);
    }
    bc();
  }, 1000 / 60);
})(io.of('/zombie'));

// ── KING OF THE HILL ─────────────────────────────────────────────────────────
(function setupKing(ns) {
  let players = {}, started = false, cdTimer = null, countdown = 0;
  const st = { get started() { return started; }, get cdTimer() { return cdTimer; }, set cdTimer(v) { cdTimer = v; }, get countdown() { return countdown; }, set countdown(v) { countdown = v; } };
  const ZONE = { x: W / 2, y: H / 2, r: 85 };
  const WIN = 60;

  const bc = () => ns.emit('state', {
    players: Object.values(players).map(p => ({ id: p.id, name: p.name, x: p.x, y: p.y, score: p.score, inZone: p.inZone, color: p.color })),
    started, countdown, zone: ZONE, win: WIN
  });

  const startGame = () => {
    const ids = Object.keys(players);
    if (ids.length < 2) return;
    started = true;
    ids.forEach(id => { const p = rpos(); players[id] = { ...players[id], x: p.x, y: p.y, score: 0, inZone: false, keys: {} }; });
    ns.emit('started', {});
    bc();
  };

  ns.on('connection', socket => {
    socket.on('join', name => {
      if (Object.keys(players).length >= MAX) { socket.emit('full'); return; }
      const p = rpos();
      players[socket.id] = { id: socket.id, name: name.slice(0, 14), x: p.x, y: p.y, score: 0, inZone: false, keys: {}, color: rcolor() };
      bc();
      if (Object.keys(players).length >= 2 && !started && !cdTimer) startCD(ns, st, startGame);
    });
    socket.on('keys', k => { if (players[socket.id]) players[socket.id].keys = k; });
    socket.on('disconnect', () => { delete players[socket.id]; bc(); });
  });

  // Score ticker
  setInterval(() => {
    if (!started) return;
    const inZone = Object.values(players).filter(p => p.inZone);
    if (inZone.length === 0) return;
    const pts = 1 / inZone.length;
    let won = false;
    inZone.forEach(p => {
      p.score = Math.min(WIN, p.score + pts);
      if (p.score >= WIN && !won) {
        won = true; started = false;
        ns.emit('gameover', { winner: p.name });
        setTimeout(() => { if (Object.keys(players).length >= 2) startGame(); }, 4000);
      }
    });
    if (!won) bc();
  }, 300);

  setInterval(() => {
    if (!started) return;
    Object.values(players).forEach(p => {
      move(p, 4);
      p.inZone = dist(p, ZONE) < ZONE.r - R;
    });
    const arr = Object.values(players);
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const d = dist(arr[i], arr[j]);
      if (d < R * 2 && d > 0.1) {
        const ang = Math.atan2(arr[j].y - arr[i].y, arr[j].x - arr[i].x);
        const push = (R * 2 - d) * 0.5;
        arr[j].x += Math.cos(ang) * push; arr[j].y += Math.sin(ang) * push;
        arr[i].x -= Math.cos(ang) * push; arr[i].y -= Math.sin(ang) * push;
        [arr[i], arr[j]].forEach(p => { p.x = Math.max(R, Math.min(W - R, p.x)); p.y = Math.max(R, Math.min(H - R, p.y)); });
        ns.emit('push', { x: (arr[i].x + arr[j].x) / 2, y: (arr[i].y + arr[j].y) / 2 });
      }
    }
    bc();
  }, 1000 / 60);
})(io.of('/king'));

// ── SPACE SHOOTER ─────────────────────────────────────────────────────────────
(function setupShooter(ns) {
  let players = {}, bullets = [], started = false, cdTimer = null, countdown = 0;
  const st = { get started() { return started; }, get cdTimer() { return cdTimer; }, set cdTimer(v) { cdTimer = v; }, get countdown() { return countdown; }, set countdown(v) { countdown = v; } };

  const bc = () => ns.emit('state', {
    players: Object.values(players).map(p => ({ id: p.id, name: p.name, x: p.x, y: p.y, hp: p.hp, angle: p.angle, color: p.color, alive: p.alive })),
    bullets: bullets.map(b => ({ x: b.x, y: b.y, color: b.color, angle: b.angle })),
    started, countdown
  });

  const startGame = () => {
    const ids = Object.keys(players);
    if (ids.length < 2) return;
    started = true; bullets = [];
    ids.forEach(id => { const p = rpos(100); players[id] = { ...players[id], x: p.x, y: p.y, hp: 3, angle: 0, alive: true, keys: {}, cd: 0 }; });
    ns.emit('started', {});
    bc();
  };

  ns.on('connection', socket => {
    socket.on('join', name => {
      if (Object.keys(players).length >= MAX) { socket.emit('full'); return; }
      const p = rpos(100);
      players[socket.id] = { id: socket.id, name: name.slice(0, 14), x: p.x, y: p.y, hp: 3, angle: 0, alive: true, keys: {}, cd: 0, color: rcolor() };
      bc();
      if (Object.keys(players).length >= 2 && !started && !cdTimer) startCD(ns, st, startGame);
    });
    socket.on('keys', k => { if (players[socket.id]) players[socket.id].keys = k; });
    socket.on('disconnect', () => { delete players[socket.id]; bc(); });
  });

  setInterval(() => {
    if (!started) return;
    Object.values(players).filter(p => p.alive).forEach(p => {
      let dx = 0, dy = 0;
      if (p.keys['ArrowUp']    || p.keys['w']) dy = -4;
      if (p.keys['ArrowDown']  || p.keys['s']) dy = 4;
      if (p.keys['ArrowLeft']  || p.keys['a']) dx = -4;
      if (p.keys['ArrowRight'] || p.keys['d']) dx = 4;
      p.x = Math.max(R, Math.min(W - R, p.x + dx));
      p.y = Math.max(R, Math.min(H - R, p.y + dy));
      if (dx || dy) p.angle = Math.atan2(dy, dx);
      if (p.cd > 0) p.cd--;
      if ((p.keys[' '] || p.keys['f']) && p.cd === 0) {
        bullets.push({ x: p.x, y: p.y, vx: Math.cos(p.angle) * 9, vy: Math.sin(p.angle) * 9, owner: p.id, color: p.color, angle: p.angle, life: 70 });
        p.cd = 18;
        ns.emit('shot', { x: p.x, y: p.y, color: p.color, angle: p.angle });
      }
    });

    bullets = bullets.filter(b => {
      b.x += b.vx; b.y += b.vy; b.life--;
      if (b.life <= 0 || b.x < 0 || b.x > W || b.y < 0 || b.y > H) return false;
      let hit = false;
      Object.values(players).filter(p => p.alive && p.id !== b.owner).forEach(p => {
        if (dist(b, p) < R + 5) {
          hit = true; p.hp--;
          ns.emit('hit', { id: p.id, x: p.x, y: p.y, hp: p.hp });
          if (p.hp <= 0) {
            p.alive = false;
            ns.emit('died', { id: p.id, x: p.x, y: p.y });
            const alive = Object.values(players).filter(pp => pp.alive);
            if (alive.length <= 1) {
              started = false;
              ns.emit('gameover', { winner: alive[0]?.name || 'Nobody' });
              setTimeout(() => { if (Object.keys(players).length >= 2) startGame(); }, 4000);
            }
          }
        }
      });
      return !hit;
    });
    bc();
  }, 1000 / 60);
})(io.of('/shooter'));

server.listen(3001, () => console.log('Games Hub at http://localhost:3001'));
