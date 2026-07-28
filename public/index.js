document.addEventListener('DOMContentLoaded', () => {
  // Footer year
  const footerYearEl = document.getElementById('footer-year');
  if (footerYearEl) footerYearEl.textContent = new Date().getFullYear();

  // Loading overlay (cached once — used only for show/hide)
  const overlay = document.getElementById('loading-overlay');

  /**
   * Show the loading screen, play the progress animation, then navigate.
   * The progress animation in CSS is 1.4 s — we wait just long enough for
   * it to visually complete before we hand off to the browser.
   *
   * Fix 1 — cloneNode detached-node crash:
   *   Re-query #progress-bar from the live DOM on every call instead of
   *   using a variable captured at DOMContentLoaded time.  After the first
   *   navigation the cached reference pointed to a detached node, making
   *   oldBar.parentNode === null and throwing before setTimeout ran.
   *
   * Fix 3 — hard safety timeout:
   *   A 4 s fallback unconditionally calls window.location.href so the user
   *   is never permanently stuck even if something else goes wrong.
   */
  function navigateTo(href) {
    // FIX 1: always fetch the current (live) bar from the DOM
    const oldBar = document.getElementById('progress-bar');
    if (oldBar && oldBar.parentNode) {
      const newBar = oldBar.cloneNode(false);
      oldBar.parentNode.replaceChild(newBar, oldBar);
    }

    overlay.classList.add('visible');

    // Primary path: navigate after the CSS animation finishes (1.4 s + buffer)
    const primaryTimer = setTimeout(() => {
      window.location.href = href;
    }, 1500);

    // FIX 3: hard fallback — navigate no matter what after 4 s
    setTimeout(() => {
      clearTimeout(primaryTimer);
      window.location.href = href;
    }, 4000);
  }

  // FIX 2 — bfcache restore:
  //   When the user presses Back, browsers may resurrect the page from the
  //   back/forward cache with the overlay still .visible from the previous
  //   navigation.  pageshow fires with e.persisted === true in that case;
  //   we simply hide the overlay immediately.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      overlay.classList.remove('visible');
    }
  });

  const links = {
    'go-signin': 'signin.html',
    'go-signup': 'signup.html',
    'go-update': 'update.html',
  };

  for (const [id, href] of Object.entries(links)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(href);
    });
    // Keyboard (Enter / Space) support for <a> used as button
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        navigateTo(href);
      }
    });
  }
});
