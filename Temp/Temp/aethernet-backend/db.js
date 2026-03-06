'use strict';
/**
 * db.js — Pure-JS JSON file store with better-sqlite3-compatible API.
 * No native compilation required. Uses Node's built-in `fs` module only.
 *
 * Supported API:
 *   db.pragma()          → no-op
 *   db.exec(sql)         → initialises tables from CREATE TABLE statements
 *   db.prepare(sql).run(...args)  → INSERT / UPDATE / DELETE
 *   db.prepare(sql).get(...args)  → SELECT (first row or undefined)
 *   db.prepare(sql).all(...args)  → SELECT (all rows as array)
 */

const fs = require('fs');
const path = require('path');

// ── Storage ───────────────────────────────────────────────────────────────────
const DB_FILE = path.resolve(
  (process.env.DB_PATH || './aethernet.db').replace(/\.db$/, '-store.json')
);

let store = {};   // { tableName: [ ...rows ] }

(function load() {
  try { if (fs.existsSync(DB_FILE)) store = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { store = {}; }
})();

function save() {
  fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function nowStr() {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

/** Split CSV string respecting parentheses depth */
function smartSplit(str) {
  const parts = []; let depth = 0, cur = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** Resolve a SQL token to a JS value */
function resolveToken(t) {
  t = (t || '').trim();
  if (/datetime\('now'\)/i.test(t)) return nowStr();
  if (/^null$/i.test(t)) return null;
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  if (t !== '' && !isNaN(t)) return Number(t);
  return t;
}

/**
 * Bind positional `?` params into a WHERE/SET string so it becomes
 * a pure-literal string that evalWhere can compare without index tracking.
 */
function bindStr(sql, params, startIdx = 0) {
  let i = startIdx;
  return sql.replace(/\?/g, () => {
    const v = params[i++];
    if (v == null) return 'NULL';
    if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
    return String(v);
  });
}

/** Count `?` placeholders in a string */
function countQ(s) { return (s.match(/\?/g) || []).length; }

// ── WHERE evaluation (operates on already-bound literal strings) ───────────────
function evalWhere(clause, row) {
  const orParts = clause.split(/\s+OR\s+/i);
  if (orParts.length > 1) return orParts.some(p => evalAnd(p, row));
  return evalAnd(clause, row);
}

function evalAnd(clause, row) {
  return clause.split(/\s+AND\s+/i).every(cond => evalCond(cond.trim(), row));
}

function evalCond(cond, row) {
  const m = cond.match(/^(\w+)\s*=\s*(.+)$/i);
  if (!m) return true;
  const rowVal = row[m[1]] == null ? 'NULL' : String(row[m[1]]);
  const expRaw = m[2].trim();
  const expVal = expRaw.startsWith("'") && expRaw.endsWith("'")
    ? expRaw.slice(1, -1).replace(/''/g, "'")
    : expRaw;
  return rowVal === expVal;
}

// ── SQL handlers ──────────────────────────────────────────────────────────────
function handleCreate(s) {
  const m = s.match(/CREATE TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(\w+)/i);
  if (m && !store[m[1]]) { store[m[1]] = []; save(); }
  return { changes: 0 };
}

function handleInsert(s, params) {
  const m = s.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
  if (!m) throw new Error('Unsupported INSERT: ' + s);
  const table = m[1];
  const cols = m[2].split(',').map(c => c.trim());
  const tokens = smartSplit(m[3]);
  let pi = 0;
  const row = {};
  cols.forEach((col, i) => {
    const t = (tokens[i] || '?').trim();
    row[col] = (t === '?') ? params[pi++] : resolveToken(t);
  });
  if (!row.created_at) row.created_at = nowStr();
  if (!store[table]) store[table] = [];
  store[table].push(row);
  save();
  return { changes: 1, lastInsertRowid: store[table].length };
}

function handleSelect(s, params) {
  const tableM = s.match(/FROM\s+(\w+)/i);
  if (!tableM) return [];
  const table = tableM[1];
  let rows = [...(store[table] || [])];
  let pi = 0;

  // WHERE — bind params for this clause, then filter
  const whereM = s.match(/WHERE\s+(.+?)(?=\s+ORDER\s+BY|\s+LIMIT|$)/i);
  if (whereM) {
    const qc = countQ(whereM[1]);
    const bound = bindStr(whereM[1], params, pi);
    pi += qc;
    rows = rows.filter(row => evalWhere(bound, row));
  }

  // ORDER BY
  const orderM = s.match(/ORDER\s+BY\s+(\w+)(?:\s+(ASC|DESC))?/i);
  if (orderM) {
    const col = orderM[1], desc = (orderM[2] || '').toUpperCase() === 'DESC';
    rows.sort((a, b) => {
      if (a[col] < b[col]) return desc ? 1 : -1;
      if (a[col] > b[col]) return desc ? -1 : 1;
      return 0;
    });
  }

  // LIMIT
  const limitM = s.match(/LIMIT\s+(\?|\d+)/i);
  if (limitM) {
    const lim = limitM[1] === '?' ? params[pi++] : parseInt(limitM[1]);
    rows = rows.slice(0, lim);
  }

  // SELECT columns (projection)
  const colsPart = s.match(/^SELECT\s+(.+?)\s+FROM/i)?.[1]?.trim() || '*';
  if (colsPart !== '*') {
    const selectCols = colsPart.split(',').map(c => c.trim().split(/\s+/).pop());
    rows = rows.map(row => {
      const out = {};
      selectCols.forEach(c => { if (c in row) out[c] = row[c]; });
      return out;
    });
  }

  return rows;
}

function handleUpdate(s, params) {
  const tableM = s.match(/^UPDATE\s+(\w+)/i);
  const setM = s.match(/SET\s+(.+?)\s+WHERE/i);
  const whereM = s.match(/WHERE\s+(.+?)$/i);
  if (!tableM || !setM) throw new Error('Unsupported UPDATE: ' + s);

  let pi = 0;

  // Parse SET clause — consume params in order
  const sets = {};
  for (const part of smartSplit(setM[1])) {
    const eq = part.indexOf('=');
    const col = part.slice(0, eq).trim();
    const tok = part.slice(eq + 1).trim();
    sets[col] = (tok === '?') ? params[pi++] : resolveToken(tok);
  }

  // WHERE — bind remaining params
  let changes = 0;
  if (whereM) {
    const qc = countQ(whereM[1]);
    const bound = bindStr(whereM[1], params, pi);
    pi += qc;
    (store[tableM[1]] || []).forEach((row, idx) => {
      if (evalWhere(bound, row)) {
        Object.assign(store[tableM[1]][idx], sets);
        changes++;
      }
    });
  } else {
    (store[tableM[1]] || []).forEach((_, idx) => {
      Object.assign(store[tableM[1]][idx], sets);
      changes++;
    });
  }
  save();
  return { changes };
}

function handleDelete(s, params) {
  const tableM = s.match(/^DELETE\s+FROM\s+(\w+)/i);
  const whereM = s.match(/WHERE\s+(.+?)$/i);
  if (!tableM) throw new Error('Unsupported DELETE: ' + s);
  const table = tableM[1];
  const before = (store[table] || []).length;
  if (whereM) {
    const bound = bindStr(whereM[1], params);
    store[table] = (store[table] || []).filter(row => !evalWhere(bound, row));
  } else {
    store[table] = [];
  }
  save();
  return { changes: before - (store[table] || []).length };
}

function execute(sql, params) {
  const s = sql.trim().replace(/\s+/g, ' ');
  const type = s.split(' ')[0].toUpperCase();
  if (type === 'CREATE') return handleCreate(s);
  if (type === 'INSERT') return handleInsert(s, params);
  if (type === 'SELECT') return handleSelect(s, params);
  if (type === 'UPDATE') return handleUpdate(s, params);
  if (type === 'DELETE') return handleDelete(s, params);
  return { changes: 0 };
}

// ── Public API — mirrors better-sqlite3 ───────────────────────────────────────
function flatten(args) {
  return args.length === 1 && Array.isArray(args[0]) ? args[0] : Array.from(args);
}

const db = {
  pragma: () => { },  // no-op
  exec(sql) {
    sql.split(';').map(s => s.trim()).filter(Boolean).forEach(s => execute(s, []));
  },
  prepare(sql) {
    const s = sql.trim().replace(/\s+/g, ' ');
    return {
      run: (...args) => execute(s, flatten(args)),
      get: (...args) => { const r = execute(s, flatten(args)); return Array.isArray(r) ? (r[0] ?? undefined) : undefined; },
      all: (...args) => { const r = execute(s, flatten(args)); return Array.isArray(r) ? r : []; },
    };
  },
};

console.log('[DB] JSON store initialised →', DB_FILE);
module.exports = db;
