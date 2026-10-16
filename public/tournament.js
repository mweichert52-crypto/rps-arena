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

  // Styles for the tournament button + leave button polish
  const css = document.createElement('style');
  css.textContent = `
    /* Centered tournament button */
    .tournament-home-btn{
      position:fixed;
      left:50%;
      top:50%;
      transform:translate(-50%,-50%);
      z-index:1200;
      min-width:180px;
      height:62px;
      font-size:16px;
      font-weight:800;
      letter-spacing:.3px;
      border-radius:14px;
      background:linear-gradient(90deg,var(--violet),var(--pink));
      color:#fff;
      border:0;
      display:flex;
      align-items:center;
      justify-content:center;
      gap:10px;
      box-shadow:0 12px 40px rgba(139,92,246,.18);
      cursor:pointer;
      transition:transform .12s ease, box-shadow .12s ease, opacity .12s ease;
    }
    .tournament-home-btn:focus{outline:3px solid rgba(255,255,255,.12);transform:translate(-50%,-52%)}
    .tournament-home-btn:hover{transform:translate(-50%,-52%);box-shadow:0 20px 50px rgba(139,92,246,.22)}
    .tournament-home-btn span{display:inline-block}
    .tour-leave{margin-top:18px!important;height:48px!important;min-height:48px!important;border:1px solid rgba(255,99,130,.18)!important;background:linear-gradient(135deg,rgba(255,70,90,.12),rgba(255,30,70,.06))!important;color:#ffb3bf!important;box-shadow:0 6px 18px rgba(255,70,90,.12)!important;font:800 13px 'JetBrains Mono',monospace!important;letter-spacing:1px;border-radius:10px}
    .tour-leave:hover{background:linear-gradient(135deg,#ff6b83,#c92b4b)!important;color:#fff!important;border-color:#ffb3bf!important;box-shadow:0 12px 30px rgba(255,70,90,.28)!important;transform:translateY(-2px)}
    .tour-code button{margin-left:14px}.tour-card{min-height:66px}.tour-card small{line-height:1.4}.tour-player{min-height:40px;align-items:center}.tour-rank{min-height:45px}.tour-actions .btn:disabled{opacity:.42;filter:grayscale(.6);cursor:not-allowed}.tour-state-note{margin:14px 0;color:var(--muted);text-align:center}.tour-match-row{gap:14px}.tour-match-row small{margin-left:auto;color:var(--theme-accent)}
    @media(max-width:900px){.tournament-home-btn{left:50%;top:72%;transform:translate(-50%,-50%);min-width:140px;height:52px}}
    @media(max-width:650px){.tournament-home-btn{left:50%;top:80%;transform:translate(-50%,-50%);width:calc(100% - 32px)}.tour-code{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.tour-code button{margin-left:0}}
  `;
  document.head.appendChild(css);

  function ensureTournamentButton() {
    const hero = document.querySelector('#home .hero') || document.querySelector('#home');
    let btn = document.getElementById('tournament-open');

    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'tournament-open';
      btn.className = 'tournament-home-btn';
      btn.type = 'button';
      btn.innerHTML = '<span>🏆</span><span>Turnier</span>';
      document.body.appendChild(btn);
    }

    btn.setAttribute('aria-label', 'Turnier öffnen');
    btn.tabIndex = 0;

    try {
      if (hero) {
        if (getComputedStyle(hero).position === 'static') hero.style.position = 'relative';
        btn.style.position = 'absolute';
        btn.style.left = '50%';
        btn.style.top = '50%';
        btn.style.transform = 'translate(-50%,-50%)';
      } else {
        btn.style.position = 'fixed';
        btn.style.left = '50%';
        btn.style.top = '50%';
        btn.style.transform = 'translate(-50%,-50%)';
      }
    } catch (e) {
      btn.style.position = 'fixed';
      btn.style.left = '50%';
      btn.style.top = '50%';
      btn.style.transform = 'translate(-50%,-50%)';
    }

    btn.style.zIndex = '9999';
    btn.style.pointerEvents = 'auto';

    if (!btn.dataset.tourAttached) {
      const openHandler = () => {
        try { sizes(); } catch (e) {}
        try { screen('tournament'); } catch (e) {}
        try { refreshTournaments(); } catch (e) { socket.emit('list-public-tournaments', () => {}); }
      };
      btn.addEventListener('click', openHandler);
      btn.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openHandler();
        }
      });
      btn.dataset.tourAttached = '1';
    }

    if (hero && btn.parentElement !== hero) {
      hero.appendChild(btn);
    }
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
    socket.emit('list-public-tournaments', refreshTournaments);
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
    `).join('');
