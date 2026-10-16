const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.send('ok'));

// In-memory rooms
const rooms = new Map();
const choices = new Set(['rock', 'paper', 'scissors']);

function makeCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase().slice(0,6);
}

function roomState(r, message='') {
  return {
    code: r.code,
    phase: r.phase,
    message: message || r.message || '',
    targetWins: r.targetWins,
    players: r.players.map(p => p ? { name: p.name, ready: !!p.ready, score: p.score } : null),
    spectatorCount: r.spectators ? r.spectators.size : 0
  };
}

function broadcastRoomState(r) {
  try { io.to(r.code).emit('state', roomState(r)); } catch (e) { console.error(e); }
}

function evaluateRound(aChoice, bChoice) {
  if (aChoice === bChoice) return 'draw';
  if (
    (aChoice === 'rock' && bChoice === 'scissors') ||
    (aChoice === 'scissors' && bChoice === 'paper') ||
    (aChoice === 'paper' && bChoice === 'rock')
  ) return 'a';
  return 'b';
}

function rRound(r) {
  const [a, b] = r.players;
  if (!a || !b || !a.choice || !b.choice) return;

  const result = evaluateRound(a.choice, b.choice);
  const draw = result === 'draw';
  let winner = null;

  if (!draw) {
    if (result === 'a') {
      a.score += 1;
      winner = a.name;
    } else {
      b.score += 1;
      winner = b.name;
    }
  }

  const choicesPayload = [
    { label: a.choice ? a.choice.toUpperCase() : '—', value: a.choice },
    { label: b.choice ? b.choice.toUpperCase() : '—', value: b.choice }
  ];

  io.to(r.code).emit('round-result', { choices: choicesPayload, draw, winner });

  // check for match finish
  const target = r.targetWins || 3;
  if (a.score >= target || b.score >= target) {
    const matchWinner = a.score >= target ? a.name : b.name;
    finishMatch(r, matchWinner);
  }
}

function finishMatch(r, winner, reason='') {
  if (!rooms.has(r.code) || r.phase === 'finished') return;
  r.phase = 'finished';
  let n = 10;
  io.to(r.code).emit('match-finished', { winner, seconds: n, reason });
  r.finishTimer = setInterval(() => {
    n--;
    io.to(r.code).emit('match-countdown', { seconds: n });
    if (n <= 0) {
      clearInterval(r.finishTimer);
      r.finishTimer = null;
      // cleanup room to allow new players
      rooms.delete(r.code);
      io.to(r.code).emit('room-closed');
    }
  }, 1000);
}

function startCountdown(r, seconds = 3) {
  if (r.countdownTimer) return;
  let sec = Math.max(1, Number(seconds) || 3);
  io.to(r.code).emit('countdown', { seconds: sec });
  r.countdownTimer = setInterval(() => {
    sec--;
    if (sec > 0) {
      io.to(r.code).emit('countdown', { seconds: sec });
      return;
    }
    clearInterval(r.countdownTimer);
    r.countdownTimer = null;
    io.to(r.code).emit('countdown', { seconds: 0 });

    r.phase = 'playing';
    try { rRound(r); } catch (e) { console.error('rRound error', e); }

    setTimeout(() => {
      if (Array.isArray(r.players)) {
        r.players.forEach(p => { if (p) { p.choice = null; p.ready = false; } });
      }
      r.phase = 'ready';
      io.to(r.code).emit('round-reset');
      broadcastRoomState(r);
    }, 3000);
  }, 1000);
}

io.on('connection', s => {
  s.data = s.data || {};

  s.on('list-public-rooms', cb => {
    const list = [...rooms.values()].filter(r => r.isPublic && r.players.some(Boolean) && r.phase !== 'finished').map(r => ({ code: r.code, hostName: (r.players.find(Boolean) || {}).name || 'Spieler', players: r.players.length }));
    try { cb(list); } catch (e) {}
  });

  s.on('create-room', ({ name, targetWins, isPublic }, cb) => {
    name = String(name || '').trim().slice(0,20);
    if (!name) return cb && cb({ error: 'Bitte gib zuerst deinen Namen ein.' });
    const code = makeCode();
    const room = {
      code,
      phase: 'ready',
      targetWins: Math.min(10, Math.max(1, parseInt(targetWins, 10) || 3)),
      players: [ { id: s.id, name, ready: false, choice: null, score: 0 }, null ],
      spectators: new Set(),
      isPublic: !!isPublic,
      countdownTimer: null,
      finishTimer: null
    };
    rooms.set(code, room);
    s.join(code);
    s.data.room = code;
    s.data.role = 0; // player index 0
    broadcastRoomState(room);
    if (cb) cb({ code, role: 'player', targetWins: room.targetWins });
  });

  s.on('join-room', ({ name, code }, cb) => {
    name = String(name || '').trim().slice(0,20);
    const r = rooms.get(String(code || '').toUpperCase());
    if (!r) return cb && cb({ error: 'Raum nicht gefunden.' });
    if (!name) return cb && cb({ error: 'Bitte gib zuerst deinen Namen ein.' });
    // find empty slot
    const idx = r.players[0] ? (r.players[1] ? -1 : 1) : 0;
    if (idx === -1) return cb && cb({ error: 'Raum ist voll.' });
    r.players[idx] = { id: s.id, name, ready: false, choice: null, score: 0 };
    s.join(r.code);
    s.data.room = r.code;
    s.data.role = idx;
    broadcastRoomState(r);
    if (cb) cb({ code: r.code, role: 'player', targetWins: r.targetWins });
  });

  s.on('watch-room', ({ code, name }, cb) => {
    const r = rooms.get(String(code || '').toUpperCase());
    if (!r) return cb && cb({ error: 'Raum nicht gefunden.' });
    r.spectators.add(s.id);
    s.join(r.code);
    s.data.room = r.code;
    s.data.role = 'spectator';
    broadcastRoomState(r);
    if (cb) cb({ code: r.code, role: 'spectator' });
  });

  s.on('choose', c => {
    if (!c) return;
    if (s.data.tournament) { /* tournament routing not implemented in this simplified server */ return; }
    const r = rooms.get(s.data.room);
    const i = s.data.role;
    if (!r || !Number.isInteger(i) || !choices.has(c)) return;
    const p = r.players && r.players[i];
    if (!p) return;
    if (p.ready || r.phase === 'playing' || r.countdownTimer) return;
    p.choice = c;
    broadcastRoomState(r);
  });

  s.on('ready', () => {
    const r = rooms.get(s.data.room);
    const i = s.data.role;
    if (!r || !Number.isInteger(i)) return;
    const p = r.players && r.players[i];
    if (!p) return;
    if (!p.choice) { try { s.emit('status', { error: 'Wähle zuerst Stein/Papier/Schere.' }); } catch (e) {} return; }
    p.ready = true;
    broadcastRoomState(r);
    const playersPresent = Array.isArray(r.players) && r.players.filter(Boolean).length === 2;
    const bothReady = playersPresent && r.players.every(x => x && x.ready);
    if (bothReady) {
      r.phase = 'ready';
      startCountdown(r, 3);
    }
  });

  s.on('leave-room', () => {
    const code = s.data.room;
    if (!code) return;
    const r = rooms.get(code);
    if (!r) return;
    // remove player or spectator
    if (Number.isInteger(s.data.role)) {
      const idx = s.data.role;
      if (r.players && r.players[idx] && r.players[idx].id === s.id) {
        r.players[idx] = null;
      }
    } else {
      r.spectators.delete(s.id);
    }
    try { s.leave(code); } catch (e) {}
    s.data.room = null; s.data.role = null;

    // If a player left while countdown was running, abort countdown and reset remaining player state
    if (r.countdownTimer) {
      clearInterval(r.countdownTimer);
      r.countdownTimer = null;
      try { io.to(r.code).emit('countdown', { seconds: 0 }); } catch (e) {}
      // reset choices/ready for remaining players
      if (Array.isArray(r.players)) {
        r.players.forEach(p => { if (p) { p.choice = null; p.ready = false; } });
      }
      r.phase = 'ready';
      try { io.to(r.code).emit('round-reset'); } catch (e) {}
      broadcastRoomState(r);
    }

    // if both players gone, remove room
    if (!r.players.some(Boolean)) { rooms.delete(r.code); io.to(r.code).emit('room-closed'); }
    else broadcastRoomState(r);
  });

  s.on('disconnect', () => {
    // treat like leave-room but also ensure timers aborted if player leaves mid-countdown
    const code = s.data.room;
    if (!code) return;
    const r = rooms.get(code);
    if (!r) return;
    if (Number.isInteger(s.data.role)) {
      const idx = s.data.role;
      if (r.players && r.players[idx] && r.players[idx].id === s.id) r.players[idx] = null;
    } else {
      r.spectators.delete(s.id);
    }

    // Abort countdown if running
    if (r.countdownTimer) {
      clearInterval(r.countdownTimer);
      r.countdownTimer = null;
      try { io.to(r.code).emit('countdown', { seconds: 0 }); } catch (e) {}
      if (Array.isArray(r.players)) {
        r.players.forEach(p => { if (p) { p.choice = null; p.ready = false; } });
      }
      r.phase = 'ready';
      try { io.to(r.code).emit('round-reset'); } catch (e) {}
      broadcastRoomState(r);
    }

    if (!r.players.some(Boolean)) { rooms.delete(r.code); io.to(r.code).emit('room-closed'); }
    else broadcastRoomState(r);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Listening on', PORT));
