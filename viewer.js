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

// ── Three.js state ────────────────────────────────────────────────────────────
let renderer, scene, camera, sphere;

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
  const geo = new THREE.SphereGeometry(500, 64, 32);
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
function loadImage(file) {
  const url = URL.createObjectURL(file);
  const loader = new THREE.TextureLoader();
  loader.load(url, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    sphere.material = new THREE.MeshBasicMaterial({ map: texture });
    URL.revokeObjectURL(url);
  });
}

// ── Drag / pan controls ───────────────────────────────────────────────────────
let pointerDown = false;
let lastX = 0, lastY = 0;

// Speed factor: slower at narrow FOV (zoomed in), faster when wide
function dragSpeed() {
  return camera.fov / 46700;
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
  lat += dy * dragSpeed();
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
