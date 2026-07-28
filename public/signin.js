const MODEL_URL = 'models';

// Keep the tablet's screen from auto-dimming/locking while this kiosk page
// is open — this is an always-on scanning station, it must never go dark.
// Not all browsers support this API; it's a no-op there.
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
  if (document.visibilityState !== 'visible') return;
  if (!wakeLock) requestWakeLock();
  // Coming back to a backgrounded tab is exactly when the camera is most
  // likely to have died underneath us (see restartCameraIfNeeded below).
  restartCameraIfNeeded();
});
// Fires when the page is restored from the browser's back-forward cache
// (navigate away, then hit Back) — bfcache freezes all JS execution
// including this file's detectLoop timers, but browsers stop the camera's
// MediaStream when a page enters bfcache. On restore, JS resumes right
// where it left off and would otherwise keep running face detection against
// the <video> element's last frozen frame from before the page was left.
window.addEventListener('pageshow', (e) => {
  if (e.persisted) restartCameraIfNeeded();
});

// A larger detector input catches smaller/farther-away faces (someone not
// perfectly close to the camera), and a slightly lower confidence floor
// picks up marginal detections instead of silently skipping the frame — a
// false detection here just fails to match anyone, it's not a security risk.
const DETECTOR_OPTIONS = new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.4 });
// Wait 3s between scan attempts so the same person standing at the kiosk
// can't get scanned (and hit the server) more than once within a second.
const DETECT_INTERVAL_MS = 3000;
// Face matching itself now happens server-side (POST /api/signin takes the
// raw descriptor, not a client-asserted personId) — the server is also
// authoritative on the re-greet cooldown, so this kiosk never needs to
// download the whole biometric roster just to recognize who's in front of it.

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const banner = document.getElementById('banner');
const cameraWrap = document.getElementById('camera-wrap');
const flipCameraBtn = document.getElementById('flip-camera-btn');
const recognizedCard = document.getElementById('recognized-card');
const recognizedPhoto = document.getElementById('recognized-photo');
const recognizedName = document.getElementById('recognized-name');
const recognizedTime = document.getElementById('recognized-time');

let hideRecognizedCardTimer = null;
// The server returns the same cached visitedAt while a person is still
// within their cooldown window (repeated detections while they stand at
// the kiosk) — only play the chime/toast again once it's genuinely a new
// visit, not on every redetection of the same still-present face.
let lastShownVisitedAt = null;

// Single shared AudioContext for the success chime. Created eagerly at module
// scope: some browsers start it 'suspended' until a user gesture, which we
// defensively resume() right before playing. If construction itself throws
// (e.g. no Web Audio support), audioCtx stays undefined and playSuccessChime()
// just no-ops — this must never be able to break the sign-in flow.
let audioCtx;
try {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
} catch (err) {
  console.error('Web Audio API unavailable', err);
}

function playTone(freq, startTime, duration) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  // Short linear attack/decay envelope so the tone doesn't click/pop.
  const attack = 0.015;
  const release = 0.04;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(0.2, startTime + attack);
  gain.gain.setValueAtTime(0.2, Math.max(startTime + attack, startTime + duration - release));
  gain.gain.linearRampToValueAtTime(0, startTime + duration);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

function playSuccessChime() {
  if (!audioCtx) return;
  try {
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const now = audioCtx.currentTime;
    playTone(880, now, 0.12); // ding
    playTone(660, now + 0.12, 0.16); // dong
  } catch (err) {
    // Some browsers/contexts block audio (autoplay policy, no output device,
    // etc.) — never let that affect the actual sign-in flow.
    console.error('Failed to play success chime', err);
  }
}

function showSuccessToast(name) {
  try {
    // Transient toast, separate from the persistent #recognized-card panel.
    // Built via createElement/textContent (never innerHTML-interpolation),
    // matching this file's existing safe-rendering pattern.
    const toast = document.createElement('div');
    toast.className = 'status-banner success toast';
    toast.textContent = `تم تسجيل الحضور بنجاح — ${name}`;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  } catch (err) {
    console.error('Failed to show success toast', err);
  }
}

// Set from here rather than an inline <script> in the HTML, since the CSP's
// script-src 'self' blocks inline scripts on every page.
const footerYearEl = document.getElementById('footer-year');
if (footerYearEl) footerYearEl.textContent = new Date().getFullYear();

function showBanner(message, type) {
  // Built via textContent (never innerHTML-with-interpolation) so this is
  // safe even if `message` ever incorporates user-supplied data.
  const div = document.createElement('div');
  div.className = `status-banner ${type}`;
  div.textContent = message;
  banner.innerHTML = '';
  banner.appendChild(div);
}
function clearBanner() {
  banner.innerHTML = '';
}

async function loadModels() {
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);
}

let currentFacingMode = 'user';
let cameraStream = null;
let restartingCamera = false;

function isCameraHealthy() {
  if (!cameraStream) return false;
  const tracks = cameraStream.getVideoTracks();
  return tracks.length > 0 && tracks.every((t) => t.readyState === 'live');
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: currentFacingMode } });
  cameraStream = stream;
  // If the camera stops unexpectedly (tab backgrounded/bfcached, device
  // sleep, OS reclaimed the camera for another app, etc. — NOT us calling
  // .stop() ourselves, which never fires 'ended'), the <video> element would
  // otherwise just keep showing its last frozen frame forever while
  // detection kept running against that stale image, silently logging
  // attendance for whoever happened to be in that old frame.
  stream.getVideoTracks().forEach((track) => {
    track.addEventListener('ended', () => restartCameraIfNeeded());
  });
  video.srcObject = stream;
  return new Promise((resolve) => {
    video.onloadedmetadata = () => resolve();
  });
}

async function restartCameraIfNeeded() {
  if (restartingCamera || isCameraHealthy()) return;
  restartingCamera = true;
  if (cameraWrap) cameraWrap.classList.remove('ready');
  showBanner('جارٍ إعادة تشغيل الكاميرا...', 'info');
  try {
    const previousStream = cameraStream;
    await startCamera();
    if (previousStream) previousStream.getTracks().forEach((t) => t.stop());
    clearBanner();
    if (cameraWrap) cameraWrap.classList.add('ready');
  } catch (err) {
    console.error('Failed to restart camera', err);
    showBanner('تعذّر إعادة تشغيل الكاميرا. جارٍ إعادة المحاولة...', 'error');
    setTimeout(restartCameraIfNeeded, INIT_RETRY_MS);
  } finally {
    restartingCamera = false;
  }
}

async function flipCamera() {
  if (!flipCameraBtn) return;
  flipCameraBtn.disabled = true;
  flipCameraBtn.classList.add('spin');

  const previousMode = currentFacingMode;
  const previousStream = cameraStream;
  currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';

  try {
    await startCamera();
    if (previousStream) previousStream.getTracks().forEach((track) => track.stop());
  } catch (err) {
    // This device likely only has one camera — revert quietly instead of
    // leaving the kiosk without any camera at all.
    console.error('Failed to flip camera', err);
    currentFacingMode = previousMode;
    showBanner('لا توجد كاميرا أخرى متاحة على هذا الجهاز.', 'error');
    setTimeout(clearBanner, 2500);
  } finally {
    flipCameraBtn.disabled = false;
    setTimeout(() => flipCameraBtn.classList.remove('spin'), 500);
  }
}

// Sends a detected face's descriptor to the server, which does the actual
// matching (and cooldown bookkeeping) against the stored roster. Returns the
// matched person's greeting data, or null if nobody matched closely enough.
async function attemptSignin(descriptor) {
  const res = await fetch('/api/signin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ descriptor: Array.from(descriptor) }),
  });
  if (res.status === 404) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Sign-in failed');
  }
  return data;
}

function showRecognized(data) {
  recognizedPhoto.src = data.photoUrl;
  recognizedName.textContent = `أهلاً بعودتك، ${data.name}!`;
  recognizedTime.textContent = new Date(data.visitedAt).toLocaleString('ar');
  // Force the card's fade-in animation to replay on every new greeting.
  recognizedCard.classList.remove('card');
  void recognizedCard.offsetWidth;
  recognizedCard.classList.add('card');
  recognizedCard.style.display = 'block';
  clearBanner();

  if (data.visitedAt !== lastShownVisitedAt) {
    lastShownVisitedAt = data.visitedAt;
    playSuccessChime();
    showSuccessToast(data.name);
  }

  // Auto-hide the greeting card after 8 s so it doesn't block the camera
  // view for the next person. No redirect — the scan page stays live.
  if (hideRecognizedCardTimer) clearTimeout(hideRecognizedCardTimer);
  hideRecognizedCardTimer = setTimeout(() => {
    recognizedCard.style.display = 'none';
    hideRecognizedCardTimer = null;
  }, 8000);
}

async function detectLoop() {
  try {
    if (video.readyState !== 4) {
      return;
    }
    // Belt-and-suspenders: the 'ended'/visibilitychange/pageshow handlers
    // above should already catch a dead camera and restart it, but never run
    // face detection against a stream we know isn't live in the meantime —
    // that's exactly how a frozen frame could still get processed and log a
    // stale/incorrect sign-in.
    if (!isCameraHealthy()) {
      restartCameraIfNeeded();
      return;
    }

    const displaySize = { width: video.videoWidth, height: video.videoHeight };
    faceapi.matchDimensions(overlay, displaySize);

    const detections = await faceapi
      .detectAllFaces(video, DETECTOR_OPTIONS)
      .withFaceLandmarks()
      .withFaceDescriptors();

    const resized = faceapi.resizeResults(detections, displaySize);
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    faceapi.draw.drawDetections(overlay, resized);

    if (detections.length === 0) {
      showBanner('جارٍ البحث عن وجه...', 'info');
    } else {
      let anyMatch = false;
      let hadError = false;
      // Sequential on purpose (not Promise.all) — this naturally serializes
      // requests instead of firing them concurrently, and the server-side
      // matching is synchronous/single-threaded anyway so there's nothing
      // to gain from parallelizing a handful of in-frame faces.
      for (const det of detections) {
        try {
          const data = await attemptSignin(det.descriptor);
          if (data) {
            anyMatch = true;
            showRecognized(data);
          }
        } catch (err) {
          console.error('Sign-in failed', err);
          hadError = true;
        }
      }
      if (hadError) {
        showBanner('تعذّر تسجيل الحضور، حاول مرة أخرى بعد قليل.', 'error');
      } else if (!anyMatch) {
        showBanner('لم يتم التعرف على الوجه. الرجاء التسجيل أولاً من الجهاز الآخر.', 'error');
        recognizedCard.style.display = 'none';
      }
    }
  } catch (err) {
    // A single bad frame (dropped frame, transient WebGL hiccup) must never
    // permanently stop scanning on an unattended kiosk.
    console.error('Face detection error', err);
  } finally {
    setTimeout(detectLoop, DETECT_INTERVAL_MS);
  }
}

const INIT_RETRY_MS = 5000;

async function main() {
  showBanner('جارٍ تحميل نظام التعرف على الوجه...', 'info');
  try {
    await Promise.all([loadModels(), startCamera()]);
  } catch (err) {
    // This kiosk is unattended, so a transient failure (camera permission
    // dialog dismissed, a model file blip) must not strand it on the loading
    // banner forever — show what happened and keep retrying automatically.
    console.error('Failed to start sign-in kiosk', err);
    const reason =
      err && err.name === 'NotAllowedError'
        ? 'تم رفض الوصول إلى الكاميرا.'
        : err && err.name === 'NotFoundError'
          ? 'لم يتم العثور على كاميرا.'
          : 'تعذّر تشغيل الكاميرا أو تحميل نظام التعرف على الوجه.';
    showBanner(`${reason} جارٍ إعادة المحاولة...`, 'error');
    setTimeout(main, INIT_RETRY_MS);
    return;
  }
  clearBanner();
  if (cameraWrap) cameraWrap.classList.add('ready');
  detectLoop();
}

if (flipCameraBtn) {
  flipCameraBtn.addEventListener('click', flipCamera);
}

main();
