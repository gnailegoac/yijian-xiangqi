// Record (SPEC 4.21): 棋谱 text export, backup export file, notation rows. Owner: G3.
// Pure except download(), which needs a browser. Every date in a file name or in the text is the LOCAL date.

/** @import { SessionState, Ply, Backup } from './types.js' */

const BOM = '\uFEFF';
// A Blob URL must outlive the save prompt of mobile Safari; it is released after this delay.
const REVOKE_AFTER_MS = 40000;

/** @param {number} n @returns {string} */
function two(n) {
  return String(n).padStart(2, '0');
}

/** YYYY-MM-DD in local time. @param {number} ms epoch ms @returns {string} */
function localDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** YYYY-MM-DD HH:mm in local time. @param {number} ms epoch ms @returns {string} */
function localDateTime(ms) {
  const d = new Date(ms);
  return `${localDate(ms)} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** mm:ss; minutes keep counting past 59. @param {number} ms @returns {string} */
function clock(ms) {
  const seconds = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  return `${two(Math.floor(seconds / 60))}:${two(seconds % 60)}`;
}

/** @param {SessionState} state @returns {string} */
function resultWord(state) {
  if (state.result === null) return '进行中';
  if (state.result.winner === null) return '和棋';
  return state.result.winner === state.humanColor ? '小主公胜' : '司马懿胜';
}

/**
 * Rows for the notation sheet.
 * @param {Ply[]} history
 * @returns {{n:number, red:string, black?:string}[]}
 */
export function notationRows(history) {
  /** @type {{n:number, red:string, black?:string}[]} */
  const rows = [];
  for (let i = 0; i < history.length; i += 2) {
    /** @type {{n:number, red:string, black?:string}} */
    const row = { n: i / 2 + 1, red: history[i].notation };      // red always moves first
    if (i + 1 < history.length) row.black = history[i + 1].notation;
    rows.push(row);
  }
  return rows;
}

/**
 * 棋谱 as text. filename uses the LOCAL date: 弈间棋谱-YYYY-MM-DD.txt
 * @param {SessionState} state
 * @param {number} activeMs
 * @returns {{filename:string, text:string}}
 */
export function buildRecord(state, activeMs) {
  const lines = [
    '弈间 · 中国象棋棋谱',
    '对手：司马懿（指导棋）',
    `开局：${localDateTime(state.startedAt)}`,
    `用时：${clock(activeMs)}`,
    `结果：${resultWord(state)}`,
    '',
  ];
  for (const row of notationRows(state.history)) {
    lines.push(row.black === undefined ? `${row.n}. ${row.red}` : `${row.n}. ${row.red}    ${row.black}`);
  }
  // UTF-8 with BOM, so that plain text editors on Windows read the Chinese text correctly
  return { filename: `弈间棋谱-${localDate(state.startedAt)}.txt`, text: BOM + lines.join('\n') };
}

/**
 * 弈间存档-YYYY-MM-DD.json (JSON of Backup)
 * @param {Backup} backup
 * @returns {{filename:string, text:string}}
 */
export function buildBackupFile(backup) {
  return { filename: `弈间存档-${localDate(backup.at)}.json`, text: JSON.stringify(backup) };
}

/**
 * Triggers a download with a Blob URL (no clipboard API). Browser only.
 * @param {{filename:string, text:string}} file
 * @returns {void}
 */
export function download(file) {
  const type = file.filename.endsWith('.json') ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8';
  const url = URL.createObjectURL(new Blob([file.text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
