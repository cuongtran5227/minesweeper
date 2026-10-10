// ---------- 1. Settings ----------
const LEVELS = {
  easy:   { rows: 9,  cols: 9,  mines: 10 },
  medium: { rows: 12, cols: 12, mines: 25 },
  hard:   { rows: 16, cols: 16, mines: 40 },
};

// ---------- 2. Page elements ----------
const boardEl = document.getElementById("board");
const minesEl = document.getElementById("mines");
const timerEl = document.getElementById("timer");
const messageEl = document.getElementById("message");
const restartBtn = document.getElementById("restart");
const difficultyEl = document.getElementById("difficulty");
const flagModeBtn = document.getElementById("flagMode");

// ---------- 3. Game state ----------
let rows, cols, mineCount;
let cells;            // one object per square: { mine, revealed, flagged, adjacent }
let firstClick, gameOver, flagsPlaced, revealedCount;
let seconds, timerId;
let flagMode = false;

// ---------- 4. Start a new game ----------
function newGame() {
  stopTimer();
  ({ rows, cols, mines: mineCount } = LEVELS[difficultyEl.value]);

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
  seconds = 0;

  timerEl.textContent = 0;
  minesEl.textContent = mineCount;
  messageEl.textContent = "";
  restartBtn.textContent = "PLAY🙂RESTART";

  buildBoard();
}

function buildBoard() {
  boardEl.innerHTML = "";
  boardEl.style.setProperty("--cols", cols);
  for (let i = 0; i < rows * cols; i++) {
    const btn = document.createElement("button");
    btn.className = "cell";
    btn.dataset.index = i;
    boardEl.appendChild(btn);
  }
}

// ---------- 5. Helpers ----------
// Indexes of the (up to 8) squares around square i
function neighbors(i) {
  const r = Math.floor(i / cols);
  const c = i % cols;
  const result = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) result.push(nr * cols + nc);
    }
  }
  return result;
}

// Place mines AFTER the first click so the first click is always safe
function placeMines(safeIndex) {
  const forbidden = new Set([safeIndex, ...neighbors(safeIndex)]);
  let placed = 0;
  while (placed < mineCount) {
    const i = Math.floor(Math.random() * cells.length);
    if (cells[i].mine || forbidden.has(i)) continue;
    cells[i].mine = true;
    placed++;
  }
  // Count the mines around every square
  cells.forEach((cell, i) => {
    cell.adjacent = neighbors(i).filter((n) => cells[n].mine).length;
  });
}

// ---------- 6. Drawing one square ----------
function draw(i) {
  const cell = cells[i];
  const el = boardEl.children[i];
  el.className = "cell";
  el.textContent = "";

  if (cell.revealed) {
    el.classList.add("revealed");
    if (cell.mine) {
      el.classList.add("mine");
      el.textContent = "💣";
    } else if (cell.adjacent > 0) {
      el.textContent = cell.adjacent;
      el.classList.add("n" + cell.adjacent);
    }
  } else if (cell.flagged) {
    el.textContent = "🚩";
  }
}

// ---------- 7. Player actions ----------
function revealCell(start) {
  // Flood fill: empty squares (0 mines around) open their neighbours too
  const stack = [start];
  while (stack.length) {
    const i = stack.pop();
    const cell = cells[i];
    if (cell.revealed || cell.flagged) continue;
    cell.revealed = true;
    revealedCount++;
    draw(i);
    if (cell.adjacent === 0) neighbors(i).forEach((n) => stack.push(n));
  }
}

function handleReveal(i) {
  const cell = cells[i];
  if (gameOver || cell.revealed || cell.flagged) return;

  if (firstClick) {
    placeMines(i);
    firstClick = false;
    startTimer();
  }

  if (cell.mine) {
    lose(i);
    return;
  }

  revealCell(i);

  if (revealedCount === rows * cols - mineCount) win();
}

function toggleFlag(i) {
  const cell = cells[i];
  if (gameOver || cell.revealed) return;
  cell.flagged = !cell.flagged;
  flagsPlaced += cell.flagged ? 1 : -1;
  minesEl.textContent = mineCount - flagsPlaced;
  draw(i);
}

// ---------- 8. Win / lose ----------
function lose(clickedIndex) {
  gameOver = true;
  stopTimer();
  cells.forEach((cell, i) => {
    if (cell.mine && !cell.flagged) {
      cell.revealed = true;
      draw(i);
    } else if (!cell.mine && cell.flagged) {
      boardEl.children[i].classList.add("wrong");
    }
  });
  boardEl.children[clickedIndex].classList.add("exploded");
  restartBtn.textContent = "😎RESTART😎";
  messageEl.textContent = "💥XỊCH KỊCH ĐÙM ĐUM, CON GÀ ƠI?";
}

function win() {
  gameOver = true;
  stopTimer();
  cells.forEach((cell, i) => {
    if (cell.mine && !cell.flagged) {
      cell.flagged = true;
      draw(i);
    }
  });
  minesEl.textContent = 0;
  restartBtn.textContent = "😎RESTART😎";
  messageEl.textContent = `🎉 BẠN ĐÃ THẮNG SAU ${seconds} GIÂY!`;
}

// ---------- 9. Timer ----------
function startTimer() {
  timerId = setInterval(() => {
    seconds++;
    timerEl.textContent = seconds;
  }, 1000);
}
function stopTimer() {
  clearInterval(timerId);
}

// ---------- 10. Events ----------
boardEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".cell");
  if (!btn) return;
  const i = Number(btn.dataset.index);
  if (flagMode) toggleFlag(i);
  else handleReveal(i);
});

boardEl.addEventListener("contextmenu", (e) => {
  e.preventDefault(); // stop the browser's right-click menu
  const btn = e.target.closest(".cell");
  if (btn) toggleFlag(Number(btn.dataset.index));
});

restartBtn.addEventListener("click", newGame);
difficultyEl.addEventListener("change", newGame);

flagModeBtn.addEventListener("click", () => {
  flagMode = !flagMode;
  flagModeBtn.textContent = "🚩 Flag mode: " + (flagMode ? "on" : "off");
});

newGame();
