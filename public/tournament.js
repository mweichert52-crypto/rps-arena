(() => {
  const $=id=>document.getElementById(id);
  const socket=window.__rpsSocket||(window.__rpsSocket=io());
  let role=null,code=null,inMatch=false;
  const css=document.createElement('style');
  css.textContent=`
  /* Tournament: simplified, non-invasive styles */
  .tournament-home-btn{\n    position:fixed; right:28px; bottom:28px; z-index:8;\n    min-width:154px; height:54px; font-size:15px; font-weight:800;\n    letter-spacing:.2px; border-radius:10px;\n  }\n  .tournament-home-btn span{ margin-left:8px; font-size:18px }\n
  .tour-leave{\n    margin-top:18px; height:48px; min-height:48px;\n    border:1px solid rgba(255,100,117,0.18); \n    background: linear-gradient(135deg, rgba(255,70,90,0.08), rgba(255,40,80,0.04));\n    color: #ff6475;\n    border-radius:8px;\n  }\n  .tour-leave:hover{\n    background: linear-gradient(135deg,#ef4055,#b91c3b);\n    color:#fff; border-color:#ff9da8; box-shadow:0 8px 24px rgba(0,0,0,0.25);\n  }\n
  .tour-code button{ margin-left:14px }\n  .tour-card{ min-height:66px }\n  .tour-card small{ line-height:1.4 }\n  .tour-player{ min-height:40px; align-items:center }\n  .tour-rank{ min-height:45px }\n  .tour-actions .btn:disabled{ opacity:.5; cursor:not-allowed }\n
  @media(max-width:650px){\n    .tournament-home-btn{ right:16px; bottom:16px; width:calc(100% - 32px) }\n    .tour-code{ display:flex; align-items:center; flex-wrap:wrap; gap:8px }\n    .tour-code button{ margin-left:0 }\n  }\n`;
  document.head.appendChild(css);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const screen=id=>{document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));$(id)?.classList.add('active')};
  const error=t=>{if($('tournament-error'))$('tournament-error').textContent=t||''};
  function sizes(){const s=$('tournament-size');if(s&&!s.options.length)for(let n=4;n<=60;n+=2)s.add(new Option(`${n} Spieler`,n));if(s&&!s.value)s.value='8'}
  function refresh(){socket.emit('list-public-tournaments',list)}
  function list(items){const e=$('tournament-list');if(!e)return;if(!items?.length){e.innerHTML='<p class="muted">Keine offenen Turniere.</p>';return}e.innerHTML=items.map(t=>`<div class="tour-car[...]
  }
  function join(name,c){if(!name)return error('Bitte gib zuerst deinen Namen ein.');socket.emit('join-tournament',{name,code:c},d=>d?.error?error(d.error):enter(d,'player'))}
  function enter(d,r){role=r;code=d.code;inMatch=false;$('tournament-setup').hidden=true;$('tournament-lobby').hidden=false;$('tournament-match').hidden=true;screen('tournament')}
  function leave(){if(code)socket.emit('leave-tournament');code=null;role=null;inMatch=false;$('tournament-setup').hidden=false;$('tournament-lobby').hidden=true;$('tournament-match').hidden=true;[...]
  function ranks(ps){return(ps||[]).map((p,i)=>`<div class="tour-rank"><span class="place">${p.rank||i+1}</span><strong>${esc(p.name)}</strong><span class="points">${p.points||0} P</span></div>`).[...]
  function render(s){if(inMatch)return;const host=role==='host',players=s.players||[],ready=s.phase==='ready'||s.phase==='lobby';$('tournament-lobby').hidden=false;$('tournament-lobby').innerHTML=[...]
  function bindMatch(){document.querySelectorAll('#choices [data-choice]').forEach(b=>b.onclick=()=>{window.__tourChoice=b.dataset.choice;socket.emit('choose',b.dataset.choice);document.querySelec[...]
  socket.on('public-tournaments',list);socket.on('tournament-state',render);socket.on('tournament-match',m=>{inMatch=true;window.__tourChoice=null;screen('game');$('room-code').textContent=code;$([...]
  $('tournament-open')?.addEventListener('click',()=>{sizes();screen('tournament');refresh()});$('tournament-refresh')?.addEventListener('click',refresh);$('tournament-host')?.addEventListener('cl[...]
})();
