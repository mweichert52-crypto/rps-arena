(() => {
  const socket = window.__rpsSocket || (window.__rpsSocket = io());
  const $ = id => document.getElementById(id);
  const currentRoom = () => (window.__roomCode || null);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let inMatch = false;
  let code = null;
  let cachedTournaments = [];

  function screen(name) {
    document.querySelectorAll('[data-screen]').forEach(el => {
      el.hidden = el.dataset.screen !== name;
    });
  }

  function sizes() {
    const app = $('app');
    if (!app) return;
    const w = Math.min(1180, window.innerWidth - 20);
    app.style.maxWidth = `${w}px`;
  }

  function refreshTournaments() {
    socket.emit('list-public-tournaments', list => {
      cachedTournaments = Array.isArray(list) ? list : [];
      if (typeof renderTournaments === 'function') renderTournaments(cachedTournaments);
    });
  }

  function renderTournaments(list) {
    const root = $('tournament-list');
    if (!root) return;
    const rows = (list || []).map(t => `
      <div class="tour-row">
        <div>
          <b>${esc(t.name || 'Turnier')}</b>
          <small>${t.players || 0}/${t.maxPlayers || 0} · ${t.isPublic ? 'Öffentlich' : 'Privat'}</small>
        </div>
        <div class="tour-meta">${t.targetWins || 3} Siege · Code ${esc(t.code || '')}</div>
        <button class="small-btn" data-join-code="${esc(t.code || '')}">BEITRETEN</button>
      </div>
    `).join('');
    root.innerHTML = rows || '<div class="tour-empty">Keine öffentlichen Turniere.</div>';
    root.querySelectorAll('[data-join-code]').forEach(btn => {
      btn.onclick = () => {
        const name = ($('tournament-name') || {}).value || '';
        const tcode = (btn.getAttribute('data-join-code') || '').trim();
        if (!name) return $('tournament-error').textContent = 'Bitte gib zuerst deinen Namen ein.';
        $('tournament-error').textContent = '';
        socket.emit('join-tournament', { name, code: tcode }, d => {
          if (d?.error) return $('tournament-error').textContent = d.error;
          enterTournament(d, 'player');
        });
      };
    });
  }

  function leaveTournament() {
    try {
      socket.emit('leave-tournament');
    } catch (e) {}
    code = null;
    inMatch = false;
    window.__tourChoice = null;
    screen('home');
  }

  function leave() {
    try { socket.emit('leave-tournament'); } catch (e) {}
    code = null; inMatch = false; window.__tourChoice = null; screen('home');
  }

  function checkReadyState() {
    const readyBtn = $('ready-btn');
    if (!readyBtn) return;
    readyBtn.onclick = () => {
      if (!window.__tourChoice) {
        $('status').textContent = 'Wähle zuerst Stein, Papier oder Schere.';
        return;
      }
      socket.emit('ready');
    };
  }

  function injectTournamentButton() {
    const existing = $('tournament-open');
    if (existing) {
      existing.dataset.tourBound = '1';
      existing.onclick = () => {
        try {
          sizes();
          screen('tournament');
          refreshTournaments();
          $('tournament-name')?.focus();
        } catch (e) {
          console.error('Failed to open tournament panel', e);
        }
      };
      return;
    }

    const btn = document.createElement('button');
    btn.id = 'tournament-open';
    btn.className = 'nav-btn';
    btn.textContent = 'TURNIER';
    btn.onclick = () => {
      try {
        sizes();
        screen('tournament');
        refreshTournaments();
        $('tournament-name')?.focus();
      } catch (e) {
        console.error('Failed to open tournament panel', e);
      }
    };
    const nav = $('nav') || $('main-nav') || document.querySelector('header') || document.body;
    nav.appendChild(btn);
  }

  function enterTournament(d, role) {
    code = d?.code || code;
    inMatch = false;
    screen('tournament');
    const lobby = $('tournament-lobby');
    if (!lobby) return;
    lobby.hidden = false;
    lobby.innerHTML = `
      <div class="tour-lobby">
        <h2>${role === 'host' ? 'Turnier erstellt' : 'Turnier beigetreten'}</h2>
        <p class="tour-state-note">Code: <strong>${esc(code || '')}</strong></p>
        <p class="tour-state-note">Warte auf Mitspieler...</p>
        <div class="tour-meta-row">
          <span>Host: ${esc(d?.hostName || 'Host')}</span>
          <span>Ziel: ${esc(d?.targetWins || '3')} Siege</span>
        </div>
        <button class="btn tour-leave full" id="tour-leave">TURNIER VERLASSEN</button>
      </div>
    `;
    $('tour-leave').onclick = leaveTournament;
  }

  function tournamentState(t) {
    if (!t) return { players: [], liveMatches: [] };
    return {
      code: t.code,
      hostName: t.hostName,
      targetWins: t.targetWins,
      players: Array.from(t.players.values()).map(p => ({ name: p.name, ready: !!p.ready, points: p.points || 0 })),
      liveMatches: t.liveMatches || []
    };
  }

  function tournamentList() {
    return cachedTournaments;
  }

  function parseTournamentList(list) {
    return Array.isArray(list) ? list : [];
  }

  socket.on('public-tournaments', list => {
    cachedTournaments = parseTournamentList(list);
    if (typeof renderTournaments === 'function') renderTournaments(cachedTournaments);
  });

  socket.on('tournament-state', render => {
    if (!render || !render.code) return;
    code = render.code;
    const lobby = $('tournament-lobby');
    if (!lobby) return;
    lobby.hidden = false;
    lobby.innerHTML = `
      <div class="tour-lobby">
        <h2>Turnierlobby</h2>
        <p class="tour-state-note">Code: <strong>${esc(render.code || '')}</strong></p>
        <div class="tour-player-list">
          ${(render.players || []).map(p => `
            <div class="tour-player ${p.ready ? 'ready' : ''}">
              <span>${esc(p.name || 'Spieler')}</span>
              <small>${p.ready ? 'Bereit' : 'Wartet'}</small>
            </div>
          `).join('') || '<div class="tour-empty">Noch keine Spieler.</div>'}
        </div>
        <button class="btn tour-leave full" id="tour-leave">TURNIER VERLASSEN</button>
      </div>
    `;
    $('tour-leave').onclick = leaveTournament;
  });

  socket.on('tournament-match', m => {
    inMatch = true;
    window.__tourChoice = null;
    screen('game');
    $('room-code').textContent = code;
    $('match-rule').textContent = `Turnierduell · Ziel: ${m.targetWins || 3} Siege`;
    $('name-0').textContent = m.players[0];
    $('name-1').textContent = m.players[1];
    $('score-0').textContent = '0';
    $('score-1').textContent = '0';
    $('status').textContent = 'Wähle zuerst Stein, Papier oder Schere.';
    checkReadyState();
    const old = $('game-leave');
    if (old) old.remove();
    const b = document.createElement('button');
    b.id = 'game-leave';
    b.className = 'game-leave tour-leave';
    b.textContent = 'TURNIER VERLASSEN';
    b.onclick = leave;
    $('game').appendChild(b);
  });

  socket.on('tournament-ended', d => {
    inMatch = false;
    screen('tournament');
    const lobby = $('tournament-lobby');
    if (!lobby) return;
    lobby.hidden = false;
    lobby.innerHTML = `<div class="tour-lobby"><h2>Das Turnier ist beendet!</h2><p class="tour-state-note">Auswertung folgt!</p><div class="tour-podium">${(d.players || []).slice(0,3).map((p,i)=>`<div class="podium-place ${['first','second','third'][i]}"><b>${i+1}. Platz</b><strong>${esc(p.name)}</strong><small>${p.points} Punkte</small></div>`).join('')}</div><div class="tour-board"><h3>Leaderboard</h3><div>${(d.players||[]).map(p=>`<div>${esc(p.name)} · ${p.points} Punkte</div>`).join('')}</div></div><button class="btn tour-leave full" id="tour-leave">ZURÜCK ZUM HAUPTMENÜ</button></div>`;
    $('tour-leave').onclick = leaveTournament;
  });

  socket.on('tournament-rounds-finished', () => {
    if (!inMatch) screen('tournament');
  });

  function detectPublicSetting() {
    const tp = $('tournament-public');
    if (tp) return tp.checked;
    const lp = $('lobby-public');
    if (lp) return lp.checked;
    return true;
  }

  window.addEventListener('beforeunload', () => {
    if (!code) return;
    try { socket.emit('player-left-ensure'); } catch (e) {}
    try { socket.emit('leave-tournament'); } catch (e) {}
  });

  injectTournamentButton();

  document.addEventListener('DOMContentLoaded', () => {
    const openBtn = $('tournament-open');
    if (openBtn && !openBtn.dataset.tourBound) {
      openBtn.dataset.tourBound = '1';
      openBtn.addEventListener('click', () => {
        try {
          sizes();
          screen('tournament');
          refreshTournaments();
          $('tournament-name')?.focus();
        } catch (e) {
          console.error('Failed to open tournament panel', e);
        }
      });
    }

    $('tournament-host')?.addEventListener('click', () => {
      const name = ($('tournament-name').value || '').trim();
      if (!name) return $('tournament-error').textContent = 'Bitte gib zuerst deinen Namen ein.';
      $('tournament-error').textContent = '';
      const targetWins = $('tournament-wins')?.value || '3';
      const maxPlayers = $('tournament-size')?.value || '8';
      const isPublic = detectPublicSetting();
      socket.emit('create-tournament', { name, targetWins, maxPlayers, isPublic }, d => {
        if (d?.error) return $('tournament-error').textContent = d.error;
        enterTournament(d, 'host');
      });
    });

    $('tournament-refresh')?.addEventListener('click', refreshTournaments);

    $('tournament-join')?.addEventListener('click', () => {
      const name = ($('tournament-name').value || '').trim();
      const tcode = ($('tournament-code').value || '').trim().toUpperCase();
      if (!name) return $('tournament-error').textContent = 'Bitte gib zuerst deinen Namen ein.';
      if (!tcode) return $('tournament-error').textContent = 'Gib einen Turniercode ein.';
      $('tournament-error').textContent = '';
      socket.emit('join-tournament', { name, code: tcode }, d => {
        if (d?.error) return $('tournament-error').textContent = d.error;
        enterTournament(d, 'player');
      });
    });

    document.addEventListener('click', e => {
      if (e.target && e.target.id === 'tour-leave') leaveTournament();
    });
  });
})();
