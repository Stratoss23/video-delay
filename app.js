const sourceVideo = document.getElementById("sourceVideo");
const delayCanvas = document.getElementById("delayCanvas");
const ctx = delayCanvas.getContext("2d", { alpha: false });
const drawCanvas = document.getElementById("drawCanvas");
const drawCtx = drawCanvas.getContext("2d");

const permissionPanel = document.getElementById("permissionPanel");
const startButton = document.getElementById("startButton");
const statusText = document.getElementById("statusText");
const cameraButton = document.getElementById("cameraButton");
const mirrorButton = document.getElementById("mirrorButton");
const pauseButton = document.getElementById("pauseButton");
const playBufferButton = document.getElementById("playBufferButton");
const speedButton = document.getElementById("speedButton");
const frameSlider = document.getElementById("frameSlider");
const frameLabel = document.getElementById("frameLabel");
const fitButton = document.getElementById("fitButton");
const fullscreenButton = document.getElementById("fullscreenButton");
const delaySlider = document.getElementById("delaySlider");
const delayLabel = document.getElementById("delayLabel");
const cameraLabel = document.getElementById("cameraLabel");
const bufferLabel = document.getElementById("bufferLabel");
const drawButton = document.getElementById("drawButton");
const drawModeButton = document.getElementById("drawModeButton");
const freeDrawButton = document.getElementById("freeDrawButton");
const colorButton = document.getElementById("colorButton");
const undoDrawButton = document.getElementById("undoDrawButton");
const clearDrawButton = document.getElementById("clearDrawButton");

const captureCanvas = document.createElement("canvas");
const captureCtx = captureCanvas.getContext("2d", { alpha: false });

let stream = null;
let facingMode = "environment";
let mirrored = false;
let fillMode = true;
let delaySeconds = Number(delaySlider.value);
let frames = [];
let lastCapture = 0;
let animationFrame = 0;
let paused = false;
let pausedFrameIndex = -1;
let lastDelayedFrameIndex = -1;
let bufferPlaying = false;
let bufferPlayTimer = 0;
let playbackSpeedIndex = 0;
let drawMode = false;
let activeLine = null;
let drawingPointerId = null;
let drawColorIndex = 0;
let drawShapeMode = "line";
let guideLines = [];

const CAMERA_WIDTH = 1920;
const CAMERA_HEIGHT = 1080;
const CAMERA_FPS = 60;
const MAX_DELAY_SECONDS = 5;

const playbackSpeeds = [
  { label: "1x", multiplier: 1 },
  { label: "0.5x", multiplier: 0.5 },
  { label: "0.25x", multiplier: 0.25 }
];

const drawColors = [
  { label: "Yellow", value: "#ffd447" },
  { label: "Red", value: "#e33d3d" },
  { label: "Blue", value: "#246fe6" },
  { label: "White", value: "#f4ecd4" }
];

function setStatus(message) {
  statusText.textContent = message;
}

function applyFillMode() {
  document.body.classList.toggle("fill", fillMode);
}

function updateLabels() {
  delaySlider.max = String(MAX_DELAY_SECONDS);
  if (delaySeconds > MAX_DELAY_SECONDS) {
    delaySeconds = MAX_DELAY_SECONDS;
    delaySlider.value = String(delaySeconds);
  }

  delayLabel.textContent = `Delay ${delaySeconds} s`;
  cameraLabel.textContent = `${facingMode === "user" ? "Predna" : "Zadna"} 1080/60`;
  mirrorButton.classList.toggle("active", mirrored);
  pauseButton.textContent = paused ? "Live" : "Pause";
  pauseButton.classList.toggle("active", paused);
  playBufferButton.disabled = !paused || frames.length < 2;
  playBufferButton.textContent = bufferPlaying ? "Stop" : "Play";
  playBufferButton.classList.toggle("active", bufferPlaying);
  speedButton.textContent = playbackSpeeds[playbackSpeedIndex].label;
  speedButton.disabled = !paused;
  frameSlider.disabled = !paused || frames.length < 2;
  frameSlider.max = String(Math.max(0, frames.length - 1));
  frameSlider.value = String(pausedFrameIndex >= 0 ? pausedFrameIndex : 0);
  frameLabel.textContent = paused && pausedFrameIndex >= 0
    ? `Frame ${pausedFrameIndex + 1}/${frames.length}`
    : "Frame --";
  fitButton.classList.toggle("active", fillMode);
  fitButton.textContent = fillMode ? "Fit" : "Fill";
  fitButton.title = fillMode ? "Zobrazit cely zaber" : "Vyplnit obraz";
  drawButton.classList.toggle("active", drawMode);
  drawCanvas.classList.toggle("enabled", drawMode);
  drawModeButton.textContent = "Line";
  drawModeButton.classList.toggle("active", drawShapeMode === "line");
  freeDrawButton.classList.toggle("active", drawShapeMode === "free");
  colorButton.textContent = drawColors[drawColorIndex].label;
  colorButton.style.setProperty("--draw-color", drawColors[drawColorIndex].value);
  undoDrawButton.disabled = guideLines.length === 0;
  clearDrawButton.disabled = guideLines.length === 0;

  const newest = frames.at(-1);
  const oldest = frames[0];
  const buffered = newest && oldest ? Math.max(0, newest.time - oldest.time) / 1000 : 0;
  bufferLabel.textContent = `Buffer ${buffered.toFixed(0)} s`;
}

function isPortraitViewport() {
  return window.innerHeight > window.innerWidth;
}

function configureCaptureCanvas() {
  const portrait = isPortraitViewport();
  const width = fillMode && portrait ? CAMERA_HEIGHT : CAMERA_WIDTH;
  const height = fillMode && portrait ? CAMERA_WIDTH : CAMERA_HEIGHT;

  if (captureCanvas.width !== width || captureCanvas.height !== height) {
    captureCanvas.width = width;
    captureCanvas.height = height;
    return true;
  }

  return false;
}

function clearFrameBuffer() {
  stopBufferPlayback();
  frames.forEach((frame) => frame.bitmap?.close?.());
  frames = [];
  paused = false;
  pausedFrameIndex = -1;
  lastDelayedFrameIndex = -1;
  lastCapture = 0;
  updateLabels();
}

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.floor(window.innerWidth * ratio);
  const height = Math.floor(window.innerHeight * ratio);

  if (delayCanvas.width !== width || delayCanvas.height !== height) {
    delayCanvas.width = width;
    delayCanvas.height = height;
  }

  if (drawCanvas.width !== width || drawCanvas.height !== height) {
    drawCanvas.width = width;
    drawCanvas.height = height;
    redrawGuideLines();
  }
}

function pointFromEvent(event) {
  const rect = drawCanvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height
  };
}

function drawGuideItem(item, preview = false) {
  const width = drawCanvas.width;
  const height = drawCanvas.height;
  const lineWidth = Math.max(4, Math.round(Math.min(width, height) * 0.006));
  const points = item.type === "free"
    ? item.points
    : [
        { x: item.x1, y: item.y1 },
        { x: item.x2, y: item.y2 }
      ];

  if (!points || points.length < 2) {
    return;
  }

  drawCtx.save();
  drawCtx.lineCap = "round";
  drawCtx.lineJoin = "round";
  drawCtx.lineWidth = lineWidth + 5;
  drawCtx.strokeStyle = "rgba(0, 0, 0, 0.62)";
  drawCtx.beginPath();
  drawCtx.moveTo(points[0].x * width, points[0].y * height);
  points.slice(1).forEach((point) => {
    drawCtx.lineTo(point.x * width, point.y * height);
  });
  drawCtx.stroke();

  drawCtx.lineWidth = preview ? lineWidth + 2 : lineWidth;
  drawCtx.strokeStyle = item.color;
  drawCtx.beginPath();
  drawCtx.moveTo(points[0].x * width, points[0].y * height);
  points.slice(1).forEach((point) => {
    drawCtx.lineTo(point.x * width, point.y * height);
  });
  drawCtx.stroke();
  drawCtx.restore();
}

function redrawGuideLines() {
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  guideLines.forEach((line) => drawGuideItem(line));

  if (activeLine) {
    drawGuideItem(activeLine, true);
  }
}

function setDrawMode(enabled) {
  drawMode = enabled;
  activeLine = null;
  drawingPointerId = null;
  redrawGuideLines();
  updateLabels();
}

function cycleDrawColor() {
  drawColorIndex = (drawColorIndex + 1) % drawColors.length;
  updateLabels();
}

function toggleDrawEnabled() {
  drawMode = !drawMode;
  activeLine = null;
  drawingPointerId = null;
  redrawGuideLines();
  updateLabels();
}

function selectDrawTool(mode) {
  drawShapeMode = mode;
  activeLine = null;
  drawingPointerId = null;
  redrawGuideLines();
  updateLabels();
}

function undoGuideLine() {
  guideLines.pop();
  redrawGuideLines();
  updateLabels();
}

function clearGuideLines() {
  guideLines = [];
  activeLine = null;
  redrawGuideLines();
  updateLabels();
}

function stopStream() {
  cancelAnimationFrame(animationFrame);
  stopBufferPlayback();
  animationFrame = 0;
  paused = false;
  pausedFrameIndex = -1;
  lastDelayedFrameIndex = -1;

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  frames.forEach((frame) => frame.bitmap?.close?.());
  frames = [];
}

async function startCamera() {
  stopStream();
  setStatus("Otvaram kameru...");

  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: CAMERA_WIDTH },
      height: { ideal: CAMERA_HEIGHT },
      frameRate: { ideal: CAMERA_FPS, max: CAMERA_FPS }
    }
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    sourceVideo.srcObject = stream;
    await sourceVideo.play();

    permissionPanel.classList.add("hidden");
    configureCaptureCanvas();
    lastCapture = 0;
    updateLabels();
    if (!animationFrame) {
      renderLoop();
    }
  } catch (error) {
    console.error(error);
    setStatus("Kamera sa nepodarila spustit. Skontroluj povolenie kamery v Safari.");
    permissionPanel.classList.remove("hidden");
  }
}

async function switchCamera() {
  stopBufferPlayback();
  paused = false;
  pausedFrameIndex = -1;
  lastDelayedFrameIndex = -1;
  facingMode = facingMode === "user" ? "environment" : "user";
  updateLabels();
  await startCamera();
}

function drawVideoToCaptureCanvas() {
  captureCtx.save();
  captureCtx.clearRect(0, 0, captureCanvas.width, captureCanvas.height);

  if (mirrored) {
    captureCtx.translate(captureCanvas.width, 0);
    captureCtx.scale(-1, 1);
  }

  const videoRatio = sourceVideo.videoWidth / sourceVideo.videoHeight;
  const canvasRatio = captureCanvas.width / captureCanvas.height;
  let sx = 0;
  let sy = 0;
  let sw = sourceVideo.videoWidth;
  let sh = sourceVideo.videoHeight;

  if (videoRatio > canvasRatio) {
    sw = sourceVideo.videoHeight * canvasRatio;
    sx = (sourceVideo.videoWidth - sw) / 2;
  } else {
    sh = sourceVideo.videoWidth / canvasRatio;
    sy = (sourceVideo.videoHeight - sh) / 2;
  }

  captureCtx.drawImage(sourceVideo, sx, sy, sw, sh, 0, 0, captureCanvas.width, captureCanvas.height);
  captureCtx.restore();
}

async function captureFrame(time) {
  drawVideoToCaptureCanvas();

  let bitmap = null;
  if ("createImageBitmap" in window) {
    bitmap = await createImageBitmap(captureCanvas);
  }

  frames.push({
    time,
    bitmap,
    canvas: bitmap ? null : cloneCanvas(captureCanvas)
  });
}

function cloneCanvas(source) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.getContext("2d", { alpha: false }).drawImage(source, 0, 0);
  return canvas;
}

function drawDelayedFrame(frame) {
  resizeCanvas();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, delayCanvas.width, delayCanvas.height);

  const source = frame.bitmap || frame.canvas;
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  const canvasRatio = delayCanvas.width / delayCanvas.height;
  const sourceRatio = sourceWidth / sourceHeight;

  let drawWidth;
  let drawHeight;

  if (fillMode ? sourceRatio < canvasRatio : sourceRatio > canvasRatio) {
    drawWidth = delayCanvas.width;
    drawHeight = delayCanvas.width / sourceRatio;
  } else {
    drawHeight = delayCanvas.height;
    drawWidth = delayCanvas.height * sourceRatio;
  }

  const x = (delayCanvas.width - drawWidth) / 2;
  const y = (delayCanvas.height - drawHeight) / 2;
  ctx.drawImage(source, x, y, drawWidth, drawHeight);
}

function trimFrames(now) {
  const keepAfter = now - Math.max(delaySeconds + 2, 4) * 1000;

  while (frames.length && frames[0].time < keepAfter) {
    const oldFrame = frames.shift();
    oldFrame.bitmap?.close?.();
    if (!paused && pausedFrameIndex >= 0) {
      pausedFrameIndex -= 1;
    }
    if (lastDelayedFrameIndex >= 0) {
      lastDelayedFrameIndex -= 1;
    }
  }
  if (lastDelayedFrameIndex < -1) {
    lastDelayedFrameIndex = -1;
  }
}

function findDelayedFrameIndex(now) {
  const targetTime = now - delaySeconds * 1000;

  for (let i = frames.length - 1; i >= 0; i -= 1) {
    if (frames[i].time <= targetTime) {
      return i;
    }
  }

  return frames.length ? frames.length - 1 : -1;
}

function setPaused(nextPaused) {
  stopBufferPlayback();
  paused = nextPaused;

  if (paused) {
    const currentFrameIndex = findDelayedFrameIndex(performance.now());
    pausedFrameIndex = currentFrameIndex >= 0 ? currentFrameIndex : lastDelayedFrameIndex;

    if (pausedFrameIndex >= 0 && frames[pausedFrameIndex]) {
      drawDelayedFrame(frames[pausedFrameIndex]);
    }
  } else {
    pausedFrameIndex = -1;
  }

  updateLabels();
}

function stopBufferPlayback() {
  if (bufferPlayTimer) {
    clearTimeout(bufferPlayTimer);
    bufferPlayTimer = 0;
  }
  bufferPlaying = false;
}

function playBufferFromCurrentFrame() {
  if (!paused || frames.length < 2) {
    return;
  }

  if (bufferPlaying) {
    stopBufferPlayback();
    updateLabels();
    return;
  }

  if (pausedFrameIndex < 0) {
    pausedFrameIndex = 0;
  }

  bufferPlaying = true;
  updateLabels();

  const playNext = () => {
    if (!bufferPlaying || !paused) {
      stopBufferPlayback();
      updateLabels();
      return;
    }

    drawDelayedFrame(frames[pausedFrameIndex]);
    updateLabels();

    if (pausedFrameIndex >= frames.length - 1) {
      stopBufferPlayback();
      updateLabels();
      return;
    }

    pausedFrameIndex += 1;
    const speed = playbackSpeeds[playbackSpeedIndex].multiplier;
    bufferPlayTimer = setTimeout(playNext, 1000 / (CAMERA_FPS * speed));
  };

  playNext();
}

function switchPlaybackSpeed() {
  playbackSpeedIndex = (playbackSpeedIndex + 1) % playbackSpeeds.length;
  updateLabels();
}

function scrubFrame(index) {
  if (!paused || !frames.length) {
    return;
  }

  stopBufferPlayback();
  pausedFrameIndex = Math.min(
    frames.length - 1,
    Math.max(0, index)
  );

  drawDelayedFrame(frames[pausedFrameIndex]);
  updateLabels();
}

async function renderLoop(now = performance.now()) {
  animationFrame = requestAnimationFrame(renderLoop);

  if (!stream || sourceVideo.readyState < 2) {
    return;
  }

  if (paused) {
    return;
  }

  if (now - lastCapture >= 1000 / CAMERA_FPS) {
    lastCapture = now;
    await captureFrame(now);
    trimFrames(now);
    updateLabels();
  }

  const targetTime = now - delaySeconds * 1000;
  let delayedFrame = null;
  let delayedFrameIndex = -1;

  for (let i = frames.length - 1; i >= 0; i -= 1) {
    if (frames[i].time <= targetTime) {
      delayedFrame = frames[i];
      delayedFrameIndex = i;
      break;
    }
  }

  if (delayedFrame) {
    lastDelayedFrameIndex = delayedFrameIndex;

    if (!paused) {
      drawDelayedFrame(delayedFrame);
    }
  }
}

startButton.addEventListener("click", startCamera);

cameraButton.addEventListener("click", () => {
  switchCamera();
});

mirrorButton.addEventListener("click", () => {
  mirrored = !mirrored;
  updateLabels();
});

pauseButton.addEventListener("click", () => {
  setPaused(!paused);
});

playBufferButton.addEventListener("click", () => {
  playBufferFromCurrentFrame();
});

speedButton.addEventListener("click", () => {
  switchPlaybackSpeed();
});

frameSlider.addEventListener("input", (event) => {
  scrubFrame(Number(event.target.value));
});

drawButton.addEventListener("click", () => {
  toggleDrawEnabled();
});

colorButton.addEventListener("click", () => {
  cycleDrawColor();
});

drawModeButton.addEventListener("click", () => {
  selectDrawTool("line");
});

freeDrawButton.addEventListener("click", () => {
  selectDrawTool("free");
});

undoDrawButton.addEventListener("click", () => {
  undoGuideLine();
});

clearDrawButton.addEventListener("click", () => {
  clearGuideLines();
});

drawCanvas.addEventListener("pointerdown", (event) => {
  if (!drawMode) {
    return;
  }

  event.preventDefault();
  drawCanvas.setPointerCapture(event.pointerId);
  drawingPointerId = event.pointerId;
  const point = pointFromEvent(event);
  activeLine = drawShapeMode === "line"
    ? {
        type: "line",
        x1: point.x,
        y1: point.y,
        x2: point.x,
        y2: point.y,
        color: drawColors[drawColorIndex].value
      }
    : {
        type: "free",
        points: [point],
        color: drawColors[drawColorIndex].value
      };
  redrawGuideLines();
});

drawCanvas.addEventListener("pointermove", (event) => {
  if (!drawMode || drawingPointerId !== event.pointerId || !activeLine) {
    return;
  }

  event.preventDefault();
  const point = pointFromEvent(event);
  if (activeLine.type === "free") {
    activeLine.points.push(point);
  } else {
    activeLine.x2 = point.x;
    activeLine.y2 = point.y;
  }
  redrawGuideLines();
});

drawCanvas.addEventListener("pointerup", (event) => {
  if (!drawMode || drawingPointerId !== event.pointerId || !activeLine) {
    return;
  }

  event.preventDefault();
  const point = pointFromEvent(event);
  if (activeLine.type === "free") {
    activeLine.points.push(point);
  } else {
    activeLine.x2 = point.x;
    activeLine.y2 = point.y;
  }

  const shouldKeep = activeLine.type === "free"
    ? activeLine.points.length > 2
    : Math.hypot(activeLine.x2 - activeLine.x1, activeLine.y2 - activeLine.y1) > 0.01;

  if (shouldKeep) {
    guideLines.push(activeLine);
  }

  activeLine = null;
  drawingPointerId = null;
  redrawGuideLines();
  updateLabels();
});

drawCanvas.addEventListener("pointercancel", () => {
  activeLine = null;
  drawingPointerId = null;
  redrawGuideLines();
});

fitButton.addEventListener("click", () => {
  fillMode = !fillMode;
  applyFillMode();
  if (configureCaptureCanvas()) {
    clearFrameBuffer();
  }
  updateLabels();
});

fullscreenButton.addEventListener("click", async () => {
  fillMode = true;
  applyFillMode();
  updateLabels();

  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen?.();
  } else {
    await document.exitFullscreen?.();
  }
});

delaySlider.addEventListener("input", (event) => {
  delaySeconds = Number(event.target.value);
  if (paused) {
    setPaused(false);
  }
  updateLabels();
});

window.addEventListener("resize", resizeCanvas);
window.addEventListener("orientationchange", () => {
  resizeCanvas();
  if (configureCaptureCanvas()) {
    clearFrameBuffer();
  }
});

window.addEventListener("resize", () => {
  if (configureCaptureCanvas()) {
    clearFrameBuffer();
  }
});
window.addEventListener("pagehide", () => {
  cancelAnimationFrame(animationFrame);
  stopStream();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

resizeCanvas();
applyFillMode();
updateLabels();
