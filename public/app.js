const socket = window.__rpsSocket || (window.__rpsSocket = io()); let role = null; let selected = null; let roomJoined = false; const $ = (id) => document.getElementById(id); const show = (id) => {document.querySelectorAll('.screen').forEach(x => x.classList.remove('active')); document.getElementById(id)?.classList.add('active')};

// ... keep existing logic above untouched (socket handlers, game flow, etc.)

// APP: append robust handlers (add this near the end of the file)
(function attachRobustUiHandlers(){
  // Safety: only run after DOM loaded
  function init() {
    // Delegated click handling for color buttons and play/watch actions.
    document.addEventListener('click', (e) => {
      // Color buttons: use data-role="color-btn" and data-color="#..."/name
      const colorBtn = e.target.closest('[data-role="color-btn"]');
      if (colorBtn) {
        const color = colorBtn.dataset.color;
        if (color) {
          selected = color;
          // Apply visual active state
          document.querySelectorAll('[data-role="color-btn"]').forEach(b => b.classList.toggle('active', b === colorBtn));
          // Emit or call existing logic if present (preserve backward compatibility)
          if (typeof onColorSelected === 'function') onColorSelected(color);
        }
        return;
      }

      // Play / Watch buttons using data-action
      const actionBtn = e.target.closest('[data-action="play"], [data-action="watch"]');
      if (actionBtn) {
        const action = actionBtn.dataset.action;
        if (action === 'play') {
          // existing flow: show play screen or call start function
          try { show('play'); } catch (err) { console.warn('show(play) failed', err); }
        } else if (action === 'watch') {
          try { show('watch'); } catch (err) { console.warn('show(watch) failed', err); }
        }
        return;
      }
    });

    // Defensive bindings for known IDs (copy button etc.)
    const copyBtn = document.getElementById('copy');
    if (copyBtn && !copyBtn.dataset._bound) {
      copyBtn.addEventListener('click', () => {
        const code = document.getElementById('room-code')?.textContent || '';
        if (navigator.clipboard) navigator.clipboard.writeText(code).catch(()=>{});
      });
      copyBtn.dataset._bound = '1';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
