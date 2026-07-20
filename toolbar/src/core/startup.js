// ── STARTUP SPLASH ─────────────────────────────────────────────────────────
// Plays the bundled Extella logo once while the desktop UI settles.

ETB.startup = (function () {
  var splash = null;
  var fallbackTimer = null;
  var keyHandler = null;

  function remove() {
    if (!splash || splash.getAttribute('data-closing') === '1') return;
    splash.setAttribute('data-closing', '1');
    if (fallbackTimer) clearTimeout(fallbackTimer);
    if (keyHandler) window.removeEventListener('keydown', keyHandler);
    splash.style.opacity = '0';
    var old = splash;
    splash = null;
    setTimeout(function () {
      if (old && old.parentNode) old.parentNode.removeChild(old);
    }, 420);
  }

  function show() {
    if (splash || !_ETB_STARTUP_LOGO_VIDEO || !document.body) return;

    splash = document.createElement('div');
    splash.id = '_etbv2_startup';
    splash.setAttribute('aria-hidden', 'true');
    splash.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483647',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'background:#000',
      'opacity:1',
      'transition:opacity .4s ease',
      'overflow:hidden'
    ].join(';');

    var video = document.createElement('video');
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = _ETB_STARTUP_LOGO_VIDEO;
    video.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;background:#000';
    video.addEventListener('ended', remove, { once: true });
    video.addEventListener('error', remove, { once: true });
    splash.appendChild(video);
    document.body.appendChild(splash);

    keyHandler = function (e) { if (e.key === 'Escape') remove(); };
    window.addEventListener('keydown', keyHandler);

    var reduceMotion = false;
    try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (reduceMotion) {
      video.pause();
      try { video.currentTime = 0; } catch (e) {}
      fallbackTimer = setTimeout(remove, 900);
      return;
    }

    var play = video.play();
    if (play && typeof play.catch === 'function') play.catch(remove);
    fallbackTimer = setTimeout(remove, 22000);
  }

  return { show: show, close: remove };
})();
