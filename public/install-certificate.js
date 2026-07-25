document.addEventListener('DOMContentLoaded', () => {
  // Set from here rather than an inline <script> in the HTML, since the CSP's
  // script-src 'self' blocks inline scripts on every page.
  const footerYearEl = document.getElementById('footer-year');
  if (footerYearEl) footerYearEl.textContent = new Date().getFullYear();
});
