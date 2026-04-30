// ── SOUND ENGINE (Web Audio API — no files needed) ───────────────────────────
let _ac;
function ac() { if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)(); return _ac; }

function tone(freq, dur, type = 'sine', vol = 0.25, delay = 0) {
  try {
    const c = ac(), o = c.createOscillator(), g = c.createGain();
    o.connect(g); g.connect(c.destination);
    o.type = type; o.frequency.value = freq;
    const t = c.currentTime + delay;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t); o.stop(t + dur + 0.02);
  } catch (_) {}
}

function noise(dur, vol = 0.2, delay = 0) {
  try {
    const c = ac(), sr = c.sampleRate;
    const buf = c.createBuffer(1, sr * dur, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = buf; src.connect(g); g.connect(c.destination);
    const t = c.currentTime + delay;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.start(t);
  } catch (_) {}
}

const SFX = {
  tick:     (fast) => tone(fast ? 900 : 440, 0.04, 'square', 0.18),
  boom:     ()     => { noise(0.6, 0.45); tone(70, 0.5, 'sawtooth', 0.3); },
  transfer: ()     => { tone(300, 0.05); tone(200, 0.07, 'sine', 0.2, 0.05); },
  coin:     ()     => { tone(880, 0.07); tone(1320, 0.09, 'sine', 0.2, 0.07); },
  bump:     ()     => noise(0.12, 0.35),
  infect:   ()     => { tone(110, 0.35, 'sawtooth', 0.35); noise(0.2, 0.2, 0.1); },
  groan:    ()     => { tone(85, 0.5, 'sawtooth', 0.22); tone(75, 0.4, 'square', 0.15, 0.25); },
  scream:   ()     => { tone(750, 0.08, 'sine', 0.3); tone(550, 0.25, 'sawtooth', 0.2, 0.08); },
  score:    ()     => tone(660, 0.1, 'sine', 0.2),
  push:     ()     => noise(0.08, 0.2),
  shoot:    ()     => tone(260, 0.05, 'square', 0.12),
  hit:      ()     => { tone(140, 0.07, 'sawtooth', 0.3); },
  die:      ()     => { noise(0.4, 0.3); tone(160, 0.35, 'sawtooth', 0.25); },
  win:      ()     => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'sine', 0.25, i * 0.13)),
  countdown:()     => tone(440, 0.08, 'sine', 0.2),
  go:       ()     => { tone(880, 0.15, 'sine', 0.3); tone(1100, 0.15, 'sine', 0.25, 0.15); },
};

// ── PARTICLE SYSTEM ──────────────────────────────────────────────────────────
class Particles {
  constructor() { this.list = []; }

  emit(x, y, n, colors, spd = 5, gravity = 0.12) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (Math.random() * 0.6 + 0.4) * spd;
      this.list.push({
        x, y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s - spd * 0.25,
        color: Array.isArray(colors) ? colors[i % colors.length] : colors,
        size: Math.random() * 5 + 2,
        life: 1,
        decay: 0.018 + Math.random() * 0.022,
        gravity
      });
    }
  }

  ring(x, y, n, color, radius = 30) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const spd = 3 + Math.random() * 3;
      this.list.push({
        x: x + Math.cos(a) * radius * 0.3,
        y: y + Math.sin(a) * radius * 0.3,
        vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
        color, size: 4, life: 1, decay: 0.025, gravity: 0
      });
    }
  }

  update() {
    this.list = this.list.filter(p => {
      p.x += p.vx; p.y += p.vy;
      p.vy += p.gravity; p.vx *= 0.97; p.vy *= 0.97;
      p.life -= p.decay;
      return p.life > 0;
    });
  }

  draw(ctx) {
    this.list.forEach(p => {
      ctx.save();
      ctx.globalAlpha = p.life * p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }
}

// ── SCREEN SHAKE ─────────────────────────────────────────────────────────────
let _shake = 0;
function shake(n) { _shake = Math.max(_shake, n); }
function applyShake(ctx) {
  if (_shake > 0.5) {
    ctx.translate((Math.random() - 0.5) * _shake, (Math.random() - 0.5) * _shake);
    _shake *= 0.75;
  } else _shake = 0;
}

// ── FLOATING TEXT ─────────────────────────────────────────────────────────────
class FloatText {
  constructor() { this.list = []; }
  add(x, y, text, color = '#fff', size = 18) {
    this.list.push({ x, y, text, color, size, life: 1, vy: -1.5 });
  }
  update() {
    this.list = this.list.filter(t => { t.y += t.vy; t.life -= 0.025; return t.life > 0; });
  }
  draw(ctx) {
    this.list.forEach(t => {
      ctx.save();
      ctx.globalAlpha = t.life;
      ctx.fillStyle = t.color;
      ctx.font = `bold ${t.size}px Segoe UI`;
      ctx.textAlign = 'center';
      ctx.fillText(t.text, t.x, t.y);
      ctx.restore();
    });
  }
}

// ── COMMON UI ─────────────────────────────────────────────────────────────────
function drawStars(ctx, stars) {
  stars.forEach(s => {
    ctx.fillStyle = `rgba(255,255,255,${s.b})`;
    ctx.fillRect(s.x, s.y, s.r, s.r);
  });
}

function makeStars(n, W, H) {
  return Array.from({ length: n }, () => ({
    x: Math.random() * W, y: Math.random() * H,
    r: Math.random() < 0.3 ? 2 : 1,
    b: Math.random() * 0.6 + 0.2
  }));
}
