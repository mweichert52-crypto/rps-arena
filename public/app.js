const socket = window.__rpsSocket || (window.__rpsSocket = io());
let role = null;
let selected = null;
let roomJoined = false;
let localCountdownTimer = null;

const $ = id => document.getElementById(id);

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = $(id);
  if (target) target.classList.add('active');
  if (id === 'play' || id === 'watch') requestLobbies();
}

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-screen]');
  if (!btn) return;
  const target = btn.dataset.screen;
  if (target) show(target);
});

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

function requestLobbies() {
  try {
    socket.emit('list-public-rooms', rooms => {
      renderLobbies('player', rooms);
      renderLobbies('watch', rooms);
    });
  } catch (e) {}
}

function lobbyMarkup(kind) {
  const id = kind === 'player' ? 'play-lobbies' : 'watch-lobbies';
  const box = $(id);
  if (!box) return;
  box.className = 'lobby-browser';
  if (!box.querySelector('.lobby-list')) box.innerHTML = '<div class="lobby-list"><p class="muted">Suche Lobbies...</p></div>';
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
    const hostName = r.hostName || 'Spieler';
    return `
      <div class="lobby-card">
        <div class="title-row">
          <strong>${r.code}</strong>
          <small>${r.players || 0}/2</small>
        </div>
        <div class="meta">${hostName}</div>
        <button class="btn tiny" data-join="${r.code}" data-kind="${kind}">Beitreten</button>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-join]').forEach(button => {
    button.onclick = () => {
      const code = button.dataset.join;
      const type = button.dataset.kind;
      const name = (type === 'player' ? ($('player-name')?.value || '') : ($('watch-name')?.value || '')).trim();
      if (!name) return alert('Bitte gib zuerst deinen Namen ein.');
      if (type === 'player') socket.emit('join-room', { name, code }, d => enter(d, 'play-error'));
      else socket.emit('watch-room', { code, name }, d => enter(d, 'watch-error'));
    };
  });
}

function resetGameUi() {
  selected = null;
  roomJoined = false;
  if ($('winner')) $('winner').innerHTML = '';
  if ($('result')) $('result').innerHTML = '';
  if ($('status')) $('status').textContent = '';
  document.querySelectorAll('[data-choice]').forEach(x => { x.classList.remove('selected'); x.disabled = false; });
  document.querySelectorAll('[data-ready-dot]').forEach(d => d.classList.remove('ready'));
  if ($('countdown')) $('countdown').textContent = '';
  if (localCountdownTimer) {
    clearInterval(localCountdownTimer);
    localCountdownTimer = null;
  }
}

function enter(data, errorId) {
  if (!data) return;
  if (data.error) {
    if (errorId) $(errorId).textContent = data.error;
    else alert(data.error);
    return;
  }
  role = data.role;
  roomJoined = true;
  if ($('room-code')) $('room-code').textContent = data.code;
  if (data.targetWins && $('match-rule')) $('match-rule').textContent = `Ziel: ${data.targetWins} Siege`;

  if (role !== 'player') {
    document.querySelectorAll('.choices, #ready-btn').forEach(el => el.style.display = 'none');
    if ($('status')) $('status').textContent = 'Zuschauer-Modus — Du siehst das Match.';
  } else {
    document.querySelectorAll('.choices, #ready-btn').forEach(el => el.style.display = '');
    if ($('status')) $('status').textContent = '';
  }
  show('game');
}

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
    const copyBtn = $('copy');
    if (!copyBtn) return;
    copyBtn.textContent = 'KOPIERT ✓';
    setTimeout(() => copyBtn.textContent = 'CODE KOPIEREN', 1400);
  });

  document.querySelectorAll('[data-choice]').forEach(button => {
    button.onclick = () => {
      if (role !== 'player') return;
      if (button.disabled) return;
      document.querySelectorAll('[data-choice]').forEach(x => x.classList.remove('selected'));
      button.classList.add('selected');
      selected = button.dataset.choice;
      socket.emit('choose', selected);
    };
  });

  $('ready-btn')?.addEventListener('click', () => {
    if (!selected) {
      if ($('status')) $('status').textContent = 'Wähle zuerst Stein, Papier oder Schere.';
      return;
    }
    socket.emit('ready');
    document.querySelectorAll('[data-choice]').forEach(x => x.disabled = true);
    if ($('ready-btn')) $('ready-btn').disabled = true;
  });
}

socket.on('connect', requestLobbies);
socket.on('public-lobbies', rooms => {
  renderLobbies('player', rooms);
  renderLobbies('watch', rooms);
});

socket.on('state', s => {
  if (!$('game')?.classList.contains('active')) return;
  (s.players || []).forEach((p, i) => {
    if ($('name-' + i)) $('name-' + i).textContent = p?.name || 'Wartet…';
    if ($('score-' + i)) $('score-' + i).textContent = p?.score || 0;
    const dot = document.querySelector(`[data-ready-dot="${i}"]`) || $('ready-' + i);
    if (dot) {
      if (p?.ready) dot.classList.add('ready');
      else dot.classList.remove('ready');
    }
  });

  const bothReady = (s.players || []).filter(Boolean).length === 2 && (s.players || []).every(p => p?.ready);
  if (role === 'player') {
    if (bothReady) {
      if ($('ready-btn')) $('ready-btn').disabled = true;
      document.querySelectorAll('[data-choice]').forEach(x => x.disabled = true);
    } else if ($('ready-btn')) {
      $('ready-btn').disabled = false;
    }
  }
});

socket.on('countdown', d => {
  if (!$('game')?.classList.contains('active')) return;
  if (localCountdownTimer) {
    clearInterval(localCountdownTimer);
    localCountdownTimer = null;
  }
  const sec = Number(d.seconds);
  if (!Number.isFinite(sec)) return;
  const el = $('countdown');
  if (el) el.textContent = sec > 0 ? sec : '';
  if (sec > 0) {
    if ($('ready-btn')) $('ready-btn').disabled = true;
    document.querySelectorAll('[data-choice]').forEach(x => x.disabled = true);
  }
});

socket.on('round-result', d => {
  if ($('countdown')) $('countdown').textContent = '';
  if ($('result')) {
    const [one, two] = d.choices || [];
    const winnerText = d.draw ? 'UNENTSCHIEDEN' : (d.winner || '—');
    $('result').innerHTML = `
      <div class="result-card">
        <div class="result-winner">${winnerText}</div>
        <div class="result-choices">
          <span>${one?.label || '—'}</span>
          <span>${two?.label || '—'}</span>
        </div>
      </div>
    `;
  }
});

socket.on('round-reset', () => {
  selected = null;
  if ($('ready-btn')) $('ready-btn').disabled = false;
  if ($('result')) $('result').innerHTML = '';
  document.querySelectorAll('[data-choice]').forEach(x => { x.disabled = false; x.classList.remove('selected'); });
  document.querySelectorAll('[data-ready-dot]').forEach(d => d.classList.remove('ready'));
  if ($('countdown')) $('countdown').textContent = '';
});

socket.on('match-finished', d => {
  if ($('winner')) {
    $('winner').innerHTML = `<small>🏆 MATCH GEWONNEN 🏆</small><strong>${d.winner}</strong><span class="finish-countdown" id="finish-countdown">${d.seconds}</span>`;
  }
});

socket.on('match-countdown', d => {
  const el = $('finish-countdown');
  if (el) el.textContent = d.seconds;
});

socket.on('room-closed', () => {
  resetGameUi();
  role = null;
  show('home');
});

socket.on('disconnect', () => {
  if ($('game')?.classList.contains('active') && !$('winner')?.classList.contains('show')) {
    $('status').textContent = 'Verbindung verloren.';
  }
});

initThemeButtons();
initFormBindings();
window.addEventListener('beforeunload', () => {
  try { if (roomJoined) socket.emit('leave-room'); } catch (e) {}
});
