const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
const rooms = new Map();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const choices = new Set(['rock', 'paper', 'scissors']);
const cleanName = (name) => String(name || '').trim().slice(0, 20);
const makeCode = () => {
  let code;
  do code = crypto.randomBytes(3).toString('hex').toUpperCase(); while (rooms.has(code));
  return code;
};
const publicRoom = (room, message = '') => ({
  code: room.code,
  phase: room.phase,
  message,
  players: room.players.map((p) => p ? { name: p.name, ready: p.ready, score: p.score } : null),
  spectatorCount: room.spectators.size,
  countdown: room.countdown
});
const broadcastState = (room, message = '') => io.to(room.code).emit('state', publicRoom(room, message));
const getRole = (room, socketId) => room.players.findIndex((p) => p && p.id === socketId);

function finishRound(room) {
  const [a, b] = room.players;
  if (!a || !b || !a.choice || !b.choice) return;
  const winner = a.choice === b.choice ? 'draw' :
    ((a.choice === 'rock' && b.choice === 'scissors') ||
     (a.choice === 'scissors' && b.choice === 'paper') ||
     (a.choice === 'paper' && b.choice === 'rock') ? 'playerOne' : 'playerTwo');
  if (winner === 'playerOne') a.score++;
  if (winner === 'playerTwo') b.score++;
  room.phase = 'result';
  io.to(room.code).emit('round-result', {
    choices: [a.choice, b.choice], winner,
    scores: [a.score, b.score], draw: winner === 'draw'
  });
  if (a.score >= 3 || b.score >= 3) {
    room.phase = 'finished';
    const matchWinner = a.score >= 3 ? a.name : b.name;
    io.to(room.code).emit('match-finished', { winner: matchWinner });
    room.finishTimer = setTimeout(() => {
      room.players.forEach((player) => player && io.sockets.sockets.get(player.id)?.disconnect(true));
      room.players = [null, null];
      room.spectators.forEach((id) => io.to(id).emit('state', publicRoom(room, 'Die Arena ist bereit für neue Spieler.')));
      room.phase = 'waiting'; room.countdown = null; room.finishTimer = null;
      broadcastState(room);
      if (!room.spectators.size) rooms.delete(room.code);
    }, 10000);
    return;
  }
  setTimeout(() => {
    if (!rooms.has(room.code) || room.phase === 'finished') return;
    a.choice = b.choice = null; a.ready = b.ready = false; room.phase = 'playing';
    io.to(room.code).emit('round-reset'); broadcastState(room);
  }, 2200);
}

io.on('connection', (socket) => {
  socket.on('create-room', ({ name }, ack) => {
    name = cleanName(name); if (!name) return ack({ error: 'Bitte gib einen Namen ein.' });
    const room = { code: makeCode(), players: [{ id: socket.id, name, choice: null, ready: false, score: 0 }, null], spectators: new Set(), phase: 'waiting', countdown: null, finishTimer: null };
    rooms.set(room.code, room); socket.join(room.code); socket.data.room = room.code; socket.data.role = 0;
    ack({ ok: true, code: room.code, role: 'player' }); broadcastState(room, 'Warte auf den zweiten Spieler.');
  });
  socket.on('join-room', ({ code, name }, ack) => {
    name = cleanName(name); code = String(code || '').trim().toUpperCase(); const room = rooms.get(code);
    if (!name) return ack({ error: 'Bitte gib einen Namen ein.' });
    if (!room) return ack({ error: 'Raum nicht gefunden.' });
    if (room.phase === 'finished' || room.players[0] && room.players[1]) return ack({ error: 'Dieser Raum ist bereits voll.' });
    const slot = room.players[0] ? 1 : 0; room.players[slot] = { id: socket.id, name, choice: null, ready: false, score: 0 };
    socket.join(code); socket.data.room = code; socket.data.role = slot; ack({ ok: true, code, role: 'player' });
    room.phase = 'playing'; broadcastState(room, 'Beide Spieler sind bereit.');
  });
  socket.on('watch-room', ({ code }, ack) => {
    code = String(code || '').trim().toUpperCase(); const room = rooms.get(code);
    if (!room) return ack({ error: 'Raum nicht gefunden.' });
    room.spectators.add(socket.id); socket.join(code); socket.data.room = code; socket.data.role = 'spectator'; ack({ ok: true, code, role: 'spectator' });
    socket.emit('spectator-state', publicRoom(room, 'Du schaust anonym zu.')); broadcastState(room);
  });
  socket.on('choose', (choice) => {
    const room = rooms.get(socket.data.room); const role = socket.data.role;
    if (!room || !Number.isInteger(role) || !choices.has(choice) || room.phase !== 'playing') return;
    const player = room.players[role]; if (!player || player.ready) return;
    player.choice = choice; broadcastState(room);
  });
  socket.on('ready', () => {
    const room = rooms.get(socket.data.room); const role = socket.data.role;
    if (!room || !Number.isInteger(role) || room.phase !== 'playing') return;
    const player = room.players[role]; if (!player || !player.choice || player.ready) return;
    player.ready = true; broadcastState(room);
    if (room.players.every((p) => p && p.ready)) {
      room.phase = 'countdown'; room.countdown = 3; io.to(room.code).emit('countdown', { seconds: 3 }); broadcastState(room);
      let left = 3; const timer = setInterval(() => { left--; room.countdown = left; if (left > 0) io.to(room.code).emit('countdown', { seconds: left }); else { clearInterval(timer); room.countdown = null; finishRound(room); } }, 1000);
    }
  });
  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.room); if (!room) return;
    room.spectators.delete(socket.id); const role = socket.data.role;
    if (Number.isInteger(role) && room.players[role]?.id === socket.id) { room.players[role] = null; room.phase = 'waiting'; room.players.forEach((p) => { if (p) { p.choice = null; p.ready = false; p.score = 0; } }); broadcastState(room, 'Ein Spieler hat den Raum verlassen.'); }
    if (!room.players.some(Boolean) && !room.spectators.size) rooms.delete(room.code);
  });
});

server.listen(PORT, () => console.log(`RPS Arena läuft auf Port ${PORT}`));
