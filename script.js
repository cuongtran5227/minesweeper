"use strict";

/* =====================================================
   1. Constants, settings and saved data
   ===================================================== */
const LEVELS = {
  easy:   { rows: 9,  cols: 9,  mines: 10 },
  medium: { rows: 12, cols: 12, mines: 25 },
  hard:   { rows: 16, cols: 16, mines: 40 },
};
const MAX_HINTS = 3;
const LONG_PRESS_MS = 380;
const THEME_COLORS = { dark: "#1f2430", light: "#eef1f8", neon: "#0b0b1a" };

const prefersReducedMotion =
  !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

const DEFAULT_SETTINGS = {
  level: "easy",
  custom: { rows: 12, cols: 16, mines: 30 },
  sound: true,
  volume: 0.6,
  vibration: true,
  animations: !prefersReducedMotion,
  theme: "dark",
  cellSize: 34,
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    return fallback;
  }
}
function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    /* storage may be blocked (private mode); the game still works */
  }
}

function loadSettings() {
  const s = Object.assign({}, DEFAULT_SETTINGS, loadJSON("ms_settings", {}));
  s.custom = Object.assign({}, DEFAULT_SETTINGS.custom, s.custom);
  if (!(s.level in LEVELS) && s.level !== "custom") s.level = "easy";
  if (!(s.theme in THEME_COLORS)) s.theme = "dark";
  s.cellSize = clamp(Number(s.cellSize) || 34, 24, 48);
  s.volume = clamp(Number(s.volume), 0, 1);
  if (Number.isNaN(s.volume)) s.volume = 0.6;
  return s;
}

function loadStats() {
  const s = Object.assign({ played: 0, won: 0, streak: 0, bestStreak: 0 }, loadJSON("ms_stats", {}));
  s.best = s.best && typeof s.best === "object" ? s.best : {};
  return s;
}

let settings = loadSettings();
let stats = loadStats();

const persistSettings = () => saveJSON("ms_settings", settings);
const persistStats = () => saveJSON("ms_stats", stats);

/* =====================================================
   2. Page elements
   ===================================================== */
const $ = (id) => document.getElementById(id);

const boardEl = $("board");
const minesEl = $("mines");
const timerEl = $("timer");
const messageEl = $("message");
const bestInfoEl = $("bestInfo");
const restartBtn = $("restart");
const hintBtn = $("hintBtn");
const flagModeBtn = $("flagMode");
const difficultyEl = $("difficulty");
const customRow = $("customRow");
const cRows = $("cRows");
const cCols = $("cCols");
const cMines = $("cMines");
const confettiCanvas = $("confetti");
const cctx = confettiCanvas.getContext ? confettiCanvas.getContext("2d") : null;

const settingsDialog = $("settingsDialog");
const statsDialog = $("statsDialog");

/* =====================================================
   3. Sound (made with the Web Audio API, no files needed)
   ===================================================== */
let audioCtx = null;
let master = null;

function ensureAudio() {
  if (!settings.sound || settings.volume <= 0) return null;
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
    master = audioCtx.createGain();
    master.connect(audioCtx.destination);
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  master.gain.value = settings.volume;
  return audioCtx;
}

function tone({ freq, to, dur = 0.12, type = "sine", vol = 0.4, delay = 0 }) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

function noise({ dur = 0.6, vol = 0.5, from = 1800, to = 100, delay = 0 }) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const length = Math.floor(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  src.start(t);
}

const sfx = {
  click()  { tone({ freq: 520, to: 380, dur: 0.07, type: "triangle", vol: 0.3 }); },
  reveal(n) { tone({ freq: 420 + Math.min(n, 8) * 40, dur: 0.1, type: "sine", vol: 0.35 }); },
  cascade(n) {
    const steps = Math.min(6, 3 + Math.floor(n / 8));
    for (let i = 0; i < steps; i++) {
      tone({ freq: 380 + i * 80, dur: 0.09, type: "sine", vol: 0.25, delay: i * 0.05 });
    }
  },
  flag()   { tone({ freq: 300, to: 600, dur: 0.09, type: "square", vol: 0.15 }); },
  unflag() { tone({ freq: 600, to: 300, dur: 0.09, type: "square", vol: 0.15 }); },
  hint() {
    tone({ freq: 880, dur: 0.12, type: "sine", vol: 0.3 });
    tone({ freq: 1320, dur: 0.18, type: "sine", vol: 0.3, delay: 0.1 });
  },
  error()  { tone({ freq: 150, dur: 0.1, type: "square", vol: 0.18 }); },
  tick()   { tone({ freq: 160 + Math.random() * 90, to: 50, dur: 0.12, type: "sawtooth", vol: 0.18 }); },
  lose() {
    noise({ dur: 0.7, vol: 0.6, from: 2200, to: 80 });
    tone({ freq: 220, to: 45, dur: 0.8, type: "sawtooth", vol: 0.3 });
  },
  win() {
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      tone({ freq: f, dur: 0.24, type: "triangle", vol: 0.32, delay: i * 0.11 })
    );
  },
};

function buzz(pattern) {
  if (settings.vibration && navigator.vibrate) navigator.vibrate(pattern);
}

/* =====================================================
   4. Game state
   ===================================================== */
let rows, cols, mineCount;
let cells;                 // one object per square: { mine, revealed, flagged, adjacent }
let firstClick, gameOver, flagsPlaced, revealedCount;
let hintsLeft, hintsUsed;
let seconds, timerId;
let flagMode = false;
let gameId = 0;            // changes every new game so old timeouts can be ignored
let pendingTimeouts = [];

// Run something later, but only if the same game is still going
function later(fn, ms) {
  const id = gameId;
  const t = setTimeout(() => {
    if (id === gameId) fn();
  }, ms);
  pendingTimeouts.push(t);
}

function getConfig() {
  if (settings.level === "custom") {
    const r = clamp(Math.round(Number(settings.custom.rows)) || 12, 5, 24);
    const c = clamp(Math.round(Number(settings.custom.cols)) || 16, 5, 30);
    const m = clamp(Math.round(Number(settings.custom.mines)) || 30, 1, r * c - 9);
    settings.custom = { rows: r, cols: c, mines: m };
    return { rows: r, cols: c, mines: m };
  }
  return LEVELS[settings.level] || LEVELS.easy;
}

function newGame() {
  gameId++;
  pendingTimeouts.forEach(clearTimeout);
  pendingTimeouts = [];
  stopTimer();
  stopConfetti();

  ({ rows, cols, mines: mineCount } = getConfig());
  cells = Array.from({ length: rows * cols }, () => ({
    mine: false,
    revealed: false,
    flagged: false,
    adjacent: 0,
  }));

  firstClick = true;
  gameOver = false;
  flagsPlaced = 0;
  revealedCount = 0;
  hintsLeft = MAX_HINTS;
  hintsUsed = 0;
  seconds = 0;

  timerEl.textContent = 0;
  minesEl.textContent = mineCount;
  messageEl.textContent = "";
  setFace("🙂");
  restartBtn.classList.remove("bounce");
  boardEl.classList.remove("shake", "won");
  syncCustomInputs();
  updateHintBtn();
  updateBestInfo();
  buildBoard();
}

function buildBoard() {
  boardEl.innerHTML = "";
  boardEl.style.setProperty("--cols", cols);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < rows * cols; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cell";
    btn.dataset.index = i;
    frag.appendChild(btn);
  }
  boardEl.appendChild(frag);
}

/* =====================================================
   5. Helpers
   ===================================================== */
function neighbors(i) {
  const r = Math.floor(i / cols);
  const c = i % cols;
  const result = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) result.push(nr * cols + nc);
    }
  }
  return result;
}

// Mines are placed AFTER the first click so the first click is always safe
function placeMines(safeIndex) {
  const forbidden = new Set([safeIndex, ...neighbors(safeIndex)]);
  let placed = 0;
  while (placed < mineCount) {
    const i = Math.floor(Math.random() * cells.length);
    if (cells[i].mine || forbidden.has(i)) continue;
    cells[i].mine = true;
    placed++;
  }
  cells.forEach((cell, i) => {
    cell.adjacent = neighbors(i).filter((n) => cells[n].mine).length;
  });
}

function setFace(emoji) {
  restartBtn.textContent = emoji;
}

function fmtTime(s) {
  return typeof s === "number" ? s + "s" : "–";
}

function updateBestInfo() {
  if (settings.level === "custom") {
    bestInfoEl.textContent = "Best times are not tracked on custom boards.";
  } else {
    bestInfoEl.textContent = `Best time (${settings.level}): ${fmtTime(stats.best[settings.level])}`;
  }
}

function updateHintBtn() {
  hintBtn.textContent = `💡 Hint (${hintsLeft})`;
  hintBtn.disabled = firstClick || gameOver || hintsLeft <= 0;
}

/* =====================================================
   6. Drawing one square
   ===================================================== */
function draw(i) {
  const cell = cells[i];
  const el = boardEl.children[i];
  if (!el) return;
  el.className = "cell";
  el.textContent = "";
  el.style.animationDelay = "";

  if (cell.revealed) {
    el.classList.add("revealed");
    if (cell.mine) {
      el.classList.add("mine", "boom");
      el.textContent = "💣";
    } else {
      el.classList.add("pop");
      if (cell.adjacent > 0) {
        el.textContent = cell.adjacent;
        el.classList.add("n" + cell.adjacent);
      }
    }
  } else if (cell.flagged) {
    el.classList.add("flagged");
    el.textContent = "🚩";
  }
}

/* =====================================================
   7. Player actions
   ===================================================== */
// Opens a square. Empty squares open their neighbours too (spreads out like a ripple).
function revealCell(start) {
  let count = 0;
  const queue = [[start, 0]];
  let head = 0;
  while (head < queue.length) {
    const [i, depth] = queue[head++];
    const cell = cells[i];
    if (cell.revealed || cell.flagged) continue;
    cell.revealed = true;
    revealedCount++;
    count++;
    if (depth === 0 || !settings.animations) draw(i);
    else later(() => draw(i), Math.min(depth * 30, 600));
    if (cell.adjacent === 0) {
      for (const n of neighbors(i)) {
        if (!cells[n].revealed && !cells[n].flagged) queue.push([n, depth + 1]);
      }
    }
  }
  return count;
}

function playRevealSound(count, adjacent) {
  if (count > 1) sfx.cascade(count);
  else sfx.reveal(adjacent);
}

function handleReveal(i) {
  if (gameOver) return;
  const cell = cells[i];

  if (cell.revealed) {
    if (cell.adjacent > 0) chord(i);
    return;
  }
  if (cell.flagged) {
    sfx.error();
    return;
  }

  if (firstClick) {
    placeMines(i);
    firstClick = false;
    startTimer();
    updateHintBtn();
  }

  if (cell.mine) {
    lose(i);
    return;
  }

  const count = revealCell(i);
  playRevealSound(count, cell.adjacent);
  buzz(8);
  checkWin();
}

// Chording: click a number whose flags match it to open all its other neighbours
function chord(i) {
  const cell = cells[i];
  const around = neighbors(i);
  const flagged = around.filter((n) => cells[n].flagged).length;
  if (flagged !== cell.adjacent) {
    sfx.error();
    return;
  }
  let hitMine = -1;
  let total = 0;
  for (const n of around) {
    const c = cells[n];
    if (c.revealed || c.flagged) continue;
    if (c.mine) {
      hitMine = n;
      continue;
    }
    total += revealCell(n);
  }
  if (hitMine >= 0) {
    lose(hitMine);
    return;
  }
  if (total > 0) {
    playRevealSound(total, 1);
    buzz(8);
  }
  checkWin();
}

function toggleFlag(i) {
  if (gameOver) return;
  const cell = cells[i];
  if (cell.revealed) return;
  cell.flagged = !cell.flagged;
  flagsPlaced += cell.flagged ? 1 : -1;
  minesEl.textContent = mineCount - flagsPlaced;
  draw(i);
  if (cell.flagged) sfx.flag();
  else sfx.unflag();
  buzz(15);
}

function useHint() {
  if (gameOver || firstClick || hintsLeft <= 0) {
    sfx.error();
    return;
  }
  const candidates = [];
  cells.forEach((c, i) => {
    if (!c.mine && !c.revealed && !c.flagged) candidates.push(i);
  });
  if (candidates.length === 0) return;

  // Prefer squares next to ones you have already opened
  const frontier = candidates.filter((i) => neighbors(i).some((n) => cells[n].revealed));
  const pool = frontier.length ? frontier : candidates;
  const i = pool[Math.floor(Math.random() * pool.length)];

  hintsLeft--;
  hintsUsed++;
  updateHintBtn();
  sfx.hint();
  revealCell(i);
  boardEl.children[i].classList.add("hintflash");
  messageEl.textContent = "💡 Đã sử dụng gợi ý!";
  checkWin();
}

function checkWin() {
  if (!gameOver && revealedCount === rows * cols - mineCount) win();
}

/* =====================================================
   8. Win and lose
   ===================================================== */
function lose(clicked) {
  gameOver = true;
  stopTimer();
  updateHintBtn();

  stats.played++;
  stats.streak = 0;
  persistStats();

  setFace("😵");
  messageEl.textContent = "💥XỊCH KỊCH ĐÙM ĐUM💥";
  sfx.lose();
  buzz([120, 60, 200]);
  if (settings.animations) boardEl.classList.add("shake");

  // The mine you clicked
  cells[clicked].revealed = true;
  draw(clicked);
  boardEl.children[clicked].classList.add("exploded");

  // Every other mine blows up one after another, starting near the clicked one
  const cr = Math.floor(clicked / cols);
  const cc = clicked % cols;
  const others = [];
  cells.forEach((c, i) => {
    if (i === clicked) return;
    if (c.mine && !c.flagged) others.push(i);
    else if (!c.mine && c.flagged) boardEl.children[i].classList.add("wrong");
  });
  others.sort((a, b) => {
    const da = Math.hypot(Math.floor(a / cols) - cr, (a % cols) - cc);
    const db = Math.hypot(Math.floor(b / cols) - cr, (b % cols) - cc);
    return da - db;
  });
  const step = others.length ? Math.min(70, 1400 / others.length) : 0;
  others.forEach((i, k) => {
    const explode = () => {
      cells[i].revealed = true;
      draw(i);
      if (k < 12) sfx.tick();
    };
    if (settings.animations) later(explode, 250 + k * step);
    else explode();
  });
}

function win() {
  gameOver = true;
  stopTimer();
  updateHintBtn();

  // Flag any mines that are still unflagged
  cells.forEach((c, i) => {
    if (c.mine && !c.flagged) {
      c.flagged = true;
      draw(i);
    }
  });
  flagsPlaced = mineCount;
  minesEl.textContent = 0;

  stats.played++;
  stats.won++;
  stats.streak++;
  stats.bestStreak = Math.max(stats.bestStreak, stats.streak);

  let msg = `🎉 Chúc mừng! Bạn đã thắng sau ${seconds} giây!`;
  const key = settings.level;
  if (key !== "custom") {
    if (hintsUsed === 0) {
      if (stats.best[key] === undefined || seconds < stats.best[key]) {
        stats.best[key] = seconds;
        msg += " 🏆 Kỷ lục mới! 🏆";
      }
    } else {
      msg += " (Đã sử dụng gợi ý nên không được tính là kỷ lục mới)";
    }
  }
  persistStats();
  updateBestInfo();

  setFace("😎");
  messageEl.textContent = msg;
  sfx.win();
  buzz([60, 40, 60, 40, 160]);

  if (settings.animations) {
    boardEl.classList.add("won");
    restartBtn.classList.add("bounce");
    for (let i = 0; i < cells.length; i++) {
      const el = boardEl.children[i];
      const r = Math.floor(i / cols);
      const c = i % cols;
      el.style.animationDelay = (r + c) * 30 + "ms";
      el.classList.add("wave");
    }
    startConfetti();
  }
}

/* =====================================================
   9. Timer
   ===================================================== */
function startTimer() {
  stopTimer();
  timerId = setInterval(() => {
    seconds++;
    timerEl.textContent = seconds;
  }, 1000);
}
function stopTimer() {
  clearInterval(timerId);
}

/* =====================================================
   10. Confetti
   ===================================================== */
let confettiParticles = [];
let confettiRaf = null;

function startConfetti() {
  if (!settings.animations || !cctx) return;
  stopConfetti();
  const w = (confettiCanvas.width = window.innerWidth);
  const h = (confettiCanvas.height = window.innerHeight);
  const colors = ["#ff5d5d", "#ffd166", "#06d6a0", "#4cc9f0", "#b388ff", "#ff9f1c"];
  confettiParticles = Array.from({ length: 150 }, () => ({
    x: Math.random() * w,
    y: -20 - Math.random() * h * 0.6,
    vx: (Math.random() - 0.5) * 3,
    vy: 2 + Math.random() * 3.5,
    size: 6 + Math.random() * 6,
    color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * 6.28,
    vr: (Math.random() - 0.5) * 0.35,
  }));

  const step = () => {
    cctx.clearRect(0, 0, w, h);
    confettiParticles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.03;
      p.rot += p.vr;
      cctx.save();
      cctx.translate(p.x, p.y);
      cctx.rotate(p.rot);
      cctx.fillStyle = p.color;
      cctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      cctx.restore();
    });
    confettiParticles = confettiParticles.filter((p) => p.y < h + 30);
    if (confettiParticles.length) confettiRaf = requestAnimationFrame(step);
    else cctx.clearRect(0, 0, w, h);
  };
  confettiRaf = requestAnimationFrame(step);
}

function stopConfetti() {
  cancelAnimationFrame(confettiRaf);
  confettiParticles = [];
  if (cctx) cctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
}

/* =====================================================
   11. Settings and stats panels
   ===================================================== */
function applySettings() {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.style.setProperty("--size", settings.cellSize + "px");
  document.body.classList.toggle("no-anim", !settings.animations);
  const meta = $("themeColor");
  if (meta) meta.setAttribute("content", THEME_COLORS[settings.theme]);
}

function syncSettingsUI() {
  $("setSound").checked = settings.sound;
  $("setVolume").value = Math.round(settings.volume * 100);
  $("setVibration").checked = settings.vibration;
  $("setTheme").value = settings.theme;
  $("setSize").value = settings.cellSize;
  $("sizeOut").textContent = settings.cellSize + "px";
  $("setAnimations").checked = settings.animations;
  difficultyEl.value = settings.level;
  customRow.hidden = settings.level !== "custom";
}

function syncCustomInputs() {
  cRows.value = settings.custom.rows;
  cCols.value = settings.custom.cols;
  cMines.value = settings.custom.mines;
}

function openDialog(dlg) {
  if (typeof dlg.showModal === "function") dlg.showModal();
  else dlg.setAttribute("open", "");
}

function renderStats() {
  $("stPlayed").textContent = stats.played;
  $("stWon").textContent = stats.won;
  $("stRate").textContent = stats.played ? Math.round((stats.won / stats.played) * 100) + "%" : "0%";
  $("stStreak").textContent = stats.streak;
  $("stBestStreak").textContent = stats.bestStreak;
  $("stBestEasy").textContent = fmtTime(stats.best.easy);
  $("stBestMedium").textContent = fmtTime(stats.best.medium);
  $("stBestHard").textContent = fmtTime(stats.best.hard);
}

function setFlagMode(on) {
  flagMode = on;
  flagModeBtn.textContent = "🚩 Flag mode: " + (flagMode ? "on" : "off");
  flagModeBtn.classList.toggle("on", flagMode);
  boardEl.classList.toggle("flag-mode", flagMode);
}

/* =====================================================
   12. Events
   ===================================================== */
// --- Board: mouse, touch (long-press = flag) ---
let pressTimer = null;
let longPressed = false;
let lastPointerType = "mouse";

boardEl.addEventListener("pointerdown", (e) => {
  lastPointerType = e.pointerType;
  const btn = e.target.closest(".cell");
  if (!btn || e.pointerType !== "touch") return;
  longPressed = false;
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    longPressed = true;
    toggleFlag(Number(btn.dataset.index));
  }, LONG_PRESS_MS);
});
["pointerup", "pointercancel", "pointerleave"].forEach((type) =>
  boardEl.addEventListener(type, () => clearTimeout(pressTimer))
);

boardEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".cell");
  if (!btn) return;
  if (longPressed) {
    longPressed = false;
    return;
  }
  const i = Number(btn.dataset.index);
  if (flagMode) toggleFlag(i);
  else handleReveal(i);
});

boardEl.addEventListener("contextmenu", (e) => {
  e.preventDefault(); // no browser menu on right click / long press
  if (lastPointerType === "touch") return; // touch is handled by the long-press timer
  const btn = e.target.closest(".cell");
  if (btn) toggleFlag(Number(btn.dataset.index));
});

// --- Buttons ---
restartBtn.addEventListener("click", newGame);
hintBtn.addEventListener("click", useHint);
flagModeBtn.addEventListener("click", () => setFlagMode(!flagMode));

$("settingsBtn").addEventListener("click", () => {
  syncSettingsUI();
  openDialog(settingsDialog);
});
$("statsBtn").addEventListener("click", () => {
  renderStats();
  openDialog(statsDialog);
});

// Little click sound for normal buttons (not the board squares)
document.addEventListener("click", (e) => {
  if (e.target.closest("button:not(.cell)")) sfx.click();
});

// --- Difficulty and custom board ---
difficultyEl.addEventListener("change", () => {
  settings.level = difficultyEl.value;
  customRow.hidden = settings.level !== "custom";
  persistSettings();
  newGame();
});

$("applyCustom").addEventListener("click", () => {
  settings.custom = {
    rows: Number(cRows.value),
    cols: Number(cCols.value),
    mines: Number(cMines.value),
  };
  settings.level = "custom";
  persistSettings();
  newGame(); // also writes the corrected numbers back into the inputs
  persistSettings();
});

// --- Settings panel ---
$("setSound").addEventListener("change", (e) => {
  settings.sound = e.target.checked;
  persistSettings();
  if (settings.sound) sfx.click();
});
$("setVolume").addEventListener("input", (e) => {
  settings.volume = Number(e.target.value) / 100;
  persistSettings();
});
$("setVolume").addEventListener("change", () => sfx.reveal(3)); // preview the volume
$("setVibration").addEventListener("change", (e) => {
  settings.vibration = e.target.checked;
  persistSettings();
  if (settings.vibration) buzz(40);
});
$("setTheme").addEventListener("change", (e) => {
  settings.theme = e.target.value;
  persistSettings();
  applySettings();
});
$("setSize").addEventListener("input", (e) => {
  settings.cellSize = Number(e.target.value);
  $("sizeOut").textContent = settings.cellSize + "px";
  persistSettings();
  applySettings();
});
$("setAnimations").addEventListener("change", (e) => {
  settings.animations = e.target.checked;
  persistSettings();
  applySettings();
});
$("resetSettings").addEventListener("click", () => {
  settings = Object.assign({}, DEFAULT_SETTINGS, { custom: Object.assign({}, DEFAULT_SETTINGS.custom) });
  persistSettings();
  applySettings();
  syncSettingsUI();
  newGame();
});

// --- Stats panel ---
$("resetStats").addEventListener("click", () => {
  if (!window.confirm("Reset tất cả dữ liệu và thời gian?")) return;
  stats = { played: 0, won: 0, streak: 0, bestStreak: 0, best: {} };
  persistStats();
  renderStats();
  updateBestInfo();
});

// --- Keyboard shortcuts ---
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (settingsDialog.open || statsDialog.open) return;
  const tag = e.target && e.target.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  const key = e.key.toLowerCase();
  if (key === "r") newGame();
  else if (key === "h") useHint();
  else if (key === "f") setFlagMode(!flagMode);
});

/* =====================================================
   13. Start
   ===================================================== */
applySettings();
syncSettingsUI();
newGame();
