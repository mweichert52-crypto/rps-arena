(() => {
  const socket = window.__rpsSocket || (window.__rpsSocket = io());
  const $ = id => document.getElementById(id);
  let code = null;
  let role = null;
  let inMatch = false;

  const esc = s => String(s ?? '').replace(/[&<>\"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const screen = id => {
    document.querySelectorAll('.screen').forEach(x => x.classList.remove('active'));
    $(id)?.classList.add('active');

    // hide global back buttons when in tournament screen (tournament should only have a colored "Turnier Verlassen" button)
    document.querySelectorAll('.back').forEach(b => { b.hidden = (id === 'tournament'); });
  };

  // inject minimal CSS tweaks so "back" buttons are colorful and tour-leave stays prominent
  (function injectLocalStyles(){
    if (document.getElementById('tournament-local-styles')) return;
    const css = document.createElement('style');
    css.id = 'tournament-local-styles';
    css.textContent = `
      .back{ background: linear-gradient(135deg,var(--accent),var(--accent-2)); color:#fff; border:0; padding:8px 10px; border-radius:8px; display:inline-flex; align-items:center; gap:8px; cursor:pointer; box-shadow:var(--shadow); }
      .back:hover{ transform:translateY(-2px); }
      /* ensure the tournament leave button is clearly colored */
      .tour-leave{ background: linear-gradient(135deg,#ff6b83,#c92b4b)!important; color:#fff!important; border:0!important }
    `;
    document.head.appendChild(css);
  })();

  function detectPublicSetting() {
    const tp = $('tournament-public');
    if (tp) return tp.checked;
    const lp = $('lobby-public');
    if (lp) return lp.checked;
    return true;
  }

  // ensure there's a visible tournament button on the home screen
  function injectTournamentButton() {
    if ($('tournament-open')) return;
    const home = document.querySelector('#home .hero') || document.querySelector('#home');
    if (!home) return;
    const btn = document.createElement('button');
    btn.id = 'tournament-open';
    btn.className = 'tournament-home-btn';
    btn.type = 'button';
    btn.innerHTML = '<span>🏆</span><span>Turnier</span>';
    btn.addEventListener('click', () => { sizes(); screen('tournament'); refreshTournaments(); $('tournament-name')?.focus(); });
    home.appendChild(btn);
  }

  function sizes() {
    const select = $('tournament-size');
    if (!select) return;
    if (!select.dataset.ready) {
      // fill options in steps of 2 (even numbers) from 4 to 60
      select.innerHTML = '';
      for (let n = 4; n <= 60; n += 2) select.add(new Option(String(n), String(n)));
      select.dataset.ready = '1';
    }
    if (!select.value) select.value = '8';
  }

  function refreshTournaments() {
    socket.emit('list-public-tournaments', list => {
      const el = $('tournament-list');
      if (!el) return;
      if (!list || !list.length) {
        el.innerHTML = '<div class="empty-state">Keine offenen Turniere.</div>';
        return;
      }

      el.innerHTML = list.map(t => {
        // if we're already in this tournament, don't show a "Joinen" button
        let actionHtml = '';
        if (code && code === t.code) {
          // if we're the host, show a Starten button
          if (role === 'host') {
            actionHtml = `<button class="btn tiny" data-tourney-start="${t.code}" type="button">Turnier starten</button>`;
          } else {
            actionHtml = `<small style="color:var(--muted)">Bereits beigetreten</small>`;
          }
        } else {
          // show join button for tournaments we haven't joined
          actionHtml = `<button class="btn tiny" data-tourney-join="${t.code}" type="button">Joinen</button>`;
        }

        return `
        <div class="tournament-card">
          <div class="title-row"><strong>${t.code}</strong><small>${t.players}/${t.maxPlayers}</small></div>
          <div class="meta">${esc(t.hostName)} · Ziel: ${t.targetWins}</div>
          <div class="tournament-actions">${actionHtml}</div>
        </div>
      `
      }).join('');

      // bind join buttons
      el.querySelectorAll('[data-tourney-join]').forEach(btn => {
        btn.onclick = () => {
          const name = $('tournament-name').value.trim();
          if (!name) return $('tournament-error').textContent = 'Bitte gib zuerst deinen Namen ein.';
          $('tournament-error').textContent = '';
          socket.emit('join-tournament', { name, code: btn.dataset.tourneyJoin }, d => {
            if (d?.error) return $('tournament-error').textContent = d.error;
            enterTournament(d, 'player');
          });
        };
      });

      // bind start buttons (host)
      el.querySelectorAll('[data-tourney-start]').forEach(btn => {
        btn.onclick = () => {
          // only emit start if we are host of this tournament
          if (role === 'host' && code === btn.dataset.tourneyStart) {
            socket.emit('start-tournament');
          }
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
    refreshTournamentState();
  }

  function leaveTournament() {
    if (code) {
      try { socket.emit('leave-tournament'); } catch (e) {}
    }
    code = null; role = null; inMatch = false;
    $('tournament-setup').hidden = false;
    $('tournament-lobby').hidden = true;
    $('tournament-match').hidden = true;
    $('tournament-list') && refreshTournaments();
    screen('tournament');
  }

  function refreshTournamentState() {
    if (!code) return;
    // server will push tournament-state events to room; request a refresh by re-listing public tournaments
    socket.emit('list-public-tournaments', () => {});
  }

  function renderTournamentState(d) {
    // render lobby for either host or players
    const lobby = $('tournament-lobby');
    if (!lobby) return;

    // ensure we always show every player who joined with their entered name and points
    const playersHtml = (d.players || []).map((p, i) => `
      <div class="tour-player"><strong>${esc(p.name)}</strong> <small>${p.points ?? 0} Punkte${p.inMatch ? ' · im Match' : ''}</small></div>
    `).join('') || '<div class="empty-state">Keine Spieler</div>';

    let hostControls = '';
    if (role === 'host') {
      hostControls = `
        <div class="tour-host-row">
          <button class="btn primary" id="tour-start">Starten</button>
          <button class="btn" id="tour-end">Turnier beenden</button>
          <button class="btn" id="tour-copy">Code kopieren</button>
        </div>
      `;
    }

    lobby.hidden = false;
    lobby.innerHTML = `<div class="tournament-card">
        <div class="title-row"><strong>${d.code}</strong><small>${(d.players||[]).length}/${d.maxPlayers}</small></div>
        <div class="meta">Host: ${esc(d.hostName)} · Ziel: ${d.targetWins}</div>
        <div class="tour-board"><h3>Leaderboard</h3><div>${playersHtml}</div></div>
        ${hostControls}
        <div style="margin-top:16px"><button class="btn tour-leave full" id="tour-leave">TURNIER VERLASSEN</button></div>
      </div>`;

    // bind host buttons
    if (role === 'host') {
      $('tour-start').onclick = () => { socket.emit('start-tournament'); };
      $('tour-end').onclick = () => { socket.emit('leave-tournament'); };
      $('tour-copy').onclick = () => {
        try { navigator.clipboard.writeText(d.code); $('tour-copy').textContent = 'Kopiert!'; setTimeout(() => { $('tour-copy').textContent = 'Code kopieren'; }, 1500); } catch (e) {}
      };
    }

    $('tour-leave').onclick = leaveTournament;

    // if host, render live matches area (server also emits tournament-live-matches)
  }

  function renderTournamentMatch(payload) {
    // payload: { code, matchId, targetWins, players: [p1,p2], role }
    inMatch = true;
    window.__tourChoice = null;
    screen('game');
    $('room-code').textContent = payload.code || code || '—';
    $('match-rule').textContent = `Turnierduell · Ziel: ${payload.targetWins || 3} Siege`;
    $('name-0').textContent = payload.players?.[0] || '—';
    $('name-1').textContent = payload.players?.[1] || '—';
    $('score-0').textContent = '0';
    $('score-1').textContent = '0';
    $('result').innerHTML = '';
    $('status').textContent = payload.role === 'host' ? 'Zuschauermodus: Warte auf Spieler...' : 'Wähle deine Hand und drücke Bereit.';
    $('choices').style.display = payload.role === 'host' ? 'none' : '';
    $('ready-btn').style.display = payload.role === 'host' ? 'none' : '';
    $('ready-btn').disabled = false;
    bindMatch(payload.matchId, payload.role);
  }

  function bindMatch(matchId, myRole) {
    // choice buttons
    document.querySelectorAll('#choices button').forEach(btn => {
      btn.onclick = () => {
        if (myRole === 'host') return;
        const choice = btn.dataset.choice;
        window.__tourChoice = choice;
        document.querySelectorAll('#choices button').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        socket.emit('choose', choice);
      };
    });

    const ready = $('ready-btn');
    if (ready) {
      ready.onclick = () => {
        if (myRole === 'host') return;
        if (!window.__tourChoice) { $('status').textContent = 'Wähle zuerst Stein, Papier oder Schere.'; return; }
        socket.emit('ready');
        ready.disabled = true;
      };
    }
  }

  // socket event handlers
  socket.on('public-tournaments', list => {
    // if tournament panel active, refresh
    if (document.querySelector('#tournament')?.classList.contains('active')) refreshTournaments();
  });

  socket.on('tournament-state', d => {
    // if this tournament matches our code or we are host, render
    if (!code && d && role === 'host') { code = d.code; }
    renderTournamentState(d);
  });

  socket.on('tournament-live-matches', list => {
    // show small host-only live list inside lobby card if present
    const lobby = $('tournament-lobby');
    if (!lobby || !list || !list.length) return;
    const hostBox = document.createElement('div');
    hostBox.className = 'tournament-card';
    hostBox.innerHTML = `<h4>Live Matches</h4><div>${list.map(m => `<div class="tour-match-row"><span>${esc(m.players.join(' vs '))}</span><button class="btn tiny" data-watch="${m.id}">Zuschauen</button></div>`).join('')}</div>`;
    lobby.prepend(hostBox);
    hostBox.querySelectorAll('[data-watch]').forEach(btn => {
      btn.onclick = () => { socket.emit('watch-match', btn.dataset.watch); };
    });
  });

  socket.on('tournament-match', payload => {
    // server sends tournament-match to players and hosts when a match starts or when host watches
    renderTournamentMatch(payload);
  });

  socket.on('tournament-match-choice', d => {
    // acknowledge of our choice
    // no-op for now; can be used to show UI
  });

  socket.on('countdown', d => {
    const cd = $('countdown');
    if (!cd) return;
    if (d.seconds > 0) cd.textContent = d.seconds;
    else cd.textContent = '';
  });

  socket.on('tournament-round-result', d => {
    $('result').innerHTML = `<div class="result-card"><div class="result-winner">${esc(d.winner)}${d.reason ? ' · ' + esc(d.reason) : ''}</div></div>`;
    setTimeout(() => { inMatch = false; screen('tournament'); $('tournament-lobby').hidden = false; }, 1500);
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
    // rounds finished - show lobby
    if (!inMatch) { screen('tournament'); }
  });

  // wire up UI elements on load
  injectTournamentButton();
  document.addEventListener('DOMContentLoaded', () => {
    // open panel
    $('tournament-open')?.addEventListener('click', () => { sizes(); screen('tournament'); refreshTournaments(); $('tournament-name')?.focus(); });

    // setup host button
    $('tournament-host')?.addEventListener('click', () => {
      const name = $('tournament-name').value.trim();
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

    // refresh button
    $('tournament-refresh')?.addEventListener('click', refreshTournaments);

    // join by code
    $('tournament-join')?.addEventListener('click', () => {
      const name = $('tournament-name').value.trim();
      const tcode = $('tournament-code').value.trim().toUpperCase();
      if (!name) return $('tournament-error').textContent = 'Bitte gib zuerst deinen Namen ein.';
      if (!tcode) return $('tournament-error').textContent = 'Gib einen Turniercode ein.';
      $('tournament-error').textContent = '';
      socket.emit('join-tournament', { name, code: tcode }, d => {
        if (d?.error) return $('tournament-error').textContent = d.error;
        enterTournament(d, 'player');
      });
    });

    // leave buttons (global handlers)
    document.addEventListener('click', e => {
      if (e.target && e.target.id === 'tour-leave') leaveTournament();
    });

  });

  // graceful notify to server on unload
  window.addEventListener('beforeunload', () => {
    try { socket.emit('player-left-ensure'); } catch (e) {}
    try { socket.emit('leave-tournament'); } catch (e) {}
  });

})();
