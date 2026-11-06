import { createInitialBoard, opposite, getLegalMoves, getPieceLegalMoves, applyMove, isInCheck, getGameStatus, moveToNotation, pieceLabel } from './engine.js';

const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = 'yijian.xiangqi.v1';
const colorName = (color) => color === 'red' ? '红方' : '黑方';
const difficulties = { easy: '入门', normal: '进阶', hard: '挑战' };
const svgStart = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
const icons = {
  flip: '<path d="M4 9a8 8 0 0 1 13-4l3 3M20 3v5h-5M20 15a8 8 0 0 1-13 4l-3-3M4 21v-5h5"/>',
  bulb: '<path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 .8-1 1-1 3H9c0-2 0-2.2-1-3Z"/>',
  sound: '<path d="m11 4-6 5H2v6h3l6 5V4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  muted: '<path d="m11 4-6 5H2v6h3l6 5V4Zm5 5 6 6m0-6-6 6"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4M10 10h4v4h-4z"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6m3 10v-3a6 6 0 0 0-3-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  undo: '<path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12h-2"/>',
  flag: '<path d="M5 21V3m0 1c5-5 9 5 14 0v10c-5 5-9-5-14 0"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  scroll: '<path d="M6 4h12v15a2 2 0 0 1-4 0H4V6a2 2 0 1 1 4 0H6m3 2h6m-6 4h6m-6 4h4m5-12h2v12"/>',
  leaf: '<path d="M20 3C7 2 1 11 7 17s15 0 13-14ZM4 21 15 10m-6 6v-5m1 4h5"/>',
};
function fillIcons(root = document) { root.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = svgStart + (icons[el.dataset.icon] || icons.leaf) + '</svg>'; }); }
fillIcons();

function freshGame(config = {}) {
  return { board: createInitialBoard(), turn: 'red', history: [], mode: 'ai', difficulty: 'normal', humanColor: 'red', flipped: false, sound: false, startedAt: Date.now(), endedAt: null, result: null, ...config };
}
let state = freshGame();
let selected = null;
let legalTargets = [];
let suggestion = null;
let thinking = false;
let hintBusy = false;
let activeWorker = null;
let requestId = 0;
let workerTimeout = null;
let toastTimeout = null;
let aiError = false;
let storageAvailable = true;
let audioContext = null;

function moveKey(move) { return `${move.from.row},${move.from.col}-${move.to.row},${move.to.col}`; }
function samePoint(point, row, col) { return point?.row === row && point?.col === col; }
function humanTurn() { return state.mode === 'local' || state.turn === state.humanColor; }
function status() { return state.result || getGameStatus(state.board, state.turn); }

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, mode: state.mode, difficulty: state.difficulty, humanColor: state.humanColor, flipped: state.flipped, sound: state.sound, moves: state.history.map(({ move }) => ({ from: move.from, to: move.to })), startedAt: state.startedAt, endedAt: state.endedAt, result: state.result }));
    storageAvailable = true;
  } catch { storageAvailable = false; }
  $('#save-label').textContent = storageAvailable ? '棋局自动保存' : '当前浏览器无法保存';
}

function restore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!raw || raw.version !== 1 || !Array.isArray(raw.moves) || raw.moves.length > 2000) return;
    const config = { mode: raw.mode === 'local' ? 'local' : 'ai', difficulty: raw.difficulty in difficulties ? raw.difficulty : 'normal', humanColor: raw.humanColor === 'black' ? 'black' : 'red', flipped: !!raw.flipped, sound: !!raw.sound, startedAt: Number.isFinite(raw.startedAt) && raw.startedAt > 0 ? Math.min(Date.now(), raw.startedAt) : Date.now() };
    const loaded = freshGame(config);
    for (const requested of raw.moves) {
      if (getGameStatus(loaded.board, loaded.turn).over) throw new Error('已结束的棋局仍有走棋');
      const move = getLegalMoves(loaded.board, loaded.turn).find((candidate) => moveKey(candidate) === moveKey(requested));
      if (!move) throw new Error('棋谱包含不合法走法');
      loaded.history.push({ board: loaded.board, turn: loaded.turn, move, notation: moveToNotation(loaded.board, move) });
      loaded.board = applyMove(loaded.board, move);
      loaded.turn = opposite(loaded.turn);
    }
    if (raw.result?.reason === 'resign' && ['red', 'black'].includes(raw.result.winner)) loaded.result = { over: true, winner: raw.result.winner, reason: 'resign', check: false };
    loaded.endedAt = Number.isFinite(raw.endedAt) && raw.endedAt >= loaded.startedAt && raw.endedAt <= Date.now() ? raw.endedAt : null;
    if (getGameStatus(loaded.board, loaded.turn).over && !loaded.endedAt) loaded.endedAt = Date.now();
    state = loaded;
  } catch { toast('已忽略无法读取的存档，为你开启新棋局'); }
}

function toast(message) {
  clearTimeout(toastTimeout);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimeout = setTimeout(() => { $('#toast').hidden = true; }, 3400);
}

function boardArt() {
  let lines = '<rect x="66" y="66" width="768" height="858" rx="2" fill="none" stroke="#97703b" stroke-width="2"/><rect x="74" y="74" width="752" height="842" fill="none" stroke="#a78048" stroke-width=".7"/>';
  for (let row = 0; row < 10; row++) lines += `<path d="M90 ${90 + row * 90}H810"/>`;
  for (let col = 0; col < 9; col++) {
    const x = 90 + col * 90;
    lines += col === 0 || col === 8 ? `<path d="M${x} 90V900"/>` : `<path d="M${x} 90V450M${x} 540V900"/>`;
  }
  lines += '<path d="m360 90 180 180m0-180-180 180m0 450 180 180m0-180-180 180"/>';
  const crosses = [[2, 1], [2, 7], [7, 1], [7, 7], ...[0, 2, 4, 6, 8].flatMap((col) => [[3, col], [6, col]])];
  for (const [row, col] of crosses) {
    const x = 90 + col * 90, y = 90 + row * 90;
    for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
      if ((col === 0 && dx === -1) || (col === 8 && dx === 1)) continue;
      lines += `<path d="M${x + dx * 23} ${y + dy * 9}H${x + dx * 9}V${y + dy * 23}"/>`;
    }
  }
  const top = state.flipped ? ['九', '八', '七', '六', '五', '四', '三', '二', '一'] : ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const bottom = state.flipped ? ['9', '8', '7', '6', '5', '4', '3', '2', '1'] : ['九', '八', '七', '六', '五', '四', '三', '二', '一'];
  let labels = '';
  top.forEach((label, col) => { labels += `<text x="${90 + col * 90}" y="43">${label}</text><text x="${90 + col * 90}" y="962">${bottom[col]}</text>`; });
  return `<svg class="board-art" viewBox="0 0 900 1000" aria-hidden="true"><g fill="none" stroke="#987440" stroke-width="1.5" stroke-opacity=".72">${lines}</g><g font-family="SimSun,serif" font-size="40" fill="#9a7848" text-anchor="middle" letter-spacing="13"><text x="274" y="509">楚 河</text><text x="638" y="509">汉 界</text></g><g font-size="17" font-family="SimSun,serif" fill="#a98b5d" text-anchor="middle">${labels}</g></svg>`;
}

function renderBoard() {
  const active = document.activeElement?.closest('.board-cell');
  const focused = active ? { row: Number(active.dataset.row), col: Number(active.dataset.col) } : null;
  const gameStatus = status();
  const last = state.history.at(-1)?.move;
  const checks = { red: isInCheck(state.board, 'red'), black: isInCheck(state.board, 'black') };
  let html = boardArt();
  for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
    const piece = state.board[row][col];
    const viewRow = state.flipped ? 9 - row : row;
    const viewCol = state.flipped ? 8 - col : col;
    const legal = legalTargets.some((move) => samePoint(move.to, row, col));
    const classes = ['board-cell'];
    if (samePoint(selected, row, col)) classes.push('selected');
    if (samePoint(last?.from, row, col)) classes.push('last-from');
    if (samePoint(last?.to, row, col)) classes.push('last-to');
    if (legal) classes.push('legal', ...(piece ? ['capture'] : []));
    if (suggestion && (samePoint(suggestion.from, row, col) || samePoint(suggestion.to, row, col))) classes.push('hint', 'last-to');
    if (piece?.type === 'king' && checks[piece.color]) classes.push('in-check');
    const label = `${piece ? colorName(piece.color) + pieceLabel(piece) : '空位'}，第${row + 1}行第${col + 1}列${legal ? '，可走' : ''}`;
    html += `<button type="button" class="${classes.join(' ')}" data-row="${row}" data-col="${col}" style="left:${10 + viewCol * 10}%;top:${9 + viewRow * 9}%" aria-label="${label}" aria-pressed="${samePoint(selected, row, col)}" ${row === 9 && col === 4 ? '' : 'tabindex="-1"'}>${piece ? `<span class="piece ${piece.color}" aria-hidden="true">${pieceLabel(piece)}</span>` : ''}</button>`;
  }
  $('#board').innerHTML = html;
  $('#board').classList.toggle('game-over', gameStatus.over);
  if (focused) $(`.board-cell[data-row="${focused.row}"][data-col="${focused.col}"]`)?.focus({ preventScroll: true });
}

function renderPlayers() {
  const bottomColor = state.flipped ? 'black' : 'red';
  const topColor = opposite(bottomColor);
  for (const [prefix, color] of [['opponent', topColor], ['self', bottomColor]]) {
    const ai = state.mode === 'ai' && color !== state.humanColor;
    $(`#${prefix}-avatar`).textContent = color === 'red' ? '帅' : '将';
    $(`#${prefix}-avatar`).className = `avatar ${color}-avatar`;
    $(`#${prefix}-name`).textContent = state.mode === 'local' ? `${colorName(color)}棋手` : ai ? '弈间棋手' : '我方';
    $(`#${prefix}-detail`).textContent = state.mode === 'local' ? '双人同屏 · 轮流行棋' : ai ? `电脑 · ${difficulties[state.difficulty]}难度` : '从容落子，好棋自来';
    $(`#${prefix}-side`).textContent = `执${color === 'red' ? '红' : '黑'} · ${color === 'red' ? '先手' : '后手'}`;
    $(`#${prefix}-side`).className = `side-label ${color}-label`;
  }
}

function renderHistory() {
  $('#move-count').textContent = state.history.length;
  if (!state.history.length) {
    $('#move-history').innerHTML = '<div class="empty-history"><span data-icon="scroll"></span><p>棋局，始于你的第一步</p><span>落子后，棋谱将在这里记录</span></div>';
    fillIcons($('#move-history'));
  } else {
    let html = '';
    for (let i = 0; i < state.history.length; i += 2) {
      const red = state.history[i], black = state.history[i + 1];
      html += `<div class="history-row"><span>${String(i / 2 + 1).padStart(2, '0')}</span><span class="history-move red${i === state.history.length - 1 ? ' current' : ''}">${red.notation}</span><span class="history-move black${i + 1 === state.history.length - 1 ? ' current' : ''}">${black?.notation || '—'}</span></div>`;
    }
    $('#move-history').innerHTML = html;
    $('#move-history').scrollTop = $('#move-history').scrollHeight;
  }
  const captures = state.history.map(({ move }) => move.captured).filter(Boolean);
  $('#capture-summary').innerHTML = captures.length ? `<span class="captured-red">红方吃子 ${captures.filter((piece) => piece.color === 'black').map(pieceLabel).join(' ') || '—'}</span><span class="captured-black">黑方吃子 ${captures.filter((piece) => piece.color === 'red').map(pieceLabel).join(' ') || '—'}</span>` : '<span>尚未发生吃子</span>';
}

function renderStatus() {
  const gameStatus = status();
  $('#turn-indicator').className = `turn-dot ${gameStatus.over ? 'ended' : state.turn}`;
  $('#thinking-indicator').hidden = !(thinking || hintBusy);
  $('#retry-ai').hidden = !aiError || humanTurn() || gameStatus.over;
  if (gameStatus.over) {
    $('#status-title').textContent = `${colorName(gameStatus.winner)}获胜`;
    $('#status-description').textContent = { resign: `${colorName(opposite(gameStatus.winner))}认输，感谢这盘好棋`, checkmate: '将死 · 棋局结束，可以再来一盘', stalemate: '困毙 · 无合法走法的一方判负', 'king-captured': '将帅被吃，棋局结束' }[gameStatus.reason] || '棋局结束';
  } else {
    $('#status-title').textContent = `${colorName(state.turn)}${gameStatus.check ? '被将军' : '行棋'}`;
    $('#status-description').textContent = aiError ? '电脑计算中断，请点击下方重试' : thinking ? '弈间棋手正在思考…' : hintBusy ? '正在寻找适合的走法…' : gameStatus.check ? '请应将，保护你的将帅' : selected ? `已选${pieceLabel(state.board[selected.row][selected.col])}，点击标记位置落子` : state.history.length === 0 && humanTurn() ? '你先行，请选择一枚棋子' : '请选择棋子，落子从容';
  }
  $('#round-count').textContent = String(Math.floor(state.history.length / 2) + 1).padStart(2, '0');
  $('#undo-button').disabled = state.history.length === 0 || (state.mode === 'ai' && state.history.length === 1 && state.history[0].turn !== state.humanColor);
  $('#resign-button').disabled = gameStatus.over || thinking;
  $('#hint-button').disabled = gameStatus.over || !humanTurn() || thinking || hintBusy;
  $('#sound-button').setAttribute('aria-pressed', String(state.sound));
  $('#sound-label').textContent = state.sound ? '音效已开启' : '音效已关闭';
  $('#sound-button [data-icon]').dataset.icon = state.sound ? 'sound' : 'muted';
  fillIcons($('#sound-button'));
  renderClock();
}

function renderSettings() {
  document.querySelectorAll('[data-mode]').forEach((el) => { el.classList.toggle('active', el.dataset.mode === state.mode); el.setAttribute('aria-pressed', String(el.dataset.mode === state.mode)); });
  document.querySelectorAll('[data-difficulty]').forEach((el) => { el.classList.toggle('active', el.dataset.difficulty === state.difficulty); el.setAttribute('aria-pressed', String(el.dataset.difficulty === state.difficulty)); });
  document.querySelectorAll('[data-color]').forEach((el) => { el.classList.toggle('active', el.dataset.color === state.humanColor); el.setAttribute('aria-pressed', String(el.dataset.color === state.humanColor)); });
  $('#difficulty-description').textContent = { easy: '轻松练习，熟悉棋路', normal: '思考几步，棋逢对手', hard: '步步为营，认真过招' }[state.difficulty];
  $('#ai-settings').hidden = state.mode !== 'ai';
  $('#local-description').hidden = state.mode === 'ai';
}
function render() { renderBoard(); renderPlayers(); renderStatus(); renderHistory(); renderSettings(); }
function renderClock() {
  const seconds = Math.max(0, Math.floor(((state.endedAt || Date.now()) - state.startedAt) / 1000));
  $('#elapsed-time').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function sound(capture = false) {
  if (!state.sound) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    oscillator.connect(gain); gain.connect(audioContext.destination);
    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(capture ? 480 : 730, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(capture ? 100 : 230, audioContext.currentTime + .075);
    gain.gain.setValueAtTime(.13, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .12);
    oscillator.start(); oscillator.stop(audioContext.currentTime + .13);
  } catch { /* Browsers without Web Audio still support the full game. */ }
}

function cancelAnalysis() {
  requestId++;
  clearTimeout(workerTimeout);
  activeWorker?.terminate(); activeWorker = null;
  thinking = false; hintBusy = false; aiError = false;
}

function makeMove(move) {
  cancelAnalysis();
  const notation = moveToNotation(state.board, move);
  state.history.push({ board: state.board, turn: state.turn, move, notation });
  state.board = applyMove(state.board, move);
  state.turn = opposite(state.turn);
  selected = null; legalTargets = []; suggestion = null;
  const gameStatus = getGameStatus(state.board, state.turn);
  if (gameStatus.over) state.endedAt = Date.now();
  sound(!!move.captured);
  save(); render();
  $('#board-announcement').textContent = `${colorName(opposite(state.turn))}${notation}。${$('#status-title').textContent}`;
  if (gameStatus.over) toast(`${colorName(gameStatus.winner)}获胜，棋局结束`);
  else if (gameStatus.check) toast(`${colorName(state.turn)}被将军，请应将`);
  maybeComputerMove();
}

function beginAnalysis(kind) {
  cancelAnalysis();
  const id = ++requestId;
  const currentColor = state.turn;
  thinking = kind === 'computer'; hintBusy = kind === 'hint';
  renderStatus();
  const fail = () => {
    if (id !== requestId) return;
    cancelAnalysis(); aiError = kind === 'computer';
    renderStatus(); toast(kind === 'computer' ? '电脑计算暂时中断，点击“重新让电脑行棋”即可继续' : '提示暂不可用，请稍后重试');
  };
  try {
    activeWorker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
    activeWorker.onmessage = ({ data }) => {
      if (id !== requestId || data.id !== id) return;
      if (data.error || !data.move) { fail(); return; }
      const move = getLegalMoves(state.board, currentColor).find((candidate) => moveKey(candidate) === moveKey(data.move));
      if (!move || state.turn !== currentColor || status().over) { fail(); return; }
      cancelAnalysis();
      if (kind === 'computer') makeMove(move);
      else {
        suggestion = move; selected = move.from;
        legalTargets = getPieceLegalMoves(state.board, move.from.row, move.from.col);
        renderBoard(); renderStatus();
        toast(`不妨试试：${moveToNotation(state.board, move)}（虚线框为建议落点）`);
      }
    };
    activeWorker.onerror = fail;
    activeWorker.postMessage({ id, board: state.board, color: currentColor, difficulty: kind === 'hint' ? 'normal' : state.difficulty });
    workerTimeout = setTimeout(fail, 15000);
  } catch { fail(); }
}
function maybeComputerMove() {
  if (state.mode === 'ai' && !humanTurn() && !status().over) beginAnalysis('computer');
}

function selectCell(row, col) {
  if (status().over) { toast('本局已结束，可以悔棋或重新开局'); return; }
  if (!humanTurn() || thinking) { toast('电脑正在思考，请稍候'); return; }
  if (hintBusy) cancelAnalysis();
  const move = legalTargets.find((candidate) => samePoint(candidate.to, row, col));
  if (selected && move) { makeMove(move); return; }
  const piece = state.board[row][col];
  if (piece?.color === state.turn) {
    if (samePoint(selected, row, col)) { selected = null; legalTargets = []; }
    else { selected = { row, col }; legalTargets = getPieceLegalMoves(state.board, row, col); if (!legalTargets.length) toast('这枚棋子暂时没有合法走法'); }
    suggestion = null;
  } else if (selected) toast('此处不能落子，请选择有标记的位置');
  else if (piece) toast(`现在轮到${colorName(state.turn)}行棋`);
  renderBoard(); renderStatus();
}

function undo() {
  if (!state.history.length) return;
  cancelAnalysis();
  let count = 1;
  if (state.mode === 'ai') {
    const last = state.history.at(-1);
    if (last.turn !== state.humanColor && state.history.length >= 2) count = 2;
    if (state.history.length === 1 && last.turn !== state.humanColor) { renderStatus(); toast('电脑开局的第一步无法悔棋，你可以重新开局'); maybeComputerMove(); return; }
  }
  const previous = state.history[state.history.length - count];
  state.board = previous.board; state.turn = previous.turn;
  state.history.splice(-count); state.result = null; state.endedAt = null;
  selected = null; legalTargets = []; suggestion = null;
  save(); render(); toast(state.mode === 'ai' && count === 2 ? '已退回到你上一次落子前' : '已悔棋'); maybeComputerMove();
}

function modal(title, content, actions = [{ text: '知道了', primary: true }]) {
  $('#modal-title').textContent = title;
  $('#modal-content').innerHTML = content;
  $('#modal-actions').replaceChildren();
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = action.text;
    if (action.primary) button.className = 'primary-button';
    button.addEventListener('click', () => { $('#modal').close(); action.onClick?.(); });
    $('#modal-actions').append(button);
  }
  if (!$('#modal').open) $('#modal').showModal();
}

function newGame(config = {}) {
  const start = () => {
    cancelAnalysis();
    const nextConfig = { mode: state.mode, difficulty: state.difficulty, humanColor: state.humanColor, flipped: state.flipped, sound: state.sound, ...config };
    if (config.humanColor) nextConfig.flipped = config.humanColor === 'black';
    state = freshGame(nextConfig);
    selected = null; legalTargets = []; suggestion = null;
    save(); render(); maybeComputerMove();
  };
  if (state.history.length && !status().over) modal('开始新的对局？', '<p>当前棋局将被替换。你可以先下载本局棋谱，再开启新的一盘。</p>', [{ text: '继续当前棋局' }, { text: '开始新对局', primary: true, onClick: start }]);
  else start();
}

function exportGame() {
  const result = status();
  const lines = ['弈间 · 中国象棋棋谱', `模式：${state.mode === 'ai' ? `人机对弈 · ${difficulties[state.difficulty]}` : '双人同屏'}`, `开局：${new Date(state.startedAt).toLocaleString('zh-CN')}`, `结果：${result.over ? `${colorName(result.winner)}获胜` : '进行中'}`, ''];
  for (let i = 0; i < state.history.length; i += 2) lines.push(`${i / 2 + 1}. ${state.history[i].notation}    ${state.history[i + 1]?.notation || ''}`);
  if (!state.history.length) { toast('落下第一步后，就可以下载棋谱'); return; }
  const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `弈间棋谱-${new Date(state.startedAt).toISOString().slice(0, 10)}.txt`; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const actions = {
  new: () => newGame(),
  flip: () => { state.flipped = !state.flipped; save(); renderBoard(); renderPlayers(); },
  undo,
  hint: () => { if (humanTurn() && !status().over && !thinking && !hintBusy) beginAnalysis('hint'); },
  sound: () => { state.sound = !state.sound; save(); renderStatus(); sound(); },
  resign: () => {
    if (status().over || thinking) return;
    const resigning = state.mode === 'ai' ? state.humanColor : state.turn;
    modal('确定认输？', `<p>本局将以${colorName(opposite(resigning))}获胜结束。下一盘，继续过招。</p>`, [{ text: '继续对弈' }, { text: '确认认输', primary: true, onClick: () => { cancelAnalysis(); state.result = { over: true, winner: opposite(resigning), reason: 'resign', check: false }; state.endedAt = Date.now(); selected = null; legalTargets = []; suggestion = null; save(); render(); $('#board-announcement').textContent = `${colorName(resigning)}认输，${colorName(opposite(resigning))}获胜`; } }]);
  },
  retry: () => maybeComputerMove(),
  export: exportGame,
  rules: () => modal('行棋有道', '<p>红方先行，双方轮流走一步。点击己方棋子，绿色标记会显示合法落点。</p><ul><li><strong>车</strong>走直线，不可越子；<strong>炮</strong>平走同车，吃子时须隔一个炮架。</li><li><strong>马</strong>走日，不能蹩马腿；<strong>相／象</strong>走田，不能塞象眼，也不能过河。</li><li><strong>仕／士</strong>在九宫斜行一步；<strong>帅／将</strong>在九宫直行一步，双方将帅不能照面。</li><li><strong>兵／卒</strong>每次向前一步，过河后可横走，不能后退。</li><li>被将军必须应将。将死或无合法走法（困毙），均判负。</li></ul><p class="rules-note">本作适合休闲对弈，暂不裁定正式比赛中的长将、长捉及自然限着。</p>'),
  about: () => modal('关于弈间', '<p>一张棋盘，三十二枚棋子。弈间是一个简单、安静的中国象棋小游戏。</p><p>支持三档电脑对手与双人同屏对弈，也可以悔棋、获取走棋提示、翻转棋盘和下载棋谱。</p><p>棋局保存在当前浏览器，刷新页面后可以继续。电脑在你的设备上思考，无需注册。</p><p class="rules-note">双人模式为同一设备轮流操作。清理浏览器数据后，本地存档会一并删除。</p>'),
};

document.addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target || target.disabled) return;
  if (target.matches('.board-cell')) selectCell(Number(target.dataset.row), Number(target.dataset.col));
  else if (target.dataset.action) actions[target.dataset.action]?.();
  else if (target.dataset.mode && target.dataset.mode !== state.mode) newGame({ mode: target.dataset.mode });
  else if (target.dataset.difficulty && target.dataset.difficulty !== state.difficulty) {
    state.difficulty = target.dataset.difficulty; save(); renderSettings(); renderPlayers();
    if (thinking) maybeComputerMove();
    toast(`电脑难度已切换为${difficulties[state.difficulty]}`);
  } else if (target.dataset.color && target.dataset.color !== state.humanColor) newGame({ humanColor: target.dataset.color });
});

$('#board').addEventListener('keydown', (event) => {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  const cell = event.target.closest('.board-cell');
  if (!cell) return;
  event.preventDefault();
  const sign = state.flipped ? -1 : 1;
  const row = Math.max(0, Math.min(9, Number(cell.dataset.row) + ({ ArrowDown: sign, ArrowUp: -sign }[event.key] || 0)));
  const col = Math.max(0, Math.min(8, Number(cell.dataset.col) + ({ ArrowRight: sign, ArrowLeft: -sign }[event.key] || 0)));
  $(`.board-cell[data-row="${row}"][data-col="${col}"]`)?.focus();
});
document.addEventListener('keydown', (event) => {
  if ($('#modal').open || event.ctrlKey || event.metaKey || event.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
  const action = { u: 'undo', f: 'flip', h: 'hint' }[event.key.toLowerCase()];
  if (action) { event.preventDefault(); actions[action](); }
  if (event.key === 'Escape') { if (hintBusy) cancelAnalysis(); selected = null; legalTargets = []; suggestion = null; renderBoard(); renderStatus(); }
});
$('#modal-close').addEventListener('click', () => $('#modal').close());
$('#modal').addEventListener('click', (event) => { if (event.target === $('#modal')) { const rect = $('#modal').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('#modal').close(); } });

restore(); render(); maybeComputerMove();
setInterval(renderClock, 1000);
