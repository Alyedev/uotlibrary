document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('login-form');
  const passwordInput = document.getElementById('password');
  const submitBtn = document.getElementById('submit-btn');
  const banner = document.getElementById('banner');

  // Set from here rather than an inline <script> in the HTML, since the CSP's
  // script-src 'self' blocks inline scripts on every page.
  const footerYearEl = document.getElementById('footer-year');
  if (footerYearEl) footerYearEl.textContent = new Date().getFullYear();

  function showError(message) {
    const div = document.createElement('div');
    div.className = 'status-banner error';
    div.textContent = message;
    banner.innerHTML = '';
    banner.appendChild(div);
  }

  // If already signed in, skip straight to the dashboard.
  fetch('/api/session')
    .then((res) => res.json())
    .then((data) => {
      if (data && data.isAdmin) {
        window.location.href = '/dashboard.html';
      }
    })
    .catch(() => {
      // Ignore — user can still attempt to log in manually.
    });

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    submitBtn.disabled = true;
    submitBtn.textContent = 'جارٍ تسجيل الدخول...';

    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: passwordInput.value }),
    })
      .then(async (res) => {
        let data = {};
        try {
          data = await res.json();
        } catch (e) {
          data = {};
        }

        if (res.ok) {
          window.location.href = '/dashboard.html';
          return;
        }

        showError(data && data.error ? data.error : 'فشل تسجيل الدخول، حاول مرة أخرى.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'تسجيل الدخول';
      })
      .catch(() => {
        showError('فشل تسجيل الدخول، حاول مرة أخرى.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'تسجيل الدخول';
      });
  });
});
