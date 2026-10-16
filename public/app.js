// Main frontend app glue for RPS Arena
// Rewritten to ensure back buttons, theme buttons, and play/watch flows work reliably.
const socket = window.__rpsSocket || (window.__rpsSocket = io());
let role = null;
let selected = null;
let roomJoined = false;
const $ = id => document.getElementById(id);

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = $(id);
  if (el) el.classList.add('active');
  // If entering play or watch we want the lobby list refreshed
  if (id === 'play' || id === 'watch') requestLobbies();
}

// delegate clicks for any element with data-screen (back buttons and menu buttons)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-screen]');
  if (!btn) return;
  const target = btn.dataset.screen;
  if (target) show(target);
});

// theme buttons (color selection) - work even if added later
function initThemeButtons() {
  const saved = localStorage.getItem('rps-theme') || 'void';
  document.body.dataset.theme = saved;
  document.querySelectorAll('.theme-option').forEach(button => {
    button.classList.toggle('active', button.dataset.theme === saved);
    button.onclick = () => {
      const theme = button.dataset.theme;
      document.body.dataset.theme = theme;
      localStorage.setItem('rps-theme', theme);
      document.querySelectorAll('.theme-option').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
    };
  });
}

// Lobby rendering helpers (player/watch)
function lobbyMarkup(kind) {
  const id = kind === 'player' ? 'play-lobbies' : 'watch-lobbies';
  const box = $(id);
  if (!box) return;
  box.className = 'lobby-browser';
  if (!box.querySelector('.lobby-list')) box.innerHTML = `<div class="lobby-list"><p class="muted">Suche Lobbies...</p></div>`;
}

function renderLobbies(kind, rooms = []) {
  lobbyMarkup(kind);
  const box = $(kind === 'player' ? 'play-lobbies' : 'watch-lobbies');
  if (!box) return;
  const list = box.querySelector('.lobby-list');
  const available = rooms.filter(r => r.players < 2 || r.spectatorCount >= 0);
  if (!available.length) {
    list.innerHTML = '<p class="muted">Keine offenen Lobbies.</p>';
    return;
  }
  list.innerHTML = available.map(r => `<div class="lobby"><strong>${r.code}</strong><small>${r.players.length} Spieler</small><div class="actions"><button class="btn" data-join="${r.code}" data-kind="${kind}">${kind==='player'?'Beitreten':'Zuschauen'}</button></div></div>`).join('');
  list.querySelectorAll('[data-join]').forEach(b => b.onclick = () => {
    const code = b.dataset.join;
    const kind = b.dataset.kind;
    const name = kind === 'player' ? ($('player-name')?.value || '').trim() : ($('watch-name')?.value || '').trim();
    if (!name) return alert('Bitte gib zuerst deinen Namen ein.');
    if (kind === 'player') socket.emit('join-room', { name, code }, d => enter(d, 'play-error'));
    else socket.emit('watch-room', { code, name }, d => enter(d, 'watch-error'));
  });
}

function requestLobbies() {
  try { socket.emit('list-public-rooms', rooms => { renderLobbies('player', rooms); renderLobbies('watch', rooms); }); } catch (e) {}
}

function resetGameUi() {
  selected = null;
  roomJoined = false;
  document.body.classList.remove('winner-overlay-open');
  $('winner')?.classList.remove('show');
  if ($('winner')) $('winner').innerHTML = '';
  if ($('result')) $('result').innerHTML = '';
  if ($('status')) $('status').textContent = '';
  // reset choices UI
  document.querySelectorAll('[data-choice]').forEach(x => x.classList.remove('selected'));
}

function leaveToHome() {
  if (socket.connected && roomJoined) socket.emit('leave-room');
  resetGameUi();
  role = null;
  show('home');
}

function enter(data, errorId) {
  if (!data) return;
  if (data.error) { if (errorId) $(errorId).textContent = data.error; else alert(data.error); return; }
  role = data.role;
  roomJoined = true;
  if ($('room-code')) $('room-code').textContent = data.code;
  if (data.targetWins && $('match-rule')) $('match-rule').textContent = `Ziel: ${data.targetWins} Siege`;
  show('game');
}

// Bind form buttons
function initFormBindings() {
  $('create')?.addEventListener('click', () => {
    const name = $('player-name')?.value || '';
    const targetWins = $('target-wins')?.value || 3;
    const isPublic = $('lobby-public') ? !!$('lobby-public').checked : true;
    socket.emit('create-room', { name, targetWins, isPublic }, d => enter(d, 'play-error'));
  });

  $('join')?.addEventListener('click', () => {
    const name = $('player-name')?.value || '';
    const code = $('join-code')?.value || '';
    socket.emit('join-room', { name, code }, d => enter(d, 'play-error'));
  });

  $('watch-btn')?.addEventListener('click', () => {
    const name = $('watch-name')?.value?.trim();
    const code = $('watch-code')?.value?.trim();
    if (!name) return $('watch-error').textContent = 'Bitte gib zuerst deinen Namen ein.';
    if (!code) return $('watch-error').textContent = 'Bitte gib einen Raumcode ein.';
    socket.emit('watch-room', { code, name }, d => enter(d, 'watch-error'));
  });

  $('copy')?.addEventListener('click', () => {
    navigator.clipboard?.writeText($('room-code')?.textContent || '');
    const t = $('copy'); if (!t) return; t.textContent = 'KOPIERT ✓'; setTimeout(() => t.textContent = 'CODE KOPIEREN', 1400);
  });

  document.querySelectorAll('[data-choice]').forEach(b => b.onclick = () => {
    if (role !== 'player') return;
    selected = b.dataset.choice;
    socket.emit('choose', selected);
    document.querySelectorAll('[data-choice]').forEach(x => x.classList.toggle('selected', x === b));
  });

  $('ready-btn')?.addEventListener('click', () => {
    if (!selected) { if ($('status')) $('status').textContent = 'Wähle zuerst Stein, Papier oder Schere.'; return; }
    socket.emit('ready');
  });
}

// Socket events
socket.on('connect', requestLobbies);
socket.on('public-lobbies', rooms => { renderLobbies('player', rooms); renderLobbies('watch', rooms); });

socket.on('state', s => {
  if (!$('game')?.classList.contains('active')) return;
  s.players.forEach((p, i) => {
    $('name-' + i) && ($('name-' + i).textContent = p?.name || 'Wartet…');
    $('score-' + i) && ($('score-' + i).textContent = p?.score || 0);
    $('ready-' + i) && ($('ready-' + i).textContent = p?.ready ? 'Bereit' : '');
  });
});

socket.on('countdown', d => { $('countdown') && ($('countdown').textContent = d.seconds); $('ready-btn') && ($('ready-btn').disabled = true); document.querySelectorAll('[data-choice]').forEach(x => x.disabled = true); });

socket.on('round-result', d => {
  if ($('result')) $('result').innerHTML = `<div class="result-card"><div class="result-winner">${d.winner || '—'}</div><div class="result-score">${d.score?.[0]||0} : ${d.score?.[1]||0}</div></div>`;
  setTimeout(() => { resetGameUi(); }, 1500);
});

// initialize
initThemeButtons();
initFormBindings();

// ensure back buttons added in dynamic screens also work (they use data-screen attribute so delegation above handles it)

