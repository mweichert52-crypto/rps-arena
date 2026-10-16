// Main frontend app glue for RPS Arena
// Reworked handling for joining lobbies, ready flow, spectator UI and countdown stabilization.
const socket = window.__rpsSocket || (window.__rpsSocket = io());
let role = null;
let selected = null;
let roomJoined = false;
const $ = id => document.getElementById(id);

let __localCountdownTimer = null; // fallback countdown when server doesn't reliably send countdown

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

// theme buttons (color selection)
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
  const available = (rooms || []).filter(Boolean);
  if (!available.length) {
    list.innerHTML = '<p class="muted">Keine offenen Lobbies.</p>';
    return;
  }
  list.innerHTML = available.map(r => {
    const playerCount = (r.players && Array.isArray(r.players)) ? r.players.filter(Boolean).length : (r.players || 0);
    const hostName = (r.players && Array.isArray(r.players) && r.players.find(p => p && p.name) && r.players.find(p => p.name).name) || r.hostName || 'Wartet…';
    return `<div class="lobby"><strong>${r.code}</strong><small>${playerCount} Spieler</small><div class="meta">${hostName}</div><div class="actions"><button class="btn" data-join="${r.code}" data[...]`;
  }).join('');

  list.querySelectorAll('[data-join]').forEach(b => b.onclick = () => {
    const code = b.dataset.join;
    const kind = b.dataset.kind;
    const name = (kind === 'player' ? ($('player-name')?.value || '') : ($('watch-name')?.value || '')).trim();
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
  document.querySelectorAll('[data-choice]').forEach(x => { x.classList.remove('selected'); x.disabled = false; });
  // reset ready indicators
  document.querySelectorAll('[data-ready-dot]').forEach(d => d.classList.remove('ready'));
  // clear local countdown fallback
  if (__localCountdownTimer) { clearInterval(__localCountdownTimer); __localCountdownTimer = null; }
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
  // If spectator, hide choices and ready button
  if (role !== 'player') {
    document.querySelectorAll('.choices, #ready-btn').forEach(el => { if (el) el.style.display = 'none'; });
    if ($('status')) $('status').textContent = 'Zuschauer-Modus — Du siehst das Match.';
  } else {
    document.querySelectorAll('.choices, #ready-btn').forEach(el => { if (el) el.style.display = ''; });
    if ($('status')) $('status').textContent = '';
  }
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
    if (b.disabled) return; // locked because ready
    document.querySelectorAll('[data-choice]').forEach(x => x.classList.remove('selected'));
    b.classList.add('selected');
    selected = b.dataset.choice;
    socket.emit('choose', selected);
  });

  $('ready-btn')?.addEventListener('click', () => {
    if (!selected) { if ($('status')) $('status').textContent = 'Wähle zuerst Stein, Papier oder Schere.'; return; }
    socket.emit('ready');
    // lock choices locally until round-reset
    document.querySelectorAll('[data-choice]').forEach(x => x.disabled = true);
    // disable ready to avoid double-click
    if ($('ready-btn')) $('ready-btn').disabled = true;
  });
}

// Socket events
socket.on('connect', requestLobbies);
socket.on('public-lobbies', rooms => { renderLobbies('player', rooms); renderLobbies('watch', rooms); });

socket.on('state', s => {
  if (!$('game')?.classList.contains('active')) return;
  (s.players || []).forEach((p, i) => {
    if ($('name-' + i)) $('name-' + i).textContent = p?.name || 'Wartet…';
    if ($('score-' + i)) $('score-' + i).textContent = p?.score || 0;
    // ready indicator dot should be toggled
    const dot = document.querySelector(`[data-ready-dot="${i}"]`) || $('ready-' + i);
    if (dot) {
      if (p?.ready) dot.classList.add('ready');
      else dot.classList.remove('ready');
    }
  });

  // If both players are ready, ensure the ready button is disabled for players
  const bothReady = (s.players || []).filter(Boolean).length === 2 && (s.players || []).every(p => p?.ready);
  if (role === 'player') {
    if (bothReady) {
      if ($('ready-btn')) $('ready-btn').disabled = true;
      document.querySelectorAll('[data-choice]').forEach(x => x.disabled = true);

      // start a local fallback countdown if server doesn't provide one quickly
      const el = $('countdown');
      if (el && !el.textContent && !__localCountdownTimer) {
        let sec = 3;
        el.textContent = sec;
        if ($('ready-btn')) $('ready-btn').disabled = true;
        document.querySelectorAll('[data-choice]').forEach(x => x.disabled = true);
        __localCountdownTimer = setInterval(() => {
          sec--;
          if (sec > 0) {
            el.textContent = sec;
            return;
          }
          // stop local countdown at 0 and clear — real round-result should come from server
          clearInterval(__localCountdownTimer);
          __localCountdownTimer = null;
          el.textContent = '';
        }, 1000);
      }
    }
  }
});

socket.on('countdown', d => {
  if (!$('game')?.classList.contains('active')) return;
  // if server sends countdown, cancel any local fallback immediately to avoid conflict
  if (__localCountdownTimer) { clearInterval(__localCountdownTimer); __localCountdownTimer = null; }
  const sec = Number(d.seconds);
  if (!Number.isFinite(sec)) return;
  const el = $('countdown');
  if (el) el.textContent = sec > 0 ? sec : '';
  // disable ready while countdown running
  if (sec > 0) {
    if ($('ready-btn')) $('ready-btn').disabled = true;
    document.querySelectorAll('[data-choice]').forEach(x => x.disabled = true);
  } else {
    // countdown finished - allow state to control re-enabling
    // keep disabled until round-reset arrives
  }
});

socket.on('round-result', d => {
  if ($('countdown')) $('countdown').textContent = '';
  // show both choices and winner for everyone (spectators included)
  if ($('result')) {
    const [one, two] = d.choices || [];
    const winnerText = d.draw ? 'UNENTSCHIEDEN' : (d.winner || '—');
    $('result').innerHTML = `<div class="result-card"><div class="result-winner">${winnerText}</div><div class="result-choices"><span>${one?.label||'—'}</span><span>${two?.label||'—'}</span></div></div>`;
  }
  // after showing result, wait for round-reset to re-enable interaction
});

socket.on('round-reset', () => {
  selected = null;
  if ($('ready-btn')) $('ready-btn').disabled = false;
  if ($('result')) $('result').innerHTML = '';
  document.querySelectorAll('[data-choice]').forEach(x => { x.disabled = false; x.classList.remove('selected'); });
  // clear ready indicators on UI
  document.querySelectorAll('[data-ready-dot]').forEach(d => d.classList.remove('ready'));
  // clear any local countdown
  if (__localCountdownTimer) { clearInterval(__localCountdownTimer); __localCountdownTimer = null; }
});

socket.on('match-finished', d => {
  if ($('winner')) $('winner').innerHTML = `<small>🏆 MATCH GEWONNEN 🏆</small><strong>${d.winner}</strong><span class="finish-countdown" id="finish-countdown">${d.seconds}</span>`;
});

socket.on('match-countdown', d => { const el = $('finish-countdown'); if (el) el.textContent = d.seconds; });

socket.on('room-closed', () => { resetGameUi(); role = null; show('home'); });

socket.on('disconnect', () => { if ($('game')?.classList.contains('active') && !$('winner')?.classList.contains('show')) $('status').textContent = 'Verbindung verloren.'; });

// initialize
initThemeButtons();
initFormBindings();

// beforeunload: try to tell server we left (best-effort)
window.addEventListener('beforeunload', () => { try { if (roomJoined) socket.emit('leave-room'); } catch (e) {} });
