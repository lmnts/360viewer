// Builds dist/360viewer.html — a single self-contained file with no dependencies.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "fs";

const VERSION = "v11";

const result = await build({
  entryPoints: ["viewer.js"],
  bundle: true,
  minify: true,
  write: false,
  format: "iife",
});

const js  = result.outputFiles[0].text;
const css = readFileSync("style.css", "utf8");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>360° Viewer</title>
  <style>${css}</style>
</head>
<body>

  <!-- Upload screen -->
  <div id="upload-screen">
    <div id="drop-zone">
      <div id="drop-content">
        <svg id="upload-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 8v4m0 0v4m0-4h4m-4 0H8"/>
        </svg>
        <h1>360° Viewer</h1>
        <p>Drop a spherical panorama image here, or click to browse</p>
        <p class="hint">Supports equirectangular JPG / PNG images &nbsp;·&nbsp; ${VERSION}</p>
        <button id="browse-btn">Choose Image</button>
      </div>
      <input type="file" id="file-input" accept="image/*" />
    </div>
  </div>

  <!-- Viewer screen -->
  <div id="viewer-screen" class="hidden">
    <canvas id="viewer-canvas"></canvas>

    <div id="hud">
      <button id="back-btn" title="Upload new image">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
      </button>
      <span id="image-name"></span>
      <div id="controls-hint">Drag to pan &nbsp;·&nbsp; Scroll to zoom</div>
    </div>

    <div id="zoom-btns">
      <button id="zoom-in" title="Zoom in">+</button>
      <button id="zoom-out" title="Zoom out">−</button>
    </div>
  </div>

  <script>${js}</script>
</body>
</html>`;

mkdirSync("dist", { recursive: true });
writeFileSync("dist/360viewer.html", html);
console.log(`Built dist/360viewer.html (${(html.length / 1024).toFixed(0)} KB)`);
