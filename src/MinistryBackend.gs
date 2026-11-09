/**
 * ============================================================
 * 播青｜MinistryBackend.gs
 * 事工管理 / 四次会议更新 / 组别权限 / 会议报告生成
 *
 * 依赖现有项目中的工具函数：
 * requireAdminSession_(), ensureSheetHeaders_(), getHeaders_(),
 * claim_getObjects_(), claim_getObjectByRow_(), claim_findRow_(),
 * claim_setValue_(), admin_saveRecord_(), writeLog_(), parseDateInput_()
 * ============================================================
 */

const MIN_SHEET_MEETINGS = '会议';
const MIN_SHEET_MINISTRY = '事工';
const MIN_SHEET_UPDATES = '事工更新';
const MIN_SHEET_STATS = '事工统计';
const MIN_SHEET_SUBMISSIONS = '会议组提交';

const MIN_GROUPS = [
  '行政组',
  '信仰组',
  '见证组',
  '宣教组',
  '公民组',
  '团契组'
];

const MIN_CATEGORIES = [
  '牧区青团事工',
  '聚会',
  '教区 & 年会青团事工'
];

const MIN_MEETING_TYPES = {
  1: '年度策划会议',
  2: '第一次进度会议',
  3: '第二次进度会议',
  4: '年度总结会议'
};

const MIN_REPORT_FOLDER = '播青｜事工会议报告';


/* ============================================================
   一、初始化
   ============================================================ */

function ministryEnsureReady_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // 结构 6 小时内只检查一次，保存资料会快很多。
  if (schemaCheckedRecently_('MINISTRY')) return ss;

  ministryEnsureExistingSheet_(ss, MIN_SHEET_MEETINGS, [
    '会议编号', '年份', '会议次数', '会议类型', '会议日期', '状态',
    '报告截止日期', '报告Doc链接', '报告PDF链接', '报告文件ID',
    '报告PDF文件ID', '生成时间', '备注'
  ]);

  ministryEnsureExistingSheet_(ss, MIN_SHEET_MINISTRY, [
    '事工编号', '年份', '组别', '类别', '序号', '事工名称',
    '目的', '进行方式', '目标/指标', '预算', '负责人', '状态'
  ]);

  ministryEnsureExistingSheet_(ss, MIN_SHEET_STATS, [
    '统计编号', '事工编号', '年份', '统计日期', '统计项目', '数值', '单位', '备注', '会议次数'
  ]);

  // 只在真正缺少这两张新表时建立；不会修改已有表头或资料。
  ministryEnsureNewSheet_(ss, MIN_SHEET_UPDATES, [
    '更新编号', '事工编号', '年份', '会议次数', '组别', '状态',
    '日期变更', '新日期', '进行方式变更', '本次进行方式', '本次进度',
    '本次结果', '参与人数', '本次预算调整', '新预算', '本次支出',
    '下一步', '附件链接', '更新人', '更新时间'
  ]);

  ministryEnsureNewSheet_(ss, MIN_SHEET_SUBMISSIONS, [
    '提交编号', '年份', '会议次数', '组别', '状态',
    '提交人', '提交时间', '文书备注', '更新时间'
  ]);

  markSchemaChecked_('MINISTRY');
  return ss;
}

/** 在编辑器手动运行：建立事工系统的工作表。 */
function initializeMinistrySystem() {
  editorOnly_();
  return ministry_initAll_();
}

function ministry_initAll_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 注意：现有「会议 / 事工 / 事工统计」已经有资料时，不再用旧版的
    // ensureSheetHeaders_ 自动补栏，避免把相似栏位重复加进去。
    ministryEnsureExistingSheet_(ss, MIN_SHEET_MEETINGS, [
      '会议编号', '年份', '会议次数', '会议类型', '会议日期', '状态',
      '报告截止日期', '报告Doc链接', '报告PDF链接', '报告文件ID',
      '报告PDF文件ID', '生成时间', '备注'
    ]);

    ministryEnsureExistingSheet_(ss, MIN_SHEET_MINISTRY, [
      '事工编号', '年份', '组别', '类别', '序号', '事工名称',
      '目的', '进行方式', '目标/指标', '预算', '负责人', '状态'
    ]);

    ministryEnsureExistingSheet_(ss, MIN_SHEET_STATS, [
      '统计编号', '事工编号', '年份', '统计日期', '统计项目', '数值', '单位', '备注', '会议次数'
    ]);

    // 这两个是当前 Sheet 里真正缺少、而事工工作流程需要的表。
    ministryEnsureNewSheet_(ss, MIN_SHEET_UPDATES, [
      '更新编号', '事工编号', '年份', '会议次数', '组别', '状态',
      '日期变更', '新日期', '进行方式变更', '本次进行方式', '本次进度',
      '本次结果', '参与人数', '本次预算调整', '新预算', '本次支出',
      '下一步', '附件链接', '更新人', '更新时间'
    ]);

    ministryEnsureNewSheet_(ss, MIN_SHEET_SUBMISSIONS, [
      '提交编号', '年份', '会议次数', '组别', '状态',
      '提交人', '提交时间', '文书备注', '更新时间'
    ]);

    return {
      success: true,
      message: '事工系统初始化完成。'
    };
  } catch (err) {
    return {
      success: false,
      message: err.message
    };
  }
}

function ministryEnsureExistingSheet_(ss, sheetName, requiredHeaders) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    return sheet;
  }

  var existing = getHeaders_(sheet);
  var missing = requiredHeaders.filter(function(h) {
    return existing.indexOf(h) === -1;
  });

  if (missing.length) {
    throw new Error('「' + sheetName + '」缺少必要栏位：' + missing.join('、') + '。系统不会自动改动现有表头，请先检查 Sheet。');
  }

  return sheet;
}

function ministryEnsureNewSheet_(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sheet;
  }

  var existing = getHeaders_(sheet);
  if (!existing.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sheet;
  }

  var missing = headers.filter(function(h) { return existing.indexOf(h) === -1; });
  if (missing.length) {
    throw new Error('「' + sheetName + '」已经存在，但缺少栏位：' + missing.join('、') + '。请先检查这张表，系统不会自动重排表头。');
  }
  return sheet;
}

function ensureMinistryMeetings_(year) {
  year = Number(year);
  if (!year || year < 2000 || year > 2100) throw new Error('年份不正确。');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MIN_SHEET_MEETINGS);
  if (!sheet) throw new Error('找不到「会议」工作表。');

  for (var no = 1; no <= 4; no++) {
    var meetingId = 'MTG-' + year + '-' + String(no).padStart(2, '0');
    var row = claim_findRow_(sheet, '会议编号', meetingId);

    if (row === -1) {
      var data = {
        '会议编号': meetingId,
        '年份': year,
        '会议次数': no,
        '会议类型': MIN_MEETING_TYPES[no],
        '会议日期': '',
        '状态': no === 1 ? '未开始' : '未开始',
        '报告截止日期': '',
        '报告Doc链接': '',
        '报告PDF链接': '',
        '报告文件ID': '',
        '报告PDF文件ID': '',
        '生成时间': '',
        '备注': ''
      };
      admin_saveRecord_(MIN_SHEET_MEETINGS, '会议编号', 'MTG', data);
    }
  }
}

function getMinistryMeetings(token, year) {
  try {
    var session = ministryRequireAnySession_(token);
    year = Number(year || new Date().getFullYear());
    ensureMinistryMeetings_(year);

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MIN_SHEET_MEETINGS);
    var all = claim_getObjects_(sheet).filter(function(item) {
      return Number(item['年份']) === year;
    });

    all.sort(function(a, b) {
      return Number(a['会议次数'] || 0) - Number(b['会议次数'] || 0);
    });

    return {
      success: true,
      year: year,
      user: ministryPublicUser_(session),
      meetings: all
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function saveMinistryMeeting(token, data) {
  try {
    var session = ministryRequireSession_(token);
    ministryRequireOfficeRole_(session);

    data = data || {};
    var year = Number(data.year);
    var no = Number(data.meetingNo);
    if (!year || no < 1 || no > 4) throw new Error('会议年份或次数不正确。');

    ensureMinistryMeetings_(year);
    var meetingId = 'MTG-' + year + '-' + String(no).padStart(2, '0');

    admin_saveRecord_(MIN_SHEET_MEETINGS, '会议编号', 'MTG', {
      '会议编号': meetingId,
      '年份': year,
      '会议次数': no,
      '会议类型': data.meetingType || MIN_MEETING_TYPES[no],
      '会议日期': parseDateInput_(data.meetingDate),
      '状态': data.status || '未开始',
      '报告截止日期': parseDateInput_(data.reportDeadline),
      '备注': data.remark || ''
    });

    writeLog_(token, '更新事工会议', MIN_SHEET_MEETINGS, meetingId,
      year + '年第' + no + '次会议');

    return { success: true, meetingId: meetingId };
  } catch (err) {
    return { success: false, message: err.message };
  }
}


/* ============================================================
   二、取得事工资料
   ============================================================ */

function ministryValidateReady_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (schemaCheckedRecently_('MINISTRY')) return ss;
  ministryEnsureExistingSheet_(ss, MIN_SHEET_MEETINGS, [
    '会议编号', '年份', '会议次数', '会议类型', '会议日期', '状态',
    '报告截止日期', '报告Doc链接', '报告PDF链接', '报告文件ID',
    '报告PDF文件ID', '生成时间', '备注'
  ]);
  ministryEnsureExistingSheet_(ss, MIN_SHEET_MINISTRY, [
    '事工编号', '年份', '组别', '类别', '序号', '事工名称',
    '目的', '进行方式', '目标/指标', '预算', '负责人', '状态'
  ]);
  ministryEnsureExistingSheet_(ss, MIN_SHEET_STATS, [
    '统计编号', '事工编号', '年份', '统计日期', '统计项目', '数值', '单位', '备注', '会议次数'
  ]);
  var updates = ss.getSheetByName(MIN_SHEET_UPDATES);
  var submissions = ss.getSheetByName(MIN_SHEET_SUBMISSIONS);
  if (!updates) throw new Error('找不到「事工更新」工作表。请先运行 initializeMinistrySystem() 一次。');
  if (!submissions) throw new Error('找不到「会议组提交」工作表。请先运行 initializeMinistrySystem() 一次。');
  markSchemaChecked_('MINISTRY');
  return ss;
}

function getMinistrySystemData(token, year, meetingNo) {
  try {
    var session = ministryRequireAnySession_(token);
    year = Number(year || new Date().getFullYear());
    meetingNo = Number(meetingNo || 1);
    if (meetingNo < 1 || meetingNo > 4) throw new Error('会议次数必须是 1 至 4。');

    // 读取页面时只验证结构，不修改 Sheet，避免每次进入事工页面都执行写入操作。
    var ss = ministryValidateReady_();
    var group = ministryGetUserGroup_(session);
    var canViewAll = ministryIsOffice_(session);

    var ministries = claim_getObjects_(ss.getSheetByName(MIN_SHEET_MINISTRY));
    var updates = claim_getObjects_(ss.getSheetByName(MIN_SHEET_UPDATES));
    var stats = claim_getObjects_(ss.getSheetByName(MIN_SHEET_STATS));
    var submissions = claim_getObjects_(ss.getSheetByName(MIN_SHEET_SUBMISSIONS));
    var events = claim_getObjects_(ss.getSheetByName('节目'));
    var meetings = claim_getObjects_(ss.getSheetByName(MIN_SHEET_MEETINGS));

    ministries = ministries.filter(function(item) {
      return Number(item['年份']) === year &&
        (canViewAll || String(item['组别'] || '') === group);
    });

    var ministryIds = {};
    ministries.forEach(function(item) { ministryIds[String(item['事工编号'])] = true; });

    updates = updates.filter(function(item) {
      return Number(item['年份']) === year && ministryIds[String(item['事工编号'])];
    });

    stats = stats.filter(function(item) {
      return Number(item['年份']) === year && ministryIds[String(item['事工编号'])];
    });

    events = ministryAttachVirtualLinks_(events, ministries);
    events = events.filter(function(item) {
      var mid = String(item['事工编号'] || '').trim();
      if (mid) return ministryIds[mid] || canViewAll;
      return canViewAll || String(item['负责组'] || '').trim() === group;
    });

    submissions = submissions.filter(function(item) {
      return Number(item['年份']) === year &&
        (canViewAll || String(item['组别'] || '') === group);
    });

    meetings = meetings.filter(function(item) {
      return Number(item['年份']) === year;
    });
    meetings.sort(function(a, b) {
      return Number(a['会议次数'] || 0) - Number(b['会议次数'] || 0);
    });

    return {
      success: true,
      year: year,
      meetingNo: meetingNo,
      user: ministryPublicUser_(session),
      groups: MIN_GROUPS.slice(),
      categories: MIN_CATEGORIES.slice(),
      meetings: meetings,
      ministries: ministries,
      updates: updates,
      stats: stats,
      submissions: submissions,
      events: events
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/* ============================================================
   三、年度事工计划
   ============================================================ */

function saveMinistryPlan(token, data) {
  try {
    var session = ministryRequireSession_(token);
    data = data || {};

    var year = Number(data.year);
    var group = ministryNormalizeGroup_(data.group);
    var category = String(data.category || '').trim();

    if (!year) throw new Error('年份不能为空。');
    if (MIN_GROUPS.indexOf(group) === -1) throw new Error('组别不正确。');
    if (MIN_CATEGORIES.indexOf(category) === -1) throw new Error('类别不正确。');
    if (!String(data.name || '').trim()) throw new Error('请填写事工名称。');
    ministryRequireCanEditGroup_(session, group, year);

    ministryEnsureReady_();

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MIN_SHEET_MINISTRY);
    var ministryId = String(data.ministryId || '').trim();
    var existingRow = ministryId ? claim_findRow_(sheet, '事工编号', ministryId) : -1;

    if (ministryId && existingRow === -1) throw new Error('找不到这个事工。');

    if (!ministryId) {
      ministryId = claim_createId_(sheet, '事工编号', 'MIN');
      if (!String(data.serial || '').trim()) {
        data.serial = ministryNextSerial_(sheet, year, group);
      }
    }

    var object = {
      '事工编号': ministryId,
      '年份': year,
      '组别': group,
      '类别': category,
      '序号': String(data.serial || '').trim(),
      '事工名称': String(data.name || '').trim(),
      '目的': String(data.purpose || ''),
      '进行方式': String(data.method || ''),
      '目标/指标': String(data.target || ''),
      // 当前 Sheet 同时存在「计划时间」和「计划日期」，优先保留两栏兼容性。
      '计划日期': parseDateInput_(data.plannedDate),
      '计划时间': parseDateInput_(data.plannedDate),
      '预算': ministryNumberOrBlank_(data.budget),
      '负责人': String(data.pic || ''),
      // 当前 Sheet 同时存在「节目编号」和「关联节目编号」，两栏都写，避免改变原结构。
      '节目编号': String(data.eventId || ''),
      '关联节目编号': String(data.eventId || ''),
      '状态': String(data.status || '计划中'),
      '排序': ministryNumberOrBlank_(data.sortOrder),
      '备注': String(data.remark || ''),
      '建立者': session.name || '',
      '更新者': session.name || ''
    };

    if (existingRow !== -1) {
      var existing = claim_getObjectByRow_(sheet, existingRow, claim_getHeaders_(sheet));
      object['建立者'] = existing['建立者'] || session.name || '';
    }

    admin_saveRecord_(MIN_SHEET_MINISTRY, '事工编号', 'MIN', object);

    // 直接回传刚保存的记录，让前端可以就地更新，不必马上重新读取整套事工资料。
    var savedRow = claim_findRow_(sheet, '事工编号', ministryId);
    var savedObject = savedRow > 1
      ? claim_getObjectByRow_(sheet, savedRow, claim_getHeaders_(sheet))
      : object;

    writeLog_(token, existingRow === -1 ? '新增事工' : '更新事工', MIN_SHEET_MINISTRY, ministryId,
      group + '｜' + object['事工名称']);

    return {
      success: true,
      ministryId: ministryId,
      ministry: savedObject,
      message: existingRow === -1 ? '事工已建立。' : '事工已更新。'
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function deleteMinistryPlan(token, ministryId) {
  try {
    var session = ministryRequireSession_(token);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MIN_SHEET_MINISTRY);
    var row = claim_findRow_(sheet, '事工编号', ministryId);
    if (row < 2) throw new Error('找不到这个事工。');

    var obj = claim_getObjectByRow_(sheet, row, claim_getHeaders_(sheet));
    ministryRequireCanEditGroup_(session, String(obj['组别'] || ''), obj['年份']);

    claim_setValue_(sheet, row, '状态', '已停用');
    claim_setValue_(sheet, row, '更新者', session.name || '');
    claim_setValue_(sheet, row, '更新日期', new Date());

    writeLog_(token, '停用事工', MIN_SHEET_MINISTRY, ministryId, obj['事工名称'] || '');
    return { success: true, message: '事工已停用。' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}


/* ============================================================
   四、会议更新
   ============================================================ */

function saveMinistryUpdate(token, data) {
  try {
    var session = ministryRequireSession_(token);
    data = data || {};

    var ministryId = String(data.ministryId || '').trim();
    var year = Number(data.year);
    var meetingNo = Number(data.meetingNo);

    if (!ministryId) throw new Error('缺少事工编号。');
    if (!year || meetingNo < 1 || meetingNo > 4) throw new Error('年份或会议次数不正确。');

    ministryEnsureReady_();

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ministrySheet = ss.getSheetByName(MIN_SHEET_MINISTRY);
    var ministryRow = claim_findRow_(ministrySheet, '事工编号', ministryId);
    if (ministryRow < 2) throw new Error('找不到这个事工。');

    var ministry = claim_getObjectByRow_(ministrySheet, ministryRow, claim_getHeaders_(ministrySheet));
    if (Number(ministry['年份']) !== year) throw new Error('事工年份不一致。');
    ministryRequireCanEditGroup_(session, String(ministry['组别'] || ''), ministry['年份']);

    var sheet = ss.getSheetByName(MIN_SHEET_UPDATES);
    var row = ministryFindUpdateRow_(sheet, ministryId, meetingNo);
    var updateId = row === -1
      ? claim_createId_(sheet, '更新编号', 'UPD')
      : String(claim_getObjectByRow_(sheet, row, claim_getHeaders_(sheet))['更新编号'] || '');

    var updateObject = {
      '更新编号': updateId,
      '事工编号': ministryId,
      '年份': year,
      '会议次数': meetingNo,
      '组别': String(ministry['组别'] || ''),
      '状态': String(data.status || ''),
      '日期变更': String(data.dateChanged || '否'),
      '新日期': parseDateInput_(data.newDate),
      '进行方式变更': String(data.methodChanged || '否'),
      '本次进行方式': String(data.currentMethod || ''),
      '本次进度': String(data.progress || ''),
      '本次结果': String(data.result || ''),
      '参与人数': ministryNumberOrBlank_(data.attendance),
      '本次预算调整': String(data.budgetChanged || '否'),
      '新预算': ministryNumberOrBlank_(data.newBudget),
      '本次支出': ministryNumberOrBlank_(data.expense),
      '下一步': String(data.nextStep || ''),
      '附件链接': String(data.attachmentUrl || ''),
      '更新人': session.name || ''
    };

    if (row === -1) claim_appendObject_(sheet, updateObject);
    else {
      var existing = claim_getObjectByRow_(sheet, row, claim_getHeaders_(sheet));
      updateObject['更新时间'] = new Date();
      var headers = claim_getHeaders_(sheet);
      var values = headers.map(function(h) {
        return updateObject.hasOwnProperty(h) ? updateObject[h] : existing[h];
      });
      sheet.getRange(row, 1, 1, headers.length).setValues([values]);
    }

    invalidateSheetCache_(sheet);
    writeLog_(token, row === -1 ? '新增事工会议更新' : '更新事工会议更新',
      MIN_SHEET_UPDATES, updateId,
      '第' + meetingNo + '次会议｜' + ministry['事工名称']);

    return {
      success: true,
      updateId: updateId,
      message: '本次会议更新已保存。'
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function getMinistryHistory(token, ministryId) {
  try {
    var session = ministryRequireAnySession_(token);
    ministryEnsureReady_();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ministrySheet = ss.getSheetByName(MIN_SHEET_MINISTRY);
    var row = claim_findRow_(ministrySheet, '事工编号', ministryId);
    if (row < 2) throw new Error('找不到这个事工。');

    var ministry = claim_getObjectByRow_(ministrySheet, row, claim_getHeaders_(ministrySheet));
    ministryRequireCanViewGroup_(session, String(ministry['组别'] || ''));

    var updates = claim_getObjects_(ss.getSheetByName(MIN_SHEET_UPDATES)).filter(function(item) {
      return String(item['事工编号'] || '') === String(ministryId);
    });
    updates.sort(function(a, b) {
      return Number(a['会议次数'] || 0) - Number(b['会议次数'] || 0);
    });

    var stats = claim_getObjects_(ss.getSheetByName(MIN_SHEET_STATS)).filter(function(item) {
      return String(item['事工编号'] || '') === String(ministryId);
    });
    stats.sort(function(a, b) {
      return new Date(a['统计日期'] || 0).getTime() - new Date(b['统计日期'] || 0).getTime();
    });

    return {
      success: true,
      ministry: ministry,
      updates: updates,
      stats: stats
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function ministryEffectiveBudget_(planBudget, updates) {
  var effective = (planBudget === '' || planBudget == null) ? '' : Number(planBudget);
  (updates || []).slice().sort(function(a, b) {
    return Number(a['会议次数'] || 0) - Number(b['会议次数'] || 0);
  }).forEach(function(update) {
    if (update['本次预算调整'] === '是' && update['新预算'] !== '' && update['新预算'] != null) {
      var n = Number(update['新预算']);
      if (!isNaN(n)) effective = n;
    }
  });
  return effective;
}

function ministryGetExpenseSummary_(ministryId, meetingNo) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MIN_SHEET_UPDATES);
  if (!sheet) return { latest: '', cumulative: 0 };

  var updates = claim_getObjects_(sheet).filter(function(item) {
    return String(item['事工编号'] || '') === String(ministryId) &&
      Number(item['会议次数'] || 0) <= Number(meetingNo);
  });

  var cumulative = 0;
  updates.forEach(function(item) {
    if (item['本次支出'] !== '' && item['本次支出'] != null) {
      var n = Number(item['本次支出']);
      if (!isNaN(n)) cumulative += n;
    }
  });

  updates.sort(function(a, b) {
    return Number(a['会议次数'] || 0) - Number(b['会议次数'] || 0);
  });

  var latest = updates.length ? updates[updates.length - 1] : null;
  return {
    latest: latest && latest['本次支出'] !== '' ? Number(latest['本次支出']) : '',
    cumulative: cumulative
  };
}


/* ============================================================
   五、事工统计
   ============================================================ */

function saveMinistryStat(token, data) {
  try {
    var session = ministryRequireSession_(token);
    data = data || {};

    var ministryId = String(data.ministryId || '').trim();
    var year = Number(data.year);
    var meetingNo = Number(data.meetingNo);
    if (!ministryId || !year || meetingNo < 1 || meetingNo > 4) {
      throw new Error('统计资料缺少必要资料。');
    }

    ministryEnsureReady_();

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ministrySheet = ss.getSheetByName(MIN_SHEET_MINISTRY);
    var ministryRow = claim_findRow_(ministrySheet, '事工编号', ministryId);
    if (ministryRow < 2) throw new Error('找不到这个事工。');
    var ministry = claim_getObjectByRow_(ministrySheet, ministryRow, claim_getHeaders_(ministrySheet));

    ministryRequireCanEditGroup_(session, String(ministry['组别'] || ''), ministry['年份']);
    if (Number(ministry['年份']) !== year) throw new Error('年份不一致。');
    if (!String(data.item || '').trim()) throw new Error('请填写统计项目。');

    ministryEnsureReady_();

    var sheet = ss.getSheetByName(MIN_SHEET_STATS);
    var statId = String(data.statId || '').trim();
    var row = statId ? claim_findRow_(sheet, '统计编号', statId) : -1;

    if (statId && row < 2) throw new Error('找不到统计记录。');
    if (!statId) statId = claim_createId_(sheet, '统计编号', 'STAT');

    var object = {
      '统计编号': statId,
      '事工编号': ministryId,
      '年份': year,
      '会议次数': meetingNo,
      '统计日期': parseDateInput_(data.date),
      '统计项目': String(data.item || ''),
      '数值': ministryNumberOrBlank_(data.value),
      '单位': String(data.unit || ''),
      '备注': String(data.remark || '')
    };

    if (row === -1) claim_appendObject_(sheet, object);
    else {
      var existing = claim_getObjectByRow_(sheet, row, claim_getHeaders_(sheet));
      var headers = claim_getHeaders_(sheet);
      var values = headers.map(function(h) {
        return object.hasOwnProperty(h) ? object[h] : existing[h];
      });
      sheet.getRange(row, 1, 1, headers.length).setValues([values]);
    }

    invalidateSheetCache_(sheet);
    writeLog_(token, row === -1 ? '新增事工统计' : '更新事工统计',
      MIN_SHEET_STATS, statId, ministry['事工名称'] + '｜' + data.item);

    return { success: true, statId: statId };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function deleteMinistryStat(token, statId) {
  try {
    var session = ministryRequireSession_(token);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MIN_SHEET_STATS);
    var row = claim_findRow_(sheet, '统计编号', statId);
    if (row < 2) throw new Error('找不到统计记录。');

    var stat = claim_getObjectByRow_(sheet, row, claim_getHeaders_(sheet));
    var ministrySheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MIN_SHEET_MINISTRY);
    var ministryRow = claim_findRow_(ministrySheet, '事工编号', stat['事工编号']);
    if (ministryRow < 2) throw new Error('找不到对应事工。');
    var ministry = claim_getObjectByRow_(ministrySheet, ministryRow, claim_getHeaders_(ministrySheet));

    ministryRequireCanEditGroup_(session, String(ministry['组别'] || ''), ministry['年份']);
    sheet.deleteRow(row);
    invalidateSheetCache_(sheet);

    writeLog_(token, '删除事工统计', MIN_SHEET_STATS, statId, ministry['事工名称'] || '');
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}


/* ============================================================
   六、组别提交状态
   ============================================================ */

function submitMinistryGroupReport(token, year, meetingNo, group, remark) {
  try {
    var session = ministryRequireSession_(token);
    year = Number(year);
    meetingNo = Number(meetingNo);
    group = ministryNormalizeGroup_(group || ministryGetUserGroup_(session));

    if (MIN_GROUPS.indexOf(group) === -1) throw new Error('组别不正确。');
    if (!year || meetingNo < 1 || meetingNo > 4) throw new Error('会议资料不正确。');
    ministryRequireCanEditGroup_(session, group, year);

    ministryEnsureReady_();

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MIN_SHEET_SUBMISSIONS);
    var row = ministryFindSubmissionRow_(sheet, year, meetingNo, group);
    var id = row === -1 ? claim_createId_(sheet, '提交编号', 'SUB') : String(
      claim_getObjectByRow_(sheet, row, claim_getHeaders_(sheet))['提交编号'] || ''
    );

    var obj = {
      '提交编号': id,
      '年份': year,
      '会议次数': meetingNo,
      '组别': group,
      '状态': '已提交',
      '提交人': session.name || '',
      '提交时间': new Date(),
      '文书备注': String(remark || ''),
      '更新时间': new Date()
    };

    if (row === -1) claim_appendObject_(sheet, obj);
    else {
      var existing = claim_getObjectByRow_(sheet, row, claim_getHeaders_(sheet));
      var headers = claim_getHeaders_(sheet);
      var values = headers.map(function(h) {
        return obj.hasOwnProperty(h) ? obj[h] : existing[h];
      });
      sheet.getRange(row, 1, 1, headers.length).setValues([values]);
    }

    invalidateSheetCache_(sheet);
    writeLog_(token, '提交组别事工报告', MIN_SHEET_SUBMISSIONS, id,
      year + '年第' + meetingNo + '次｜' + group);

    // Email 通知文书
    try {
      notify_send_(notify_emailsByRole_(['文书']), [], group + ' 已提交第' + meetingNo + '次会议报告',
        [group + ' 已提交 ' + year + ' 年第 ' + meetingNo + ' 次会议的事工报告。', '', '提交人：' + (session.name || ''),
         remark ? '备注：' + remark : '', '', '请到后台「事工管理」或「会议报告」查看并确认。']);
    } catch (mailErr) { console.log('提交通知失败：' + mailErr.message); }

    return { success: true, message: group + ' 已提交，文书会收到 Email 通知。' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function setMinistryGroupSubmissionStatus(token, year, meetingNo, group, status, remark) {
  try {
    var session = ministryRequireSession_(token);
    ministryRequireOfficeRole_(session);

    year = Number(year);
    meetingNo = Number(meetingNo);
    group = ministryNormalizeGroup_(group);

    if (['已提交', '已退回', '已确认', '未提交'].indexOf(status) === -1) {
      throw new Error('提交状态不正确。');
    }

    ministryEnsureReady_();
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MIN_SHEET_SUBMISSIONS);
    var row = ministryFindSubmissionRow_(sheet, year, meetingNo, group);
    var id;

    if (row === -1) {
      id = claim_createId_(sheet, '提交编号', 'SUB');
      claim_appendObject_(sheet, {
        '提交编号': id,
        '年份': year,
        '会议次数': meetingNo,
        '组别': group,
        '状态': status,
        '提交人': '',
        '提交时间': '',
        '文书备注': String(remark || ''),
        '更新时间': new Date()
      });
    } else {
      id = String(claim_getObjectByRow_(sheet, row, claim_getHeaders_(sheet))['提交编号'] || '');
      claim_setValue_(sheet, row, '状态', status);
      claim_setValue_(sheet, row, '文书备注', String(remark || ''));
      claim_setValue_(sheet, row, '更新时间', new Date());
    }

    writeLog_(token, '更新组别提交状态', MIN_SHEET_SUBMISSIONS, id,
      year + '年第' + meetingNo + '次｜' + group + '｜' + status);

    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}


/* ============================================================
   七、节目关联
   ============================================================ */

function linkEventToMinistry(token, eventId, ministryId) {
  try {
    var session = ministryRequireSession_(token);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var eventSheet = ss.getSheetByName('节目');
    var ministrySheet = ss.getSheetByName(MIN_SHEET_MINISTRY);

    var eventRow = claim_findRow_(eventSheet, '节目编号', eventId);
    if (eventRow < 2) throw new Error('找不到这个节目。');
    var ministryRow = claim_findRow_(ministrySheet, '事工编号', ministryId);
    if (ministryRow < 2) throw new Error('找不到这个事工。');

    var ministry = claim_getObjectByRow_(ministrySheet, ministryRow, claim_getHeaders_(ministrySheet));
    ministryRequireCanEditGroup_(session, String(ministry['组别'] || ''), ministry['年份']);

    claim_setValue_(ministrySheet, ministryRow, '关联节目编号', eventId);
    claim_setValue_(ministrySheet, ministryRow, '节目编号', eventId);

    writeLog_(token, '关联节目与事工', MIN_SHEET_MINISTRY, ministryId, eventId);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}


/* ============================================================
   八、会议报告资料 / 生成 Google Docs + PDF
   ============================================================ */

function getMinistryReportData(token, year, meetingNo) {
  try {
    var session = ministryRequireSession_(token);
    ministryRequireOfficeRole_(session);

    year = Number(year);
    meetingNo = Number(meetingNo);
    if (!year || meetingNo < 1 || meetingNo > 4) throw new Error('报告年份或会议次数不正确。');

    ministryEnsureReady_();

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var allMinistries = claim_getObjects_(ss.getSheetByName(MIN_SHEET_MINISTRY)).filter(function(item) {
      return Number(item['年份']) === year && MIN_GROUPS.indexOf(String(item['组别'] || '')) !== -1 &&
        String(item['状态'] || '') !== '已停用';
    });

    var allUpdates = claim_getObjects_(ss.getSheetByName(MIN_SHEET_UPDATES)).filter(function(item) {
      return Number(item['年份']) === year && Number(item['会议次数'] || 0) <= meetingNo;
    });

    var allStats = claim_getObjects_(ss.getSheetByName(MIN_SHEET_STATS)).filter(function(item) {
      return Number(item['年份']) === year && Number(item['会议次数'] || 0) <= meetingNo;
    });

    var staffMap = ministryGetAllGroupStaff_(year);

    var reportGroups = MIN_GROUPS.map(function(group) {
      var items = allMinistries.filter(function(m) {
        return String(m['组别'] || '') === group;
      });

      items.sort(function(a, b) {
        var categoryA = MIN_CATEGORIES.indexOf(String(a['类别'] || ''));
        var categoryB = MIN_CATEGORIES.indexOf(String(b['类别'] || ''));
        if (categoryA !== categoryB) return categoryA - categoryB;

        var serialA = String(a['序号'] || '');
        var serialB = String(b['序号'] || '');
        var numA = ministrySerialNumber_(serialA);
        var numB = ministrySerialNumber_(serialB);
        if (numA !== numB) return numA - numB;
        return String(a['事工名称'] || '').localeCompare(String(b['事工名称'] || ''));
      });

      var rows = items.map(function(m) {
        var updates = allUpdates.filter(function(u) {
          return String(u['事工编号'] || '') === String(m['事工编号'] || '');
        });
        updates.sort(function(a, b) {
          return Number(a['会议次数'] || 0) - Number(b['会议次数'] || 0);
        });

        var latest = updates.length ? updates[updates.length - 1] : null;
        var stats = allStats.filter(function(s) {
          return String(s['事工编号'] || '') === String(m['事工编号'] || '');
        });
        // 直接用已读取的更新资料计算支出（原本每个事工都重新读一次整张「事工更新」表）。
        var expenseSummary = { latest: '', cumulative: 0 };
        updates.forEach(function(u) {
          if (u['本次支出'] !== '' && u['本次支出'] != null && !isNaN(Number(u['本次支出']))) {
            expenseSummary.cumulative += Number(u['本次支出']);
          }
        });
        if (latest && latest['本次支出'] !== '' && latest['本次支出'] != null) {
          expenseSummary.latest = Number(latest['本次支出']);
        }

        var resultParts = [];
        if (m['目标/指标']) resultParts.push('目标：' + String(m['目标/指标']));

        var effectiveBudget = ministryEffectiveBudget_(m['预算'], updates);
        if (effectiveBudget !== '' && effectiveBudget != null && !isNaN(Number(effectiveBudget))) {
          resultParts.push('预算：' + ministryMoney_(effectiveBudget));
        }

        if (meetingNo > 1 && latest) {
          if (latest['状态']) resultParts.push('状态：' + String(latest['状态']));
          if (latest['日期变更'] === '是' && latest['新日期']) {
            resultParts.push('日期调整：' + ministryFormatDate_(latest['新日期']));
          }
          if (latest['进行方式变更'] === '是' && latest['本次进行方式']) {
            resultParts.push('进行方式调整：' + String(latest['本次进行方式']));
          }
          if (latest['本次进度']) resultParts.push('进度：' + String(latest['本次进度']));
          if (latest['本次结果']) resultParts.push('结果：' + String(latest['本次结果']));
          if (latest['参与人数'] !== '' && latest['参与人数'] != null) {
            resultParts.push('参与人数：' + String(latest['参与人数']));
          }
          if (latest['下一步']) resultParts.push('下一步：' + String(latest['下一步']));
        }

        if (latest && latest['本次预算调整'] === '是' && latest['新预算'] !== '' && latest['新预算'] != null) {
          resultParts.push('预算调整：' + ministryMoney_(latest['新预算']));
        }

        if (stats.length) {
          var statLines = stats.map(function(stat) {
            var valueText = stat['数值'] !== '' && stat['数值'] != null ? String(stat['数值']) : '';
            var unitText = String(stat['单位'] || '');
            var itemText = String(stat['统计项目'] || '');
            var dateObj = stat['统计日期'] ? new Date(stat['统计日期']) : null;
            var line = itemText;
            if (valueText) line += '：' + valueText + (unitText ? ' ' + unitText : '');
            if (dateObj && !isNaN(dateObj.getTime())) {
              line = Utilities.formatDate(dateObj, 'Asia/Kuala_Lumpur', 'M月') + '：' + line;
            }
            if (stat['备注']) line += '（' + String(stat['备注']) + '）';
            return line;
          }).filter(function(x) { return x; });
          if (statLines.length) resultParts.push(statLines.join('\n'));
        }

        if (expenseSummary.cumulative > 0) {
          resultParts.push('支出：' + ministryMoney_(expenseSummary.cumulative));
        }

        var purposeMethodParts = [];
        if (m['目的']) purposeMethodParts.push(String(m['目的']));
        if (m['进行方式']) purposeMethodParts.push(String(m['进行方式']));
        var plannedDate = ministryFormatDate_(m['计划日期'] || m['计划时间']);
        if (plannedDate && purposeMethodParts.join('\n').indexOf('日期') === -1) purposeMethodParts.push('日期：' + plannedDate);
        // 结果栏：有填「本次结果」就原文照登（跟正式报告一样），没有才用系统整理的资料。
        var verbatim = latest && String(latest['本次结果'] || '').trim() ? String(latest['本次结果']) : '';

        return {
          ministryId: m['事工编号'],
          serial: m['序号'],
          name: m['事工名称'],
          purpose: m['目的'],
          method: m['进行方式'],
          purposeMethod: purposeMethodParts.join('\n'),
          target: m['目标/指标'],
          plannedDate: plannedDate,
          budget: effectiveBudget,
          pic: m['负责人'],
          category: m['类别'],
          result: verbatim || resultParts.join('\n'),
          statistics: stats,
          linkedEvents: [],
          latestUpdate: latest,
          expense: expenseSummary
        };
      });

      return {
        group: group,
        staff: staffMap[group] || '',
        categories: MIN_CATEGORIES.map(function(category) {
          return {
            category: category,
            rows: rows.filter(function(row) { return row.category === category; })
          };
        }).filter(function(section) { return section.rows.length > 0; })
      };
    });

    return {
      success: true,
      year: year,
      meetingNo: meetingNo,
      meetingType: MIN_MEETING_TYPES[meetingNo],
      groups: reportGroups
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function ministryGenerateOldReport_(token, year, meetingNo, options) {
  try {
    var session = ministryRequireSession_(token);
    ministryRequireOfficeRole_(session);

    var data = getMinistryReportData(token, year, meetingNo);
    if (!data.success) throw new Error(data.message || '无法取得报告资料。');

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var meetingsSheet = ss.getSheetByName(MIN_SHEET_MEETINGS);
    var meetingId = 'MTG-' + Number(year) + '-' + String(Number(meetingNo)).padStart(2, '0');
    var meetingRow = claim_findRow_(meetingsSheet, '会议编号', meetingId);
    if (meetingRow < 2) throw new Error('找不到会议记录。');

    var meeting = claim_getObjectByRow_(meetingsSheet, meetingRow, claim_getHeaders_(meetingsSheet));
    var folder = ministryGetOrCreateFolder_(MIN_REPORT_FOLDER);
    var doc;
    var docFile;

    if (meeting['报告文件ID']) {
      try {
        docFile = DriveApp.getFileById(String(meeting['报告文件ID']));
        doc = DocumentApp.openById(String(meeting['报告文件ID']));
      } catch (ignoreOpen) {
        doc = null;
        docFile = null;
      }
    }

    if (!doc) {
      var title = Number(year) + '年播恩堂青年团契第' + Number(meetingNo) + '次会议报告';
      doc = DocumentApp.create(title);
      docFile = DriveApp.getFileById(doc.getId());
      folder.addFile(docFile);
      try { DriveApp.getRootFolder().removeFile(docFile); } catch (ignoreRoot) {}
    }

    var body = doc.getBody();

    // 原报告为 A4 直式、约 36 pt 页边距。
    body.setPageWidth(595.28);
    body.setPageHeight(841.89);
    body.setMarginLeft(36);
    body.setMarginRight(36);
    body.setMarginTop(36);
    body.setMarginBottom(36);
    body.clear();

    body.setAttributes({
      [DocumentApp.Attribute.FONT_FAMILY]: 'Noto Serif CJK SC',
      [DocumentApp.Attribute.FONT_SIZE]: 9.5
    });

    var titlePara = body.appendParagraph(
      Number(year) + '年播恩堂青年团契第' + Number(meetingNo) + '次会议报告'
    );
    titlePara.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    titlePara.setBold(true);
    titlePara.setUnderline(true);
    titlePara.setFontFamily('Noto Serif CJK SC');
    titlePara.setFontSize(14);
    titlePara.setSpacingAfter(8);

    // 可选：报告首页附加各组总览表。
    if (options && options.includeSummary) {
      ministryAppendSummaryTable_(body, data);
    }

    data.groups.forEach(function(groupData, groupIndex) {
      if (groupIndex > 0) body.appendPageBreak();

      var groupTitle = body.appendParagraph(
        (groupIndex + 1) + '．' + groupData.group +
        (groupData.staff ? ' – ' + groupData.staff : '')
      );
      groupTitle.setBold(true);
      groupTitle.setFontFamily('Noto Serif CJK SC');
      groupTitle.setFontSize(10.5);
      groupTitle.setSpacingAfter(4);

      // 每一组只建立一张四栏表，符合原会议报告：
      // 序 | 事工 | 目的/进行方式 | 结果
      var table = body.appendTable([['序', '事工', '目的/进行方式', '结果']]);
      table.setBorderColor('#000000');
      table.setBorderWidth(0.5);

      var sections = groupData.categories || [];
      if (!sections.length) {
        var emptyRow = table.appendTableRow();
        emptyRow.appendTableCell('');
        emptyRow.appendTableCell('本组暂无事工资料。');
        emptyRow.appendTableCell('');
        emptyRow.appendTableCell('');
        ministryStyleReportTable_(table);
        return;
      }

      sections.forEach(function(section) {
        // 分组标题列，横跨四栏。
        var sectionRow = table.appendTableRow();
        var s0 = sectionRow.appendTableCell(String(section.category || ''));
        var s1 = sectionRow.appendTableCell('');
        var s2 = sectionRow.appendTableCell('');
        var s3 = sectionRow.appendTableCell('');
        s3.merge();
        s2.merge();
        s1.merge();
        s0.editAsText().setBold(true);
        s0.editAsText().setFontFamily('Noto Serif CJK SC');
        s0.editAsText().setFontSize(9.5);

        (section.rows || []).forEach(function(row) {
          var tr = table.appendTableRow();
          tr.appendTableCell(String(row.serial || ''));
          tr.appendTableCell(String(row.name || ''));
          tr.appendTableCell(String(row.purposeMethod || ''));
          tr.appendTableCell(String(row.result || ''));
        });
      });

      // 组尾总支出：放在该组最后一行，前三栏合并。
      var totalExpense = sections.reduce(function(total, sec) {
        return total + (sec.rows || []).reduce(function(sub, row) {
          return sub + Number(row.expense && row.expense.cumulative || 0);
        }, 0);
      }, 0);
      if (totalExpense > 0) {
        var totalRow = table.appendTableRow();
        var t0 = totalRow.appendTableCell('');
        var t1 = totalRow.appendTableCell('');
        var t2 = totalRow.appendTableCell('总支出');
        var t3 = totalRow.appendTableCell(ministryMoney_(totalExpense));
        t2.merge();
        t1.merge();
        t0.merge();
        t0.editAsText().setBold(true);
        t0.setTextAlignment(DocumentApp.HorizontalAlignment.RIGHT);
        t3.editAsText().setBold(true);
      }

      ministryStyleReportTable_(table);
    });

    // 页码放在页脚中央。Google Docs FooterSection 支持 appendPageNumber。
    var footer = doc.getFooter() || doc.addFooter();
    footer.clear();
    var footerPara = footer.appendParagraph('');
    footerPara.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    footerPara.setFontFamily('Noto Serif CJK SC');
    footerPara.setFontSize(9);
    footerPara.appendPageNumber();

    doc.saveAndClose();
    docFile.setName(Number(year) + '年播恩堂青年团契第' + Number(meetingNo) + '次会议报告');
    docFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    if (meeting['报告PDF文件ID']) {
      try { DriveApp.getFileById(String(meeting['报告PDF文件ID'])).setTrashed(true); } catch (ignorePdf) {}
    }

    var pdfBlob = docFile.getAs(MimeType.PDF);
    pdfBlob.setName(Number(year) + '年播恩堂青年团契第' + Number(meetingNo) + '次会议报告.pdf');
    var pdfFile = folder.createFile(pdfBlob);
    pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    claim_setValue_(meetingsSheet, meetingRow, '报告Doc链接', docFile.getUrl());
    claim_setValue_(meetingsSheet, meetingRow, '报告PDF链接', pdfFile.getUrl());
    claim_setValue_(meetingsSheet, meetingRow, '报告文件ID', docFile.getId());
    claim_setValue_(meetingsSheet, meetingRow, '报告PDF文件ID', pdfFile.getId());
    claim_setValue_(meetingsSheet, meetingRow, '生成时间', new Date());
    claim_setValue_(meetingsSheet, meetingRow, '状态', '报告已生成');

    writeLog_(token, '生成事工会议报告', MIN_SHEET_MEETINGS, meetingId,
      Number(year) + '年第' + Number(meetingNo) + '次会议');

    return {
      success: true,
      meetingId: meetingId,
      docUrl: docFile.getUrl(),
      pdfUrl: pdfFile.getUrl(),
      message: '会议报告已按正式会议报告版式生成。'
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function ministryStyleReportTable_(table) {
  table.setBorderColor('#000000');
  table.setBorderWidth(0.5);
  var widths = [34, 99, 220, 170];

  for (var r = 0; r < table.getNumRows(); r++) {
    var row = table.getRow(r);
    row.setMinimumHeight(18);
    for (var c = 0; c < row.getNumCells(); c++) {
      var cell = row.getCell(c);
      cell.setVerticalAlignment(DocumentApp.VerticalAlignment.TOP);
      cell.setPaddingTop(2);
      cell.setPaddingBottom(2);
      cell.setPaddingLeft(5);
      cell.setPaddingRight(5);
      if (row.getNumCells() === 1) {
        cell.setWidth(523);
      } else if (c < widths.length) {
        cell.setWidth(widths[c]);
      }
      var text = cell.editAsText();
      text.setFontFamily('Noto Serif CJK SC');
      text.setFontSize(9.5);
    }
  }

  if (table.getNumRows() > 0) {
    var header = table.getRow(0);
    header.setMinimumHeight(20);
    for (var h = 0; h < header.getNumCells(); h++) {
      var hc = header.getCell(h);
      hc.setVerticalAlignment(DocumentApp.VerticalAlignment.CENTER);
      hc.setTextAlignment(DocumentApp.HorizontalAlignment.CENTER);
      hc.editAsText().setBold(true);
      hc.editAsText().setFontFamily('Noto Serif CJK SC');
      hc.editAsText().setFontSize(9.5);
    }
  }

  // 最后一行如果为总支出行，金额与标签加粗。
  var lastRow = table.getRow(table.getNumRows() - 1);
  if (lastRow.getNumCells() === 2) {
    var leftText = String(lastRow.getCell(0).getText() || '');
    if (leftText.indexOf('总支出') !== -1) {
      lastRow.getCell(0).editAsText().setBold(true);
      lastRow.getCell(1).editAsText().setBold(true);
    }
  }
}

/* ============================================================
   九、权限 / 通用辅助
   ============================================================ */

function ministryRequireSession_(token) {
  var session = requireAdminSession_(token);
  if (!session) throw new Error('登录已过期，请重新登录。');
  return session;
}

function ministryPublicUser_(session) {
  return {
    name: session.name || '',
    role: session.role || '',
    group: ministryGetUserGroup_(session),
    isOffice: ministryIsOffice_(session)
  };
}

function ministryIsOffice_(session) {
  var role = String(session && session.role || '').trim();
  var group = String(session && session.group || '').trim();
  if (session && session.readOnly) return false;
  return role === '管理员' || role === '文书' || group === '文书';
}

function ministryRequireOfficeRole_(session) {
  if (!ministryIsOffice_(session)) {
    throw new Error('只有文书或管理员可以执行这个操作。');
  }
}

function ministryGetUserGroup_(session) {
  if (session && session.group) {
    var sg = ministryNormalizeGroup_(session.group);
    if (MIN_GROUPS.indexOf(sg) !== -1) return sg;
  }

  var loginName = String(session && (session.loginId || session.name) || '').trim();
  if (!loginName) return '';

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('用户');
  if (!sheet || sheet.getLastRow() < 2) return '';

  var headers = getHeaders_(sheet);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  var nameCols = ministryHeaderIndexes_(headers, '姓名');
  var idCol = headers.indexOf('登入账号');
  var nameCol = nameCols.length ? nameCols[0] : -1;
  var groupCol = headers.indexOf('事工组别');
  if (groupCol < 0) groupCol = headers.indexOf('组别');
  // 你现在的 Sheet 暂时是「姓名 / 姓名」，第二个「姓名」实际存的是组别；这里兼容，不修改 Sheet。
  if (groupCol < 0 && nameCols.length >= 2) groupCol = nameCols[1];

  for (var i = 0; i < values.length; i++) {
    var id = idCol >= 0 ? String(values[i][idCol] || '').trim() : '';
    var name = nameCol >= 0 ? String(values[i][nameCol] || '').trim() : '';
    var group = groupCol >= 0 ? ministryNormalizeGroup_(values[i][groupCol]) : '';

    if (loginName === id || loginName === name || loginName === group) {
      return MIN_GROUPS.indexOf(group) !== -1 ? group : '';
    }
  }

  return '';
}

function ministryHeaderIndexes_(headers, target) {
  var result = [];
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i] || '').trim() === target) result.push(i);
  }
  return result;
}

function ministryAttachVirtualLinks_(events, ministries) {
  var linkMap = {};
  (ministries || []).forEach(function(m) {
    var mid = String(m['事工编号'] || '').trim();
    var raw = String(
      (m['关联节目编号'] != null && m['关联节目编号'] !== '')
        ? m['关联节目编号']
        : (m['节目编号'] || '')
    ).trim();
    if (!mid || !raw) return;

    raw.split(/[;,；、\n]+/).map(function(x) { return String(x || '').trim(); }).filter(Boolean).forEach(function(eventId) {
      linkMap[eventId] = mid;
    });
  });

  return (events || []).map(function(e) {
    var copy = {};
    Object.keys(e || {}).forEach(function(k) { copy[k] = e[k]; });
    var eventId = String(e['节目编号'] || '').trim();
    if (eventId && linkMap[eventId]) copy['事工编号'] = linkMap[eventId];
    return copy;
  });
}

function ministryRequireCanViewGroup_(session, group) {
  group = ministryNormalizeGroup_(group);
  if (ministryIsOffice_(session)) return true;

  var ownGroup = ministryGetUserGroup_(session);
  if (!ownGroup) throw new Error('你在这一届还没有组别任期，请联系管理员。');
  if (ownGroup !== group) throw new Error('你不能查看其他组的事工。');
  return true;
}

function ministryRequireCanEditGroup_(session, group, year) {
  ministryRequireCanViewGroup_(session, group);
  // 上一届（以前年份）的资料锁定为只读，只有管理员可以修改。
  if (year && Number(year) < term_currentYear_() && session.role !== '管理员') {
    throw new Error(year + ' 年的资料属于上一届，已锁定为只读。如需修改请联系管理员。');
  }
  return true;
}

function ministryRequireAnySession_(token) {
  return requireAnySession_(token);
}

function ministryNormalizeGroup_(group) {
  var s = String(group || '').trim();
  if (s === '行政') s = '行政组';
  if (s === '信仰') s = '信仰组';
  if (s === '见证') s = '见证组';
  if (s === '宣教') s = '宣教组';
  if (s === '公民') s = '公民组';
  if (s === '团契') s = '团契组';
  if (s === 'ALL') s = '全部';
  return s;
}

function ministryNumberOrBlank_(value) {
  if (value === '' || value == null) return '';
  var n = Number(value);
  return isNaN(n) ? '' : n;
}

function ministryFindUpdateRow_(sheet, ministryId, meetingNo) {
  if (!sheet || sheet.getLastRow() < 2) return -1;
  var headers = claim_getHeaders_(sheet);
  var idCol = headers.indexOf('事工编号') + 1;
  var noCol = headers.indexOf('会议次数') + 1;
  if (idCol <= 0 || noCol <= 0) return -1;

  var count = sheet.getLastRow() - 1;
  var idValues = sheet.getRange(2, idCol, count, 1).getValues();
  var noValues = sheet.getRange(2, noCol, count, 1).getValues();
  for (var i = 0; i < count; i++) {
    if (String(idValues[i][0] || '') === String(ministryId) && Number(noValues[i][0] || 0) === Number(meetingNo)) {
      return i + 2;
    }
  }
  return -1;
}

function ministryFindSubmissionRow_(sheet, year, meetingNo, group) {
  if (!sheet || sheet.getLastRow() < 2) return -1;
  var headers = claim_getHeaders_(sheet);
  var yearCol = headers.indexOf('年份') + 1;
  var noCol = headers.indexOf('会议次数') + 1;
  var groupCol = headers.indexOf('组别') + 1;
  if (yearCol <= 0 || noCol <= 0 || groupCol <= 0) return -1;

  var count = sheet.getLastRow() - 1;
  var y = sheet.getRange(2, yearCol, count, 1).getValues();
  var n = sheet.getRange(2, noCol, count, 1).getValues();
  var g = sheet.getRange(2, groupCol, count, 1).getValues();
  for (var i = 0; i < count; i++) {
    if (Number(y[i][0] || 0) === Number(year) &&
        Number(n[i][0] || 0) === Number(meetingNo) &&
        String(g[i][0] || '') === String(group)) {
      return i + 2;
    }
  }
  return -1;
}

function ministryNextSerial_(sheet, year, group) {
  var groupIndex = MIN_GROUPS.indexOf(group) + 1;
  if (groupIndex < 1) groupIndex = 1;

  var objects = claim_getObjects_(sheet).filter(function(item) {
    return Number(item['年份']) === Number(year) && String(item['组别'] || '') === group;
  });

  var max = 0;
  objects.forEach(function(item) {
    var s = String(item['序号'] || '');
    var match = s.match(/\.(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  });

  return groupIndex + '.' + String(max + 1);
}

function ministrySerialNumber_(serial) {
  var m = String(serial || '').match(/\.(\d+)$/);
  return m ? Number(m[1]) : 999999;
}

function ministryFormatDate_(value) {
  var d = parseDateInput_(value);
  if (!d) return '';
  return Utilities.formatDate(d, 'Asia/Kuala_Lumpur', 'yyyy/MM/dd');
}

function ministryMoney_(value) {
  var n = Number(value);
  if (isNaN(n)) return String(value || '');
  return 'RM ' + n.toFixed(2);
}

function ministryJoinPurposeMethod_(purpose, method) {
  var p = String(purpose || '').trim();
  var m = String(method || '').trim();
  if (p && m) return p + '\n\n' + m;
  return p || m;
}

function ministryBuildActivityCell_(row) {
  return String(row.name || '');
}

function ministryGetGroupStaff_(group) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('用户');
  if (!sheet || sheet.getLastRow() < 2) return '';

  var headers = getHeaders_(sheet);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  var nameCols = ministryHeaderIndexes_(headers, '姓名');
  var nameCol = nameCols.length ? nameCols[0] : -1;
  var groupCol = headers.indexOf('事工组别');
  if (groupCol < 0) groupCol = headers.indexOf('组别');
  if (groupCol < 0 && nameCols.length >= 2) groupCol = nameCols[1];
  if (nameCol < 0 || groupCol < 0) return '';

  var names = [];
  values.forEach(function(row) {
    var rowGroup = ministryNormalizeGroup_(row[groupCol]);
    var name = String(row[nameCol] || '').trim();
    if (rowGroup === group && name && names.indexOf(name) === -1) names.push(name);
  });
  return names.join('、');
}

function ministryGetOrCreateFolder_(folderName) {
  return drive_folder_(folderName);
}


/* ============================================================
   十、会议报告中心 / 报告总览
   ============================================================ */

/**
 * 会议报告页面：一次取得该年度四次会议、各组提交状态、各组更新进度。
 */
function getMeetingCenterData(token, year) {
  try {
    var session = ministryRequireAnySession_(token);
    year = Number(year || new Date().getFullYear());
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var office = ministryIsOffice_(session);
    var byYear = function(item) { return Number(item['年份']) === year; };

    var meetingSheet = ss.getSheetByName(MIN_SHEET_MEETINGS);
    var meetings = claim_getObjects_(meetingSheet).filter(byYear);
    if (meetings.length < 4 && office && !session.readOnly && meetingSheet) {
      ensureMinistryMeetings_(year);
      meetings = claim_getObjects_(meetingSheet).filter(byYear);
    }
    meetings.sort(function(a, b) {
      return Number(a['会议次数'] || 0) - Number(b['会议次数'] || 0);
    });

    var submissions = claim_getObjects_(ss.getSheetByName(MIN_SHEET_SUBMISSIONS)).filter(byYear);
    var ministries = claim_getObjects_(ss.getSheetByName(MIN_SHEET_MINISTRY)).filter(function(m) {
      return byYear(m) && MIN_GROUPS.indexOf(String(m['组别'] || '')) !== -1 &&
        String(m['状态'] || '') !== '已停用';
    });
    var updates = claim_getObjects_(ss.getSheetByName(MIN_SHEET_UPDATES)).filter(byYear);

    var updatedKey = {};
    updates.forEach(function(u) {
      updatedKey[String(u['事工编号']) + '|' + Number(u['会议次数'])] = true;
    });

    var progress = {};
    for (var no = 1; no <= 4; no++) {
      progress[no] = {};
      for (var g = 0; g < MIN_GROUPS.length; g++) {
        var group = MIN_GROUPS[g];
        var items = ministries.filter(function(m) { return String(m['组别']) === group; });
        var updated = 0;
        for (var k = 0; k < items.length; k++) {
          if (updatedKey[String(items[k]['事工编号']) + '|' + no]) updated++;
        }
        progress[no][group] = { total: items.length, updated: updated };
      }
    }

    return {
      success: true,
      year: year,
      isOffice: office,
      user: ministryPublicUser_(session),
      groups: MIN_GROUPS.slice(),
      meetings: meetings,
      submissions: submissions,
      progress: progress
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/** 一次读取「用户」表，取得六组职员名单（原本每组读一次）。 */
function ministryGetAllGroupStaff_(year) {
  // 依照「职员任期」取得该年度各组的职员（在任 / 已卸任；辞职者不列入）。
  var map = {};
  year = Number(year) || term_currentYear_();
  term_read_().terms.forEach(function(t) {
    if (Number(t['年份']) !== year || ['在任', '已卸任'].indexOf(String(t['状态'])) === -1) return;
    var g = ministryNormalizeGroup_(t['组别']);
    var name = String(t['人名'] || '').trim();
    if (!g || !name) return;
    if (!map[g]) map[g] = [];
    if (map[g].indexOf(name) === -1) map[g].push(name);
  });
  Object.keys(map).forEach(function(k) { map[k] = map[k].join('、'); });
  return map;
}

/** 报告首页的总览表（可选）：各组事工数、本次已更新、预算、累计支出。 */
function ministryAppendSummaryTable_(body, data) {
  var meetingNo = Number(data.meetingNo);
  var rows = [['组别', '事工数', '本次已更新', '预算', '累计支出']];
  var tot = [0, 0, 0, 0];

  data.groups.forEach(function(g) {
    var count = 0, updated = 0, budget = 0, expense = 0;
    (g.categories || []).forEach(function(sec) {
      (sec.rows || []).forEach(function(r) {
        count++;
        if (r.latestUpdate && Number(r.latestUpdate['会议次数']) === meetingNo) updated++;
        if (r.budget !== '' && r.budget != null && !isNaN(Number(r.budget))) budget += Number(r.budget);
        expense += Number(r.expense && r.expense.cumulative || 0);
      });
    });
    tot[0] += count; tot[1] += updated; tot[2] += budget; tot[3] += expense;
    rows.push([g.group, String(count), meetingNo > 1 ? String(updated) : '—', ministryMoney_(budget), ministryMoney_(expense)]);
  });
  rows.push(['合计', String(tot[0]), meetingNo > 1 ? String(tot[1]) : '—', ministryMoney_(tot[2]), ministryMoney_(tot[3])]);

  var label = body.appendParagraph('总览');
  label.setBold(true);
  label.setFontFamily('Noto Serif CJK SC');
  label.setFontSize(10.5);
  label.setSpacingAfter(4);

  var table = body.appendTable(rows);
  table.setBorderColor('#000000');
  table.setBorderWidth(0.5);
  var last = table.getNumRows() - 1;
  for (var r = 0; r < table.getNumRows(); r++) {
    var row = table.getRow(r);
    for (var c = 0; c < row.getNumCells(); c++) {
      var cell = row.getCell(c);
      cell.setPaddingTop(2);
      cell.setPaddingBottom(2);
      cell.setPaddingLeft(5);
      cell.setPaddingRight(5);
      var t = cell.editAsText();
      t.setFontFamily('Noto Serif CJK SC');
      t.setFontSize(9.5);
      t.setBold(r === 0 || r === last);
    }
  }
  body.appendPageBreak();
}


/* ============================================================
   十、正式报告：会议报告 / 会议议案（Word + PDF，同一版式）
   ------------------------------------------------------------
   直接组装 Word (.docx) 档案：字体 Century Gothic + 楷体 (KaiTi)，
   A4、0.5 吋页边、四栏表格、页尾页码，跟会议报告样本一样。
   PDF 由同一份 Word 档转出（需要「Drive API」进阶服务）。
   事工内文的小标记：
     **粗体**　　　　　　　　 → 粗体
     | 栏1 | 栏2 | 栏3　　　 → 小表格（连续几行组成一个表）
     行首四个空格　　　　　　 → 缩进一层
     a) / i. / 1) / - / •　　 → 悬挂缩进的列点
   ============================================================ */

var RPT_FONT_LATIN_ = 'Century Gothic';
var RPT_FONT_CJK_ = 'KaiTi';
var RPT_SZ_ = 22;
var RPT_COLS_ = [700, 1980, 4360, 3420];
var RPT_CN_ = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
var RPT_SHEET_BUDGET_ = '预算';
var RPT_FIN_ACCOUNTS_ = ['奉献在手', '现金', '银行'];

function rptCn_(n) {
  n = Number(n) || 0;
  if (n <= 10) return RPT_CN_[n];
  if (n < 20) return '十' + (n % 10 ? RPT_CN_[n % 10] : '');
  return RPT_CN_[Math.floor(n / 10)] + '十' + (n % 10 ? RPT_CN_[n % 10] : '');
}
function rptEsc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}
function rptMoney_(n, dashZero) {
  if (n === '' || n == null || isNaN(Number(n))) return dashZero ? '-' : '';
  n = Math.round(Number(n) * 100) / 100;
  if (dashZero && Math.abs(n) < 0.005) return '-';
  var s = Math.abs(n).toFixed(2).split('.');
  s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '-' : '') + s.join('.');
}

/* ---------- Word XML 小工具 ---------- */
function rptRun_(text, o) {
  o = o || {};
  var rpr = '';
  if (o.font) rpr += '<w:rFonts w:ascii="' + o.font + '" w:hAnsi="' + o.font + '" w:cs="' + o.font + '"' + (o.fontCjk ? ' w:eastAsia="' + o.fontCjk + '"' : '') + '/>';
  if (o.b) rpr += '<w:b/><w:bCs/>';
  if (o.sz) rpr += '<w:sz w:val="' + o.sz + '"/><w:szCs w:val="' + o.sz + '"/>';
  if (o.u) rpr += '<w:u w:val="single"/>';
  var x = '';
  String(text == null ? '' : text).split(/(\t|\n)/).forEach(function(p) {
    if (p === '\t') x += '<w:tab/>';
    else if (p === '\n') x += '<w:br/>';
    else if (p) x += '<w:t xml:space="preserve">' + rptEsc_(p) + '</w:t>';
  });
  return x ? '<w:r>' + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') + x + '</w:r>' : '';
}
/** 支援 **粗体** 的文字 */
function rptRich_(text, o) {
  o = o || {};
  var out = '';
  String(text == null ? '' : text).split('**').forEach(function(s, i) {
    if (!s) return;
    var oo = {}; for (var k in o) oo[k] = o[k];
    oo.b = o.b || (i % 2 === 1);
    out += rptRun_(s, oo);
  });
  return out;
}
function rptPara_(runs, p) {
  p = p || {};
  var ppr = '';
  if (p.keepNext) ppr += '<w:keepNext/>';
  if (p.pageBreakBefore) ppr += '<w:pageBreakBefore/>';
  if (p.tabs && p.tabs.length) ppr += '<w:tabs>' + p.tabs.map(function(t) { return '<w:tab w:val="' + (t.val || 'left') + '" w:pos="' + t.pos + '"/>'; }).join('') + '</w:tabs>';
  ppr += '<w:spacing w:before="' + (p.before || 0) + '" w:after="' + (p.after || 0) + '" w:line="' + (p.line || 240) + '" w:lineRule="auto"/>';
  if (p.left || p.hanging) ppr += '<w:ind w:left="' + (p.left || 0) + '"' + (p.hanging ? ' w:hanging="' + p.hanging + '"' : '') + '/>';
  if (p.jc) ppr += '<w:jc w:val="' + p.jc + '"/>';
  if (p.sz) ppr += '<w:rPr><w:sz w:val="' + p.sz + '"/><w:szCs w:val="' + p.sz + '"/></w:rPr>';
  return '<w:p><w:pPr>' + ppr + '</w:pPr>' + (runs || '') + '</w:p>';
}
function rptBorderSet_(names, sz) {
  return names.map(function(n) { return '<w:' + n + ' w:val="single" w:sz="' + (sz || 4) + '" w:space="0" w:color="000000"/>'; }).join('');
}
function rptNoBorder_(names) {
  return names.map(function(n) { return '<w:' + n + ' w:val="nil"/>'; }).join('');
}
function rptTc_(w, inner, o) {
  o = o || {};
  var p = '<w:tcW w:w="' + w + '" w:type="dxa"/>';
  if (o.span) p += '<w:gridSpan w:val="' + o.span + '"/>';
  if (o.borders) p += '<w:tcBorders>' + o.borders + '</w:tcBorders>';
  if (o.vAlign) p += '<w:vAlign w:val="' + o.vAlign + '"/>';
  return '<w:tc><w:tcPr>' + p + '</w:tcPr>' + (inner || rptPara_('')) + '</w:tc>';
}
function rptTable_(widths, rowsXml, o) {
  o = o || {};
  var total = widths.reduce(function(a, b) { return a + b; }, 0);
  var pr = '<w:tblW w:w="' + total + '" w:type="dxa"/>';
  if (o.jc) pr += '<w:jc w:val="' + o.jc + '"/>';
  pr += '<w:tblBorders>' + (o.borders || rptBorderSet_(['top', 'left', 'bottom', 'right', 'insideH', 'insideV'])) + '</w:tblBorders>';
  pr += '<w:tblLayout w:type="fixed"/>';
  pr += '<w:tblCellMar><w:left w:w="' + (o.pad == null ? 100 : o.pad) + '" w:type="dxa"/><w:right w:w="' + (o.pad == null ? 100 : o.pad) + '" w:type="dxa"/></w:tblCellMar>';
  return '<w:tbl><w:tblPr>' + pr + '</w:tblPr><w:tblGrid>' + widths.map(function(w) { return '<w:gridCol w:w="' + w + '"/>'; }).join('') + '</w:tblGrid>' + rowsXml + '</w:tbl>';
}

var RPT_LIST_RE_ = /^((?:[a-z]|[ivx]{1,4})[\)\.]|\d{1,2}[\)）]|\d{1,2}\.(?=\s)|[•●\-–])\s*/;

/** 把事工栏位的文字（含小标记）变成段落 */
function rptCellBlocks_(text, width) {
  var lines = String(text == null ? '' : text).replace(/\r/g, '').split('\n');
  var xml = '', lastTable = false, i = 0;
  while (i < lines.length) {
    var ln = lines[i];
    if (/^\s*\|/.test(ln)) {
      var rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(lines[i].replace(/^\s*\|/, '').split('|').map(function(c) { return c.trim().replace(/\\n/g, '\n'); }));
        i++;
      }
      xml += rptNestedTable_(rows, width);
      lastTable = true;
      continue;
    }
    var m = ln.match(/^([ 　]*)/);
    var sp = m[1].replace(/　/g, '  ').length;
    var level = Math.floor(sp / 4);
    var body = ln.slice(m[1].length);
    var lm = body.match(RPT_LIST_RE_);
    if (lm && body.length > lm[0].length) {
      var pre = lm[1];
      var hang = pre.length >= 3 ? 420 : 300;
      var left = level * 300 + hang;
      xml += rptPara_(rptRich_(pre) + rptRun_('\t') + rptRich_(body.slice(lm[0].length)), { left: left, hanging: hang, tabs: [{ pos: left }] });
    } else {
      xml += rptPara_(rptRich_(body), { left: level * 300 });
    }
    lastTable = false;
    i++;
  }
  if (!xml || lastTable) xml += rptPara_('');
  return xml;
}
function rptNestedTable_(rows, width) {
  var n = Math.max.apply(null, rows.map(function(r) { return r.length; }));
  var w = Math.floor((width - 40) / n);
  var widths = []; for (var k = 0; k < n; k++) widths.push(w);
  var x = rows.map(function(r) {
    var cells = '';
    for (var c = 0; c < n; c++) cells += rptTc_(w, rptCellBlocks_(r[c] || '', w - 120));
    return '<w:tr>' + cells + '</w:tr>';
  }).join('');
  return rptTable_(widths, x, { pad: 60 });
}

/* ---------- 组别报告表 ---------- */
function rptGroupXml_(g, index) {
  var W = RPT_COLS_;
  var x = rptPara_(rptRun_(index + '．' + g.group + (g.staff ? ' – ' + g.staff : '')), { keepNext: true, after: 40 });
  var hdr = '<w:tr><w:trPr><w:tblHeader/></w:trPr>' +
    ['序', '事工', '目的/进行方式', '结果'].map(function(h, i) { return rptTc_(W[i], rptPara_(rptRun_(h), { jc: 'center' }), { vAlign: 'center' }); }).join('') + '</w:tr>';
  var rows = '';
  var total = 0;
  (g.categories || []).forEach(function(sec) {
    rows += '<w:tr><w:trPr><w:cantSplit/></w:trPr>' + rptTc_(10460, rptPara_(rptRun_(sec.category, { b: true }), { keepNext: true }), { span: 4 }) + '</w:tr>';
    (sec.rows || []).forEach(function(r) {
      total += Number(r.expense && r.expense.cumulative || 0);
      rows += '<w:tr>' +
        rptTc_(W[0], rptCellBlocks_(r.serial, W[0] - 200)) +
        rptTc_(W[1], rptCellBlocks_(r.name, W[1] - 200)) +
        rptTc_(W[2], rptCellBlocks_(r.purposeMethod, W[2] - 200)) +
        rptTc_(W[3], rptCellBlocks_(r.result, W[3] - 200)) + '</w:tr>';
    });
  });
  if (!(g.categories || []).length) {
    rows += '<w:tr>' + rptTc_(W[0], '') + rptTc_(W[1] + W[2] + W[3], rptPara_(rptRun_('本组暂无事工资料。')), { span: 3 }) + '</w:tr>';
  }
  rows += '<w:tr><w:trPr><w:cantSplit/></w:trPr>' +
    rptTc_(W[0] + W[1] + W[2], rptPara_(rptRun_('总支出'), { jc: 'right' }), { span: 3 }) +
    rptTc_(W[3], rptPara_(rptRun_('RM ' + rptMoney_(total)))) + '</w:tr>';
  return x + rptTable_(W, hdr + rows) + rptPara_('', { after: 120 });
}

/* ---------- 议案首页 ---------- */
function rptCoverXml_(year, no, c) {
  c = c || {};
  var x = rptPara_(rptRun_(year + '年播恩堂青年团契第' + rptCn_(no) + '次会议议案', { b: true, u: true }), { jc: 'center', after: 200 });
  var info = function(label, val) { return rptPara_(rptRun_(label + '：' + (val || '')), { line: 276 }); };
  x += info('日期', rptCoverDate_(c.date));
  x += info('开始时间', c.start);
  x += info('地点', c.venue);
  x += info('主持', c.chair);
  x += info('记录', c.recorder);
  x += rptPara_(rptRun_('出席者：' + (c.present || []).join('、')), { left: 900, hanging: 900, line: 276 });
  x += rptPara_(rptRun_('缺席者：' + (c.absent || []).join('、')), { left: 900, hanging: 900, line: 276 });
  x += rptPara_('', { line: 276 });
  x += rptPara_(rptRun_('会议议程', { b: true, u: true }), { line: 276, after: 40 });
  var L = { line: 276 };
  (c.agenda || []).forEach(function(a, i) {
    var num = '（' + rptCn_(i + 1) + '）';
    var t = String(a.title || '').trim();
    if (a.type === 'motion') {
      x += rptPara_(rptRich_(num + t + '：'), L);
      x += rptPara_(rptRun_('提议：' + (a.proposer || '') + '\t附议：' + (a.seconder || '') + '\t' + (a.result || '全体通过')), { left: 720, tabs: [{ pos: 5040 }, { pos: 9380 }], line: 276 });
    } else if (a.type === 'groups') {
      x += rptPara_(rptRich_(num + t + '：'), L);
      var items = (a.rows || []).filter(function(r) { return r && (r.label || r.person); });
      for (var k = 0; k < items.length; k += 2) {
        var s = items[k].label + '：' + (items[k].person || '');
        if (items[k + 1]) s += '\t' + items[k + 1].label + '：' + (items[k + 1].person || '');
        x += rptPara_(rptRun_(s), { left: 720, tabs: [{ pos: 5040 }], line: 276 });
      }
      String(a.extra || '').split('\n').forEach(function(e) { if (e.trim()) x += rptPara_(rptRich_(e.trim()), { left: 720, line: 276 }); });
    } else if (a.type === 'bullets') {
      x += rptPara_(rptRich_(num + t + '：'), L);
      (a.items || []).forEach(function(b) {
        if (String(b || '').trim()) x += rptPara_(rptRun_('•\t') + rptRich_(String(b).trim()), { left: 900, hanging: 180, tabs: [{ pos: 900 }], line: 276 });
      });
    } else {
      x += rptPara_(rptRich_(num + t + (a.person ? '：' + a.person : '')), L);
    }
  });
  return x;
}
function rptCoverDate_(v) {
  if (!v) return '';
  var d = (typeof gridDate_ === 'function' ? gridDate_(v) : null) || new Date(String(v).replace(' ', 'T'));
  if (!d || isNaN(d.getTime())) return String(v);
  var wk = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日（星期' + wk + '）';
}

/* ---------- 组装 .docx ---------- */
function rptBuildDocx_(bodyXml, images, name) {
  images = images || [];
  var NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  var sect = '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="400" w:gutter="0"/></w:sectPr>';
  var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + '><w:body>' + bodyXml + sect + '</w:body></w:document>';
  var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="' + RPT_FONT_LATIN_ + '" w:hAnsi="' + RPT_FONT_LATIN_ + '" w:eastAsia="' + RPT_FONT_CJK_ + '" w:cs="' + RPT_FONT_LATIN_ + '"/>' +
    '<w:sz w:val="' + RPT_SZ_ + '"/><w:szCs w:val="' + RPT_SZ_ + '"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    '</w:styles>';
  var footer = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ' + NS + '><w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr><w:t>1</w:t></w:r>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>';
  var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
    images.map(function(im) { return '<Relationship Id="' + im.rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + im.rid + '.png"/>'; }).join('') +
    '</Relationships>';
  var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>';
  var root = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  var blobs = [
    Utilities.newBlob(ct, 'application/xml', '[Content_Types].xml'),
    Utilities.newBlob(root, 'application/xml', '_rels/.rels'),
    Utilities.newBlob(doc, 'application/xml', 'word/document.xml'),
    Utilities.newBlob(styles, 'application/xml', 'word/styles.xml'),
    Utilities.newBlob(footer, 'application/xml', 'word/footer1.xml'),
    Utilities.newBlob(rels, 'application/xml', 'word/_rels/document.xml.rels')
  ];
  images.forEach(function(im) { blobs.push(im.blob.copyBlob().setName('word/media/' + im.rid + '.png')); });
  var zip = Utilities.zip(blobs, name + '.docx');
  return zip.setContentType('application/vnd.openxmlformats-officedocument.wordprocessingml.document').setName(name + '.docx');
}
function rptImageRun_(rid, id, cx, cy) {
  return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + id + '" name="Sig' + id + '"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' + id + '" name="sig' + id + '.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
}
/** Word → PDF（经由 Google Docs 转换，转完马上丢进垃圾桶） */
function rptDocxToPdf_(docx, name) {
  if (typeof Drive === 'undefined') throw new Error('PDF 需要开启 Apps Script 的「Drive API」服务。Word 档已经可以下载。');
  var f = Drive.Files.create({ name: name + ' (temp)', mimeType: MimeType.GOOGLE_DOCS }, docx.copyBlob());
  try {
    return DriveApp.getFileById(f.id).getAs(MimeType.PDF).setName(name + '.pdf');
  } finally {
    try { Drive.Files.update({ trashed: true }, f.id); } catch (ignore) { try { DriveApp.getFileById(f.id).setTrashed(true); } catch (e2) {} }
  }
}
function rptOutput_(bodyXml, images, name, formats) {
  formats = formats || ['pdf', 'docx'];
  var docx = rptBuildDocx_(bodyXml, images, name);
  var out = { success: true, title: name };
  if (formats.indexOf('docx') !== -1) out.docx = Utilities.base64Encode(docx.getBytes());
  if (formats.indexOf('pdf') !== -1) {
    try { out.pdf = Utilities.base64Encode(rptDocxToPdf_(docx, name).getBytes()); }
    catch (e) { out.pdfError = e.message; }
  }
  return out;
}

/* ---------- 职员名单（报告用） ---------- */
function rptStaffByRole_(year) {
  var res = { roles: {}, all: [] };
  term_read_().terms.forEach(function(t) {
    if (Number(t['年份']) !== Number(year) || ['在任', '已卸任'].indexOf(String(t['状态'])) === -1) return;
    var n = String(t['人名'] || '').trim(); if (!n) return;
    var r = String(t['职位'] || '').trim();
    if (r && !res.roles[r]) res.roles[r] = n;
    if (res.all.indexOf(n) === -1) res.all.push(n);
  });
  return res;
}

/* ---------- 会议议案首页：读取 / 保存 ---------- */
function rptMeetingRow_(year, no) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MIN_SHEET_MEETINGS);
  ensureHeaders_(sheet, ['议案资料']);
  var id = 'MTG-' + Number(year) + '-' + String(Number(no)).padStart(2, '0');
  var row = claim_findRow_(sheet, '会议编号', id);
  if (row < 2) { ensureMinistryMeetings_(year); row = claim_findRow_(sheet, '会议编号', id); }
  return { sheet: sheet, row: row, id: id, obj: claim_getObjectByRow_(sheet, row, claim_getHeaders_(sheet)) };
}
function rptDefaultCover_(year, no, meeting) {
  var staff = rptStaffByRole_(year);
  var groupStaff = ministryGetAllGroupStaff_(year);
  var chair = staff.roles['主席'] || '';
  var treasurer = staff.roles['财政'] || '';
  var month = '';
  var md = meeting && meeting['会议日期'] ? new Date(String(meeting['会议日期']).replace(' ', 'T')) : null;
  if (md && !isNaN(md.getTime())) month = rptCn_(Math.max(1, md.getMonth()));
  var agenda = [{ type: 'text', title: '开始祷告', person: chair }];
  if (no > 1) agenda.push({ type: 'motion', title: '接收' + year + '年第' + rptCn_(no - 1) + '次会议议案', proposer: '', seconder: '', result: '全体通过' });
  agenda.push({
    type: 'groups', title: '各组报告',
    rows: MIN_GROUPS.map(function(g) { return { label: g, person: String(groupStaff[g] || '').split('、')[0] || '' }; }),
    extra: '财政报告（一月至' + (month || '　') + '月）：' + treasurer
  });
  agenda.push({ type: 'bullets', title: '讨论事项', items: [] });
  agenda.push({ type: 'motion', title: '接收' + year + '年第' + rptCn_(no) + '次会议报告', proposer: '', seconder: '', result: '全体通过' });
  agenda.push({ type: 'motion', title: '接收财政报告（一月至' + (month || '　') + '月）', proposer: '', seconder: '', result: '全体通过' });
  agenda.push({ type: 'text', title: '结束祷告', person: '' });
  agenda.push({ type: 'text', title: '结束时间', person: '' });
  return {
    date: meeting && meeting['会议日期'] ? String(meeting['会议日期']).slice(0, 10) : '',
    start: '', venue: '播恩堂', chair: chair, recorder: staff.roles['文书'] || '',
    present: staff.all, absent: [], agenda: agenda
  };
}
function getMeetingCover(token, year, no) {
  try {
    var session = ministryRequireAnySession_(token);
    year = Number(year); no = Number(no);
    var m = rptMeetingRow_(year, no);
    var cover = null;
    try { cover = m.obj['议案资料'] ? JSON.parse(m.obj['议案资料']) : null; } catch (e) { cover = null; }
    return {
      success: true, saved: !!cover, cover: cover || rptDefaultCover_(year, no, m.obj),
      staff: rptStaffByRole_(year).all, groups: MIN_GROUPS.slice(),
      canEdit: ministryIsOffice_(session) || ['主席', '副主席'].indexOf(String(session.role || '')) !== -1
    };
  } catch (err) { return { success: false, message: err.message }; }
}
function saveMeetingCover(token, year, no, cover) {
  try {
    var session = ministryRequireSession_(token);
    if (!(ministryIsOffice_(session) || ['主席', '副主席'].indexOf(String(session.role || '')) !== -1)) throw new Error('只有文书、主席或管理员可以编辑议案。');
    var m = rptMeetingRow_(Number(year), Number(no));
    var json = JSON.stringify(cover || {});
    if (json.length > 45000) throw new Error('议案内容太长了。');
    claim_setValue_(m.sheet, m.row, '议案资料', json);
    if (cover && cover.date) claim_setValue_(m.sheet, m.row, '会议日期', parseDateInput_(cover.date));
    writeLog_(token, '保存会议议案', MIN_SHEET_MEETINGS, m.id, year + '年第' + no + '次会议');
    return { success: true, message: '议案已保存。' };
  } catch (err) { return { success: false, message: err.message }; }
}

/* ---------- 一键生成：会议报告 / 议案 ---------- */
function generateMinistryMeetingReport(token, year, meetingNo, options) {
  try {
    var session = ministryRequireSession_(token);
    ministryRequireOfficeRole_(session);
    options = options || {};
    year = Number(year); meetingNo = Number(meetingNo);
    var data = getMinistryReportData(token, year, meetingNo);
    if (!data.success) throw new Error(data.message || '无法取得报告资料。');
    var version = options.version === 'motion' ? 'motion' : 'report';
    var m = rptMeetingRow_(year, meetingNo);
    var body = '';
    if (version === 'motion') {
      var cover = null;
      try { cover = m.obj['议案资料'] ? JSON.parse(m.obj['议案资料']) : null; } catch (e) {}
      body += rptCoverXml_(year, meetingNo, cover || rptDefaultCover_(year, meetingNo, m.obj));
    } else {
      body += rptPara_(rptRun_(year + '年播恩堂青年团契第' + rptCn_(meetingNo) + '次会议报告', { b: true, u: true }), { jc: 'center', after: 200 });
    }
    var first = true;
    data.groups.forEach(function(g, i) {
      var gx = rptGroupXml_(g, i + 1);
      if (first && version === 'motion') gx = gx.replace('<w:p><w:pPr><w:keepNext/>', '<w:p><w:pPr><w:keepNext/><w:pageBreakBefore/>');
      first = false;
      body += gx;
    });
    var images = [];
    if (options.financeMonth) {
      var fin = fin_computeReport_(year, Number(options.financeMonth));
      var fx = fin_reportXml_(fin, images, fin_loadSigs_(year, Number(options.financeMonth)));
      var head = rptPara_(rptRun_((data.groups.length + 1) + '. 财政报告（1月至' + Number(options.financeMonth) + '月） – ' + (fin.treasurer || '')), { pageBreakBefore: true, after: 60 });
      body += head + fx;
    }
    var name = year + '年播恩堂青年团契第' + rptCn_(meetingNo) + '次会议' + (version === 'motion' ? '议案' : '报告');
    // 只生成给大家过目，不会自动存进 Drive；确定没问题再按「存进 Drive」。
    var out = rptOutput_(body, images, name, options.formats);
    out.kind = version; out.year = year; out.meetingNo = meetingNo;
    return out;
  } catch (err) { return { success: false, message: err.message }; }
}

/* ============================================================
   十一、财政：交易（收入 / 支出 / 转账）、预算、财政报告、签名
   ------------------------------------------------------------
   账户：奉献在手（收了还没存银行的奉献）、现金、银行
   奉献 → 奉献在手；Claim 批准 → 现金支出；Bank in → 奉献在手→银行；
   Petty cash top up → 银行→现金。
   报告：收入按「预算」收入项目；支出按项目，再按组别，其余归「其他」。
   ============================================================ */

function fin_requireRole_(token, write) {
  var s = write ? requireAdminSession_(token) : requireAnySession_(token);
  if (!perm_isFinance_(s)) throw new Error('只有财政、查账或管理员可以使用财政功能。');
  return s;
}
function fin_ensure_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // 栏位检查 6 小时做一次就好（加快财政报告）
  if (schemaCheckedRecently_('FIN') && ss.getSheetByName('财政') && ss.getSheetByName(RPT_SHEET_BUDGET_)) return { ss: ss, fin: ss.getSheetByName('财政'), budget: ss.getSheetByName(RPT_SHEET_BUDGET_) };
  var fin = ensureTab_('财政', ['交易编号', '交易日期', '类型', '类别', '组别', '说明', '金额', '参考编号', '付款方式', '记录人', '备注', '建立时间', '更新日期']);
  ensureHeaders_(fin, ['账户', '转入账户']);
  var b = ensureTab_(RPT_SHEET_BUDGET_, ['预算编号', '年份', '类型', '项目', '说明', '预算', '排序']);
  markSchemaChecked_('FIN');
  return { ss: ss, fin: fin, budget: b };
}
function fin_num_(v) { var n = Number(String(v == null ? '' : v).replace(/,/g, '')); return isNaN(n) ? 0 : n; }
function fin_date_(v) {
  var d = (typeof gridDate_ === 'function' ? gridDate_(v) : null) || (v ? new Date(String(v).replace(' ', 'T')) : null);
  return d && !isNaN(d.getTime()) ? d : null;
}
function fin_budgetItems_(year) {
  var items = claim_getObjects_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RPT_SHEET_BUDGET_)).filter(function(r) { return Number(r['年份']) === Number(year); });
  items.sort(function(a, b) { return fin_num_(a['排序']) - fin_num_(b['排序']); });
  return items.map(function(r) { return { type: String(r['类型']), item: String(r['项目'] || '').trim(), desc: String(r['说明'] || ''), budget: r['预算'] === '' ? '' : fin_num_(r['预算']) }; });
}

function getFinanceData(token, year) {
  try {
    var s = fin_requireRole_(token, false);
    fin_ensure_();
    year = Number(year) || term_currentYear_();
    var all = claim_getObjects_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName('财政'));
    var txns = all.filter(function(t) { var d = fin_date_(t['交易日期']); return d && d.getFullYear() === year; });
    txns.sort(function(a, b) { return String(b['交易日期']).localeCompare(String(a['交易日期'])); });
    var now = new Date();
    var month = year === now.getFullYear() ? now.getMonth() + 1 : 12;
    var rep = fin_computeReport_(year, month);
    var sigs = fin_signatures_();
    return {
      success: true, year: year, month: month, role: s.role, canWrite: !s.readOnly,
      txns: txns, budget: fin_budgetItems_(year), summary: rep,
      groups: MIN_GROUPS.slice(), accounts: RPT_FIN_ACCOUNTS_.slice(),
      mySignature: !!sigs[String(s.email || '').toLowerCase()]
    };
  } catch (err) { return { success: false, message: err.message }; }
}

function saveFinanceTxn(token, data) {
  try {
    var s = fin_requireRole_(token, true);
    var f = fin_ensure_();
    data = data || {};
    var type = String(data.type || '');
    if (['收入', '支出', '转账'].indexOf(type) === -1) throw new Error('类型不正确。');
    var amt = fin_num_(data.amount);
    if (!(amt > 0)) throw new Error('请填写金额。');
    if (!data.date) throw new Error('请填写日期。');
    var acct = String(data.account || '');
    if (RPT_FIN_ACCOUNTS_.indexOf(acct) === -1) throw new Error('请选择账户。');
    var to = type === '转账' ? String(data.toAccount || '') : '';
    if (type === '转账' && (RPT_FIN_ACCOUNTS_.indexOf(to) === -1 || to === acct)) throw new Error('请选择转入的账户。');
    var cat = String(data.category || '').trim() || (type === '转账' ? '转账' : '其他');
    var obj = {
      '交易日期': parseDateInput_(data.date), '类型': type, '类别': cat, '组别': String(data.group || ''),
      '说明': String(data.description || '').slice(0, 300), '金额': amt, '账户': acct, '转入账户': to,
      '备注': String(data.remark || ''), '记录人': s.name + '（' + s.role + '）'
    };
    if (data.id) {
      var row = claim_findRow_(f.fin, '交易编号', data.id);
      if (row < 2) throw new Error('找不到这笔交易。');
      var cur = claim_getObjectByRow_(f.fin, row, claim_getHeaders_(f.fin));
      if (/^(CLM|OFF)-/.test(String(cur['参考编号'] || '')) && fin_num_(cur['金额']) !== amt) throw new Error('这笔是 Claim / 奉献自动产生的，金额请在原本的记录修改。');
      obj['交易编号'] = data.id;
      admin_saveRecord_('财政', '交易编号', 'FIN', obj);
    } else {
      obj['建立时间'] = new Date();
      data.id = admin_saveRecord_('财政', '交易编号', 'FIN', obj);
    }
    writeLog_(token, '财政记录', '财政', data.id, type + ' ' + cat + ' RM' + amt);
    return { success: true, id: data.id, message: '已保存。' };
  } catch (err) { return { success: false, message: err.message }; }
}
function deleteFinanceTxn(token, id) {
  try {
    fin_requireRole_(token, true);
    var f = fin_ensure_();
    var row = claim_findRow_(f.fin, '交易编号', id);
    if (row < 2) throw new Error('找不到这笔交易。');
    var cur = claim_getObjectByRow_(f.fin, row, claim_getHeaders_(f.fin));
    if (/^CLM-/.test(String(cur['参考编号'] || ''))) throw new Error('这笔是 Claim 批准后产生的，不能在这里删除。');
    f.fin.deleteRow(row);
    invalidateSheetCache_(f.fin);
    writeLog_(token, '删除财政记录', '财政', id, String(cur['说明'] || ''));
    return { success: true };
  } catch (err) { return { success: false, message: err.message }; }
}
function saveFinanceBudget(token, year, items) {
  var lock = LockService.getScriptLock();
  try {
    fin_requireRole_(token, true);
    var f = fin_ensure_();
    year = Number(year);
    lock.waitLock(15000);
    var sh = f.budget;
    var vals = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues() : [];
    var keep = vals.filter(function(r) { return Number(r[1]) !== year && String(r[0]); });
    var rows = (items || []).filter(function(it) { return String(it.item || '').trim(); }).map(function(it, i) {
      return ['BUD-' + year + '-' + String(i + 1).padStart(3, '0'), year, it.type === '支出' ? '支出' : '收入', String(it.item).trim(), String(it.desc || ''), it.budget === '' || it.budget == null ? '' : fin_num_(it.budget), i + 1];
    });
    var all = keep.concat(rows);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 7).clearContent();
    if (all.length) sh.getRange(2, 1, all.length, 7).setValues(all);
    invalidateSheetCache_(sh);
    writeLog_(token, '保存预算', RPT_SHEET_BUDGET_, String(year), rows.length + ' 项');
    return { success: true, message: '预算已保存。' };
  } catch (err) { return { success: false, message: err.message }; }
  finally { try { lock.releaseLock(); } catch (e) {} }
}

/** 计算「一月至 X 月」财政报告 */
function fin_computeReport_(year, month) {
  fin_ensure_();
  year = Number(year); month = Math.min(12, Math.max(1, Number(month) || 12));
  var end = new Date(year, month, 1).getTime();
  var start = new Date(year, 0, 1).getTime();
  var budget = fin_budgetItems_(year);
  var incItems = budget.filter(function(b) { return b.type === '收入'; });
  var expItems = budget.filter(function(b) { return b.type === '支出'; });
  var incAct = {}, expAct = {}, bal = { '奉献在手': 0, '现金': 0, '银行': 0 };
  var others = [], opening = 0;
  var expNames = expItems.map(function(b) { return b.item; });
  var incNames = incItems.map(function(b) { return b.item; });
  claim_getObjects_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName('财政')).forEach(function(t) {
    var d = fin_date_(t['交易日期']); if (!d) return;
    var ts = d.getTime(); if (ts >= end || ts < start) return;
    var amt = fin_num_(t['金额']);
    var type = String(t['类型'] || ''), cat = String(t['类别'] || '').trim(), grp = String(t['组别'] || '').trim();
    var acct = String(t['账户'] || '') || (type === '收入' && cat === '奉献' ? '奉献在手' : '现金');
    if (bal[acct] == null) bal[acct] = 0;
    if (type === '收入') {
      bal[acct] += amt;
      if (cat === '上年余额') { opening += amt; return; }
      var key = incNames.indexOf(cat) !== -1 ? cat : (cat && cat !== '其他' ? cat : '其他');
      incAct[key] = (incAct[key] || 0) + amt;
      if (key === '其他') others.push({ desc: String(t['说明'] || cat), amount: amt });
    } else if (type === '支出') {
      bal[acct] -= amt;
      var k2 = expNames.indexOf(cat) !== -1 ? cat : (expNames.indexOf(grp) !== -1 ? grp : '其他');
      expAct[k2] = (expAct[k2] || 0) + amt;
    } else if (type === '转账') {
      var to = String(t['转入账户'] || '');
      bal[acct] -= amt;
      if (bal[to] == null) bal[to] = 0;
      bal[to] += amt;
    }
  });
  var r2 = function(n) { return Math.round(n * 100) / 100; };
  var income = [{ label: (year - 1) + '年余额', budget: '', actual: r2(opening), opening: true }];
  incItems.forEach(function(b) { income.push({ label: b.item + (b.desc || ''), budget: b.budget, actual: r2(incAct[b.item] || 0) }); delete incAct[b.item]; });
  Object.keys(incAct).filter(function(k) { return k !== '其他'; }).forEach(function(k) { income.push({ label: k, budget: '-', actual: r2(incAct[k]) }); });
  if (incNames.indexOf('其他') === -1) income.push({ label: '其他', budget: '-', actual: r2(incAct['其他'] || 0) });
  var expense = [];
  expItems.forEach(function(b) { expense.push({ label: b.item + (b.desc || ''), budget: b.budget, actual: r2(expAct[b.item] || 0) }); });
  if (expNames.indexOf('其他') === -1 && expAct['其他']) expense.push({ label: '其他', budget: '-', actual: r2(expAct['其他']) });
  var sum = function(arr, k) { return r2(arr.reduce(function(a, x) { return a + (x[k] === '' || x[k] === '-' ? 0 : Number(x[k] || 0)); }, 0)); };
  var staff = rptStaffByRole_(year);
  return {
    year: year, month: month,
    title: year + '年播恩堂青年团契一月至' + rptCn_(month) + '月财政报告',
    income: income, expense: expense,
    balances: { '奉献在手': r2(bal['奉献在手'] || 0), '现金在手': r2(bal['现金'] || 0), '银行存款': r2(bal['银行'] || 0) },
    incomeBudget: sum(income, 'budget'), incomeTotal: sum(income, 'actual'),
    expenseBudget: sum(expense, 'budget'), expenseTotal: sum(expense, 'actual'),
    others: others, treasurer: staff.roles['财政'] || '', auditor: staff.roles['查账'] || ''
  };
}

/** 财政报告的 Word XML（跟样本一样：左收入、右支出） */
function fin_reportXml_(r, images, sigBlobs) {
  var F = { font: 'Times New Roman', fontCjk: 'SimSun', sz: 20 };
  var run = function(t, b) { return rptRun_(t, { font: F.font, fontCjk: F.fontCjk, sz: F.sz, b: !!b }); };
  var P = function(t, jc, b) { return rptPara_(run(t, b), { jc: jc || 'left', sz: F.sz }); };
  var W = [2900, 1150, 1150, 2800, 1150, 1150];
  var mid = rptBorderSet_(['left']);
  var x = rptPara_(rptRun_(r.title, { font: F.font, fontCjk: F.fontCjk, sz: 22, b: true, u: true }), { jc: 'center', after: 160 });
  var rows = '';
  rows += '<w:tr>' + rptTc_(W[0] + W[1] + W[2], P('收入', 'center', true), { span: 3 }) + rptTc_(W[3] + W[4] + W[5], P('支出', 'center', true), { span: 3, borders: mid }) + '</w:tr>';
  var bottom = rptBorderSet_(['bottom']);
  rows += '<w:tr>' + ['事项', '预算', '实际'].map(function(h, i) { return rptTc_(W[i], P(h, 'center', true), { borders: bottom }); }).join('') +
    ['事项', '预算', '实际'].map(function(h, i) { return rptTc_(W[i + 3], P(h, 'center', true), { borders: bottom + (i === 0 ? mid : '') }); }).join('') + '</w:tr>';
  var right = r.expense.slice();
  right.push({ label: '', budget: '', actual: '', blank: true });
  right.push({ label: '奉献在手', budget: '', actual: r.balances['奉献在手'] || '', bal: true });
  right.push({ label: '现金在手', budget: '', actual: r.balances['现金在手'], bal: true });
  right.push({ label: '银行存款', budget: '', actual: r.balances['银行存款'], bal: true });
  var n = Math.max(r.income.length, right.length);
  var fmtB = function(v) { return v === '-' ? '-' : (v === '' || v == null ? '' : rptMoney_(v, true)); };
  var fmtA = function(it) { if (!it || it.blank) return ''; if (it.bal) return it.actual ? rptMoney_(it.actual) : ''; return rptMoney_(it.actual, true); };
  for (var i = 0; i < n; i++) {
    var a = r.income[i], b = right[i];
    rows += '<w:tr>' +
      rptTc_(W[0], P(a ? a.label : '')) + rptTc_(W[1], P(a ? fmtB(a.budget) : '', 'right')) + rptTc_(W[2], P(a ? fmtA(a) : '', 'right')) +
      rptTc_(W[3], P(b ? b.label : ''), { borders: mid }) + rptTc_(W[4], P(b ? fmtB(b.budget) : '', 'right')) + rptTc_(W[5], P(b ? fmtA(b) : '', 'right')) + '</w:tr>';
  }
  var expTotal = Math.round((r.expenseTotal + r.balances['奉献在手'] + r.balances['现金在手'] + r.balances['银行存款']) * 100) / 100;
  var top = rptBorderSet_(['top']);
  rows += '<w:tr>' + rptTc_(W[0], P('')) + rptTc_(W[1], P(rptMoney_(r.incomeBudget), 'right', true), { borders: top }) + rptTc_(W[2], P(rptMoney_(r.incomeTotal), 'right', true), { borders: top }) +
    rptTc_(W[3], P(''), { borders: mid }) + rptTc_(W[4], P(rptMoney_(r.expenseBudget), 'right', true), { borders: top }) + rptTc_(W[5], P(rptMoney_(expTotal), 'right', true), { borders: top }) + '</w:tr>';
  x += rptTable_(W, rows, { jc: 'center', pad: 80, borders: rptBorderSet_(['top', 'left', 'bottom', 'right']) + rptNoBorder_(['insideH', 'insideV']) });
  x += rptPara_('', { after: 120 });
  if (r.others && r.others.length) {
    x += P('其他：');
    r.others.forEach(function(o) { x += rptPara_(run(o.desc, true) + run('\t' + rptMoney_(o.amount), true), { tabs: [{ pos: 4200, val: 'right' }] }); });
  }
  x += rptPara_('', { after: 200 });
  sigBlobs = sigBlobs || {};
  var cell = function(label, name, key) {
    var inner = rptPara_(run(label + '：' + (name || ''), true), { jc: 'center', after: 60 });
    var blob = sigBlobs[key];
    if (blob) {
      var rid = 'rIdSig' + (images.length + 1);
      images.push({ rid: rid, blob: blob });
      inner += rptPara_(rptImageRun_(rid, 100 + images.length, 1463040, 731520), { jc: 'center' });
    } else inner += rptPara_('', { after: 600 });
    return inner;
  };
  x += rptTable_([4600, 4600], '<w:tr>' + rptTc_(4600, cell('财政', r.treasurer, 'treasurer')) + rptTc_(4600, cell('查账', r.auditor, 'auditor')) + '</w:tr>',
    { jc: 'center', borders: rptNoBorder_(['top', 'left', 'bottom', 'right', 'insideH', 'insideV']) });
  return x;
}

function generateFinanceReport(token, year, month, formats, sigs) {
  try {
    var s = fin_requireRole_(token, false);
    year = Number(year); month = Number(month);
    var r = fin_computeReport_(year, month);
    // 签名：生成报告时在报告下面签。签了就记住这一期的签名（议案里的财政报告也会用到）。
    var blobs = fin_loadSigs_(year, month);
    if (sigs && !s.readOnly) {
      ['treasurer', 'auditor'].forEach(function(k) {
        if (sigs[k] === undefined) return;
        blobs[k] = fin_storeSig_(year, month, k, sigs[k]);
      });
    }
    var images = [];
    var body = fin_reportXml_(r, images, blobs);
    var out = rptOutput_(body, images, r.title, formats);
    out.kind = 'finance'; out.year = year; out.month = month;
    return out;
  } catch (err) { return { success: false, message: err.message }; }
}
/* 每一期财政报告的签名（存在 Drive「播青｜签名」资料夹） */
function fin_sigFolder_() {
  return drive_folder_('播青｜签名');
}
function fin_sigName_(year, month, key) { return 'fin_' + year + '_' + String(month).padStart(2, '0') + '_' + key + '.png'; }
function fin_loadSigs_(year, month) {
  var out = {};
  // 先看快取（不用每次去 Drive 找档案）
  var cache = CacheService.getScriptCache(), key = 'BOQ_FINSIG_' + year + '_' + month;
  try {
    var c = cache.get(key);
    if (c) { var o = JSON.parse(c); Object.keys(o).forEach(function(k) { if (o[k]) out[k] = Utilities.newBlob(Utilities.base64Decode(o[k]), 'image/png', k + '.png'); }); return out; }
  } catch (e) {}
  try {
    var folder = fin_sigFolder_();
    ['treasurer', 'auditor'].forEach(function(k) {
      var it = folder.getFilesByName(fin_sigName_(year, month, k));
      if (it.hasNext()) out[k] = it.next().getBlob();
    });
    var store = {};
    Object.keys(out).forEach(function(k) { store[k] = Utilities.base64Encode(out[k].getBytes()); });
    var json = JSON.stringify(store);
    if (json.length < 90000) cache.put(key, json, 21600);
  } catch (e) {}
  return out;
}
function fin_storeSig_(year, month, key, dataUrl) {
  var folder = fin_sigFolder_();
  var it = folder.getFilesByName(fin_sigName_(year, month, key));
  while (it.hasNext()) it.next().setTrashed(true);
  CacheService.getScriptCache().remove('BOQ_FINSIG_' + year + '_' + month);
  if (!dataUrl) return null;
  var blob = Utilities.newBlob(Utilities.base64Decode(String(dataUrl).replace(/^.*,/, '')), 'image/png', fin_sigName_(year, month, key));
  folder.createFile(blob);
  return blob;
}
function getFinanceSignatures(token, year, month) {
  try {
    fin_requireRole_(token, false);
    var b = fin_loadSigs_(Number(year), Number(month)), out = {};
    Object.keys(b).forEach(function(k) { out[k] = 'data:image/png;base64,' + Utilities.base64Encode(b[k].getBytes()); });
    return { success: true, sigs: out };
  } catch (err) { return { success: false, message: err.message }; }
}

/* ============================================================
   十二、存档：生成后先过目，确定没问题才「存进 Drive」
   存进「播青｜会议记录」资料夹，并加进「议案与记录档案」，所有职员（包括以后的新职员）都看得到。
   ============================================================ */
function saveGeneratedToDrive(token, payload) {
  try {
    var s = requireAdminSession_(token);
    payload = payload || {};
    var kind = String(payload.kind || '');
    if (kind === 'finance') fin_requireRole_(token, true);
    else ministryRequireOfficeRole_(ministryRequireSession_(token));
    if (!payload.pdf && !payload.docx) throw new Error('没有档案可以保存，请先生成。');
    var title = String(payload.title || '报告').replace(/[\\/:*?"<>|]/g, '');
    var folder = drive_folder_('播青｜会议记录');
    var pdfUrl = '', docUrl = '';
    if (payload.pdf) {
      var pf = folder.createFile(Utilities.newBlob(Utilities.base64Decode(payload.pdf), 'application/pdf', title + '.pdf'));
      pf.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      pdfUrl = pf.getUrl();
    }
    if (payload.docx) {
      var df = folder.createFile(Utilities.newBlob(Utilities.base64Decode(payload.docx), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', title + '.docx'));
      df.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      docUrl = df.getUrl();
    }
    var typeName = kind === 'motion' ? '会议议案' : kind === 'finance' ? '财政报告' : '会议报告';
    var date = new Date();
    if (kind !== 'finance' && payload.year && payload.meetingNo) {
      var m = rptMeetingRow_(Number(payload.year), Number(payload.meetingNo));
      if (m.obj['会议日期']) date = fin_date_(m.obj['会议日期']) || date;
      claim_setValue_(m.sheet, m.row, '状态', '报告已生成');
      claim_setValue_(m.sheet, m.row, '生成时间', new Date());
      if (pdfUrl) claim_setValue_(m.sheet, m.row, '报告PDF链接', pdfUrl);
      if (docUrl) claim_setValue_(m.sheet, m.row, '报告Doc链接', docUrl);
    }
    var rec = ensureTab_('会议记录', ['记录编号', '会议日期', '会议名称', '档案类型', '档案链接', '建立时间']);
    ensureHeaders_(rec, ['Word链接', '保存人']);
    admin_saveRecord_('会议记录', '记录编号', 'MTG', {
      '会议日期': date, '会议名称': title, '档案类型': typeName,
      '档案链接': pdfUrl || docUrl, 'Word链接': docUrl, '保存人': s.name + '（' + s.role + '）'
    });
    writeLog_(token, '存档 ' + typeName, '会议记录', title, pdfUrl || docUrl);
    return { success: true, message: '已存进 Drive，所有职员都可以在「议案与记录档案」看到。', pdfUrl: pdfUrl, docUrl: docUrl };
  } catch (err) { return { success: false, message: err.message }; }
}
/** 文书预览议案时看财政报告（只读） */
function getFinanceReportPreviewForMeeting(token, year, month) {
  try { ministryRequireOfficeRole_(ministryRequireSession_(token)); return { success: true, report: fin_computeReport_(Number(year), Number(month)) }; }
  catch (err) { return { success: false, message: err.message }; }
}
function getFinanceReportPreview(token, year, month) {
  try { fin_requireRole_(token, false); return { success: true, report: fin_computeReport_(Number(year), Number(month)) }; }
  catch (err) { return { success: false, message: err.message }; }
}

/* ---------- 签名（财政 / 查账在系统里签，存成 PNG） ---------- */
function fin_signatures_() {
  var map = {};
  try {
    var u = auth_readUsers_();
    u.users.forEach(function(r) { var e = String(r['邮箱'] || '').trim().toLowerCase(); var f = String(r['签名文件ID'] || '').trim(); if (e && f) map[e] = f; });
  } catch (e) {}
  return map;
}
function fin_emailByName_(name) {
  name = String(name || '').trim(); if (!name) return '';
  var u = auth_readUsers_();
  for (var i = 0; i < u.users.length; i++) if (String(u.users[i]['人名'] || '').trim() === name) return String(u.users[i]['邮箱'] || '').trim().toLowerCase();
  return '';
}
function saveMySignature(token, dataUrl) {
  try {
    var s = requireAdminSession_(token);
    var u = auth_readUsers_();
    var headers = ensureHeaders_(u.sheet, ['签名文件ID']);
    var me = auth_findByEmail_(u.users, s.email);
    if (!me) throw new Error('找不到你的账号。');
    var folder = drive_folder_('播青｜签名');
    if (me['签名文件ID']) { try { DriveApp.getFileById(String(me['签名文件ID'])).setTrashed(true); } catch (e) {} }
    var id = '';
    if (dataUrl) {
      var blob = Utilities.newBlob(Utilities.base64Decode(String(dataUrl).replace(/^.*,/, '')), 'image/png', 'signature_' + (me['用户编号'] || s.name) + '.png');
      id = folder.createFile(blob).getId();
    }
    auth_setCells_(u.sheet, headers, me._row, { '签名文件ID': id });
    writeLog_(token, id ? '保存签名' : '删除签名', '用户', String(me['用户编号'] || ''), s.name);
    return { success: true, message: id ? '签名已保存，财政报告会自动放进去。' : '签名已删除。' };
  } catch (err) { return { success: false, message: err.message }; }
}
function getMySignature(token) {
  try {
    var s = requireAnySession_(token);
    var f = fin_signatures_()[String(s.email || '').toLowerCase()];
    if (!f) return { success: true, dataUrl: '' };
    return { success: true, dataUrl: 'data:image/png;base64,' + Utilities.base64Encode(DriveApp.getFileById(f).getBlob().getBytes()) };
  } catch (err) { return { success: false, message: err.message }; }
}

