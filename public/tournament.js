(() => {
  const socket = window.__rpsSocket || (window.__rpsSocket = io());
  const $ = id => document.getElementById(id);
  let code = null;
  let role = null;
  let inMatch = false;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const screen = id => {
    document.querySelectorAll('.screen').forEach(x => x.classList.remove('active'));
    $(id)?.classList.add('active');
  };

  function sizes() {
    const select = $('tournament-size');
    if (!select) return;
    if (!select.dataset.ready) {
      for (let n = 4; n <= 60; n += 2) {
        const option = new Option(`${n} Spieler`, String(n));
        select.add(option);
      }
      select.dataset.ready = '1';
    }
    if (!select.value) select.value = '8';
  }

  function ensureTournamentButton() {
    if ($('tournament-open')) return;
    const home = document.querySelector('#home .hero') || document.querySelector('#home');
    if (!home) return;
    const btn = document.createElement('button');
    btn.id = 'tournament-open';
    btn.className = 'tournament-home-btn';
    btn.type = 'button';
    btn.innerHTML = '<span>🏆</span><span>Turnier</span>';
    home.appendChild(btn);
    btn.addEventListener('click', () => {
      sizes();
      screen('tournament');
      refreshTournaments();
    });
  }

  function refreshTournaments() {
    socket.emit('list-public-tournaments', list => {
      const el = $('tournament-list');
      if (!el) return;
      if (!list || !list.length) {
        el.innerHTML = '<div class="empty-state">Keine offenen Turniere.</div>';
        return;
      }
      el.innerHTML = list.map(t => `
        <div class="tournament-card">
          <div class="title-row"><strong>${esc(t.code)}</strong><small>${t.players}/${t.maxPlayers}</small></div>
          <div class="meta">${esc(t.hostName)} · Ziel: ${t.targetWins}</div>
          <button class="btn tiny" data-tourney-join="${t.code}" type="button">Joinen</button>
        </div>
      `).join('');
      el.querySelectorAll('[data-tourney-join]').forEach(btn => {
        btn.onclick = () => {
          const name = $('tournament-name').value.trim();
          if (!name) return $('tournament-error').textContent = 'Bitte gib zuerst deinen Namen ein.';
          socket.emit('join-tournament', { name, code: btn.dataset.tourneyJoin }, d => {
            if (d?.error) return $('tournament-error').textContent = d.error;
            enterTournament(d, 'player');
          });
        };
      });
    });
  }

  function enterTournament(data, playerRole) {
    role = playerRole;
    code = data.code;
    inMatch = false;
    $('tournament-setup').hidden = true;
    $('tournament-lobby').hidden = false;
    $('tournament-match').hidden = true;
    screen('tournament');
    // request fresh state
    socket.emit('list-public-tournaments', refreshTournaments);
    // ask server for state by listening to next tournament-state emission
  }

  function leaveTournament() {
    if (code) {
      try { socket.emit('leave-tournament'); } catch (e) {}
    }
    code = null;
    role = null;
    inMatch = false;
    $('tournament-setup').hidden = false;
    $('tournament-lobby').hidden = true;
    $('tournament-match').hidden = true;
    screen('home');
  }

  function renderLeaderboard(players) {
    return (players || []).map((p, i) => `
      <div class="leader-row">
        <span class="place">${i + 1}</span>
        <strong>${esc(p.name)}</strong>
        <span class="points">${p.points || 0} P</span>
      </div>
    `).join('');
  }

  function renderLobby(state) {
    if (!state) return;
    const isHost = role === 'host';
    const box = $('tournament-lobby');
    if (!box) return;
    box.hidden = false;
    box.innerHTML = `
      <div class="tournament-lobby-box">
        <div class="title-row">
          <strong>Turnier ${esc(state.code)}</strong>
          <small>${state.players.length}/${state.maxPlayers}</small>
        </div>
        <div class="meta">Host: ${esc(state.hostName)} · Ziel: ${state.targetWins}</div>
        <div class="lobby-list">
          ${(state.players || []).map(p => `<div class="player-row">${esc(p.name)}${p.inMatch ? ' <span class="badge">in Match</span>' : ''}</div>`).join('')}
        </div>
        <div class="tournament-actions">
          ${isHost ? '<button id="tour-start" class="btn primary" type="button">Starten</button>' : ''}
          ${isHost ? '<button id="tour-end" class="btn danger" type="button">Turnier beenden</button>' : ''}
          <button id="tour-leave" class="btn" type="button">Verlassen</button>
        </div>
        <div class="leaderboard">
          <h4>Leaderboard</h4>
          ${renderLeaderboard(state.players)}
        </div>
      </div>
    `;

    $('tour-leave')?.addEventListener('click', leaveTournament);
    if (isHost) {
      const startBtn = $('tour-start');
      const endBtn = $('tour-end');
      // disable start while any live matches
      if (state.liveMatches && state.liveMatches.length) {
        if (startBtn) startBtn.disabled = true;
      } else {
        if (startBtn) startBtn.disabled = false;
      }
      startBtn?.addEventListener('click', () => socket.emit('start-tournament'));
      endBtn?.addEventListener('click', () => {
        socket.emit('start-tournament');
        socket.emit('leave-tournament');
      });
    }
  }

  function renderMatchView(data) {
    if (!data) return;
    inMatch = true;
    const matchBox = $('tournament-match');
    if (!matchBox) return;
    matchBox.hidden = false;
    matchBox.innerHTML = `
      <div class="match-shell">
        <div class="title-row"><strong>Match</strong><small>${esc(data.players[0])} vs ${esc(data.players[1])}</small></div>
        <div class="meta">Ziel: ${data.targetWins} Siege</div>
        <div id="matchcode" class="room-code">${code}</div>
        <div id="result" class="result-box"></div>
        <div id="choices" class="choices">
          <button data-choice="rock" type="button"><span>🪨</span><b>Stein</b></button>
          <button data-choice="paper" type="button"><span>📄</span><b>Papier</b></button>
          <button data-choice="scissors" type="button"><span>✂️</span><b>Schere</b></button>
        </div>
        <button id="ready-btn" class="btn primary" type="button">Bereit →</button>
        <div id="countdown" class="countdown"></div>
      </div>
    `;

    document.querySelectorAll('#tournament-match [data-choice]').forEach(btn => {
      btn.onclick = () => {
        if (btn.disabled) return;
        document.querySelectorAll('#tournament-match [data-choice]').forEach(x => x.classList.remove('selected'));
        btn.classList.add('selected');
        socket.emit('choose', btn.dataset.choice);
      };
    });

    $('tournament-match')?.querySelector('#ready-btn')?.addEventListener('click', () => {
      socket.emit('ready');
      document.querySelectorAll('#tournament-match [data-choice]').forEach(x => x.disabled = true);
      $('tournament-match').querySelector('#ready-btn').disabled = true;
    });
  }

  function refreshTournamentState() {
    socket.emit('list-public-tournaments', refreshTournaments);
  }

  socket.on('public-tournaments', list => {
    const el = $('tournament-list');
    if (!el) return;
    if (!list || !list.length) {
      el.innerHTML = '<div class="empty-state">Keine offenen Turniere.</div>';
      return;
    }
    el.innerHTML = list.map(t => `
      <div class="tournament-card">
        <div class="title-row"><strong>${esc(t.code)}</strong><small>${t.players}/${t.maxPlayers}</small></div>
        <div class="meta">${esc(t.hostName)} · Ziel: ${t.targetWins}</div>
        <button class="btn tiny" data-tourney-join="${t.code}" type="button">Joinen</button>
      </div>
    `).join('');
    el.querySelectorAll('[data-tourney-join]').forEach(btn => {
      btn.onclick = () => {
        const name = $('tournament-name').value.trim();
        if (!name) return $('tournament-error').textContent = 'Bitte gib zuerst deinen Namen ein.';
        socket.emit('join-tournament', { name, code: btn.dataset.tourneyJoin }, d => {
          if (d?.error) return $('tournament-error').textContent = d.error;
          enterTournament(d, 'player');
        });
      };
    });
  });

  socket.on('tournament-state', state => {
    if (!state) return;
    code = state.code;
    // if running, still show lobby and leaderboard to participants
    renderLobby(state);
    if (state.phase === 'running') {
      // host will receive live matches separately
    }
  });

  socket.on('tournament-match', data => {
    if (!data) return;
    // role can be 'host' or 'player'
    renderMatchView(data);
    code = data.code;
    screen('tournament');
  });

  socket.on('tournament-round-result', d => {
    const resultBox = $('tournament-match')?.querySelector('#result');
    if (resultBox) resultBox.innerHTML = `<div class="result-card"><div class="result-winner">${esc(d.winner || 'UNENTSCHIEDEN')}</div></div>`;
  });

  socket.on('tournament-live-matches', list => {
    // host-only list
    if (!list) return;
    const hostBox = $('tournament-lobby');
    if (!hostBox) return;
    // append or update live matches panel
    const existing = hostBox.querySelector('.match-list');
    const html = `<div class="match-list"><h4>Live Matches</h4>${list.map(m => `<div class="match-row">${esc(m.players.join(' vs '))} <button class="btn tiny watch" data-match="${m.id}">Zuschauen</button></div>`).join('')}</div>`;
    if (existing) existing.remove();
    hostBox.querySelector('.leaderboard')?.insertAdjacentHTML('afterend', html);
    hostBox.querySelectorAll('.watch').forEach(b => b.addEventListener('click', e => {
      const id = b.dataset.match;
      socket.emit('watch-match', id);
    }));
  });

  socket.on('tournament-ended', data => {
    const box = $('tournament-lobby');
    if (!box) return;
    box.hidden = false;
    box.innerHTML = `
      <div class="podium-wrap">
        <div class="eyebrow">TURNIER BEENDET</div>
        <h3>Das Turnier ist beendet!</h3>
        <div class="podium">
          ${(data.players || []).slice(0, 3).map((p, i) => `
            <div class="podium-item place-${i + 1}">
              <strong>${i + 1}. ${esc(p.name)}</strong>
              <small>${p.points || 0} Punkte</small>
            </div>
          `).join('')}
        </div>
        <div class="leaderboard full-list">
          <h4>Leaderboard</h4>
          ${renderLeaderboard(data.players || [])}
        </div>
      </div>
    `;
    code = null;
    role = null;
  });

  socket.on('room-closed', () => {
    if (code) leaveTournament();
  });

  ensureTournamentButton();
  sizes();
  $('tournament-host')?.addEventListener('click', () => {
    const name = $('tournament-name').value.trim();
    if (!name) return $('tournament-error').textContent = 'Bitte gib zuerst deinen Namen ein.';
    const targetWins = $('tournament-wins').value;
    const maxPlayers = $('tournament-size').value;
    const isPublic = !!$('tournament-public')?.checked;
    socket.emit('create-tournament', { name, targetWins, maxPlayers, isPublic }, d => {
      if (d?.error) return $('tournament-error').textContent = d.error;
      role = 'host';
      code = d.code;
      $('tournament-setup').hidden = true;
      $('tournament-lobby').hidden = false;
      $('tournament-match').hidden = true;
      screen('tournament');
      // request initial state
      socket.emit('list-public-tournaments', refreshTournaments);
    });
  });

  $('tournament-join')?.addEventListener('click', () => {
    const name = $('tournament-name').value.trim();
    const codeInput = $('tournament-code').value.trim();
    if (!name) return $('tournament-error').textContent = 'Bitte gib zuerst deinen Namen ein.';
    if (!codeInput) return $('tournament-error').textContent = 'Bitte gib einen Turniercode ein.';
    socket.emit('join-tournament', { name, code: codeInput }, d => {
      if (d?.error) return $('tournament-error').textContent = d.error;
      enterTournament(d, 'player');
    });
  });

  $('tournament-refresh')?.addEventListener('click', refreshTournaments);
})();
