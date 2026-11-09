const fs = require('fs'), vm = require('vm'), crypto = require('crypto');
const V = require('path').join(__dirname, '..', 'src') + '/';
function makeEnv(opts) {
  opts = opts || {};
  const sheets = {};
  class Range {
    constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr: nr || 1, nc: nc || 1 }); }
    getValues() { const o = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) { const v = (this.sh.data[this.r - 1 + i] || [])[this.c - 1 + j]; row.push(v === undefined ? '' : v); } o.push(row); } return o; }
    getValue() { return this.getValues()[0][0]; }
    setValues(v) { v.forEach((row, i) => row.forEach((x, j) => this.sh.set(this.r + i, this.c + j, x))); return this; }
    setValue(x) { this.sh.set(this.r, this.c, x); return this; }
    setFontWeight() { return this; } setBackground() { return this; } setNumberFormat() { return this; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.data = []; }
    getName() { return this.name; }
    set(r, c, x) { while (this.data.length < r) this.data.push([]); const row = this.data[r - 1]; while (row.length < c) row.push(''); row[c - 1] = x; }
    getLastRow() { let n = this.data.length; while (n && this.data[n - 1].every(v => v === '' || v == null)) n--; return n; }
    getLastColumn() { return Math.max(0, ...this.data.map(r => { let n = r.length; while (n && (r[n - 1] === '' || r[n - 1] == null)) n--; return n; })); }
    getMaxColumns() { return Math.max(26, this.getLastColumn()); }
    getRange(r, c, nr, nc) { if (typeof r === 'string') throw new Error('A1 not mocked'); return new Range(this, r, c, nr, nc); }
    getDataRange() { return new Range(this, 1, 1, this.getLastRow() || 1, this.getLastColumn() || 1); }
    appendRow(a) { this.data.splice(this.getLastRow(), 0, a.slice()); return this; }
    deleteRow(r) { this.data.splice(r - 1, 1); }
    insertColumnsAfter() {} setFrozenRows() {} autoResizeColumns() {} hideColumns() {} insertColumnAfter() {}
  }
  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = new Sheet(n)),
    getSheets: () => Object.values(sheets), getId: () => 'SSID',
  };
  const store = {};
  const cache = { get: k => (k in store ? store[k] : null), put: (k, v) => { store[k] = String(v); }, remove: k => { delete store[k]; },
    getAll: ks => { const o = {}; ks.forEach(k => { if (k in store) o[k] = store[k]; }); return o; }, putAll: o => Object.assign(store, o), removeAll: ks => ks.forEach(k => delete store[k]) };
  const mails = [];
  const pad = n => String(n).padStart(2, '0');
  const ctx = {
    console: { log: () => {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, flush: () => {} },
    CacheService: { getScriptCache: () => cache, getUserCache: () => cache },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
    Session: { getActiveUser: () => ({ getEmail: () => opts.activeUser || '' }), getEffectiveUser: () => ({ getEmail: () => 'owner@x.com' }), getScriptTimeZone: () => 'Asia/Kuala_Lumpur' },
    ScriptApp: { getProjectTriggers: () => [{ getUniqueId: () => 'REALUID', getHandlerFunction: () => 'sendMeetingDeadlineReminders' }], getService: () => ({ getUrl: () => 'https://x/exec' }), deleteTrigger() {}, newTrigger() { throw new Error('newTrigger'); } },
    MailApp: { sendEmail: o => mails.push(o), getRemainingDailyQuota: () => 100 },
    DriveApp: {}, HtmlService: {},
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, f) => { d = new Date(d); return f.replace('yyyy', d.getFullYear()).replace('MM', pad(d.getMonth() + 1)).replace('dd', pad(d.getDate())).replace('HH', pad(d.getHours())).replace('mm', pad(d.getMinutes())).replace('ss', pad(d.getSeconds())).replace(/'/g, ''); },
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (a, v) => Array.from(crypto.createHash('sha256').update(String(v), 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
      base64Encode: b => Buffer.from(typeof b === 'string' ? b : b.map(x => x & 255)).toString('base64'),
      base64EncodeWebSafe: b => Buffer.from(typeof b === 'string' ? b : b.map(x => x & 255)).toString('base64url'),
      newBlob: s => ({ getBytes: () => Array.from(Buffer.from(String(s))) }),
      sleep() {},
    },
  };
  ctx.Utilities.formatDate.bind = undefined;
  vm.createContext(ctx);
  const code = ['Code.gs', 'AdminBackend.gs', 'MinistryBackend.gs'].map(f => fs.readFileSync(V + f, 'utf8')).join('\n;\n');
  // const at top-level -> var so they land on context
  vm.runInContext(code.replace(/^const /gm, 'var '), ctx, { filename: 'gas.js' });
  ctx.__sheets = sheets; ctx.__store = store; ctx.__mails = mails; ctx.__ss = ss;
  ctx.__mk = (name, headers, rows) => { const s = ss.insertSheet(name); s.appendRow(headers); (rows || []).forEach(r => s.appendRow(headers.map(h => r[h] === undefined ? '' : r[h]))); return s; };
  ctx.__rows = name => { const s = sheets[name]; const h = s.data[0]; return s.data.slice(1, s.getLastRow()).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); };
  return ctx;
}
module.exports = { makeEnv };
