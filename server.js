const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.send('ok'));

const rooms = new Map();
const tournaments = new Map();
const choices = new Set(['rock', 'paper', 'scissors']);

function makeCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 6);
}

function roomState(r) {
  return {
    code: r.code,
    phase: r.phase,
    message: r.message || '',
    targetWins: r.targetWins,
    players: r.players.map(p => p ? { name: p.name, ready: !!p.ready, score: p.score } : null),
    spectatorCount: r.spectators ? r.spectators.size : 0
  };
}

function broadcastRoomState(r) {
  io.to(r.code).emit('state', roomState(r));
}

function clearMatchCountdown(r) {
  if (r.countdownTimer) {
    clearInterval(r.countdownTimer);
    r.countdownTimer = null;
  }
}

function roomList() {
  return [...rooms.values()].filter(r => r.isPublic && r.players.some(Boolean) && r.phase !== 'finished').map(r => ({
    code: r.code,
    hostName: (r.players.find(Boolean) || {}).name || 'Spieler',
    players: r.players.filter(Boolean).length,
    maxPlayers: 2
  }));
}

function evaluateRound(aChoice, bChoice) {
  if (aChoice === bChoice) return 'draw';
  if ((aChoice === 'rock' && bChoice === 'scissors') || (aChoice === 'scissors' && bChoice === 'paper') || (aChoice === 'paper' && bChoice === 'rock')) return 'a';
  return 'b';
}

function startRoomCountdown(r, seconds = 3) {
  clearMatchCountdown(r);
  let sec = seconds;
  io.to(r.code).emit('countdown', { seconds: sec });

  r.countdownTimer = setInterval(() => {
    sec--;
    if (sec > 0) {
      io.to(r.code).emit('countdown', { seconds: sec });
      return;
    }

    clearMatchCountdown(r);
    io.to(r.code).emit('countdown', { seconds: 0 });
    r.phase = 'playing';

    const [a, b] = r.players;
    if (!a || !b || !a.choice || !b.choice) {
      r.phase = 'ready';
      io.to(r.code).emit('round-reset');
      broadcastRoomState(r);
      return;
    }

    const outcome = evaluateRound(a.choice, b.choice);
    const draw = outcome === 'draw';
    let winnerName = null;
    if (!draw) {
      if (outcome === 'a') {
        a.score += 1;
        winnerName = a.name;
      } else {
        b.score += 1;
        winnerName = b.name;
      }
    }

    io.to(r.code).emit('round-result', {
      choices: [
        { label: a.choice.toUpperCase(), value: a.choice },
        { label: b.choice.toUpperCase(), value: b.choice }
      ],
      draw,
      winner: winnerName
    });

    if (a.score >= r.targetWins || b.score >= r.targetWins) {
      let winner = a.score >= r.targetWins ? a.name : b.name;
      r.phase = 'finished';
      io.to(r.code).emit('match-finished', { winner, seconds: 3 });
      setTimeout(() => {
        io.to(r.code).emit('room-closed');
        rooms.delete(r.code);
      }, 3000);
      return;
    }

    setTimeout(() => {
      a.choice = null; b.choice = null; a.ready = false; b.ready = false;
      r.phase = 'ready';
      io.to(r.code).emit('round-reset');
      broadcastRoomState(r);
    }, 3000);
  }, 1000);
}

function tournamentList() {
  return [...tournaments.values()].filter(t => t.isPublic && t.phase !== 'finished').map(t => ({
    code: t.code,
    hostName: t.hostName,
    players: t.players.size,
    maxPlayers: t.maxPlayers,
    targetWins: t.targetWins
  }));
}

function tournamentState(t) {
  return {
    code: t.code,
    phase: t.phase,
    hostName: t.hostName,
    targetWins: t.targetWins,
    maxPlayers: t.maxPlayers,
    players: [...t.players.values()].map(p => ({ name: p.name, points: p.points, inMatch: !!p.inMatch })),
    liveMatches: t.liveMatches.map(m => ({ id: m.id, players: m.players.map(pid => t.players.get(pid)?.name || '—') }))
  };
}

function sortLeaderboard(t) {
  return [...t.players.values()].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

function resetTournamentMatchState(match) {
  match.ready = {};
  match.choice = {};
  if (match.players) {
    match.players.forEach(pid => {
      match.ready[pid] = false;
      match.choice[pid] = null;
    });
  }
}

function startTournamentRound(t) {
  const ids = [...t.players.keys()];
  if (ids.length < 2) return;

  const shuffled = [...ids].sort(() => Math.random() - 0.5);
  const matches = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    const a = shuffled[i];
    const b = shuffled[i + 1];
    if (!b) {
      const randomPick = ids[Math.floor(Math.random() * ids.length)];
      const target = t.players.get(randomPick);
      if (target) target.points += 1;
      continue;
    }
    const match = {
      id: `${t.code}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      players: [a, b],
      ready: { [a]: false, [b]: false },
      choice: { [a]: null, [b]: null },
      done: false,
      winnerId: null,
      countdownTimer: null,
      phase: 'ready'
    };
    matches.push(match);
    t.players.get(a).inMatch = true;
    t.players.get(b).inMatch = true;
  }

  t.liveMatches = matches;
  t.phase = 'running';

  matches.forEach(match => {
    const p1 = t.players.get(match.players[0]);
    const p2 = t.players.get(match.players[1]);
    const payload = {
      code: t.code,
      matchId: match.id,
      targetWins: t.targetWins,
      players: [p1.name, p2.name],
      role: 'player'
    };
    io.to(match.players[0]).emit('tournament-match', payload);
    io.to(match.players[1]).emit('tournament-match', payload);
  });

  io.to(t.code).emit('tournament-state', tournamentState(t));
  io.to(t.hostId).emit('tournament-live-matches', t.liveMatches.map(m => ({ id: m.id, players: m.players.map(pid => t.players.get(pid)?.name || '—') })));
}

function finishTournamentMatch(t, match) {
  if (match.done) return;
  match.done = true;
  const [aId, bId] = match.players;
  const a = t.players.get(aId);
  const b = t.players.get(bId);
  if (!a || !b) return;

  const aChoice = match.choice[aId];
  const bChoice = match.choice[bId];
  if (!aChoice || !bChoice) {
    const winner = Math.random() > 0.5 ? aId : bId;
    const loser = winner === aId ? bId : aId;
    t.players.get(winner).points += 1;
    t.players.get(loser).points += 0;
    match.winnerId = winner;
  } else {
    const outcome = evaluateRound(aChoice, bChoice);
    if (outcome === 'draw') {
      a.points += 1;
      b.points += 1;
      match.winnerId = null;
    } else if (outcome === 'a') {
      a.points += 1;
      match.winnerId = aId;
    } else {
      b.points += 1;
      match.winnerId = bId;
    }
  }

  a.inMatch = false;
  b.inMatch = false;
  io.to(aId).emit('tournament-round-result', { winner: match.winnerId ? t.players.get(match.winnerId).name : 'UNENTSCHIEDEN' });
  io.to(bId).emit('tournament-round-result', { winner: match.winnerId ? t.players.get(match.winnerId).name : 'UNENTSCHIEDEN' });

  const remaining = t.liveMatches.filter(m => !m.done);
  t.liveMatches = remaining;
  if (!remaining.length) {
    t.phase = 'lobby';
    const ordered = sortLeaderboard(t);
    t.players.forEach(p => { p.inMatch = false; });
    io.to(t.code).emit('tournament-state', {
      code: t.code,
      phase: 'lobby',
      hostName: t.hostName,
      targetWins: t.targetWins,
      maxPlayers: t.maxPlayers,
      players: ordered.map(p => ({ name: p.name, points: p.points, inMatch: false })),
      liveMatches: []
    });
    io.to(t.hostId).emit('tournament-live-matches', []);
  } else {
    io.to(t.hostId).emit('tournament-live-matches', t.liveMatches.map(m => ({ id: m.id, players: m.players.map(pid => t.players.get(pid)?.name || '—') })));
  }
}

function handleTournamentMatchChoice(t, matchId, socketId, choice) {
  const tObj = tournaments.get(socketId && socketId.includes ? null : null);
  const tournament = tournaments.get(tId); // placeholder
}

io.on('connection', socket => {
  socket.data = socket.data || {};

  socket.on('list-public-rooms', cb => {
    try { cb(roomList()); } catch (e) {}
  });

  socket.on('create-room', ({ name, targetWins, isPublic }, cb) => {
    const safeName = String(name || '').trim().slice(0, 20);
    if (!safeName) return cb && cb({ error: 'Bitte gib zuerst deinen Namen ein.' });
    const code = makeCode();
    const room = {
      code,
      phase: 'ready',
      targetWins: Math.min(10, Math.max(1, parseInt(targetWins, 10) || 3)),
      players: [
        { id: socket.id, name: safeName, ready: false, choice: null, score: 0 },
        null
      ],
      spectators: new Set(),
      isPublic: !!isPublic,
      countdownTimer: null,
      finishTimer: null,
      message: ''
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.room = code;
    socket.data.role = 0;
    broadcastRoomState(room);
    cb && cb({ code, role: 'player', targetWins: room.targetWins });
  });

  socket.on('join-room', ({ name, code }, cb) => {
    const safeName = String(name || '').trim().slice(0, 20);
    const roomCode = String(code || '').toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) return cb && cb({ error: 'Raum nicht gefunden.' });
    if (!safeName) return cb && cb({ error: 'Bitte gib zuerst deinen Namen ein.' });
    const openIndex = room.players[0] ? (room.players[1] ? -1 : 1) : 0;
    if (openIndex === -1) return cb && cb({ error: 'Raum ist voll.' });
    room.players[openIndex] = { id: socket.id, name: safeName, ready: false, choice: null, score: 0 };
    socket.join(room.code);
    socket.data.room = room.code;
    socket.data.role = openIndex;
    broadcastRoomState(room);
    cb && cb({ code: room.code, role: 'player', targetWins: room.targetWins });
  });

  socket.on('watch-room', ({ code, name }, cb) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) return cb && cb({ error: 'Raum nicht gefunden.' });
    room.spectators.add(socket.id);
    socket.join(room.code);
    socket.data.room = room.code;
    socket.data.role = 'spectator';
    broadcastRoomState(room);
    cb && cb({ code: room.code, role: 'spectator' });
  });

  socket.on('choose', choice => {
    if (!choice || !choices.has(choice)) return;

    if (socket.data.tournament && socket.data.matchId) {
      const t = tournaments.get(socket.data.tournament);
      if (!t) return;
      const match = (t.liveMatches || []).find(m => m.id === socket.data.matchId);
      if (!match || match.done || match.ready[socket.id] || match.phase !== 'ready') return;
      match.choice[socket.id] = choice;
      io.to(t.code).emit('tournament-state', tournamentState(t));
      return;
    }

    const room = rooms.get(socket.data.room);
    const idx = socket.data.role;
    if (!room || !Number.isInteger(idx)) return;
    const player = room.players[idx];
    if (!player || player.ready || room.phase === 'playing' || room.countdownTimer) return;
    player.choice = choice;
    broadcastRoomState(room);
  });

  socket.on('ready', () => {
    if (socket.data.tournament && socket.data.matchId) {
      const t = tournaments.get(socket.data.tournament);
      if (!t) return;
      const match = (t.liveMatches || []).find(m => m.id === socket.data.matchId);
      if (!match || match.done || match.ready[socket.id]) return;
      if (!match.choice[socket.id]) return socket.emit('status', { error: 'Wähle zuerst Stein, Papier oder Schere.' });
      match.ready[socket.id] = true;
      const bothReady = match.players.every(pid => !!match.ready[pid]);
      if (bothReady) {
        match.phase = 'countdown';
        let sec = 3;
        io.to(match.players[0]).emit('countdown', { seconds: sec });
        io.to(match.players[1]).emit('countdown', { seconds: sec });

        const timer = setInterval(() => {
          sec--;
          if (sec > 0) {
            io.to(match.players[0]).emit('countdown', { seconds: sec });
            io.to(match.players[1]).emit('countdown', { seconds: sec });
            return;
          }
          clearInterval(timer);
          match.phase = 'playing';
          const aId = match.players[0];
          const bId = match.players[1];
          const aChoice = match.choice[aId];
          const bChoice = match.choice[bId];
          if (!aChoice || !bChoice) {
            io.to(match.players[0]).emit('round-result', { choices: [{ label: '—' }, { label: '—' }], draw: true, winner: '—' });
            io.to(match.players[1]).emit('round-result', { choices: [{ label: '—' }, { label: '—' }], draw: true, winner: '—' });
            finishTournamentMatch(t, match);
            return;
          }
          const result = evaluateRound(aChoice, bChoice);
          const draw = result === 'draw';
          let winnerName = null;
          if (!draw) {
            if (result === 'a') {
              t.players.get(aId).points += 1;
              winnerName = t.players.get(aId).name;
            } else {
              t.players.get(bId).points += 1;
              winnerName = t.players.get(bId).name;
            }
          }
          io.to(aId).emit('tournament-round-result', { winner: winnerName || 'UNENTSCHIEDEN' });
          io.to(bId).emit('tournament-round-result', { winner: winnerName || 'UNENTSCHIEDEN' });
          finishTournamentMatch(t, match);
        }, 1000);
      }
      return;
    }

    const room = rooms.get(socket.data.room);
    const idx = socket.data.role;
    if (!room || !Number.isInteger(idx)) return;
    const player = room.players[idx];
    if (!player) return;
    if (!player.choice) return socket.emit('status', { error: 'Wähle zuerst Stein, Papier oder Schere.' });

    player.ready = true;
    broadcastRoomState(room);

    const bothReady = room.players.filter(Boolean).length === 2 && room.players.every(p => p && p.ready);
    if (bothReady) startRoomCountdown(room, 3);
  });

  socket.on('leave-room', () => {
    const room = rooms.get(socket.data.room);
    if (!room) return;
    if (Number.isInteger(socket.data.role)) {
      const idx = socket.data.role;
      if (room.players[idx] && room.players[idx].id === socket.id) room.players[idx] = null;
    }
    socket.leave(room.code);
    socket.data.room = null;
    socket.data.role = null;
    if (!room.players.some(Boolean)) {
      rooms.delete(room.code);
      io.to(room.code).emit('room-closed');
      return;
    }
    broadcastRoomState(room);
  });

  socket.on('disconnect', () => {
    if (socket.data.room) {
      const room = rooms.get(socket.data.room);
      if (room) {
        if (Number.isInteger(socket.data.role)) {
          const idx = socket.data.role;
          if (room.players[idx] && room.players[idx].id === socket.id) room.players[idx] = null;
        }
        if (room.countdownTimer) {
          clearInterval(room.countdownTimer);
          room.countdownTimer = null;
          room.phase = 'ready';
          io.to(room.code).emit('countdown', { seconds: 0 });
          io.to(room.code).emit('round-reset');
        }
        if (!room.players.some(Boolean)) {
          rooms.delete(room.code);
          io.to(room.code).emit('room-closed');
        } else broadcastRoomState(room);
      }
    }

    if (socket.data.tournament) {
      const t = tournaments.get(socket.data.tournament);
      if (t) {
        t.players.delete(socket.id);
        if (socket.id === t.hostId) {
          io.to(t.code).emit('tournament-ended', { players: sortLeaderboard(t), winner: t.hostName });
          tournaments.delete(t.code);
          io.emit('public-tournaments', tournamentList());
        } else {
          io.to(t.code).emit('tournament-state', tournamentState(t));
          io.emit('public-tournaments', tournamentList());
        }
      }
    }
  });

  socket.on('list-public-tournaments', cb => {
    try { cb(tournamentList()); } catch (e) {}
  });

  socket.on('create-tournament', ({ name, targetWins, maxPlayers, isPublic }, cb) => {
    const safeName = String(name || '').trim().slice(0, 20);
    if (!safeName) return cb && cb({ error: 'Bitte gib zuerst deinen Namen ein.' });
    const max = Math.min(60, Math.max(4, Number(maxPlayers) || 8));
    const even = max % 2 === 0 ? max : max + 1;
    const code = makeCode();
    const t = {
      code,
      hostId: socket.id,
      hostName: safeName,
      targetWins: Math.min(10, Math.max(1, parseInt(targetWins, 10) || 3)),
      maxPlayers: Math.min(60, Math.max(4, even)),
      isPublic: !!isPublic,
      phase: 'lobby',
      players: new Map(),
      liveMatches: [],
      finished: false
    };
    t.players.set(socket.id, { id: socket.id, name: safeName, points: 0, inMatch: false });
    tournaments.set(code, t);
    socket.join(code);
    socket.data.tournament = code;
    socket.data.role = 'host';
    io.emit('public-tournaments', tournamentList());
    cb && cb({ code, role: 'host' });
  });

  socket.on('join-tournament', ({ name, code }, cb) => {
    const safeName = String(name || '').trim().slice(0, 20);
    if (!safeName) return cb && cb({ error: 'Bitte gib zuerst deinen Namen ein.' });
    const t = tournaments.get(String(code || '').toUpperCase());
    if (!t) return cb && cb({ error: 'Turnier nicht gefunden.' });
    if (t.phase !== 'lobby') return cb && cb({ error: 'Dieses Turnier läuft bereits.' });
    if (t.players.size >= t.maxPlayers) return cb && cb({ error: 'Turnier ist voll.' });
    t.players.set(socket.id, { id: socket.id, name: safeName, points: 0, inMatch: false });
    socket.join(t.code);
    socket.data.tournament = t.code;
    socket.data.role = 'player';
    io.to(t.code).emit('tournament-state', tournamentState(t));
    io.emit('public-tournaments', tournamentList());
    cb && cb({ code: t.code, role: 'player' });
  });

  socket.on('leave-tournament', () => {
    const code = socket.data.tournament;
    if (!code) return;
    const t = tournaments.get(code);
    if (!t) return;
    const isHost = socket.id === t.hostId;
    t.players.delete(socket.id);
    socket.leave(code);
    socket.data.tournament = null;
    socket.data.role = null;
    if (isHost) {
      io.to(code).emit('tournament-ended', { players: sortLeaderboard(t), winner: t.hostName });
      tournaments.delete(code);
      io.emit('public-tournaments', tournamentList());
      return;
    }
    io.to(code).emit('tournament-state', tournamentState(t));
    io.emit('public-tournaments', tournamentList());
  });

  socket.on('start-tournament', () => {
    const code = socket.data.tournament;
    const t = tournaments.get(code);
    if (!t) return;
    if (socket.id !== t.hostId) return;
    if (t.phase === 'running') return;
    if (t.players.size < 2) return;
    if (t.players.size % 2 !== 0) {
      const next = [...t.players.keys()][Math.floor(Math.random() * t.players.size)];
      const target = t.players.get(next);
      if (target) target.points += 1;
    }
    startTournamentRound(t);
  });

  socket.on('tournament-match-join', (matchId) => {
    const t = tournaments.get(socket.data.tournament);
    if (!t) return;
    const match = (t.liveMatches || []).find(m => m.id === matchId);
    if (!match) return;
    socket.data.matchId = matchId;
    if (match.players.includes(socket.id)) {
      io.to(socket.id).emit('tournament-match', {
        code: t.code,
        matchId: match.id,
        targetWins: t.targetWins,
        players: match.players.map(pid => t.players.get(pid)?.name || '—'),
        role: 'player'
      });
    }
  });

  socket.on('player-left-ensure', () => {
    // no-op compatibility for older client
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Listening on', PORT));
