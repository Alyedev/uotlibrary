const statsRow = document.getElementById('stats-row');
const signupsTodayEl = document.getElementById('signups-today');
const signinsTodayEl = document.getElementById('signins-today');
const allPeopleEl = document.getElementById('all-people');
const signupsTodayPaginationEl = document.getElementById('signups-today-pagination');
const signinsTodayPaginationEl = document.getElementById('signins-today-pagination');
const allPeoplePaginationEl = document.getElementById('all-people-pagination');
const modalRoot = document.getElementById('modal-root');
const refreshBanner = document.getElementById('refresh-banner');
const todayDateEl = document.getElementById('today-date');
const searchInput = document.getElementById('search-input');
const searchCount = document.getElementById('search-count');
const logoutBtn = document.getElementById('logout-btn');
const exportBtn = document.getElementById('export-btn');
const downloadLogsBtn = document.getElementById('download-logs-btn');
const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
const logsModalRoot = document.getElementById('logs-modal-root');
const bulkDeleteModalRoot = document.getElementById('bulk-delete-modal-root');

// Per-section college/grade/gender filter dropdowns.
const signupsCollegeFilter = document.getElementById('signups-college-filter');
const signupsGradeFilter = document.getElementById('signups-grade-filter');
const signupsGenderFilter = document.getElementById('signups-gender-filter');
const signinsCollegeFilter = document.getElementById('signins-college-filter');
const signinsGradeFilter = document.getElementById('signins-grade-filter');
const signinsGenderFilter = document.getElementById('signins-gender-filter');
const allPeopleCollegeFilter = document.getElementById('allpeople-college-filter');
const allPeopleGradeFilter = document.getElementById('allpeople-grade-filter');
const allPeopleGenderFilter = document.getElementById('allpeople-gender-filter');

// Tab bar.
const tabBtnSignups = document.getElementById('tab-btn-signups');
const tabBtnSignins = document.getElementById('tab-btn-signins');
const tabBtnAllPeople = document.getElementById('tab-btn-allpeople');
const panelSignups = document.getElementById('panel-signups');
const panelSignins = document.getElementById('panel-signins');
const panelAllPeople = document.getElementById('panel-allpeople');

let signupsTodayCache = [];
let signinsTodayCache = [];
let peopleCache = [];

const PAGE_SIZE = 10;
let signupsTodayCurrentPage = 1;
let signinsTodayCurrentPage = 1;
let allPeopleCurrentPage = 1;

// IDs checked in the "All people" table for bulk delete. Persists across
// re-renders (filtering, pagination, the 15s auto-refresh) within the page
// session — cleared explicitly after a successful delete.
const selectedPersonIds = new Set();

// ---------- helpers ----------

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
}
function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('ar');
}
function genderLabel(gender) {
  return gender === 'Male' ? 'ذكر' : gender === 'Female' ? 'أنثى' : gender;
}
function genderPill(gender) {
  const cls = gender === 'Male' ? 'male' : gender === 'Female' ? 'female' : '';
  return `<span class="pill ${cls}">${escapeHtml(genderLabel(gender))}</span>`;
}

function emptyState(text) {
  return `<div class="empty-state">${escapeHtml(text)}</div>`;
}

function goToLogin() {
  window.location.href = '/login.html';
}

// Fetch wrapper: redirects to /login.html on 401, throws on any other failure.
// Explicitly asks for JSON — without this, a bare fetch() sends Accept: */*,
// which the server's content negotiation treats as a preference for HTML and
// would 302-redirect to /login.html instead of returning 401 on an expired
// session, making res.json() below throw trying to parse that HTML page.
async function apiFetch(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 401) {
    goToLogin();
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    throw new Error(`Request to ${url} failed with ${res.status}`);
  }
  return res.json();
}

function showRefreshBanner(text) {
  refreshBanner.innerHTML = `<div class="status-banner error">${escapeHtml(text)}</div>`;
}
function clearRefreshBanner() {
  refreshBanner.innerHTML = '';
}

// ---------- tabs ----------

const TABS = {
  signups: { btn: tabBtnSignups, panel: panelSignups },
  signins: { btn: tabBtnSignins, panel: panelSignins },
  allpeople: { btn: tabBtnAllPeople, panel: panelAllPeople },
};

function setActiveTab(name) {
  Object.entries(TABS).forEach(([key, { btn, panel }]) => {
    if (!btn || !panel) return;
    const active = key === name;
    panel.style.display = active ? '' : 'none';
    btn.classList.toggle('gold', active);
    btn.classList.toggle('secondary', !active);
  });
}

if (tabBtnSignups) tabBtnSignups.addEventListener('click', () => setActiveTab('signups'));
if (tabBtnSignins) tabBtnSignins.addEventListener('click', () => setActiveTab('signins'));
if (tabBtnAllPeople) tabBtnAllPeople.addEventListener('click', () => setActiveTab('allpeople'));

// ---------- filter dropdowns ----------

// Fixed filter option lists — every stage/college/gender always shows up in
// the dropdowns even if nobody currently in the data has that value.
// Keep these value strings in sync with public/signup.js and server.js.
const FILTER_COLLEGES = [
  { value: 'College of Mechanical Engineering', label: 'كلية الهندسة الميكانيكية' },
  { value: 'College of Civil Engineering', label: 'كلية الهندسة المدنية' },
  { value: 'College of Electrical Engineering', label: 'كلية الهندسة الكهربائية' },
  { value: 'College of Electromechanical Engineering', label: 'كلية الهندسة الكهروميكانيكية' },
  { value: 'College of Artificial Intelligence Engineering', label: 'كلية هندسة الذكاء الاصطناعي' },
  { value: 'College of Chemical Engineering', label: 'كلية الهندسة الكيمياوية' },
  { value: 'College of Production Engineering', label: 'كلية الهندسة الإنتاجية' },
  { value: 'College of Applied Sciences', label: 'كلية العلوم التطبيقية' },
  { value: 'College of Architecture Engineering', label: 'كلية هندسة العمارة' },
  { value: 'College of Computer Science', label: 'كلية علوم الحاسوب' },
  { value: 'College of Computer Engineering', label: 'كلية هندسة الحاسوب' },
  { value: 'College of Materials Engineering', label: 'كلية هندسة المواد' },
  { value: 'College of Laser and Optoelectronics Engineering', label: 'كلية هندسة الليزر والإلكترونيات البصرية' },
  { value: 'College of Oil and Gas Engineering', label: 'كلية هندسة النفط والغاز' },
  { value: 'College of Communication Engineering', label: 'كلية هندسة الاتصالات' },
  { value: 'College of Biomedical Engineering', label: 'كلية الهندسة الطبية الحياتية' },
  { value: 'Other', label: 'أخرى' },
];
const FILTER_GRADES = [
  { value: '1st Year', label: 'السنة الأولى' },
  { value: '2nd Year', label: 'السنة الثانية' },
  { value: '3rd Year', label: 'السنة الثالثة' },
  { value: '4th Year', label: 'السنة الرابعة' },
  { value: '5th Year', label: 'السنة الخامسة' },
  { value: 'Graduate Student', label: 'طالب دراسات عليا' },
];
const FILTER_GENDERS = [
  { value: 'Male', label: 'ذكر' },
  { value: 'Female', label: 'أنثى' },
];

// Rebuilds a <select>'s options from a fixed { value, label } list, keeping
// the user's current selection if it's still one of the options (so a
// background refresh doesn't silently reset an active filter).
function populateSelectOptions(selectEl, options) {
  if (!selectEl) return;
  const previous = selectEl.value;
  const html = ['<option value="">الكل</option>']
    .concat(options.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`))
    .join('');
  selectEl.innerHTML = html;
  selectEl.value = options.some((o) => o.value === previous) ? previous : '';
}

function updateFilterOptions(selects) {
  if (selects.college) populateSelectOptions(selects.college, FILTER_COLLEGES);
  if (selects.grade) populateSelectOptions(selects.grade, FILTER_GRADES);
  if (selects.gender) populateSelectOptions(selects.gender, FILTER_GENDERS);
}

function filterByDropdowns(list, { college, grade, gender }) {
  return list.filter((item) => {
    if (college && item.college !== college) return false;
    if (grade && item.grade !== grade) return false;
    if (gender && item.gender !== gender) return false;
    return true;
  });
}

function filterPeople(list, query) {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((p) =>
    [p.name, p.college, p.grade, p.phone].some((field) => String(field ?? '').toLowerCase().includes(q))
  );
}

function getFilteredSignupsToday() {
  return filterByDropdowns(signupsTodayCache, {
    college: signupsCollegeFilter ? signupsCollegeFilter.value : '',
    grade: signupsGradeFilter ? signupsGradeFilter.value : '',
    gender: signupsGenderFilter ? signupsGenderFilter.value : '',
  });
}
function getFilteredSigninsToday() {
  return filterByDropdowns(signinsTodayCache, {
    college: signinsCollegeFilter ? signinsCollegeFilter.value : '',
    grade: signinsGradeFilter ? signinsGradeFilter.value : '',
    gender: signinsGenderFilter ? signinsGenderFilter.value : '',
  });
}
function getFilteredAllPeople() {
  const query = searchInput ? searchInput.value : '';
  const textFiltered = filterPeople(peopleCache, query);
  return filterByDropdowns(textFiltered, {
    college: allPeopleCollegeFilter ? allPeopleCollegeFilter.value : '',
    grade: allPeopleGradeFilter ? allPeopleGradeFilter.value : '',
    gender: allPeopleGenderFilter ? allPeopleGenderFilter.value : '',
  });
}

function clampPage(page, filteredCount) {
  const maxPage = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
  if (page > maxPage) return maxPage;
  if (page < 1) return 1;
  return page;
}

// ---------- pagination ----------

// Shared control renderer used by all three tables' pagination — same
// prev/page-label/next shape as before, just parameterized by an id prefix
// and an onChange callback so each table keeps its own page variable.
function renderPaginationControls(containerEl, idPrefix, currentPage, totalPages, onChange) {
  if (!containerEl) return;

  // Always show the controls (Prev/Next simply disable themselves when there's
  // only one page) so the pagination bar doesn't pop in/out as the row count
  // crosses the page-size boundary.
  containerEl.innerHTML = `
    <button type="button" id="${idPrefix}-prev" ${currentPage <= 1 ? 'disabled' : ''}>السابق</button>
    <span>صفحة ${currentPage} من ${totalPages}</span>
    <button type="button" id="${idPrefix}-next" ${currentPage >= totalPages ? 'disabled' : ''}>التالي</button>
  `;

  const prevBtn = document.getElementById(`${idPrefix}-prev`);
  const nextBtn = document.getElementById(`${idPrefix}-next`);
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentPage > 1) onChange(currentPage - 1);
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (currentPage < totalPages) onChange(currentPage + 1);
    });
  }
}

function renderSignupsTodayPagination(totalPages) {
  renderPaginationControls(signupsTodayPaginationEl, 'signups-today', signupsTodayCurrentPage, totalPages, (page) => {
    signupsTodayCurrentPage = page;
    renderSignupsToday();
  });
}
function renderSigninsTodayPagination(totalPages) {
  renderPaginationControls(signinsTodayPaginationEl, 'signins-today', signinsTodayCurrentPage, totalPages, (page) => {
    signinsTodayCurrentPage = page;
    renderSigninsToday();
  });
}
function renderAllPeoplePagination(totalPages) {
  renderPaginationControls(allPeoplePaginationEl, 'all-people', allPeopleCurrentPage, totalPages, (page) => {
    allPeopleCurrentPage = page;
    renderAllPeople();
  });
}

// ---------- rendering ----------

function renderStats(today) {
  statsRow.innerHTML = `
    <div class="stat-tile"><div class="value">${today.totalPeople}</div><div class="label">إجمالي الأشخاص</div></div>
    <div class="stat-tile"><div class="value">${today.signupsToday.length}</div><div class="label">سجّلوا اليوم</div></div>
    <div class="stat-tile"><div class="value">${today.signinsToday.length}</div><div class="label">حضور اليوم</div></div>
  `;
}

function renderSignupsToday() {
  const filtered = getFilteredSignupsToday();

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (signupsTodayCurrentPage > totalPages) signupsTodayCurrentPage = totalPages;
  if (signupsTodayCurrentPage < 1) signupsTodayCurrentPage = 1;

  const start = (signupsTodayCurrentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  signupsTodayEl.innerHTML = pageItems.length
    ? `<div class="table-scroll"><table>
        <thead><tr><th>الاسم</th><th>الكلية</th><th>المرحلة</th><th>الجنس</th><th>الوقت</th><th>عدد مرات الحضور (هذا العام)</th><th>آخر زيارة</th></tr></thead>
        <tbody>
          ${pageItems
            .map(
              (p) => `<tr data-id="${p.id}">
                <td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.college)}</td><td>${escapeHtml(p.grade)}</td><td>${genderPill(p.gender)}</td><td>${fmtTime(p.createdAt)}</td><td>${p.signinCount}</td><td>${p.lastVisit ? fmtDateTime(p.lastVisit) : '—'}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table></div>`
    : emptyState(signupsTodayCache.length ? 'لا توجد نتائج مطابقة للفلاتر المحددة.' : 'لم يسجّل أحد اليوم بعد.');

  renderSignupsTodayPagination(totalPages);
}

function renderSigninsToday() {
  const filtered = getFilteredSigninsToday();

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (signinsTodayCurrentPage > totalPages) signinsTodayCurrentPage = totalPages;
  if (signinsTodayCurrentPage < 1) signinsTodayCurrentPage = 1;

  const start = (signinsTodayCurrentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  signinsTodayEl.innerHTML = pageItems.length
    ? `<div class="table-scroll"><table>
        <thead><tr><th>الاسم</th><th>الكلية</th><th>المرحلة</th><th>الجنس</th><th>الوقت</th><th>عدد مرات الحضور (هذا العام)</th><th>آخر زيارة</th></tr></thead>
        <tbody>
          ${pageItems
            .map(
              (v) => `<tr data-id="${v.personId}">
                <td>${escapeHtml(v.name)}</td><td>${escapeHtml(v.college)}</td><td>${escapeHtml(v.grade)}</td><td>${genderPill(v.gender)}</td><td>${fmtTime(v.visitedAt)}</td><td>${v.signinCount}</td><td>${v.lastVisit ? fmtDateTime(v.lastVisit) : '—'}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table></div>`
    : emptyState(signinsTodayCache.length ? 'لا توجد نتائج مطابقة للفلاتر المحددة.' : 'لا يوجد حضور اليوم بعد.');

  renderSigninsTodayPagination(totalPages);
}

function renderAllPeople() {
  const filtered = getFilteredAllPeople();

  searchCount.textContent = peopleCache.length
    ? `${filtered.length} من ${peopleCache.length} شخص`
    : '';

  // Selections for people no longer in the loaded data (e.g. deleted from
  // another tab) shouldn't linger forever.
  const knownIds = new Set(peopleCache.map((p) => p.id));
  for (const id of selectedPersonIds) {
    if (!knownIds.has(id)) selectedPersonIds.delete(id);
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (allPeopleCurrentPage > totalPages) allPeopleCurrentPage = totalPages;
  if (allPeopleCurrentPage < 1) allPeopleCurrentPage = 1;

  const start = (allPeopleCurrentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);
  const allOnPageSelected = pageItems.length > 0 && pageItems.every((p) => selectedPersonIds.has(p.id));

  allPeopleEl.innerHTML = pageItems.length
    ? `<div class="table-scroll"><table>
        <thead><tr>
          <th><input type="checkbox" id="select-all-checkbox" ${allOnPageSelected ? 'checked' : ''} /></th>
          <th>الاسم</th><th>الهاتف</th><th>الكلية</th><th>المرحلة</th><th>الجنس</th><th>عدد مرات الحضور (هذا العام)</th><th>آخر زيارة</th><th>تاريخ التسجيل</th>
        </tr></thead>
        <tbody>
          ${pageItems
            .map(
              (p) => `<tr data-id="${p.id}">
                <td><input type="checkbox" class="row-select-checkbox" data-id="${p.id}" ${selectedPersonIds.has(p.id) ? 'checked' : ''} /></td>
                <td>${escapeHtml(p.name)}</td>
                <td>${escapeHtml(p.phone)}</td>
                <td>${escapeHtml(p.college)}</td>
                <td>${escapeHtml(p.grade)}</td>
                <td>${genderPill(p.gender)}</td>
                <td>${p.signinCount}</td>
                <td>${p.lastVisit ? fmtDateTime(p.lastVisit) : '—'}</td>
                <td>${fmtDateTime(p.createdAt)}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table></div>`
    : emptyState(peopleCache.length ? 'لا توجد نتائج مطابقة لبحثك.' : 'لم يسجّل أحد بعد.');

  renderAllPeoplePagination(totalPages);
  updateBulkDeleteButton();

  const selectAllCheckbox = document.getElementById('select-all-checkbox');
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('click', (e) => e.stopPropagation());
    selectAllCheckbox.addEventListener('change', () => {
      if (selectAllCheckbox.checked) {
        pageItems.forEach((p) => selectedPersonIds.add(p.id));
      } else {
        pageItems.forEach((p) => selectedPersonIds.delete(p.id));
      }
      renderAllPeople();
    });
  }
}

function updateBulkDeleteButton() {
  if (!bulkDeleteBtn) return;
  const count = selectedPersonIds.size;
  bulkDeleteBtn.disabled = count === 0;
  bulkDeleteBtn.textContent = count > 0 ? `حذف المحدد (${count})` : 'حذف المحدد';
}

// Event delegation, bound once, survives re-renders since we only replace innerHTML.
signupsTodayEl.addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-id]');
  if (row) openPersonModal(row.dataset.id);
});
signinsTodayEl.addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-id]');
  if (row) openPersonModal(row.dataset.id);
});
allPeopleEl.addEventListener('click', (e) => {
  if (e.target.closest('input[type="checkbox"]')) return; // handled by the change listener below
  const row = e.target.closest('tr[data-id]');
  if (row) openPersonModal(row.dataset.id);
});
allPeopleEl.addEventListener('change', (e) => {
  const checkbox = e.target.closest('.row-select-checkbox');
  if (!checkbox) return;
  const id = Number(checkbox.dataset.id);
  if (checkbox.checked) {
    selectedPersonIds.add(id);
  } else {
    selectedPersonIds.delete(id);
  }
  renderAllPeople();
});

if (searchInput) {
  searchInput.addEventListener('input', () => {
    allPeopleCurrentPage = 1;
    renderAllPeople();
  });
}

[signupsCollegeFilter, signupsGradeFilter, signupsGenderFilter].forEach((el) => {
  if (!el) return;
  el.addEventListener('change', () => {
    signupsTodayCurrentPage = 1;
    renderSignupsToday();
  });
});
[signinsCollegeFilter, signinsGradeFilter, signinsGenderFilter].forEach((el) => {
  if (!el) return;
  el.addEventListener('change', () => {
    signinsTodayCurrentPage = 1;
    renderSigninsToday();
  });
});
[allPeopleCollegeFilter, allPeopleGradeFilter, allPeopleGenderFilter].forEach((el) => {
  if (!el) return;
  el.addEventListener('change', () => {
    allPeopleCurrentPage = 1;
    renderAllPeople();
  });
});

if (exportBtn) {
  exportBtn.addEventListener('click', () => {
    window.location.href = '/api/export/people.csv';
  });
}

// ---------- download logs by day ----------

function closeLogsModal() {
  logsModalRoot.innerHTML = '';
}

function openLogsModal() {
  const today = new Date().toISOString().slice(0, 10);
  logsModalRoot.innerHTML = `
    <div class="modal-backdrop" id="logs-modal-backdrop">
      <div class="modal" style="max-width:400px">
        <button class="modal-close" id="logs-modal-close">✕</button>
        <h3 style="margin-top:0">تحميل السجلات حسب اليوم</h3>
        <label for="logs-date-input">اليوم</label>
        <input type="date" id="logs-date-input" value="${today}" max="${today}" />
        <label class="kicker" style="margin-top:18px">نوع السجلات</label>
        <label class="check-row">
          <input type="checkbox" id="logs-include-signup" checked /> سجلات التسجيل
        </label>
        <label class="check-row">
          <input type="checkbox" id="logs-include-signin" checked /> سجلات الحضور
        </label>
        <div id="logs-modal-error"></div>
        <div class="btn-row">
          <button type="button" id="logs-modal-download">تحميل</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('logs-modal-close').addEventListener('click', closeLogsModal);
  document.getElementById('logs-modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'logs-modal-backdrop') closeLogsModal();
  });
  document.getElementById('logs-modal-download').addEventListener('click', () => {
    const date = document.getElementById('logs-date-input').value;
    const includeSignup = document.getElementById('logs-include-signup').checked;
    const includeSignin = document.getElementById('logs-include-signin').checked;
    const errorEl = document.getElementById('logs-modal-error');

    if (!date) {
      errorEl.innerHTML = '<div class="status-banner error">الرجاء اختيار يوم.</div>';
      return;
    }
    if (!includeSignup && !includeSignin) {
      errorEl.innerHTML = '<div class="status-banner error">اختر نوعاً واحداً على الأقل من السجلات.</div>';
      return;
    }

    const types = [includeSignup && 'signup', includeSignin && 'signin'].filter(Boolean).join(',');
    window.location.href = `/api/export/logs.csv?date=${encodeURIComponent(date)}&types=${encodeURIComponent(types)}`;
    closeLogsModal();
  });
}

if (downloadLogsBtn) {
  downloadLogsBtn.addEventListener('click', openLogsModal);
}

// ---------- bulk delete ----------

function closeBulkDeleteModal() {
  bulkDeleteModalRoot.innerHTML = '';
}

function openBulkDeleteModal() {
  const count = selectedPersonIds.size;
  if (count === 0) return;

  bulkDeleteModalRoot.innerHTML = `
    <div class="modal-backdrop" id="bulk-delete-modal-backdrop">
      <div class="modal" style="max-width:420px">
        <button class="modal-close" id="bulk-delete-modal-close">✕</button>
        <h3 style="margin-top:0">حذف ${count} حساب${count > 1 ? 'ات' : ''}؟</h3>
        <p class="subtitle">سيتم حذف بيانات هذا الحساب وصوره وسجل زياراته نهائياً. لا يمكن التراجع عن هذا الإجراء.</p>
        <div id="bulk-delete-modal-error"></div>
        <div class="btn-row">
          <button type="button" class="secondary" id="bulk-delete-cancel">إلغاء</button>
          <button type="button" id="bulk-delete-confirm">حذف نهائياً</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('bulk-delete-modal-close').addEventListener('click', closeBulkDeleteModal);
  document.getElementById('bulk-delete-cancel').addEventListener('click', closeBulkDeleteModal);
  document.getElementById('bulk-delete-modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'bulk-delete-modal-backdrop') closeBulkDeleteModal();
  });
  document.getElementById('bulk-delete-confirm').addEventListener('click', async () => {
    const confirmBtn = document.getElementById('bulk-delete-confirm');
    const errorEl = document.getElementById('bulk-delete-modal-error');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'جارٍ الحذف...';

    try {
      const res = await fetch('/api/people', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedPersonIds) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        goToLogin();
        return;
      }
      if (!res.ok) {
        throw new Error(data.error || 'تعذّر حذف الحسابات المحددة.');
      }
      selectedPersonIds.clear();
      closeBulkDeleteModal();
      await loadDashboard(true);
    } catch (err) {
      console.error('Bulk delete failed:', err);
      errorEl.innerHTML = `<div class="status-banner error">${escapeHtml(err.message)}</div>`;
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'حذف نهائياً';
    }
  });
}

if (bulkDeleteBtn) {
  bulkDeleteBtn.addEventListener('click', openBulkDeleteModal);
}

// ---------- data loading ----------

async function loadDashboard(resetPage) {
  try {
    const [today, people] = await Promise.all([
      apiFetch('/api/dashboard/today'),
      apiFetch('/api/people'),
    ]);

    signupsTodayCache = today.signupsToday;
    signinsTodayCache = today.signinsToday;
    peopleCache = people;

    updateFilterOptions({
      college: signupsCollegeFilter,
      grade: signupsGradeFilter,
      gender: signupsGenderFilter,
    });
    updateFilterOptions({
      college: signinsCollegeFilter,
      grade: signinsGradeFilter,
      gender: signinsGenderFilter,
    });
    updateFilterOptions({
      college: allPeopleCollegeFilter,
      grade: allPeopleGradeFilter,
      gender: allPeopleGenderFilter,
    });

    // Only jump back to page 1 on the initial load or an explicit reason
    // (e.g. a filter or the search box changed) — NOT on the periodic 15s
    // auto-refresh, otherwise staff get bounced off page 2/3 every few seconds.
    if (resetPage) {
      signupsTodayCurrentPage = 1;
      signinsTodayCurrentPage = 1;
      allPeopleCurrentPage = 1;
    } else {
      signupsTodayCurrentPage = clampPage(signupsTodayCurrentPage, getFilteredSignupsToday().length);
      signinsTodayCurrentPage = clampPage(signinsTodayCurrentPage, getFilteredSigninsToday().length);
      allPeopleCurrentPage = clampPage(allPeopleCurrentPage, getFilteredAllPeople().length);
    }

    renderStats(today);
    renderSignupsToday();
    renderSigninsToday();
    renderAllPeople();
    clearRefreshBanner();
  } catch (err) {
    if (err.message === 'unauthorized') return; // already redirecting
    console.error('Failed to refresh dashboard:', err);
    showRefreshBanner('تعذّر تحديث بيانات اللوحة. ستتم إعادة المحاولة تلقائياً.');
  }
}

async function openPersonModal(id) {
  let person;
  try {
    person = await apiFetch(`/api/people/${id}`);
  } catch (err) {
    if (err.message === 'unauthorized') return;
    console.error('Failed to load person:', err);
    return;
  }

  const visitsHtml = person.visits.length
    ? person.visits
        .map(
          (v) =>
            `<tr><td>${v.kind === 'signup' ? 'تسجيل' : 'حضور'}</td><td>${fmtDateTime(v.visited_at)}</td></tr>`
        )
        .join('')
    : `<tr><td colspan="2">لا توجد زيارات مسجّلة.</td></tr>`;

  modalRoot.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal">
        <button class="modal-close" id="modal-close">✕</button>
        <div class="recognized-panel" style="margin-bottom:16px">
          <img src="${escapeHtml(person.photoUrl)}" style="width:70px;height:70px;border-radius:50%;object-fit:cover" />
          <div>
            <div style="font-size:1.2rem;font-weight:700">${escapeHtml(person.name)}</div>
            <div class="subtitle" style="margin:2px 0">${escapeHtml(person.college)} · ${escapeHtml(person.grade)} · ${escapeHtml(genderLabel(person.gender))}</div>
            <div class="subtitle" style="margin:2px 0">${escapeHtml(person.phone)}</div>
          </div>
        </div>
        <h3 style="margin-bottom:8px">السجل</h3>
        <div class="table-scroll">
          <table>
            <thead><tr><th>الحدث</th><th>الوقت</th></tr></thead>
            <tbody>${visitsHtml}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.getElementById('modal-close').addEventListener('click', () => (modalRoot.innerHTML = ''));
  document.getElementById('modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modal-backdrop') modalRoot.innerHTML = '';
  });
}

// ---------- auth / session ----------

async function checkSession() {
  try {
    const res = await fetch('/api/session');
    if (!res.ok) {
      goToLogin();
      return false;
    }
    const data = await res.json();
    if (!data.isAdmin) {
      goToLogin();
      return false;
    }
    return true;
  } catch (err) {
    console.error('Session check failed:', err);
    goToLogin();
    return false;
  }
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout request failed:', err);
    } finally {
      goToLogin();
    }
  });
}

if (todayDateEl) {
  todayDateEl.textContent = new Date().toLocaleDateString('ar', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// Set from here rather than an inline <script> in the HTML, since the CSP's
// script-src 'self' blocks inline scripts on every page.
const footerYearEl = document.getElementById('footer-year');
if (footerYearEl) footerYearEl.textContent = new Date().getFullYear();

// ---------- boot ----------

(async function init() {
  const ok = await checkSession();
  if (!ok) return;
  setActiveTab('allpeople');
  await loadDashboard(true);
  setInterval(loadDashboard, 15000);
})();
