/**
 * Shared full-screen loading overlay used for every page-to-page transition
 * in the kiosk flow (index → signin/signup/update, and back again).
 * Requires the #loading-overlay markup (see index.html) and the CSS in
 * css/style.css. Any <a class="js-loading-nav" href="..."> is auto-wired.
 */
(() => {
  // Icon glyphs cycled in the loading overlay — university/college themed,
  // as inline <path> markup swapped into the #loading-icon-svg element.
  const LOADING_ICONS = [
    // Graduation cap
    '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
    // Book
    '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    // Pen
    '<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>',
    // Lightbulb (ideas / knowledge)
    '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.4 1 1.1 1 1.8v.5h6v-.5c0-.7.4-1.4 1-1.8A7 7 0 0 0 12 2Z"/>',
    // Award / medal (academic achievement)
    '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
    // Ruler
    '<g transform="rotate(45 12 12)"><rect x="3" y="9" width="18" height="6" rx="1.5"/><line x1="6" y1="9" x2="6" y2="12"/><line x1="9.5" y1="9" x2="9.5" y2="13.5"/><line x1="13" y1="9" x2="13" y2="12"/><line x1="16.5" y1="9" x2="16.5" y2="13.5"/></g>',
    // Backpack
    '<path d="M6 8a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2Z"/><path d="M9 4V2h6v2"/><path d="M9 12h6"/><path d="M9 16h6"/>',
  ];
  const ICON_HOLD_MS = 650;        // how long each icon stays before swapping
  const ICON_EXIT_MS = 180;        // exit-animation duration between icons
  const REQUIRED_ICON_CHANGES = 3; // navigation is gated on this many swaps
  const POST_CHANGES_BUFFER_MS = 350;
  const HARD_FALLBACK_MS = 7000;

  const overlay = document.getElementById('loading-overlay');
  if (!overlay) return; // page doesn't include the overlay markup

  /**
   * Show the loading screen and cycle the centered icon, recoloring it blue
   * or gold at random on each swap, and only navigate once
   * REQUIRED_ICON_CHANGES swaps have actually played out.
   *
   * Hard safety timeout: a fallback unconditionally calls
   * window.location.href so the user is never permanently stuck even if
   * the animation logic breaks.
   */
  function showLoadingAndNavigate(href) {
    const iconWrap = document.getElementById('loading-icon-wrap');
    const iconSvg = document.getElementById('loading-icon-svg');
    const bar = document.getElementById('progress-bar');

    // Reset the bar instantly (no transition) in case the overlay is reused
    // within the same page load (e.g. after a bfcache restore).
    if (bar) {
      bar.style.transition = 'none';
      bar.style.width = '0%';
      void bar.offsetWidth; // force reflow so the reset is applied immediately
      bar.style.transition = '';
    }
    if (iconWrap) iconWrap.classList.remove('color-blue', 'color-gold', 'icon-pop-in', 'icon-pop-out');

    overlay.classList.add('visible');

    let lastIconIndex = -1;
    let changesDone = 0;
    let navigated = false;

    function finish() {
      if (navigated) return;
      navigated = true;
      window.location.href = href;
    }

    function applyIcon() {
      let next;
      do { next = Math.floor(Math.random() * LOADING_ICONS.length); } while (next === lastIconIndex && LOADING_ICONS.length > 1);
      lastIconIndex = next;
      const color = Math.random() < 0.5 ? 'color-blue' : 'color-gold';

      if (iconSvg) iconSvg.innerHTML = LOADING_ICONS[next];
      if (iconWrap) {
        iconWrap.classList.remove('color-blue', 'color-gold', 'icon-pop-out');
        void iconWrap.offsetWidth; // force reflow so the pop-in animation restarts
        iconWrap.classList.add(color, 'icon-pop-in');
      }

      changesDone += 1;
      if (bar) bar.style.width = Math.round((changesDone / REQUIRED_ICON_CHANGES) * 100) + '%';

      if (changesDone < REQUIRED_ICON_CHANGES) {
        setTimeout(startExit, ICON_HOLD_MS);
      } else {
        setTimeout(finish, POST_CHANGES_BUFFER_MS);
      }
    }

    function startExit() {
      if (iconWrap) {
        iconWrap.classList.remove('icon-pop-in');
        iconWrap.classList.add('icon-pop-out');
      }
      setTimeout(applyIcon, ICON_EXIT_MS);
    }

    applyIcon(); // show the first icon immediately

    // Hard safety timeout — navigate no matter what if something stalls
    setTimeout(finish, HARD_FALLBACK_MS);
  }

  window.showLoadingAndNavigate = showLoadingAndNavigate;

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('a.js-loading-nav').forEach((el) => {
      const href = el.getAttribute('href');
      if (!href) return;
      el.addEventListener('click', (e) => {
        e.preventDefault();
        showLoadingAndNavigate(href);
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          showLoadingAndNavigate(href);
        }
      });
    });
  });

  // bfcache restore: hide the overlay immediately if the page is resurrected
  // from history with it still marked visible from a previous navigation.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) overlay.classList.remove('visible');
  });
})();
