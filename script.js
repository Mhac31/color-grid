"use strict";

const COLORS = ["red", "blue", "green", "yellow"];
const BOARD_SIZE = 5;
const BOARD_TILE_COUNT = BOARD_SIZE * BOARD_SIZE;
const TARGET_SIZE = 3;
// Zero-based row-major positions for rows 1-3 and columns 1-3 of the 5x5 board.
const MATCH_ZONE_INDICES = [6, 7, 8, 11, 12, 13, 16, 17, 18];
const STARTING_SECONDS = 60;
const SWAP_ANIMATION_MS = 260;
const PUZZLE_TRANSITION_MS = 480;

const targetGrid = document.querySelector("#target-grid");
const playerGrid = document.querySelector("#player-grid");
const moveCountDisplay = document.querySelector("#move-count");
const scoreDisplay = document.querySelector("#score");
const puzzleCountDisplay = document.querySelector("#puzzle-count");
const timerDisplay = document.querySelector("#timer");
const timerStat = document.querySelector("#timer-stat");
const statusMessage = document.querySelector("#status-message");
const gridHint = document.querySelector("#grid-hint");
const roundNumberDisplay = document.querySelector("#round-number");
const rewardToast = document.querySelector("#reward-toast");
const gameOverPanel = document.querySelector("#game-over-panel");
const finalScoreDisplay = document.querySelector("#final-score");
const finalPuzzlesDisplay = document.querySelector("#final-puzzles");
const finalMovesDisplay = document.querySelector("#final-moves");
const playAgainButton = document.querySelector("#play-again-button");
const colorblindToggle = document.querySelector("#colorblind-toggle");
const COLORBLIND_STORAGE_KEY = "colorGridColorblindMode";
const COLOR_MARKS = {
  red: { name: "Red", symbol: "●", letter: "R" },
  blue: { name: "Blue", symbol: "◆", letter: "B" },
  green: { name: "Green", symbol: "▲", letter: "G" },
  yellow: { name: "Yellow", symbol: "★", letter: "Y" },
};

let targetPattern = [];
let playerPattern = [];
let selectedIndex = null;
let totalMoves = 0;
let score = 0;
let puzzlesCompleted = 0;
let remainingSeconds = STARTING_SECONDS;
let timerInterval = null;
let transitionTimeout = null;
let timerStarted = false;
let isTransitioning = false;
let gameOver = false;
let puzzleRewarded = false;
let colorblindMode = true;

function loadColorblindPreference() {
  try {
    const savedPreference = window.localStorage.getItem(COLORBLIND_STORAGE_KEY);
    return savedPreference === null ? true : savedPreference === "true";
  } catch (error) {
    console.warn("[COLOR GRID] Could not load the colorblind mode preference.", error);
    return true;
  }
}

function saveColorblindPreference(enabled) {
  try {
    window.localStorage.setItem(COLORBLIND_STORAGE_KEY, String(enabled));
  } catch (error) {
    console.warn("[COLOR GRID] Could not save the colorblind mode preference.", error);
  }
}

function applyColorblindMode(enabled) {
  colorblindMode = enabled;
  document.documentElement.classList.toggle("colorblind-mode", colorblindMode);
}

function getColorQuantities(board) {
  return COLORS.reduce((quantities, color) => {
    quantities[color] = board.filter((tileColor) => tileColor === color).length;
    return quantities;
  }, {});
}

// Fisher-Yates keeps every tile while giving it a random new position.
function shufflePattern(pattern) {
  const shuffled = [...pattern];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

// Seed one of each color, then randomly fill the remaining cells.
function makeRandomBoard() {
  const board = [...COLORS];

  while (board.length < BOARD_TILE_COUNT) {
    board.push(COLORS[Math.floor(Math.random() * COLORS.length)]);
  }

  return shufflePattern(board);
}

// Draw the target from this board's inventory without using any color too often.
function makeTargetPattern(board, previousTarget) {
  let pattern;

  do {
    const availableTiles = [...board];
    pattern = Array.from({ length: TARGET_SIZE * TARGET_SIZE }, () => {
      const tileIndex = Math.floor(Math.random() * availableTiles.length);
      return availableTiles.splice(tileIndex, 1)[0];
    });
  } while (
    new Set(pattern).size < 2
    || (previousTarget && pattern.every((color, index) => color === previousTarget[index]))
  );

  return pattern;
}

function checkPattern() {
  const centerPattern = MATCH_ZONE_INDICES.map((boardIndex) => playerPattern[boardIndex]);
  const matches = centerPattern.every((color, index) => color === targetPattern[index]);

  console.debug("[COLOR GRID] target pattern:", [...targetPattern]);
  console.debug("[COLOR GRID] current center pattern:", centerPattern);
  console.debug("[COLOR GRID] patterns match:", matches);
  console.debug("[COLOR GRID] available color quantities:", getColorQuantities(playerPattern));

  return matches;
}

function isCenterSolved(board, pattern) {
  return MATCH_ZONE_INDICES.every((boardIndex, targetIndex) => {
    return board[boardIndex] === pattern[targetIndex];
  });
}

// Shuffle without changing the board inventory, then force a mismatch if needed.
function makeUnsolvedBoard(board, pattern) {
  const shuffled = shufflePattern(board);

  if (isCenterSolved(shuffled, pattern)) {
    const swap = MATCH_ZONE_INDICES.flatMap((centerIndex) => {
      const outsideIndex = shuffled.findIndex((color, index) => {
        return !MATCH_ZONE_INDICES.includes(index) && color !== pattern[MATCH_ZONE_INDICES.indexOf(centerIndex)];
      });

      return outsideIndex < 0 ? [] : [[centerIndex, outsideIndex]];
    })[0];

    [shuffled[swap[0]], shuffled[swap[1]]] = [shuffled[swap[1]], shuffled[swap[0]]];
  }

  return shuffled;
}

function makePuzzle(previousTarget = null) {
  const board = makeRandomBoard();
  const pattern = makeTargetPattern(board, previousTarget);
  return {
    target: pattern,
    board: makeUnsolvedBoard(board, pattern),
  };
}

function makeTile(color, index, isInteractive) {
  const tile = document.createElement("button");
  const isMatchZoneTile = isInteractive && MATCH_ZONE_INDICES.includes(index);
  tile.className = `tile tile-${color}${isMatchZoneTile ? " is-match-zone" : ""}`;
  tile.type = "button";
  const colorInfo = COLOR_MARKS[color];
  const zoneLabel = isMatchZoneTile ? ", matching zone" : "";
  const targetLabel = isInteractive ? "" : ", target";
  tile.setAttribute("aria-label", `${colorInfo.name} tile${targetLabel}, position ${index + 1}${zoneLabel}`);

  const mark = document.createElement("span");
  mark.className = "tile-mark";
  mark.setAttribute("aria-hidden", "true");

  const symbol = document.createElement("span");
  symbol.className = "tile-symbol";
  symbol.textContent = colorInfo.symbol;

  const letter = document.createElement("span");
  letter.className = "tile-letter";
  letter.textContent = colorInfo.letter;

  mark.append(symbol, letter);
  tile.append(mark);

  if (isInteractive) {
    tile.dataset.index = String(index);
    tile.setAttribute("aria-pressed", "false");
    tile.disabled = gameOver || isTransitioning;
  } else {
    tile.tabIndex = -1;
    tile.disabled = true;
    tile.setAttribute("aria-hidden", "true");
  }

  return tile;
}

function renderTarget() {
  targetGrid.replaceChildren(
    ...targetPattern.map((color, index) => makeTile(color, index, false)),
  );
  targetGrid.setAttribute("aria-label", "Target 3 by 3 color pattern");
}

function renderPlayerGrid() {
  playerGrid.replaceChildren(
    ...playerPattern.map((color, index) => makeTile(color, index, true)),
  );
}

function updateTileLabels() {
  colorblindToggle.checked = colorblindMode;
  applyColorblindMode(colorblindMode);
}

function setTilesDisabled(disabled) {
  playerGrid.querySelectorAll(".tile").forEach((tile) => {
    tile.disabled = disabled;
  });
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function updateTimerDisplay() {
  timerDisplay.textContent = formatTime(remainingSeconds);
  timerStat.classList.toggle("is-urgent", remainingSeconds <= 10);
}

function startTimer() {
  if (timerInterval !== null || gameOver) {
    return;
  }

  timerStarted = true;
  setStatus("Time is running! Match the target before it runs out.");
  timerInterval = window.setInterval(() => {
    remainingSeconds = Math.max(0, remainingSeconds - 1);
    updateTimerDisplay();

    if (remainingSeconds === 0) {
      endGame();
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval !== null) {
    window.clearInterval(timerInterval);
    timerInterval = null;
  }
}

function setStatus(message) {
  statusMessage.lastChild.textContent = ` ${message}`;
}

function clearSelection() {
  selectedIndex = null;
  playerGrid.querySelectorAll(".tile").forEach((tile) => {
    tile.classList.remove("is-selected");
    tile.setAttribute("aria-pressed", "false");
  });
}

// Move the existing tile elements and animate their old-to-new positions.
function swapTiles(firstIndex, secondIndex) {
  const tiles = Array.from(playerGrid.children);
  const oldPositions = new Map(
    tiles.map((tile) => [tile, tile.getBoundingClientRect()]),
  );

  [playerPattern[firstIndex], playerPattern[secondIndex]] =
    [playerPattern[secondIndex], playerPattern[firstIndex]];
  [tiles[firstIndex], tiles[secondIndex]] = [tiles[secondIndex], tiles[firstIndex]];
  playerPattern.forEach((color, index) => {
    const tile = tiles[index];
    const colorName = COLOR_MARKS[color].name;
    tile.dataset.index = String(index);
    tile.setAttribute(
      "aria-label",
      `${colorName} tile, position ${index + 1}${MATCH_ZONE_INDICES.includes(index) ? ", matching zone" : ""}`,
    );
    tile.classList.toggle("is-match-zone", MATCH_ZONE_INDICES.includes(index));
    playerGrid.append(tile);
  });

  tiles.forEach((tile) => {
    const before = oldPositions.get(tile);
    const after = tile.getBoundingClientRect();
    const offsetX = before.left - after.left;
    const offsetY = before.top - after.top;

    if (offsetX !== 0 || offsetY !== 0) {
      tile.animate(
        [
          { transform: `translate(${offsetX}px, ${offsetY}px)` },
          { transform: "translate(0, 0)" },
        ],
        { duration: SWAP_ANIMATION_MS, easing: "cubic-bezier(0.2, 0.75, 0.25, 1)" },
      );
    }
  });
}

function showReward() {
  rewardToast.hidden = false;
  rewardToast.animate(
    [
      { opacity: 0, transform: "translate(-50%, 12px) scale(0.92)" },
      { opacity: 1, transform: "translate(-50%, 0) scale(1)", offset: 0.18 },
      { opacity: 1, transform: "translate(-50%, -5px) scale(1)", offset: 0.78 },
      { opacity: 0, transform: "translate(-50%, -18px) scale(0.96)" },
    ],
    { duration: 1250, easing: "ease-out" },
  ).onfinish = () => {
    rewardToast.hidden = true;
  };
}

function finishPuzzleTransition() {
  transitionTimeout = null;

  if (gameOver) {
    return;
  }

  isTransitioning = false;
  playerGrid.classList.remove("is-entering");
  targetGrid.classList.remove("is-entering");
  setTilesDisabled(false);
  gridHint.textContent = "Swap any two tiles · match the outlined center";
  setStatus("New pattern! Match the outlined center to build your score.");
}

function startNextPuzzle() {
  const nextPuzzle = makePuzzle(targetPattern);
  targetPattern = nextPuzzle.target;
  playerPattern = nextPuzzle.board;
  puzzleRewarded = false;
  roundNumberDisplay.textContent = String(puzzlesCompleted + 1).padStart(2, "0");
  renderTarget();
  renderPlayerGrid();
  targetGrid.classList.add("is-entering");
  playerGrid.classList.add("is-entering");
  isTransitioning = true;
  setTilesDisabled(true);
  transitionTimeout = window.setTimeout(finishPuzzleTransition, PUZZLE_TRANSITION_MS);
}

function completePuzzle() {
  if (gameOver || puzzleRewarded) {
    return;
  }

  puzzleRewarded = true;
  puzzlesCompleted += 1;
  score += 100;
  remainingSeconds += 10;
  scoreDisplay.textContent = String(score);
  puzzleCountDisplay.textContent = String(puzzlesCompleted);
  updateTimerDisplay();
  clearSelection();
  showReward();
  setStatus("Pattern matched! +100 points and 10 seconds.");
  startNextPuzzle();
}

function handleTileClick(event) {
  const tile = event.target.closest(".tile");

  if (!tile || gameOver || isTransitioning) {
    return;
  }

  const clickedIndex = Number(tile.dataset.index);

  if (selectedIndex === null) {
    selectedIndex = clickedIndex;
    tile.classList.add("is-selected");
    tile.setAttribute("aria-pressed", "true");
    gridHint.textContent = "Now pick a second tile";
    setStatus("Choose another tile to swap.");
    return;
  }

  if (selectedIndex === clickedIndex) {
    clearSelection();
    gridHint.textContent = "Swap any two tiles · match the outlined center";
    setStatus("Selection cleared. Choose a tile to begin.");
    return;
  }

  const firstIndex = selectedIndex;
  if (!timerStarted) {
    startTimer();
  }

  swapTiles(firstIndex, clickedIndex);
  const patternMatched = checkPattern();
  totalMoves += 1;
  moveCountDisplay.textContent = String(totalMoves);
  clearSelection();
  gridHint.textContent = "Swap any two tiles · match the outlined center";
  setStatus("Nice swap. Keep going!");

  if (patternMatched && !puzzleRewarded) {
    isTransitioning = true;
    setTilesDisabled(true);
    completePuzzle();
  }
}

function endGame() {
  gameOver = true;
  isTransitioning = false;
  stopTimer();

  if (transitionTimeout !== null) {
    window.clearTimeout(transitionTimeout);
    transitionTimeout = null;
  }

  playerGrid.classList.remove("is-entering");
  targetGrid.classList.remove("is-entering");
  clearSelection();
  setTilesDisabled(true);
  gridHint.textContent = "The run is over";
  setStatus("Time's up. Play again for another run!");
  finalScoreDisplay.textContent = String(score);
  finalPuzzlesDisplay.textContent = String(puzzlesCompleted);
  finalMovesDisplay.textContent = String(totalMoves);
  gameOverPanel.hidden = false;
  playAgainButton.focus();
}

function startGame() {
  stopTimer();
  if (transitionTimeout !== null) {
    window.clearTimeout(transitionTimeout);
    transitionTimeout = null;
  }

  selectedIndex = null;
  totalMoves = 0;
  score = 0;
  puzzlesCompleted = 0;
  remainingSeconds = STARTING_SECONDS;
  timerStarted = false;
  isTransitioning = false;
  gameOver = false;
  puzzleRewarded = false;
  const firstPuzzle = makePuzzle();
  targetPattern = firstPuzzle.target;
  playerPattern = firstPuzzle.board;

  moveCountDisplay.textContent = "0";
  scoreDisplay.textContent = "0";
  puzzleCountDisplay.textContent = "0";
  roundNumberDisplay.textContent = "01";
  updateTimerDisplay();
  gameOverPanel.hidden = true;
  rewardToast.hidden = true;
  gridHint.textContent = "Swap any two tiles · match the outlined center";
  setStatus("Ready when you are. Your 60 seconds start on your first swap.");
  renderTarget();
  renderPlayerGrid();
}

playerGrid.addEventListener("click", handleTileClick);
playAgainButton.addEventListener("click", startGame);
colorblindToggle.addEventListener("change", () => {
  colorblindMode = colorblindToggle.checked;
  applyColorblindMode(colorblindMode);
  saveColorblindPreference(colorblindMode);
  setStatus(`Colorblind mode ${colorblindMode ? "on" : "off"}.`);
});

colorblindMode = loadColorblindPreference();
updateTileLabels();
startGame();
