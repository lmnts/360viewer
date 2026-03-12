import * as THREE from "three";

// ── DOM refs ──────────────────────────────────────────────────────────────────
const uploadScreen  = document.getElementById("upload-screen");
const viewerScreen  = document.getElementById("viewer-screen");
const fileInput     = document.getElementById("file-input");
const dropZone      = document.getElementById("drop-zone");
const browseBtn     = document.getElementById("browse-btn");
const canvas        = document.getElementById("viewer-canvas");
const backBtn       = document.getElementById("back-btn");
const imageNameEl   = document.getElementById("image-name");
const zoomInBtn     = document.getElementById("zoom-in");
const zoomOutBtn    = document.getElementById("zoom-out");
const urlInput      = document.getElementById("url-input");
const urlLoadBtn    = document.getElementById("url-load-btn");
const urlError      = document.getElementById("url-error");
const projToggleBtn = document.getElementById("proj-toggle");

// ── Three.js state ────────────────────────────────────────────────────────────
let renderer, scene, camera, sphere;

// ── Projection mode ───────────────────────────────────────────────────────────
// "equirect"   – standard equirectangular (default)
// "cylindrical" – rectilinear cylindrical: vertical stored as tan(elevation),
//                 common output of LiDAR scanners / rectilinear-lens rigs
let projectionMode = "equirect";
let lastLoadedFile = null;
let lastLoadedURL  = null;

// Camera spherical coords (lon/lat in radians)
let lon = 0;      // horizontal angle (yaw)
let lat = 0;      // vertical angle (pitch), clamped
const TARGET_FOV  = { value: 90 };   // degrees
const FOV_MIN     = 30;
const FOV_MAX     = 130;
const LAT_LIMIT   = Math.PI / 2 - 0.05;

// ── Setup Three.js ────────────────────────────────────────────────────────────
function initRenderer() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(TARGET_FOV.value, 1, 0.1, 1000);
  camera.position.set(0, 0, 0);

  // Sphere geometry — large radius, render inside by negating x-scale
  const geo = new THREE.SphereGeometry(500, 256, 128);
  // Flip geometry so we see it from the inside
  geo.scale(-1, 1, 1);

  sphere = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  scene.add(sphere);

  resizeRenderer();
  window.addEventListener("resize", resizeRenderer);
}

function resizeRenderer() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  if (camera) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}

function updateCamera() {
  // Convert lon/lat to a look-at direction
  const phi   = Math.PI / 2 - lat;          // polar angle from +Y
  const theta = lon;                         // azimuthal from +Z

  const x = Math.sin(phi) * Math.sin(theta);
  const y = Math.cos(phi);
  const z = Math.sin(phi) * Math.cos(theta);

  camera.lookAt(x, y, z);
}

function animate() {
  requestAnimationFrame(animate);
  // Smoothly interpolate FOV
  if (Math.abs(camera.fov - TARGET_FOV.value) > 0.1) {
    camera.fov += (TARGET_FOV.value - camera.fov) * 0.12;
    camera.updateProjectionMatrix();
  }
  updateCamera();
  renderer.render(scene, camera);
}

// ── Load image into sphere texture ───────────────────────────────────────────

// For equirectangular images that aren't exactly 2:1, adjust texture
// repeat/offset so pixels aren't stretched.
function applyEquirectTexture(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  const img = texture.image;
  const w = img?.naturalWidth || img?.width;
  const h = img?.naturalHeight || img?.height;
  if (w && h && isFinite(w / h)) {
    const r = w / h;
    const ideal = 2.0;
    if (Math.abs(r - ideal) > 0.05) {
      const scale = r / ideal;
      texture.repeat.set(1, scale);
      texture.offset.set(0, -(scale - 1) / 2);
      texture.wrapT = THREE.ClampToEdgeWrapping;
    }
  }
  sphere.material = new THREE.MeshBasicMaterial({ map: texture });
}

// Remap a cylindrical-projection image to equirectangular via an offscreen
// canvas, then apply.  In rectilinear cylindrical projection the image's
// vertical coordinate is proportional to tan(elevation_angle) rather than to
// the elevation angle itself.  Mapping such an image straight onto the sphere
// makes horizontal lines bow into a "frown" shape.  We correct this by
// resampling each output row from the correct input row.
//
// vertFovDeg — assumed total vertical field of view of the original capture
//              (e.g. 90 means ±45°).  180 = full equirectangular (no-op).
function remapCylindricalToEquirect(imgBitmap, vertFovDeg) {
  const sw = imgBitmap.width;
  const sh = imgBitmap.height;

  // Output is always 2:1 equirectangular
  const dw = sw;
  const dh = Math.round(sw / 2);

  const srcCanvas = new OffscreenCanvas(sw, sh);
  srcCanvas.getContext("2d").drawImage(imgBitmap, 0, 0);

  const dstCanvas = new OffscreenCanvas(dw, dh);
  const dstCtx = dstCanvas.getContext("2d");

  const halfVertRad = (vertFovDeg / 2) * (Math.PI / 180);

  // For each destination row (equirectangular latitude)
  for (let dy = 0; dy < dh; dy++) {
    // Equirectangular: latitude goes from +π/2 (top, dy=0) to -π/2 (bottom)
    const lat = Math.PI / 2 - (dy / dh) * Math.PI;  // radians

    // Cylindrical source row for this latitude:
    // v_cyl = (tan(lat) / tan(halfVertRad) + 1) / 2   (normalised 0–1)
    const v_cyl = (Math.tan(lat) / Math.tan(halfVertRad) + 1) / 2;

    if (v_cyl < 0 || v_cyl > 1) {
      // Outside the captured vertical range — leave transparent
      continue;
    }

    const sy = v_cyl * sh;  // fractional source row

    // Copy one source row to the destination row via a 1-pixel-tall drawImage
    dstCtx.drawImage(
      srcCanvas,
      0, sy,          // src x, y
      sw, 1,          // src width, height (1-px strip)
      0, dy,          // dst x, y
      dw, 1           // dst width, height
    );
  }

  return dstCanvas;
}

function applyTextureForMode(texture) {
  if (projectionMode === "cylindrical") {
    const img = texture.image;
    const bitmap = img instanceof ImageBitmap ? img
                 : img instanceof HTMLImageElement ? img
                 : null;
    if (!bitmap) { applyEquirectTexture(texture); return; }

    // 90° total vertical FOV (±45°) matches common LiDAR scanner output.
    // Adjust this constant if your scanner uses a different vertical coverage.
    const vertFovDeg = 90;

    const remapped = remapCylindricalToEquirect(bitmap, vertFovDeg);
    createImageBitmap(remapped).then((bmp) => {
      const t2 = new THREE.Texture(bmp);
      t2.colorSpace = THREE.SRGBColorSpace;
      t2.needsUpdate = true;
      sphere.material = new THREE.MeshBasicMaterial({ map: t2 });
    });
  } else {
    applyEquirectTexture(texture);
  }
}

function loadTextureFromURL(url, name) {
  lastLoadedURL  = url;
  lastLoadedFile = null;
  const loader = new THREE.TextureLoader();
  loader.crossOrigin = "anonymous";
  loader.load(
    url,
    (texture) => { applyTextureForMode(texture); },
    undefined,
    () => {
      // Load failed — likely CORS. Show error and go back.
      viewerScreen.classList.add("hidden");
      uploadScreen.classList.remove("hidden");
      urlError.textContent = "Could not load image — the server may not allow cross-origin requests.";
    }
  );
  imageNameEl.textContent = name;
  uploadScreen.classList.add("hidden");
  viewerScreen.classList.remove("hidden");
  resizeRenderer();
  lon = 0; lat = 0;
  TARGET_FOV.value = 90; camera.fov = 90; camera.updateProjectionMatrix();
}

function loadImage(file) {
  lastLoadedFile = file;
  lastLoadedURL  = null;
  const url = URL.createObjectURL(file);
  const loader = new THREE.TextureLoader();
  loader.load(url, (texture) => {
    applyTextureForMode(texture);
    URL.revokeObjectURL(url);
  });
}

// ── Drag / pan controls ───────────────────────────────────────────────────────
let pointerDown = false;
let lastX = 0, lastY = 0;

// Speed factor: slower at narrow FOV (zoomed in), faster when wide
function dragSpeed() {
  return camera.fov / 20000;
}

canvas.addEventListener("pointerdown", (e) => {
  pointerDown = true;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.classList.add("dragging");
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  if (!pointerDown) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;

  lon -= dx * dragSpeed();
  lat -= dy * dragSpeed();
  lat = Math.max(-LAT_LIMIT, Math.min(LAT_LIMIT, lat));
});

canvas.addEventListener("pointerup",    () => { pointerDown = false; canvas.classList.remove("dragging"); });
canvas.addEventListener("pointercancel",() => { pointerDown = false; canvas.classList.remove("dragging"); });

// ── Pinch-to-zoom (touch) ─────────────────────────────────────────────────────
let lastPinchDist = null;

canvas.addEventListener("touchstart", (e) => {
  if (e.touches.length === 2) lastPinchDist = pinchDist(e);
}, { passive: true });

canvas.addEventListener("touchmove", (e) => {
  if (e.touches.length === 2 && lastPinchDist !== null) {
    const dist = pinchDist(e);
    const delta = lastPinchDist - dist;
    lastPinchDist = dist;
    adjustFOV(delta * 0.15);
  }
}, { passive: true });

canvas.addEventListener("touchend", () => { lastPinchDist = null; }, { passive: true });

function pinchDist(e) {
  const dx = e.touches[0].clientX - e.touches[1].clientX;
  const dy = e.touches[0].clientY - e.touches[1].clientY;
  return Math.hypot(dx, dy);
}

// ── Scroll-to-zoom ────────────────────────────────────────────────────────────
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  adjustFOV(e.deltaY * 0.05);
}, { passive: false });

function adjustFOV(delta) {
  TARGET_FOV.value = Math.max(FOV_MIN, Math.min(FOV_MAX, TARGET_FOV.value + delta));
}

// ── Zoom buttons ──────────────────────────────────────────────────────────────
zoomInBtn.addEventListener("click",  () => adjustFOV(-10));
zoomOutBtn.addEventListener("click", () => adjustFOV(10));

// ── Projection toggle ─────────────────────────────────────────────────────────
projToggleBtn.addEventListener("click", () => {
  projectionMode = projectionMode === "equirect" ? "cylindrical" : "equirect";
  projToggleBtn.textContent = projectionMode === "equirect" ? "EQ" : "CYL";
  projToggleBtn.title = projectionMode === "equirect"
    ? "Currently: Equirectangular — click to switch to Cylindrical"
    : "Currently: Cylindrical — click to switch to Equirectangular";
  projToggleBtn.classList.toggle("active", projectionMode === "cylindrical");

  // Re-apply current image with new projection
  if (lastLoadedFile) {
    loadImage(lastLoadedFile);
  } else if (lastLoadedURL) {
    const loader = new THREE.TextureLoader();
    loader.crossOrigin = "anonymous";
    loader.load(lastLoadedURL, (texture) => { applyTextureForMode(texture); });
  }
});

// ── Keyboard controls ─────────────────────────────────────────────────────────
const KEYS = {};
window.addEventListener("keydown", (e) => { KEYS[e.key] = true; });
window.addEventListener("keyup",   (e) => { delete KEYS[e.key]; });

// Continuously pan while key is held — driven from requestAnimationFrame
function handleKeys() {
  const speed = dragSpeed() * 18;
  if (KEYS["ArrowLeft"]  || KEYS["a"] || KEYS["A"]) lon -= speed;
  if (KEYS["ArrowRight"] || KEYS["d"] || KEYS["D"]) lon += speed;
  if (KEYS["ArrowUp"]    || KEYS["w"] || KEYS["W"]) {
    lat = Math.min(LAT_LIMIT, lat + speed);
  }
  if (KEYS["ArrowDown"]  || KEYS["s"] || KEYS["S"]) {
    lat = Math.max(-LAT_LIMIT, lat - speed);
  }
  if (KEYS["+"] || KEYS["="]) adjustFOV(-1.5);
  if (KEYS["-"])               adjustFOV(1.5);
  requestAnimationFrame(handleKeys);
}

// ── Upload / file handling ────────────────────────────────────────────────────
function openImage(file) {
  if (!file || !file.type.startsWith("image/")) return;

  imageNameEl.textContent = file.name;
  loadImage(file);

  uploadScreen.classList.add("hidden");
  viewerScreen.classList.remove("hidden");
  resizeRenderer();  // canvas was 0×0 while hidden — fix now

  // Reset view
  lon = 0;
  lat = 0;
  TARGET_FOV.value = 90;
  camera.fov = 90;
  camera.updateProjectionMatrix();
}

fileInput.addEventListener("change", (e) => {
  openImage(e.target.files[0]);
  fileInput.value = "";   // reset so same file can be re-selected
});

// URL loading
function loadFromURLInput() {
  const raw = urlInput.value.trim();
  urlError.textContent = "";
  if (!raw) return;
  try { new URL(raw); } catch { urlError.textContent = "Please enter a valid URL."; return; }
  loadTextureFromURL(raw, raw.split("/").pop() || raw);
}
urlLoadBtn.addEventListener("click", loadFromURLInput);
urlInput.addEventListener("keydown", (e) => { if (e.key === "Enter") loadFromURLInput(); });

// Drag-and-drop onto the drop zone
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  openImage(e.dataTransfer.files[0]);
});

// Back button → return to upload screen
backBtn.addEventListener("click", () => {
  viewerScreen.classList.add("hidden");
  uploadScreen.classList.remove("hidden");
  // Dispose old texture to free GPU memory
  if (sphere.material.map) {
    sphere.material.map.dispose();
    sphere.material.map = null;
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
initRenderer();
handleKeys();
animate();
