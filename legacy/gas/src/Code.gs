/**
 * ============================================================
 * 播青｜Code.gs
 * ============================================================
 * 主程式：
 * 1. Web App 路由：Index.html / Admin.html
 * 2. 公开网站资料
 * 3. 后台登录基础资料
 * 4. 节目管理基础功能
 * 5. 事奉人员资料
 * 6. 活动报告资料
 * 7. 操作记录
 * 8. 2026 节目导入
 *
 * 配合：Admin.html + AdminBackend.gs
 * ============================================================
 */

const SHEET_SETTINGS = '系统设置';
const SHEET_USERS = '用户';
const SHEET_MEMBERS = '契友';
const SHEET_EVENTS = '节目';
const SHEET_ROSTER = '事奉人员';
const SHEET_REPORTS = '活动报告';
const SHEET_CLAIMS = '职员报销';
const SHEET_FINANCE = '财政';
const SHEET_OFFERING = '奉献记录';
const SHEET_LOGS = '操作记录';
const SHEET_BUDGET = '预算';

const PORTAL_TIMEZONE = 'Asia/Kuala_Lumpur';


/* ============================================================
   一、Web App 路由 (加入手机版适配标签)
   ============================================================ */

function doGet(e) {
  var page = e && e.parameter && e.parameter.page
    ? String(e.parameter.page).toLowerCase().trim()
    : '';

  if (page === 'admin') {
    return HtmlService.createHtmlOutputFromFile('Admin')
      .setTitle('播青｜同工后台')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('播青｜播恩堂青年团契')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


/**
 * 返回当前 Web App 的后台网址。
 */
function getAdminUrl() {
  var url = ScriptApp.getService().getUrl();
  if (!url) {
    throw new Error('目前无法取得 Web App 网址，请先部署为 Web App。');
  }
  return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'page=admin';
}


/* ============================================================
   二、公开网站资料
   ============================================================ */

function getPublicPortalData() {
  // 公开资料经由工作表快取读取（资料有改动时会自动更新）。

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var today = new Date();
    var startOfWeek = new Date(today);
    startOfWeek.setHours(0, 0, 0, 0);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

    var endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    var startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    var endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);

    var events = getSheetObjects_(ss.getSheetByName(SHEET_EVENTS));
    var reports = getSheetObjects_(ss.getSheetByName(SHEET_REPORTS));
    var settingsSheet = ss.getSheetByName(SHEET_SETTINGS);
    var settingsData = settingsSheet ? getSheetObjects_(settingsSheet) : [];
    
    var logoUrl = '';
    var bannerUrl = '';
    var heroTitle = '', heroSubtitle = '';
    settingsData.forEach(function(item) {
      var keyName = String(item['设置项目'] || '').trim().toLowerCase();
      if (keyName === 'logo') logoUrl = String(item['设置内容'] || '').trim();
      if (keyName === '大合照' || keyName === 'banner') bannerUrl = String(item['设置内容'] || '').trim();
      if (keyName === '首页标题') heroTitle = String(item['设置内容'] || '').trim();
      if (keyName === '首页副标题') heroSubtitle = String(item['设置内容'] || '').trim();
    });

    var weekEvents = events.filter(function(event) {
      var d = normalizeDate_(event['日期']);
      return d && d >= startOfWeek && d < endOfWeek && isActive_(event['状态']) && isPublic_(event['公开显示']);
    }).sort(sortByDateAsc_);

    var monthEvents = events.filter(function(event) {
      var d = normalizeDate_(event['日期']);
      return d && d >= startOfMonth && d < endOfMonth && isActive_(event['状态']) && isPublic_(event['公开显示']);
    }).sort(sortByDateAsc_);


    // 六个星期：上周、本周、下周，以及之后三周（星期一到星期日为一周）
    var thisMonday = new Date(today);
    thisMonday.setHours(0, 0, 0, 0);
    thisMonday.setDate(thisMonday.getDate() - ((thisMonday.getDay() + 6) % 7));
    var extraRoster = getSheetObjects_(ss.getSheetByName(SHEET_ROSTER)).filter(function(r) { return isActive_(r['状态']); });
    var weekLabels = ['上周', '本周', '下周', '下下周', '三周后', '四周后'];
    var fmtDay = function(d) { return Utilities.formatDate(d, PORTAL_TIMEZONE, 'yyyy-MM-dd'); };
    var weeks = [];
    for (var wi = -1; wi <= 4; wi++) {
      var ws = new Date(thisMonday); ws.setDate(ws.getDate() + 7 * wi);
      var we = new Date(ws); we.setDate(we.getDate() + 7);
      var wEnd = new Date(we); wEnd.setDate(wEnd.getDate() - 1);
      var wEvents = events.filter(function(event) {
        var d = normalizeDate_(event['日期']);
        var st = String(event['状态'] || '').trim();
        return d && d >= ws && d < we && (isActive_(st) || st === '暂停') && isPublic_(event['公开显示']);
      }).sort(sortByDateAsc_);
      var cleaned = cleanObjectsForClient_(wEvents);
      cleaned.forEach(function(ev) {
        ev.extraRoster = extraRoster.filter(function(r) { return String(r['节目编号']) === String(ev['节目编号']); })
          .map(function(r) { return { role: String(r['事奉岗位'] || ''), name: String(r['契友姓名'] || '') }; });
      });
      weeks.push({ label: weekLabels[wi + 1], offset: wi, start: fmtDay(ws), end: fmtDay(wEnd), events: cleaned });
    }

    reports = reports.filter(function(report) {
      return isActive_(report['公开显示']) || isPublic_(report['公开显示']);
    }).sort(function(a, b) {
      var da = normalizeDate_(a['日期']);
      var db = normalizeDate_(b['日期']);
      return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
    }).slice(0, 12);

    var finalResult = {
      success: true,
      weekEvents: cleanObjectsForClient_(weekEvents),
      monthEvents: cleanObjectsForClient_(monthEvents),
      weeks: weeks,
      reports: cleanObjectsForClient_(reports),
      logoUrl: logoUrl,
      bannerUrl: bannerUrl,
      heroTitle: heroTitle,
      heroSubtitle: heroSubtitle
    };

    return finalResult;
  } catch (err) {
    return { success: false, message: err.message || '公开资料读取失败。' };
  }
}


/* ============================================================
   七、系统初始化（只能在编辑器运行）
   ============================================================ */


function initializePortalSheets() {
  editorOnly_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  ensureSheetHeaders_(ss, SHEET_SETTINGS, ['设置项目', '设置内容', '说明']);
  auth_sheet_(); // 用户表结构由 AdminBackend.gs 的账号系统管理（不再使用 PIN 密码）
  term_sheet_();
  ensureSheetHeaders_(ss, SHEET_MEMBERS, ['契友编号', '姓名', '称呼', '电话号码', '电邮', '生日', '性别', '小组', '职位', '加入日期', '状态', '照片链接', '备注', '建立时间', '更新日期']);
  ensureSheetHeaders_(ss, SHEET_EVENTS, ['节目编号', '日期', '开始时间', '结束时间', '节目名称', '主题', '内容', '地点', '讲员', '状态', '公开显示', '封面照片链接', '建立时间', '更新日期']);
  ensureSheetHeaders_(ss, SHEET_ROSTER, ['排表编号', '节目编号', '日期', '事奉岗位', '契友编号', '契友姓名', '备注', '状态', '建立时间', '更新日期']);
  ensureSheetHeaders_(ss, SHEET_REPORTS, ['报告编号', '节目编号', '日期', '标题', '内容', '封面照片链接', '照片资料夹链接', '公开显示', '建立者', '建立时间', '更新日期']);
  ensureSheetHeaders_(ss, SHEET_OFFERING, ['奉献编号', '奉献日期', '聚会 / 节目', '奉献类型', '金额', '付款方式', '参考编号', '记录人', '建立时间', '备注']);
  ensureSheetHeaders_(ss, SHEET_LOGS, ['操作编号', '操作时间', '用户编号', '姓名', '权限', '操作', '模块', '资料编号', '说明']);

  // 事工系统：年度计划、四次会议更新、统计、组别提交。
  initializeMinistrySystem();

  return { success: true, message: '基本工作表检查完成。' };
}


/* ============================================================
   八、2026 节目导入
   ============================================================ */

function importSchedule2026() {
  editorOnly_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var eventSheet = ss.getSheetByName(SHEET_EVENTS);
  var rosterSheet = ss.getSheetByName(SHEET_ROSTER);

  if (!eventSheet) throw new Error('找不到「节目」工作表。');
  if (!rosterSheet) throw new Error('找不到「事奉人员」工作表。');

  // 契友姓名不放进代码（repo 不可含契友个资）。要导入时，在编辑器里临时贴上资料再运行，运行后不要存档。
  // 格式：['YYYY-MM-DD', '节目名称', '负责组', '领会张三', '经节手册…', '领唱/助唱…', '司琴/吉他手…', '电脑控制员…', '招待员…', '地点(选填)']
  var schedules = [];
  if (!schedules.length) throw new Error('importSchedule2026：schedules 是空的，请先在编辑器贴上资料。');

  var existingEvents = getSheetObjects_(eventSheet);
  var existingByDateName = {};
  existingEvents.forEach(function(e) {
    var key = formatDateKey_(e['日期']) + '|' + String(e['节目名称'] || '');
    existingByDateName[key] = e['节目编号'];
  });

  var eventHeaders = getHeaders_(eventSheet);
  var rosterHeaders = getHeaders_(rosterSheet);
  var imported = 0;

  schedules.forEach(function(item) {
    var date = parseDateInput_(item[0]);
    var name = item[1];
    var key = formatDateKey_(date) + '|' + name;
    var eventId = existingByDateName[key];

    if (!eventId) {
      eventId = createId_(eventSheet, '节目编号', 'EVT');
      appendObject_(eventSheet, {
        '节目编号': eventId,
        '日期': date,
        '开始时间': '',
        '结束时间': '',
        '节目名称': name,
        '主题': '',
        '内容': item[2] || '',
        '地点': item[9] || '',
        '讲员': '',
        '状态': 'ACTIVE',
        '公开显示': '是',
        '封面照片链接': '',
        '建立时间': new Date(),
        '更新日期': new Date()
      });
      imported++;
    }

    var rosterItems = [
      ['领会', item[3]],
      ['经节手册', item[4]],
      ['领唱/助唱', item[5]],
      ['司琴/吉他手', item[6]],
      ['电脑控制员', item[7]],
      ['招待员', item[8]]
    ];

    rosterItems.forEach(function(pair) {
      var text = String(pair[1] || '').trim();
      if (!text || text === '-') return;

      var person = text.replace(/^领会/, '').replace(/^经节手册/, '').replace(/^领唱\/助唱/, '').replace(/^司琴/, '').replace(/^电脑控制员/, '').replace(/^电脑/, '').replace(/^招待员/, '').replace(/^招待/, '');
      if (!person) return;

      var existingRoster = getSheetObjects_(rosterSheet).some(function(r) {
        return String(r['节目编号'] || '') === String(eventId) &&
          String(r['事奉岗位'] || '') === String(pair[0]) &&
          String(r['契友姓名'] || '') === person;
      });

      if (!existingRoster) {
        appendObject_(rosterSheet, {
          '排表编号': createId_(rosterSheet, '排表编号', 'ROS'),
          '节目编号': eventId,
          '日期': date,
          '事奉岗位': pair[0],
          '契友编号': '',
          '契友姓名': person,
          '备注': '',
          '状态': 'ACTIVE',
          '建立时间': new Date(),
          '更新日期': new Date()
        });
      }
    });
  });

  return {
    success: true,
    importedEvents: imported,
    message: '2026 节目资料导入完成。'
  };
}


/* ============================================================
   九、工具函数
   ============================================================ */

function getHeaders_(sheet) {
  if (!sheet || sheet.getLastColumn() < 1) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(v) {
    return String(v == null ? '' : v).trim();
  });
}

function getSheetObjects_(sheet) {
  // 经由快取读取（见「十、读取快取层」），输出格式与原本完全相同。
  var grid = getSheetGrid_(sheet);
  return grid.rows.map(function(row) {
    var obj = {};
    grid.headers.forEach(function(header, index) {
      if (!header) return;
      var d = gridDate_(row[index]);
      obj[header] = d ? Utilities.formatDate(d, PORTAL_TIMEZONE, 'yyyy-MM-dd HH:mm:ss') : row[index];
    });
    return obj;
  });
}

function cleanValue_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, PORTAL_TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  }
  return value;
}

function cleanObjectsForClient_(objects) {
  return (objects || []).map(function(obj) {
    var out = {};
    Object.keys(obj).forEach(function(key) {
      out[key] = obj[key];
    });
    return out;
  });
}

function appendObject_(sheet, object) {
  var headers = getHeaders_(sheet);
  var row = headers.map(function(header) {
    return object.hasOwnProperty(header) ? object[header] : '';
  });
  sheet.appendRow(row);
  invalidateSheetCache_(sheet);
}

function setObjectRow_(sheet, rowNumber, object) {
  var headers = getHeaders_(sheet);
  var values = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  headers.forEach(function(header, index) {
    if (object.hasOwnProperty(header)) values[index] = object[header];
  });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
  invalidateSheetCache_(sheet);
}

function findRowByValue_(sheet, headerName, value) {
  var headers = getHeaders_(sheet);
  var col = headers.indexOf(headerName) + 1;
  if (col <= 0 || sheet.getLastRow() < 2) return -1;
  var values = sheet.getRange(2, col, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] == null ? '' : values[i][0]).trim() === String(value == null ? '' : value).trim()) {
      return i + 2;
    }
  }
  return -1;
}

function createId_(sheet, headerName, prefix) {
  var maxNumber = 0;
  var col = getHeaders_(sheet).indexOf(headerName) + 1;
  if (col > 0 && sheet.getLastRow() >= 2) {
    var values = sheet.getRange(2, col, sheet.getLastRow() - 1, 1).getValues();
    values.forEach(function(row) {
      var match = String(row[0] || '').match(/(\d+)$/);
      if (match) maxNumber = Math.max(maxNumber, Number(match[1]));
    });
  }
  return prefix + '-' + String(maxNumber + 1).padStart(4, '0');
}

function ensureSheetHeaders_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  var existing = getHeaders_(sheet);
  if (!existing.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sheet;
  }
  headers.forEach(function(header) {
    if (existing.indexOf(header) === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      existing.push(header);
    }
  });
  invalidateSheetCache_(sheet);
  return sheet;
}

function getCellByHeader_(sheet, row, header) {
  var col = getHeaders_(sheet).indexOf(header) + 1;
  return col > 0 ? sheet.getRange(row, col).getValue() : '';
}

function parseDateInput_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') return value;
  var s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    var p = s.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  var d = new Date(s);
  return isNaN(d.getTime()) ? '' : d;
}

function normalizeDate_(value) {
  var d = parseDateInput_(value);
  if (!d || isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateKey_(value) {
  var d = normalizeDate_(value);
  return d ? Utilities.formatDate(d, PORTAL_TIMEZONE, 'yyyy-MM-dd') : '';
}

function sortByDateAsc_(a, b) {
  var da = normalizeDate_(a['日期']);
  var db = normalizeDate_(b['日期']);
  return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
}

function isActive_(value) {
  var s = String(value == null ? '' : value).trim().toUpperCase();
  return s === '' || s === 'ACTIVE' || s === '启用' || s === '是' || s === 'YES';
}

function isPublic_(value) {
  var s = String(value == null ? '' : value).trim().toUpperCase();
  return s === '是' || s === 'YES' || s === 'TRUE' || s === 'PUBLIC' || s === 'ACTIVE';
}


function writeLog_(token, action, moduleName, dataId, description) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_LOGS);
    if (!sheet) return;

    var session = auth_peekSession_(token) || {};
    var headers = getHeaders_(sheet);
    var object = {
      '操作编号': 'LOG-' + Utilities.formatDate(new Date(), PORTAL_TIMEZONE, 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 1000),
      '操作时间': new Date(),
      '用户编号': session.userId || '',
      '姓名': session.name || '',
      '权限': session.role || '',
      '操作': action || '',
      '模块': moduleName || '',
      '资料编号': dataId || '',
      '说明': description || ''
    };

    appendObject_(sheet, object);
  } catch (err) {
    console.log('写入操作记录失败：' + err.message);
  }
}

function testPortalConnection() {
  editorOnly_();
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var requiredSheets = [
      SHEET_SETTINGS,
      SHEET_USERS,
      SHEET_MEMBERS,
      SHEET_EVENTS,
      SHEET_ROSTER,
      SHEET_REPORTS,
      SHEET_CLAIMS,
      SHEET_FINANCE,
      SHEET_OFFERING,
      SHEET_LOGS,
      SHEET_BUDGET
    ];

    var result = requiredSheets.map(function(name) {
      return {
        sheet: name,
        exists: !!ss.getSheetByName(name)
      };
    });

    return { success: true, sheets: result };
  } catch (err) {
    return { success: false, message: err.message };
  }
}


/* ============================================================
   十、读取快取层（加速载入）
   ------------------------------------------------------------
   - 每张工作表读取一次后放进 CacheService（10 分钟）。
   - 后台保存资料时，会自动清掉该工作表的快取。
   - 直接在 Google Sheet 修改资料时，由 onEdit() 自动清掉快取。
   - 后台右上角「刷新」会清掉全部快取。
   ============================================================ */

var SHEET_CACHE_TTL_ = 600;
var SHEET_CACHE_CHUNK_ = 25000;
var __gridMemo_ = {};
var __cacheVer_ = null;

function getCacheVersion_() {
  if (__cacheVer_) return __cacheVer_;
  var cache = CacheService.getScriptCache();
  var v = cache.get('BOQ_CACHE_VER');
  if (!v) {
    v = String(new Date().getTime());
    cache.put('BOQ_CACHE_VER', v, 21600);
  }
  __cacheVer_ = v;
  return v;
}

function sheetCacheKey_(name) {
  return 'BOQ_GRID_' + getCacheVersion_() + '_' +
    Utilities.base64EncodeWebSafe(Utilities.newBlob(String(name)).getBytes());
}

function cachePutLarge_(key, str) {
  try {
    var cache = CacheService.getScriptCache();
    var n = Math.ceil(str.length / SHEET_CACHE_CHUNK_) || 1;
    if (n > 30) return; // 资料太大就不快取，直接读 Sheet
    var parts = {};
    for (var i = 0; i < n; i++) {
      parts[key + '_' + i] = str.substr(i * SHEET_CACHE_CHUNK_, SHEET_CACHE_CHUNK_);
    }
    cache.putAll(parts, SHEET_CACHE_TTL_);
    cache.put(key, String(n), SHEET_CACHE_TTL_);
  } catch (err) {
    console.log('快取写入失败：' + err.message);
  }
}

function cacheGetLarge_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var n = Number(cache.get(key) || 0);
    if (!n) return null;
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(key + '_' + i);
    var parts = cache.getAll(keys);
    var out = '';
    for (var j = 0; j < keys.length; j++) {
      if (parts[keys[j]] == null) return null;
      out += parts[keys[j]];
    }
    return out;
  } catch (err) {
    return null;
  }
}

/**
 * 读取整张工作表（表头 + 资料列），日期以 {d: 毫秒} 储存，方便放进快取。
 */
function getSheetGrid_(sheet) {
  if (!sheet) return { headers: [], rows: [] };
  var name = sheet.getName();
  if (__gridMemo_[name]) return __gridMemo_[name];

  var key = sheetCacheKey_(name);
  var cached = cacheGetLarge_(key);
  if (cached) {
    try {
      var parsed = JSON.parse(cached);
      __gridMemo_[name] = parsed;
      return parsed;
    } catch (ignore) {}
  }

  var grid = { headers: [], rows: [] };
  if (sheet.getLastRow() >= 1 && sheet.getLastColumn() >= 1) {
    var values = sheet.getDataRange().getValues();
    grid.headers = values[0].map(function(v) { return String(v == null ? '' : v).trim(); });
    grid.rows = values.slice(1).filter(function(row) {
      // 跳过完全空白的行（例如公式往下延伸产生的空行）
      return row.some(function(v) { return v !== '' && v !== null; });
    }).map(function(row) {
      return row.map(function(v) {
        return Object.prototype.toString.call(v) === '[object Date]' ? { d: v.getTime() } : v;
      });
    });
  }
  __gridMemo_[name] = grid;
  cachePutLarge_(key, JSON.stringify(grid));
  return grid;
}

function gridDate_(v) {
  if (v && typeof v === 'object' && typeof v.d === 'number' && !isNaN(v.d)) return new Date(v.d);
  return null;
}

function invalidateSheetCache_(sheetOrName) {
  try {
    var name = typeof sheetOrName === 'string' ? sheetOrName : sheetOrName.getName();
    delete __gridMemo_[name];
    CacheService.getScriptCache().remove(sheetCacheKey_(name));
  } catch (err) {}
}

function clearPortalCache_() {
  __gridMemo_ = {};
  __cacheVer_ = String(new Date().getTime());
  CacheService.getScriptCache().put('BOQ_CACHE_VER', __cacheVer_, 21600);
}

/** 后台「刷新」按钮：清掉快取，下次读取会直接读 Sheet。 */
function refreshAdminCache(token) {
  try {
    requireAnySession_(token);
    clearPortalCache_();
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/** 直接在 Google Sheet 改资料时自动清快取（简单触发器，不需要另外设置）。 */
function onEdit(e) {
  try {
    if (e && e.range) invalidateSheetCache_(e.range.getSheet());
  } catch (err) {}
}

function schemaCheckedRecently_(flag) {
  return !!CacheService.getScriptCache().get('BOQ_SCHEMA_' + flag);
}

function markSchemaChecked_(flag) {
  CacheService.getScriptCache().put('BOQ_SCHEMA_' + flag, '1', 21600);
}


/** 登录页只需要 Logo，不必读取整套公开资料。 */
function getPortalBranding() {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SETTINGS);
    var logoUrl = '';
    var bannerUrl = '';
    getSheetObjects_(sheet).forEach(function(item) {
      var keyName = String(item['设置项目'] || '').trim().toLowerCase();
      if (keyName === 'logo') logoUrl = String(item['设置内容'] || '').trim();
      if (keyName === '大合照' || keyName === 'banner') bannerUrl = String(item['设置内容'] || '').trim();
    });
    return { success: true, logoUrl: logoUrl, bannerUrl: bannerUrl, termYear: term_currentYear_() };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
