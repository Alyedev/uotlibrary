// ---- Grade options (keep in sync with signup.js and server.js) ----
const GRADES = [
  { value: '1st Year',         label: 'السنة الأولى' },
  { value: '2nd Year',         label: 'السنة الثانية' },
  { value: '3rd Year',         label: 'السنة الثالثة' },
  { value: '4th Year',         label: 'السنة الرابعة' },
  { value: '5th Year',         label: 'السنة الخامسة' },
  { value: 'Graduate Student', label: 'طالب دراسات عليا' },
];

const MODEL_URL = 'models';

// ---- DOM refs ----
const bannerEl      = document.getElementById('banner');
const stepVerify    = document.getElementById('step-verify');
const stepEdit      = document.getElementById('step-edit');
const verifyNameEl  = document.getElementById('verify-name');
const verifyPhoneEl = document.getElementById('verify-phone');
const verifyBtn     = document.getElementById('verify-btn');

const currentPhoto   = document.getElementById('current-photo');
const currentNameEl  = document.getElementById('current-name');
const currentGradeEl = document.getElementById('current-grade');

const editGrade  = document.getElementById('edit-grade');
const editPhone  = document.getElementById('edit-phone');
const backBtn    = document.getElementById('back-btn');
const saveBtn    = document.getElementById('save-btn');

const cameraWrap     = document.getElementById('camera-wrap');
const video          = document.getElementById('video');
const canvas         = document.getElementById('canvas');
const capturedImg    = document.getElementById('captured-img');
const openCameraBtn  = document.getElementById('open-camera-btn');
const captureActions = document.getElementById('capture-actions');
const captureBtn     = document.getElementById('capture-btn');
const retakeBtn      = document.getElementById('retake-btn');
const flipBtn        = document.getElementById('flip-camera-btn');

const footerYear = document.getElementById('footer-year');
if (footerYear) footerYear.textContent = new Date().getFullYear();

// Cancel — go back to main screen without doing anything
const cancelBtn = document.getElementById('cancel-btn');
if (cancelBtn) cancelBtn.addEventListener('click', () => {
  if (window.showLoadingAndNavigate) window.showLoadingAndNavigate('index.html');
  else window.location.href = 'index.html';
});

// ---- State ----
let foundPerson          = null;  // person returned from /api/people/self-lookup
let cameraStream         = null;
let capturedPhotoDataUrl = null;
let capturedDescriptor   = null;
let modelsReady          = false;
let modelsLoading        = null;
let facingMode           = 'user';

// ---- Normalise Arabic-Indic digits ----
function normalizePhone(str) {
  return str.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.codePointAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  }).trim();
}

// ---- Banner helpers ----
function showBanner(msg, type = 'info') {
  const div = document.createElement('div');
  div.className = `status-banner ${type}`;
  div.textContent = msg;
  bannerEl.innerHTML = '';
  bannerEl.appendChild(div);
}
function clearBanner() { bannerEl.innerHTML = ''; }

// ---- Populate grade <select> ----
function populateGrades(selectedValue) {
  editGrade.innerHTML = '';
  for (const g of GRADES) {
    const opt = document.createElement('option');
    opt.value = g.value;
    opt.textContent = g.label;
    if (g.value === selectedValue) opt.selected = true;
    editGrade.appendChild(opt);
  }
}

function gradeLabel(val) {
  return (GRADES.find(g => g.value === val) || {}).label || val;
}

// ---- Verify step ----
verifyBtn.addEventListener('click', async () => {
  clearBanner();
  const name  = verifyNameEl.value.trim();
  const phone = normalizePhone(verifyPhoneEl.value);

  if (name.length < 2) return showBanner('يرجى إدخال الاسم الكامل', 'error');
  if (!phone)          return showBanner('يرجى إدخال رقم الهاتف', 'error');

  verifyBtn.disabled    = true;
  verifyBtn.textContent = 'جارٍ التحقق…';

  try {
    const res  = await fetch('/api/people/self-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone }),
    });
    const data = await res.json();

    if (!res.ok) {
      showBanner(data.error || 'لم يتم العثور على حسابك. تأكد من كتابة اسمك الكامل تماماً كما سجّلته، ورقم هاتفك كاملاً مع الصفر في البداية (مثال: 07701234567).', 'error');
      return;
    }

    foundPerson = data;
    loadEditStep();
  } catch {
    showBanner('حدث خطأ في الاتصال بالخادم', 'error');
  } finally {
    verifyBtn.disabled    = false;
    verifyBtn.textContent = 'تحقق وتابع';
  }
});

function loadEditStep() {
  stepVerify.style.display = 'none';
  stepEdit.style.display   = '';
  clearBanner();

  currentPhoto.src           = foundPerson.photoUrl;
  currentNameEl.textContent  = foundPerson.name;
  currentGradeEl.textContent = gradeLabel(foundPerson.grade);

  populateGrades(foundPerson.grade);
  editPhone.value = foundPerson.phone;

  // Reset any previous photo capture
  capturedPhotoDataUrl = null;
  capturedDescriptor   = null;
  resetCameraUI();

  // Hint: all fields are optional
  showBanner('جميع الحقول اختيارية — عدّل ما تريد فقط، أو اضغط "حفظ" بدون تغيير.', 'info');
}

// ---- Back button ----
backBtn.addEventListener('click', () => {
  stopCamera();
  stepEdit.style.display   = 'none';
  stepVerify.style.display = '';
  clearBanner();
  foundPerson = null;
});

// ---- Camera / photo capture ----
async function loadModels() {
  if (modelsReady) return;
  if (modelsLoading) return modelsLoading;
  modelsLoading = Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]).then(() => { modelsReady = true; });
  return modelsLoading;
}

async function startCamera() {
  stopCamera();
  try {
    const constraints = {
      video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    };
    cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = cameraStream;
    await video.play();
    cameraWrap.style.display     = '';
    captureActions.style.display = '';
    document.getElementById('photo-actions').style.display = 'none';
  } catch {
    showBanner('تعذّر الوصول إلى الكاميرا', 'error');
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
}

function resetCameraUI() {
  stopCamera();
  cameraWrap.style.display     = 'none';
  captureActions.style.display = 'none';
  document.getElementById('photo-actions').style.display = '';
  video.style.display       = '';
  capturedImg.style.display = 'none';
  retakeBtn.style.display   = 'none';
  captureBtn.style.display  = '';
  captureBtn.disabled       = false;
  captureBtn.textContent    = 'التقاط الصورة';
}

openCameraBtn.addEventListener('click', async () => {
  clearBanner();
  openCameraBtn.disabled    = true;
  openCameraBtn.textContent = 'جارٍ تحميل النماذج…';
  try {
    await loadModels();
    await startCamera();
  } catch {
    showBanner('حدث خطأ أثناء تهيئة الكاميرا', 'error');
  } finally {
    openCameraBtn.disabled    = false;
    openCameraBtn.textContent = 'تغيير الصورة';
  }
});

flipBtn.addEventListener('click', async () => {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  flipBtn.classList.add('spin');
  setTimeout(() => flipBtn.classList.remove('spin'), 500);
  await startCamera();
});

captureBtn.addEventListener('click', async () => {
  clearBanner();
  captureBtn.disabled    = true;
  captureBtn.textContent = 'جارٍ التحليل…';

  try {
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    const detection = await faceapi
      .detectSingleFace(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) {
      showBanner('لم يتم اكتشاف وجه واضح. حاول مجدداً مع إضاءة أفضل.', 'error');
      captureBtn.disabled    = false;
      captureBtn.textContent = 'التقاط الصورة';
      return;
    }

    capturedDescriptor   = Array.from(detection.descriptor);
    capturedPhotoDataUrl = canvas.toDataURL('image/jpeg', 0.85);

    capturedImg.src           = capturedPhotoDataUrl;
    capturedImg.style.display = '';
    video.style.display       = 'none';
    retakeBtn.style.display   = '';
    captureBtn.style.display  = 'none';
    stopCamera();

    showBanner('تم التقاط الصورة بنجاح ✓', 'success');
  } catch {
    showBanner('حدث خطأ أثناء معالجة الصورة', 'error');
    captureBtn.disabled    = false;
    captureBtn.textContent = 'التقاط الصورة';
  }
});

retakeBtn.addEventListener('click', async () => {
  capturedPhotoDataUrl = null;
  capturedDescriptor   = null;
  capturedImg.style.display = 'none';
  video.style.display       = '';
  retakeBtn.style.display   = 'none';
  captureBtn.style.display  = '';
  captureBtn.disabled       = false;
  captureBtn.textContent    = 'التقاط الصورة';
  clearBanner();
  await startCamera();
});

// ---- Save ----
saveBtn.addEventListener('click', async () => {
  clearBanner();

  const newGrade = editGrade.value;
  const newPhone = normalizePhone(editPhone.value);

  // Phone must at least be non-empty (even if unchanged)
  if (!newPhone) return showBanner('يرجى إدخال رقم هاتف صالح', 'error');

  // Build payload — only include changed fields.
  // The server always needs (name + phone) to re-identify the person.
  const payload = {
    name:     foundPerson.name,
    phone:    foundPerson.phone,   // current phone for server-side re-verification
    newPhone,
    newGrade,
  };

  // Photo is optional — only send if the person actually took a new one.
  if (capturedPhotoDataUrl) {
    payload.photo      = capturedPhotoDataUrl;
    payload.descriptor = capturedDescriptor;
  }

  saveBtn.disabled    = true;
  saveBtn.textContent = 'جارٍ الحفظ…';

  try {
    const res  = await fetch('/api/people/self-update', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      showBanner(data.error || 'تعذّر حفظ التغييرات', 'error');
      return;
    }

    // Brief success message, then return to main screen.
    showBanner('تم حفظ التغييرات بنجاح ✓', 'success');
    setTimeout(() => {
      window.location.href = 'index.html';
    }, 1800);
  } catch {
    showBanner('حدث خطأ في الاتصال بالخادم', 'error');
  } finally {
    saveBtn.disabled    = false;
    saveBtn.textContent = 'حفظ التغييرات';
  }
});
