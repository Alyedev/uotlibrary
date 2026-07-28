document.addEventListener('DOMContentLoaded', () => {
  const footerYearEl = document.getElementById('footer-year');
  if (footerYearEl) footerYearEl.textContent = new Date().getFullYear();
});
