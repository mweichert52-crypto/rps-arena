const socket = io(); let role = null; let selected = null; const $ = (id) => document.getElementById(id); const show = (id) => { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); $(id).classList.add('active'); };
document.querySelectorAll('[data-screen]').forEach(b => b.onclick = () => show(b.dataset.screen));
function error(id, text){$(id).textContent=text||''} function enter(data, errorId){ if(data.error)return error(errorId,data.error); role=data.role; $('room-code').textContent=data.code; show('game'); }
$('create').onclick=()=>socket.emit('create-room',{name:$('player-name').value},d=>enter(d,'play-error'));
$('join').onclick=()=>socket.emit('join-room',{name:$('player-name').value,code:$('join-code').value},d=>enter(d,'play-error'));
$('watch-btn').onclick=()=>socket.emit('watch-room',{code:$('watch-code').value},d=>enter(d,'watch-error'));
$('copy').onclick=()=>navigator.clipboard?.writeText($('room-code').textContent);
document.querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>{if(role!=='player')return; selected=b.dataset.choice; socket.emit('choose', selected); document.querySelectorAll('[data-choice]').forEach(x=>x.classList.toggle('selected',x===b));});
$('ready-btn').onclick=()=>{if(!selected){ $('status').textContent='Wähle zuerst Stein, Papier oder Schere.'; return; } socket.emit('ready');};
socket.on('state',s=>{if(!$('game').classList.contains('active'))return; s.players.forEach((p,i)=>{ $('name-'+i).textContent=p?.name||'Wartet…'; $('score-'+i).textContent=p?.score||0; $('ready-'+i).classList.toggle('on',!!p?.ready); }); $('spectators').textContent=s.spectatorCount; $('status').textContent=s.message||({waiting:'Warte auf den zweiten Spieler.',playing:'Wähle deine Hand und drücke Bereit.',countdown:'Auswahl gesperrt…',result:'Runde ausgewertet.',finished:'Match beendet.'}[s.phase]||''); });
socket.on('countdown',d=>{$('countdown').textContent=d.seconds;$('ready-btn').disabled=true;document.querySelectorAll('[data-choice]').forEach(x=>x.disabled=true);});
socket.on('round-result',d=>{$('countdown').textContent=''; const labels={rock:'Stein',paper:'Papier',scissors:'Schere'}; $('result').textContent=`${labels[d.choices[0]]}  ·  ${labels[d.choices[1]]} — ${d.draw?'Unentschieden':d.winner==='playerOne'?$('name-0').textContent+' gewinnt!':$('name-1').textContent+' gewinnt!'}`;});
socket.on('round-reset',()=>{selected=null;$('ready-btn').disabled=false;$('result').textContent='';document.querySelectorAll('[data-choice]').forEach(x=>{x.disabled=false;x.classList.remove('selected')});});
socket.on('match-finished',d=>{$('winner').innerHTML=`<small>GEWINNER DER ARENA</small>${d.winner}`;$('winner').classList.add('show');});
socket.on('disconnect',()=>{if($('game').classList.contains('active'))$('status').textContent='Verbindung verloren.';});
