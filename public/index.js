document.addEventListener('DOMContentLoaded', () => {
  // Set from here rather than an inline <script> in the HTML, since the CSP's
  // script-src 'self' blocks inline scripts on every page.
  const footerYearEl = document.getElementById('footer-year');
  if (footerYearEl) footerYearEl.textContent = new Date().getFullYear();

  // Also wired here rather than inline onclick="" attributes — the CSP's
  // script-src 'self' blocks those too (they're a form of inline script),
  // so they'd silently do nothing on click.
  const links = {
    'go-dashboard': 'dashboard.html',
    'go-signup': 'signup.html',
    'go-signin': 'signin.html',
  };
  for (const [id, href] of Object.entries(links)) {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', () => { window.location.href = href; });
  }
});
