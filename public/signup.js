// ---- Configure these lists for your university ----
// `value` stays the exact English string the server validates against;
// `label` is the Arabic text shown to the person standing at the kiosk.
const COLLEGES = [
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

const GRADES = [
  { value: '1st Year', label: 'السنة الأولى' },
  { value: '2nd Year', label: 'السنة الثانية' },
  { value: '3rd Year', label: 'السنة الثالثة' },
  { value: '4th Year', label: 'السنة الرابعة' },
  { value: '5th Year', label: 'السنة الخامسة' },
  { value: 'Graduate Student', label: 'طالب دراسات عليا' },
];
// -----------------------------------------------------

const MODEL_URL = 'models';

// Keep the tablet's screen from auto-dimming/locking while this kiosk page
// is open — a shared device standing idle between people would otherwise
// go dark mid-flow. Not all browsers support this API; it's a no-op there.
let wakeLock = null;
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (err) {
    console.error('Wake lock request failed', err);
  }
}
requestWakeLock();
document.addEventListener('visibilitychange', () => {
  // The lock is released automatically whenever the tab is hidden — this
  // reacquires it as soon as the kiosk page is visible again.
  if (document.visibilityState === 'visible' && !wakeLock) requestWakeLock();
});

const stepInfo = document.getElementById('step-info');
const stepPhoto = document.getElementById('step-photo');
const continueBtn = document.getElementById('continue-btn');
const backBtn = document.getElementById('back-btn');

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const capturedImg = document.getElementById('captured-img');
const captureBtn = document.getElementById('capture-btn');
const retakeBtn = document.getElementById('retake-btn');
const submitBtn = document.getElementById('submit-btn');
const banner = document.getElementById('banner');
const collegeSelect = document.getElementById('college');
const gradeSelect = document.getElementById('grade');
const genderGroup = document.getElementById('gender-group');
const nameInput = document.getElementById('name');
const phoneInput = document.getElementById('phone');
const pageEl = document.querySelector('.page');

let capturedDescriptor = null;
let capturedPhotoDataUrl = null;
let modelsReady = false;
let modelsLoading = null;
let cameraStream = null;

function populateSelect(select, options) {
  // `options` is a fixed, developer-controlled constant (never user input),
  // so building this via innerHTML is safe here, same as before.
  select.innerHTML =
    '<option value="" disabled selected>اختر...</option>' +
    options.map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
}
populateSelect(collegeSelect, COLLEGES);
populateSelect(gradeSelect, GRADES);

function showBanner(message, type) {
  // Built via textContent (never innerHTML-with-interpolation) so this is
  // safe even though `message` sometimes includes the name just typed in by
  // whoever is standing at this shared, unattended kiosk.
  const div = document.createElement('div');
  div.className = `status-banner ${type}`;
  div.textContent = message;
  banner.innerHTML = '';
  banner.appendChild(div);
}
function clearBanner() {
  banner.innerHTML = '';
}

// Set from here rather than an inline <script> in the HTML, since the CSP's
// script-src 'self' blocks inline scripts on every page.
const footerYearEl = document.getElementById('footer-year');
if (footerYearEl) footerYearEl.textContent = new Date().getFullYear();

genderGroup.querySelectorAll('label').forEach((lbl) => {
  lbl.addEventListener('click', () => {
    genderGroup.querySelectorAll('label').forEach((l) => l.classList.remove('selected'));
    lbl.classList.add('selected');
  });
});

function loadModels() {
  if (!modelsLoading) {
    modelsLoading = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ])
      .then(() => {
        modelsReady = true;
      })
      .catch((err) => {
        // Don't memoize a permanent failure — let the next call (e.g. the
        // user clicking Continue again) retry instead of being stuck forever.
        modelsLoading = null;
        throw err;
      });
  }
  return modelsLoading;
}
loadModels().catch(() => {
  // Swallowed here; the continueBtn handler below awaits loadModels() again
  // and surfaces a banner if it still fails at that point.
});

async function startCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    // If the camera dies unexpectedly later (tab backgrounded/bfcached, OS
    // reclaimed it, etc. — not us calling stop(), which never fires 'ended')
    // while someone's mid-signup, the <video> would otherwise just freeze on
    // its last frame and "Capture Photo" could grab that stale image.
    cameraStream.getVideoTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        if (stepPhoto.style.display !== 'none') startCamera();
      });
    });
    video.srcObject = cameraStream;
  } catch (err) {
    showBanner('تعذّر الوصول إلى الكاميرا: ' + err.message, 'error');
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  // Otherwise the <video> keeps showing the last frozen frame from whoever
  // just used the kiosk until the next person's stream loads in.
  video.srcObject = null;
}

// Restore from the browser's back-forward cache (navigate away, hit Back) —
// bfcache stops the camera stream; if we're still sitting on the photo step
// when the page comes back, get a fresh stream instead of leaving a frozen one.
window.addEventListener('pageshow', (e) => {
  if (e.persisted && stepPhoto.style.display !== 'none') startCamera();
});

function getGender() {
  const input = genderGroup.querySelector('input[name="gender"]:checked');
  return input ? input.value : null;
}

continueBtn.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  const phone = phoneInput.value.trim();
  const college = collegeSelect.value;
  const grade = gradeSelect.value;
  const gender = getGender();

  if (!name || !phone || !college || !grade || !gender) {
    showBanner('الرجاء تعبئة جميع الحقول.', 'error');
    return;
  }

  clearBanner();
  stepInfo.style.display = 'none';
  stepPhoto.style.display = 'block';

  if (!modelsReady) {
    showBanner('جارٍ تحميل نظام التعرف على الوجه...', 'info');
    try {
      await loadModels();
    } catch (err) {
      console.error('Failed to load face detection models', err);
      showBanner('تعذّر تحميل نظام التعرف على الوجه. تحقق من الاتصال وحاول مرة أخرى.', 'error');
      stepPhoto.style.display = 'none';
      stepInfo.style.display = 'block';
      return;
    }
    clearBanner();
  }
  await startCamera();
});

backBtn.addEventListener('click', () => {
  stopCamera();
  clearBanner();
  stepPhoto.style.display = 'none';
  stepInfo.style.display = 'block';
});

captureBtn.addEventListener('click', async () => {
  if (!modelsReady) return;
  captureBtn.disabled = true;
  captureBtn.textContent = 'جارٍ التعرف على الوجه...';

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const detection = await faceapi
    .detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();

  captureBtn.disabled = false;
  captureBtn.textContent = 'التقاط الصورة';

  if (!detection) {
    showBanner('لم يتم العثور على وجه. الرجاء النظر إلى الكاميرا والمحاولة مرة أخرى.', 'error');
    return;
  }

  clearBanner();
  capturedDescriptor = Array.from(detection.descriptor);
  capturedPhotoDataUrl = canvas.toDataURL('image/jpeg', 0.9);

  capturedImg.src = capturedPhotoDataUrl;
  capturedImg.style.display = 'block';
  video.style.display = 'none';
  captureBtn.style.display = 'none';
  retakeBtn.style.display = 'block';
  updateSubmitState();
});

retakeBtn.addEventListener('click', () => {
  capturedDescriptor = null;
  capturedPhotoDataUrl = null;
  capturedImg.style.display = 'none';
  video.style.display = 'block';
  captureBtn.style.display = 'block';
  retakeBtn.style.display = 'none';
  clearBanner();
  updateSubmitState();
});

function updateSubmitState() {
  submitBtn.disabled = !capturedDescriptor;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Builds one of the two transition-overlay cards (success checkmark, then
// "getting ready for the next person" spinner) that stand in for #step-photo
// between one person's sign-up and the next, without a page reload.
function buildOverlay(children) {
  const overlay = document.createElement('div');
  overlay.className = 'card transition-overlay';
  children.forEach((child) => overlay.appendChild(child));
  return overlay;
}

// Runs the post-submit success -> "next person" sequence and resets the
// kiosk back to step 1, ready for whoever walks up next. Deliberately does
// NOT touch modelsReady/modelsLoading, so the already-loaded face-api models
// stay cached for the next sign-up instead of being fetched all over again.
async function runSuccessSequence(name) {
  clearBanner();
  stepPhoto.style.display = 'none';

  const checkmark = document.createElement('div');
  checkmark.className = 'checkmark-badge';
  checkmark.textContent = '✓';

  const successTitle = document.createElement('div');
  successTitle.className = 'title';
  successTitle.textContent = 'تم التسجيل بنجاح!';

  // Built via textContent, never string-interpolated into innerHTML.
  const successSubtitle = document.createElement('p');
  successSubtitle.className = 'subtitle';
  successSubtitle.textContent = `أهلاً بك، ${name}`;

  const successOverlay = buildOverlay([checkmark, successTitle, successSubtitle]);
  pageEl.insertBefore(successOverlay, stepPhoto.nextSibling);

  // Show success for 2 seconds then go back to the main screen.
  await wait(2000);
  window.location.href = 'index.html';
}

submitBtn.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  const phone = phoneInput.value.trim();
  const college = collegeSelect.value;
  const grade = gradeSelect.value;
  const gender = getGender();

  if (!name || !phone || !college || !grade || !gender) {
    showBanner('الرجاء تعبئة جميع الحقول.', 'error');
    return;
  }
  if (!capturedDescriptor) {
    showBanner('الرجاء التقاط صورة أولاً.', 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'جارٍ التسجيل...';

  try {
    const res = await fetch('/api/people', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        phone,
        college,
        grade,
        gender,
        descriptor: capturedDescriptor,
        photo: capturedPhotoDataUrl,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'فشل التسجيل');
    }
    const person = await res.json();
    stopCamera();
    await runSuccessSequence(person.name);
  } catch (err) {
    showBanner(err.message, 'error');
    submitBtn.disabled = false;
    submitBtn.textContent = 'تسجيل';
  }
});
