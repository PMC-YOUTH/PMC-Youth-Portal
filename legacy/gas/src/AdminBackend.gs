/**
 * ============================================================
 * 播青｜AdminBackend.gs (修复入会状态栏位冲突)
 * ============================================================
 */
/**
 * 登入：Email + 密码（密码以加盐 SHA-256 储存，不保存明码）。
 * 账号须由管理员批准后才能登入；权限依照「职员任期」的当届任期决定。
 */
function adminLogin(loginId, password) {
  try {
    var email = String(loginId || '').trim().toLowerCase();
    password = String(password || '');
    if (!email || !password) return { success: false, message: '请输入 Email 和密码。' };

    var cache = CacheService.getScriptCache();
    var failKey = 'BOQ_LOGINFAIL_' + Utilities.base64EncodeWebSafe(Utilities.newBlob(email).getBytes());
    var fails = Number(cache.get(failKey) || 0);
    if (fails >= 8) return { success: false, message: '尝试次数太多，请 15 分钟后再试。' };

    var u = auth_readUsers_();
    var user = auth_findByEmail_(u.users, email);
    if (!user || !user['密码哈希'] || auth_hash_(password, String(user['密码盐'] || '')) !== String(user['密码哈希'])) {
      cache.put(failKey, String(fails + 1), 900);
      return { success: false, message: 'Email 或密码不正确。' };
    }
    cache.remove(failKey);

    var status = String(user['状态'] || '').trim().toUpperCase();
    if (status === 'PENDING') return { success: false, message: '你的账号还在等待管理员或主席批准，批准后会以 Email 通知你。' };
    if (status !== 'ACTIVE') return { success: false, message: '这个账号目前未启用，请联系管理员。' };

    var session = auth_buildSession_(user, term_read_().terms);
    var token = Utilities.getUuid();
    cache.put('BOQ_SESSION_' + token, JSON.stringify(session), 21600);
    try { auth_setCells_(u.sheet, u.headers, user._row, { '最后登录': new Date() }); } catch (ignore) {}

    return { success: true, token: token, user: session, message: '登录成功。' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function adminLogout(token) { if (token) CacheService.getScriptCache().remove('BOQ_SESSION_' + String(token)); return { success: true }; }
/** 任何已登入的人（包括卸任、只能查看的人）。 */
function requireAnySession_(token) {
  if (!token || typeof token !== 'string') throw new Error('登录已过期，请重新登录。');
  var cache = CacheService.getScriptCache();
  var raw = cache.get('BOQ_SESSION_' + String(token));
  if (!raw) throw new Error('登录已过期，请重新登录。');
  var s;
  try { s = JSON.parse(raw); } catch (e) { throw new Error('登录已过期，请重新登录。'); }
  var keys = ['BOQ_SESSION_EPOCH'];
  if (s.userId) keys.push('BOQ_REVOKE_' + s.userId);
  var flags = cache.getAll(keys);
  var cut = Math.max(Number(flags['BOQ_SESSION_EPOCH'] || 0), Number(flags['BOQ_REVOKE_' + s.userId] || 0));
  if (cut && Number(s.loginTime || 0) < cut) {
    cache.remove('BOQ_SESSION_' + String(token));
    throw new Error('登录已过期，请重新登录（你的任期或权限有更新）。');
  }
  return s;
}
/** 可以修改资料的人：必须有当届任期（或是系统管理员）。 */
function requireAdminSession_(token) {
  var s = requireAnySession_(token);
  if (s.readOnly) throw new Error('你目前没有当届任期，只能查看以前的资料。');
  return s;
}
function getAdminSession(token) { try { var s = requireAnySession_(token); return { success: true, user: s, perms: perm_summary_(s) }; } catch (err) { return { success: false }; } }

/** 只读取登入资料，不抛错（给操作记录用）。 */
function auth_peekSession_(token) {
  try { return requireAnySession_(token); } catch (e) { return null; }
}

/* ============================================================
   权限（全部在后端检查，不靠前端隐藏按钮）
   ------------------------------------------------------------
   管理员   ：职位是管理员，或系统管理员（「切换身份」时依所选身份计算）
   行政组   ：管理员、主席、副主席、文书、财政、查账，或组别是行政组
   财政     ：管理员、财政、查账
   契友备注 ：只有 MEMBER_PRIVATE_ROLES_ 看得到、改得到
   ============================================================ */
var MEMBER_PRIVATE_FIELDS_ = ['备注'];
var MEMBER_PRIVATE_ROLES_ = ['管理员', '主席', '副主席', '文书'];
var FEEDBACK_PRIVATE_FIELDS_ = ['联络方式'];
/** 只有行政组可以改的节目栏位（其他组要改日期请用「申请交换节目」）。 */
var EVENT_EXEC_FIELDS_ = ['日期', '负责组', '状态', '公开显示'];

function perm_isAdmin_(s) { return !!(s && !s.readOnly && (s.role === '管理员' || (s.isSysAdmin && !s.viewAs))); }
function perm_isExec_(s) {
  if (!s || s.readOnly) return false;
  if (perm_isAdmin_(s)) return true;
  if (EXEC_ROLES_.indexOf(String(s.role || '')) !== -1) return true;
  return ['行政组', '文书', '财政', '查账'].indexOf(ministryNormalizeGroup_(s.group)) !== -1;
}
function perm_isFinance_(s) { return !!(s && !s.readOnly && (perm_isAdmin_(s) || ['财政', '查账'].indexOf(String(s.role || '')) !== -1)); }
function perm_canSeeMemberPrivate_(s) { return !!(s && !s.readOnly && (perm_isAdmin_(s) || MEMBER_PRIVATE_ROLES_.indexOf(String(s.role || '')) !== -1)); }
function perm_canEditEvent_(s, ev) {
  if (!s || s.readOnly) return false;
  if (perm_isExec_(s)) return true;
  return !!(ev && swap_inGroup_(s, ev['负责组']));
}
function perm_requireEventEdit_(s, ev) {
  if (!perm_canEditEvent_(s, ev)) throw new Error('你只能修改自己组负责的节目。');
}
function perm_stripFields_(rows, fields) {
  return (rows || []).map(function(r) {
    var o = {};
    Object.keys(r).forEach(function(k) { if (fields.indexOf(k) === -1) o[k] = r[k]; });
    return o;
  });
}
/** 前端用来决定显示哪些按钮（后端每个 API 仍会再检查一次）。 */
function perm_summary_(s) {
  return { admin: perm_isAdmin_(s), exec: perm_isExec_(s), finance: perm_isFinance_(s), memberPrivate: perm_canSeeMemberPrivate_(s), staff: !!(s && !s.readOnly) };
}

/* ============================================================
   Drive 储存位置
   ------------------------------------------------------------
   所有上传的档案（会议记录、收据、网站照片、签名、事工会议报告）
   都放在「播青系统」总资料夹下面的子资料夹。
   总资料夹的 ID 存在 Script Properties：DRIVE_ROOT_FOLDER_ID
   - 第一次在编辑器运行 setupDriveRoot() 会自动建立并记下 ID；
   - 也可以手动把共享云端硬盘（Shared Drive）里某个资料夹的 ID 填进去。
   没有设定时，会退回旧做法：直接放在运行账号的「我的云端硬盘」。
   ============================================================ */
var DRIVE_ROOT_PROP_ = 'DRIVE_ROOT_FOLDER_ID';
var DRIVE_ROOT_NAME_ = '播青系统';
var DRIVE_SUBFOLDERS_ = ['播青｜会议记录', '播青｜网站照片', '播青｜职员报销收据', '播青｜签名', '播青｜事工会议报告'];
var __driveRoot_ = undefined;
var __driveFolders_ = {};

function drive_root_() {
  if (__driveRoot_ !== undefined) return __driveRoot_;
  __driveRoot_ = null;
  var id = '';
  try { id = String(PropertiesService.getScriptProperties().getProperty(DRIVE_ROOT_PROP_) || '').trim(); } catch (e) {}
  if (id) {
    try { __driveRoot_ = DriveApp.getFolderById(id); }
    catch (err) { console.log('DRIVE_ROOT_FOLDER_ID 打不开（' + err.message + '），先放在我的云端硬盘。'); }
  }
  return __driveRoot_;
}

/** 取得（没有就建立）总资料夹下的子资料夹。 */
function drive_folder_(name) {
  if (__driveFolders_[name]) return __driveFolders_[name];
  var root = drive_root_();
  var it = root ? root.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  var folder = it.hasNext() ? it.next() : (root ? root.createFolder(name) : DriveApp.createFolder(name));
  __driveFolders_[name] = folder;
  return folder;
}

/** 在编辑器手动运行一次：建立「播青系统」总资料夹和全部子资料夹，并记下 ID。 */
function setupDriveRoot() {
  editorOnly_();
  var props = PropertiesService.getScriptProperties();
  var id = String(props.getProperty(DRIVE_ROOT_PROP_) || '').trim();
  var root = null;
  if (id) { try { root = DriveApp.getFolderById(id); } catch (e) { root = null; } }
  if (!root) {
    var it = DriveApp.getFoldersByName(DRIVE_ROOT_NAME_);
    root = it.hasNext() ? it.next() : DriveApp.createFolder(DRIVE_ROOT_NAME_);
    props.setProperty(DRIVE_ROOT_PROP_, root.getId());
  }
  __driveRoot_ = root; __driveFolders_ = {};
  DRIVE_SUBFOLDERS_.forEach(drive_folder_);
  var msg = 'Drive 总资料夹：' + root.getName() + '\n' + root.getUrl() + '\nID：' + root.getId();
  console.log(msg);
  return msg;
}

/* ============================================================
   Email 测试（在编辑器手动运行）
   会寄一封测试信给运行这个项目的账号，检查：寄信授权、寄件名称、
   今日剩余额度、信里「打开播青后台」的链接。
   ============================================================ */
function testEmail() {
  editorOnly_();
  var me = Session.getEffectiveUser().getEmail();
  var before = MailApp.getRemainingDailyQuota();
  var ok = notify_send_([me], [], '测试信', [
    '这是播青后台的测试信。收到就表示寄信功能正常。', '',
    '寄件账号：' + me,
    '今日剩余额度：' + before + ' 封',
    '后台链接：' + (notify_appUrl_() || '（还没部署 Web App，所以没有链接）')
  ]);
  var msg = (ok ? '已寄出测试信到 ' : '寄信失败，请看执行记录：') + me + '（剩余额度 ' + MailApp.getRemainingDailyQuota() + '）';
  console.log(msg);
  return msg;
}

/** 列出系统会寄的每一种通知（给测试用的检查表）。 */
function listEmailNotifications() {
  editorOnly_();
  var list = [
    '注册新账号 → 管理员、主席',
    '忘记密码 → 管理员；管理员重设后 → 本人（临时密码）',
    '申请任期 / 批准 / 拒绝 / 卸任 → 管理员、主席；本人',
    '提交 Claim → 财政、查账',
    'Claim 批准或拒绝 → 申请人（cc 查账）',
    'Claim 已付款 → 申请人；申请人确认收款 → 财政',
    '节目交换申请 → 行政组 + 对方负责组；批准 / 拒绝 → 申请人与相关人员',
    '事工组报告提交 → 文书',
    '会议截止提醒（每天 9 点触发器）→ 还没交报告的组'
  ];
  console.log(list.join('\n'));
  return list;
}

/** 维护功能只能在 Apps Script 编辑器里手动运行（从网页呼叫会被拒绝）。 */
function editorOnly_() {
  var active = '', owner = '';
  try {
    active = String(Session.getActiveUser().getEmail() || '').toLowerCase();
    owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  } catch (e) {}
  if (!active || active !== owner) throw new Error('这个功能只能在 Apps Script 编辑器里运行。');
}
/** 确认是真正的时间触发器在呼叫（triggerUid 必须是这个项目的触发器）。 */
function trigger_isReal_(e) {
  if (!e || !e.triggerUid) return false;
  try {
    return ScriptApp.getProjectTriggers().some(function(t) { return String(t.getUniqueId()) === String(e.triggerUid); });
  } catch (err) { return false; }
}

function ensureTab_(sheetName, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) { sheet = ss.insertSheet(sheetName); sheet.getRange(1, 1, 1, headers.length).setValues([headers]); }
  return sheet;
}

function getAdminEvents(token) {
  try {
    var evSession = requireAnySession_(token);
    if (!evSession.readOnly) member_autoAgeOut_();
    // 工作表结构检查很慢：6 小时内只检查一次（原本每次进入后台都检查）。
    if (!schemaCheckedRecently_('ADMIN')) {
    // 同时确保事工系统所需的工作表、用户组别栏位及四次会议骨架已建立。
    ministry_initAll_();
    ensureTab_('节目', ['节目编号', '日期', '节目名称', '主题', '地点', '讲员', '状态', '公开显示', '建立时间', '更新日期']);
    ensureTab_('事奉人员', ['排表编号', '节目编号', '日期', '事奉岗位', '契友姓名', '状态', '建立时间', '更新日期']);
    // 自动确保契友有入会状态栏位
    ensureTab_('契友', ['契友编号', '姓名', '电话号码', '职位', '入会状态', '小组', '状态', '建立时间', '更新日期']);
    ensureTab_('职员报销', ['报销编号', '申请人姓名', '报销日期', '节目编号', '报销说明', '类别', '组别', '金额', '收据链接', '状态', '财政同步', '审核人', '建立时间']);
    ensureTab_('财政', ['交易编号', '交易日期', '类型', '类别', '说明', '金额', '参考编号', '建立时间']);
    ensureTab_('会议记录', ['记录编号', '会议日期', '会议名称', '档案类型', '档案链接', '建立时间']);
    markSchemaChecked_('ADMIN');
    }
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var staff = !evSession.readOnly;
    // 按角色回传栏位：卸任 / 没有任期的人拿不到契友与意见箱；契友「备注」、意见箱「联络方式」只给有权限的人。
    var members = staff ? claim_getObjects_(ss.getSheetByName('契友')) : [];
    if (staff && !perm_canSeeMemberPrivate_(evSession)) members = perm_stripFields_(members, MEMBER_PRIVATE_FIELDS_);
    var feedback = staff ? claim_getObjects_(ss.getSheetByName('意见箱')) : [];
    if (staff && !perm_isExec_(evSession)) feedback = perm_stripFields_(feedback, FEEDBACK_PRIVATE_FIELDS_);
    return {
      success: true,
      events: claim_getObjects_(ss.getSheetByName('节目')),
      roster: claim_getObjects_(ss.getSheetByName('事奉人员')),
      members: members,
      claims: claim_listForSession_(evSession),
      meetings: claim_getObjects_(ss.getSheetByName('会议记录')),
      feedback: feedback,
      swaps: staff ? swap_list_(ss) : [],
      perms: perm_summary_(evSession),
      ageLimit: member_ageLimit_()
    };
  } catch (err) { return { success: false, message: err.message }; }
}
function uploadMeetingDoc(token, data, fileName, mimeType, base64Data) {
  try {
    requireAdminSession_(token);

    // 1. 在 Drive 建立专属资料夹并储存档案
    var folder = drive_folder_('播青｜会议记录');
    var blob = Utilities.newBlob(Utilities.base64Decode(String(base64Data).replace(/^.*,/, '')), mimeType, fileName);
    var file = folder.createFile(blob);
    
    // 设定权限为任何知道连结的人皆可查看
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var url = file.getUrl();

    // 2. 将连结与资讯存入 Sheet
    admin_saveRecord_('会议记录', '记录编号', 'MTG', {
      '会议日期': data.date,
      '会议名称': data.name,
      '档案类型': data.type,
      '档案链接': url
    });

    return { success: true, message: '会议档案已成功上传。' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function admin_saveRecord_(sheetName, idField, prefix, dataObj) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  var id = dataObj[idField] || claim_createId_(sheet, idField, prefix);
  dataObj[idField] = id;
  var row = claim_findRow_(sheet, idField, id);
  if (row === -1) {
    dataObj['建立时间'] = new Date(); dataObj['更新日期'] = new Date();
    claim_appendObject_(sheet, dataObj);
  } else {
    var existing = claim_getObjectByRow_(sheet, row, claim_getHeaders_(sheet));
    dataObj['建立时间'] = existing['建立时间'] || new Date(); dataObj['更新日期'] = new Date();
    var headers = claim_getHeaders_(sheet); var values = [];
    // 「年龄」由 Sheet 公式自动计算，写回时留空，避免盖掉公式
    headers.forEach(function(h) { values.push(h === '年龄' ? '' : (dataObj.hasOwnProperty(h) ? dataObj[h] : existing[h])); });
    sheet.getRange(row, 1, 1, headers.length).setValues([values]);
  }
  invalidateSheetCache_(sheet);
  return id;
}

/** 新增节目（只有行政组）。 */
function addAdminEvent(token, data) {
  data = data || {};
  data.eventId = '';
  return updateAdminEvent(token, data);
}

/**
 * 新增 / 修改节目。
 * 新增：只有行政组。修改：行政组，或这个节目的负责组。
 * 日期、负责组、状态、公开显示只有行政组可以改（其他组要换日期请用「申请交换节目」）。
 */
function updateAdminEvent(token, data) {
  var lock = LockService.getScriptLock();
  try {
    var s = requireAdminSession_(token);
    data = data || {};
    var exec = perm_isExec_(s);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('节目');
    var id = String(data.eventId || '').trim();
    if (!lock.tryLock(15000)) throw new Error('系统忙碌中，请稍后再试。');
    var rec = {};
    if (!id) {
      if (!exec) throw new Error('只有行政组可以新增节目。');
      if (!data.date) throw new Error('请填写日期。');
    } else {
      var row = claim_findRow_(sheet, '节目编号', id);
      if (row < 2) throw new Error('找不到这个节目。');
      perm_requireEventEdit_(s, claim_getObjectByRow_(sheet, row, claim_getHeaders_(sheet)));
      rec['节目编号'] = id;
    }
    var fields = {
      '节目名称': data.name, '地点': data.location, '领会': data.leader, '经节手册': data.verse,
      '领唱/助唱': data.singer, '司琴/吉他手': data.piano, '电脑控制员': data.computer, '招待员': data.usher
    };
    Object.keys(fields).forEach(function(k) { if (fields[k] !== undefined) rec[k] = String(fields[k] == null ? '' : fields[k]).trim().slice(0, 120); });
    if (exec) {
      if (data.date) rec['日期'] = new Date(data.date);
      if (data.group !== undefined) rec['负责组'] = String(data.group || '').trim().slice(0, 30);
      rec['状态'] = ['ACTIVE', '暂停', 'INACTIVE'].indexOf(String(data.status)) !== -1 ? String(data.status) : 'ACTIVE';
      rec['公开显示'] = String(data.publicDisplay) === '否' ? '否' : '是';
    }
    var newId = admin_saveRecord_('节目', '节目编号', 'EVT', rec);
    writeLog_(token, id ? '更新节目' : '新增节目', '节目', newId, rec['节目名称'] || '');
    return { success: true, eventId: newId };
  } catch (err) {
    return { success: false, message: err.message };
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}
/** 额外事奉岗位（音响、摄影等）：行政组，或这个节目的负责组。 */
function saveAdminRoster(token, data) {
  try {
    var s = requireAdminSession_(token);
    data = data || {};
    var ev = admin_eventById_(data.eventId);
    if (!ev) throw new Error('找不到这个节目。');
    perm_requireEventEdit_(s, ev);
    var role = String(data.role || '').trim().slice(0, 40), name = String(data.name || '').trim().slice(0, 60);
    if (!role || !name) throw new Error('请填写岗位和姓名。');
    var rec = { '节目编号': ev['节目编号'], '日期': ev['日期'] ? new Date(ev['日期']) : '', '事奉岗位': role, '契友姓名': name, '状态': 'ACTIVE' };
    if (data.rosterId) {
      var rs = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('事奉人员');
      var row = claim_findRow_(rs, '排表编号', data.rosterId);
      if (row < 2) throw new Error('找不到这笔事奉资料。');
      if (String(claim_getObjectByRow_(rs, row, claim_getHeaders_(rs))['节目编号']) !== String(ev['节目编号'])) throw new Error('资料不一致。');
      rec['排表编号'] = data.rosterId;
    }
    admin_saveRecord_('事奉人员', '排表编号', 'ROS', rec);
    return { success: true };
  } catch (err) { return { success: false, message: err.message }; }
}
function deleteAdminRoster(token, id) {
  try {
    var s = requireAdminSession_(token);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('事奉人员');
    var row = claim_findRow_(sheet, '排表编号', id);
    if (row < 2) throw new Error('找不到这笔事奉资料。');
    var r = claim_getObjectByRow_(sheet, row, claim_getHeaders_(sheet));
    perm_requireEventEdit_(s, admin_eventById_(r['节目编号']) || {});
    claim_setValue_(sheet, row, '状态', 'INACTIVE');
    claim_setValue_(sheet, row, '更新日期', new Date());
    return { success: true };
  } catch (err) { return { success: false, message: err.message }; }
}
function admin_eventById_(id) {
  if (!id) return null;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('节目');
  var row = claim_findRow_(sheet, '节目编号', id);
  return row < 2 ? null : claim_getObjectByRow_(sheet, row, claim_getHeaders_(sheet));
}

// 【修复重点】将契友的入会数据存入「入会状态」，不再覆盖「职位」
function member_phone_(p) {
  var s = String(p || '').trim();
  var d = s.replace(/\D/g, '');
  if (/^0?1\d{8,9}$/.test(d)) {
    if (d.charAt(0) !== '0') d = '0' + d;
    return d.slice(0, 3) + '-' + d.slice(3);
  }
  return s;
}

/** 契友资料：华文姓名、英文名、电话、性别、生日、小组、入会状态、活跃 / 不活跃（原因）、需要关心、备注 */
function saveAdminMember(token, data) {
  try {
    var s = requireAdminSession_(token);
    data = data || {};
    if (!String(data.name || '').trim()) throw new Error('华文姓名必填。');
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('契友');
    ensureHeaders_(sheet, ['英文名', '状态原因', '需要关心']);
    var active = data.active !== false;
    if (data.memberId && claim_findRow_(sheet, '契友编号', data.memberId) < 2) throw new Error('找不到这位契友。');
    var rec = {
      '契友编号': data.memberId,
      '姓名': String(data.name).trim(),
      '英文名': String(data.englishName || '').trim(),
      '称呼': String(data.name).trim(),
      '电话号码': member_phone_(data.phone),
      '性别': data.gender || '',
      '生日': data.birthday ? new Date(data.birthday + 'T00:00:00') : '',
      '小组': data.group || '',
      '入会状态': data.status || '未入会',
      '状态': active ? 'ACTIVE' : 'INACTIVE',
      '状态原因': active ? '' : String(data.reason || '').slice(0, 60),
      '需要关心': data.care ? '是' : ''
    };
    // 「备注」只有有权限的人可以看和改；其他人保存时保留原本的备注。
    if (perm_canSeeMemberPrivate_(s)) rec['备注'] = String(data.remark || '').slice(0, 500);
    admin_saveRecord_('契友', '契友编号', 'CY', rec);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}


/** 超过「契友年龄上限」（例如满 31 岁）的活跃契友，自动改成不活跃（原因：超龄）。只有需要时才会写入。 */
function member_autoAgeOut_() {
  try {
    var limit = member_ageLimit_();
    if (!limit) return 0;
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('契友');
    if (!sheet || sheet.getLastRow() < 2) return 0;
    var headers = claim_getHeaders_(sheet);
    var cId = headers.indexOf('契友编号'), cBd = headers.indexOf('生日'), cSt = headers.indexOf('状态');
    if (cBd < 0 || cSt < 0) return 0;
    var cache = CacheService.getScriptCache();
    var dayKey = 'BOQ_AGEOUT_' + Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyyyMMdd');
    if (cache.get(dayKey)) return 0; // 每天检查一次就够
    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
    var today = new Date(), count = 0;
    values.forEach(function(row, i) {
      var bd = row[cBd];
      if (Object.prototype.toString.call(bd) !== '[object Date]' || !row[cId]) return;
      if (String(row[cSt] || 'ACTIVE').toUpperCase() === 'INACTIVE') return;
      var age = today.getFullYear() - bd.getFullYear();
      if (today.getMonth() < bd.getMonth() || (today.getMonth() === bd.getMonth() && today.getDate() < bd.getDate())) age--;
      if (age > limit) {
        claim_setValue_(sheet, i + 2, '状态', 'INACTIVE');
        claim_setValue_(sheet, i + 2, '状态原因', '超龄');
        count++;
      }
    });
    cache.put(dayKey, '1', 21600);
    return count;
  } catch (err) {
    console.log('自动超龄检查失败：' + err.message);
    return 0;
  }
}

function member_ageLimit_() {
  var limit = 0;
  try {
    getSheetObjects_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SETTINGS)).forEach(function(item) {
      if (String(item['设置项目'] || '').trim() === '契友年龄上限') limit = Number(item['设置内容']) || 0;
    });
  } catch (e) {}
  return limit;
}

/** 依角色回传 Claim：财政 / 查账 / 管理员看全部；其他人看自己和自己组的；卸任只看自己的。 */
function claim_listForSession_(session) {
  var objects = claim_getObjects_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName('职员报销'));
  var email = String(session.email || '').toLowerCase();
  var own = function(item) {
    return (email && String(item['申请人邮箱'] || '').toLowerCase() === email) || String(item['申请人姓名'] || '') === session.name;
  };
  if (session.readOnly) return objects.filter(own);
  if (perm_isFinance_(session)) return objects;
  return objects.filter(function(item) {
    return own(item) || (session.group && (String(item['组别'] || '') === session.group || String(item['申请人姓名'] || '') === session.group));
  });
}
function claim_isMine_(s, c) {
  return !!((s.email && String(c['申请人邮箱'] || '').toLowerCase() === String(s.email).toLowerCase()) || (s.name && String(c['申请人姓名'] || '') === s.name));
}

function submitClaim(token, claimData) {
  try {
    var session = requireAdminSession_(token);
    var sheet = ensureTab_('职员报销', ['报销编号', '申请人姓名', '报销日期', '节目编号', '报销说明', '类别', '组别', '金额', '收据链接', '状态', '财政同步', '审核人', '建立时间']);
    ensureHeaders_(sheet, ['审核备注', '申请人邮箱']);
    var id = admin_saveRecord_('职员报销', '报销编号', 'CLM', {
      '申请人姓名': session.name, '申请人邮箱': session.email || '', '报销日期': claimData.date, '节目编号': claimData.eventId,
      '报销说明': claimData.description, '类别': claimData.category, '组别': claimData.group, '金额': claimData.amount,
      '收据链接': claimData.receiptUrl, '状态': 'PENDING', '财政同步': '否'
    });

    // Email 通知财政，cc 查账
    try {
      notify_send_(notify_emailsByRole_(['财政']), notify_emailsByRole_(['查账']),
        '新的 Claim 等待审核：' + session.name + ' RM' + claimData.amount,
        ['有一张新的 Claim 等待财政审核。', '',
         '编号：' + id,
         '申请人：' + session.name + (session.group ? '（' + session.group + '）' : ''),
         '日期：' + (claimData.date || ''),
         '组别：' + (claimData.group || ''),
         '类别：' + (claimData.category || ''),
         '金额：RM' + claimData.amount,
         '说明：' + (claimData.description || '')].concat(claimData.receiptUrl ? ['收据：' + claimData.receiptUrl] : []));
    } catch (mailErr) { console.log('Claim 通知失败：' + mailErr.message); }

    return { success: true, message: '报销已提交，财政会收到 Email 通知。' };
  } catch (err) { return { success: false, message: err.message }; }
}

/**
 * 审核 Claim。防重复：
 * 1. 用 LockService 排队，同一时间只处理一个审核；
 * 2. 只有「PENDING」的 Claim 可以审核，已批准 / 已拒绝的会被拒绝；
 * 3. 财政表已经有这张 Claim 的支出（参考编号相同）就不会再新增。
 */
function reviewClaim(token, claimId, decision, remark) {
  var lock = LockService.getScriptLock();
  try {
    var session = requireAdminSession_(token);
    if (!perm_isFinance_(session)) throw new Error('只有财政或查账可以审核。');
    decision = String(decision || '').trim().toUpperCase();
    if (['APPROVED', 'REJECTED'].indexOf(decision) === -1) throw new Error('审核结果不正确。');
    remark = String(remark || '').slice(0, 500);
    if (!lock.tryLock(20000)) throw new Error('系统忙碌中，请稍后再试。');

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('职员报销');
    ensureHeaders_(sheet, ['审核备注', '审核时间']);
    var row = claim_findRow_(sheet, '报销编号', claimId);
    if (row < 2) throw new Error('找不到这个 Claim。');
    var claimRow = claim_getObjectByRow_(sheet, row, claim_getHeaders_(sheet));
    var status = String(claimRow['状态'] || '').trim().toUpperCase() || 'PENDING';
    if (status !== 'PENDING') {
      throw new Error('这张 Claim 已经' + (status === 'APPROVED' ? '批准' : status === 'REJECTED' ? '拒绝' : '处理') + '过了' +
        (claimRow['审核人'] ? '（' + claimRow['审核人'] + '）' : '') + '，不能重复审核。');
    }
    if (claim_isMine_(session, claimRow) && !perm_isAdmin_(session)) throw new Error('不能审核自己的 Claim，请由另一位财政或查账审核。');

    if (decision === 'APPROVED') {
      var amt = fin_num_(claimRow['金额']);
      if (!(amt > 0)) throw new Error('Claim 金额不正确，请先更正。');
      // 先写财政（有就跳过），再改状态：就算中途出错，也不会出现两笔支出。
      if (claim_findRow_(ss.getSheetByName('财政'), '参考编号', claimId) < 2) {
        admin_saveRecord_('财政', '交易编号', 'FIN', {
          '交易日期': claimRow['报销日期'] || new Date(),
          '类型': '支出',
          '类别': claimRow['类别'] || '报销',
          '组别': claimRow['组别'] || '',
          '说明': '报销：' + (claimRow['报销说明'] || '') + '（' + (claimRow['申请人姓名'] || '') + '）',
          '金额': amt,
          '参考编号': claimId,
          '账户': '现金',
          '记录人': session.name || ''
        });
      }
      claim_setValue_(sheet, row, '财政同步', '是');
    }
    claim_setValue_(sheet, row, '审核人', session.name + '（' + session.role + '）');
    claim_setValue_(sheet, row, '审核备注', remark);
    claim_setValue_(sheet, row, '审核时间', new Date());
    claim_setValue_(sheet, row, '状态', decision);
    SpreadsheetApp.flush();
    lock.releaseLock();
    writeLog_(token, decision === 'APPROVED' ? '批准 Claim' : '拒绝 Claim', '职员报销', claimId, remark);

    // Email 通知申请人（cc 查账）
    try {
      var applicantEmail = String(claimRow['申请人邮箱'] || '').trim() || notify_emailByName_(claimRow['申请人姓名']);
      var approved = decision === 'APPROVED';
      notify_send_(applicantEmail ? [applicantEmail] : [], notify_emailsByRole_(['查账']),
        'Claim ' + (approved ? '已批准' : '被拒绝') + '：RM' + claimRow['金额'] + ' ' + String(claimRow['报销说明'] || ''),
        ['你的 Claim ' + (approved ? '已经批准。' : '被拒绝了。'), '',
         '编号：' + claimId,
         '申请人：' + (claimRow['申请人姓名'] || ''),
         '金额：RM' + claimRow['金额'],
         '说明：' + (claimRow['报销说明'] || ''),
         '审核人：' + session.name].concat(remark ? ['备注：' + remark] : []));
    } catch (mailErr) { console.log('审核通知失败：' + mailErr.message); }

    return { success: true, message: decision === 'APPROVED' ? 'Claim 已批准。' : 'Claim 已拒绝。' };
  } catch (err) {
    return { success: false, message: err.message };
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

/* ---------- Claim：付款 / 收款确认 ---------- */
function markClaimPaid(token, claimId, method, remark) {
  var lock = LockService.getScriptLock();
  try {
    var s = requireAdminSession_(token);
    if (!perm_isFinance_(s)) throw new Error('只有财政或查账可以标记已付款。');
    if (!lock.tryLock(20000)) throw new Error('系统忙碌中，请稍后再试。');
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('职员报销');
    ensureHeaders_(sheet, ['付款时间', '付款人', '付款方式', '付款备注', '收款确认时间']);
    var row = claim_findRow_(sheet, '报销编号', claimId);
    if (row < 2) throw new Error('找不到这个 Claim。');
    var c = claim_getObjectByRow_(sheet, row, claim_getHeaders_(sheet));
    if (c['状态'] !== 'APPROVED') throw new Error('要先批准，才能标记已付款。');
    if (c['付款时间']) throw new Error('这张 Claim 已经标记付款了（' + (c['付款人'] || '') + '）。');
    claim_setValue_(sheet, row, '付款时间', new Date());
    claim_setValue_(sheet, row, '付款人', s.name + '（' + s.role + '）');
    claim_setValue_(sheet, row, '付款方式', String(method || '现金'));
    claim_setValue_(sheet, row, '付款备注', String(remark || ''));
    invalidateSheetCache_(sheet);
    SpreadsheetApp.flush();
    lock.releaseLock();
    try {
      var to = String(c['申请人邮箱'] || '').trim() || notify_emailByName_(c['申请人姓名']);
      notify_send_(to ? [to] : [], [], 'Claim 已付款：RM' + c['金额'] + ' ' + String(c['报销说明'] || ''),
        ['财政已经把这笔 Claim 的钱付给你了。', '', '编号：' + claimId, '金额：RM' + c['金额'], '付款方式：' + (method || '现金'), '付款人：' + s.name, '',
         '收到钱后，请登入播青后台，在「职员 Claim」按「确认已收到」。']);
    } catch (e) {}
    writeLog_(token, 'Claim 已付款', '职员报销', claimId, method || '');
    return { success: true, message: '已标记为已付款，申请人会收到 Email。' };
  } catch (err) { return { success: false, message: err.message }; }
  finally { try { lock.releaseLock(); } catch (ignore) {} }
}
function confirmClaimReceived(token, claimId) {
  try {
    var s = requireAnySession_(token);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('职员报销');
    ensureHeaders_(sheet, ['付款时间', '付款人', '付款方式', '付款备注', '收款确认时间']);
    var row = claim_findRow_(sheet, '报销编号', claimId);
    if (row < 2) throw new Error('找不到这个 Claim。');
    var c = claim_getObjectByRow_(sheet, row, claim_getHeaders_(sheet));
    if (!claim_isMine_(s, c) && !perm_isAdmin_(s)) throw new Error('只有申请人自己可以确认收到款项。');
    if (c['状态'] !== 'APPROVED') throw new Error('这个 Claim 还没有批准。');
    if (c['收款确认时间']) return { success: true, message: '已经确认过了，谢谢！' };
    claim_setValue_(sheet, row, '收款确认时间', new Date());
    if (!c['付款时间']) claim_setValue_(sheet, row, '付款时间', new Date());
    invalidateSheetCache_(sheet);
    try {
      notify_send_(notify_emailsByRole_(['财政']), notify_emailsByRole_(['查账']), 'Claim 已确认收到：' + (c['申请人姓名'] || '') + ' RM' + c['金额'],
        [(c['申请人姓名'] || '') + ' 已确认收到 Claim 的款项。', '', '编号：' + claimId, '金额：RM' + c['金额'], '说明：' + (c['报销说明'] || '')]);
    } catch (e) {}
    writeLog_(token, 'Claim 确认收款', '职员报销', claimId, s.name);
    return { success: true, message: '已确认收到，谢谢！' };
  } catch (err) { return { success: false, message: err.message }; }
}

/* ---------- 网站设定：首页大合照、标题、活动报告 ---------- */
var SITE_KEYS_ = [
  ['大合照', '首页最上面的大合照（图片链接）'],
  ['首页标题', '首页大合照上的大字'],
  ['首页副标题', '首页大合照上的小字'],
  ['Instagram 链接', 'Official Instagram URL']
];
function site_settingsSheet_() { return ensureTab_('系统设置', ['设置项目', '设置内容', '说明']); }
function getSiteSettings(token) {
  try {
    var s = requireAnySession_(token);
    var map = {};
    claim_getObjects_(site_settingsSheet_()).forEach(function(r) { map[String(r['设置项目'] || '').trim()] = String(r['设置内容'] || ''); });
    var rep = ensureTab_('活动报告', ['报告编号', '节目编号', '日期', '标题', '内容', '封面照片链接', '照片资料夹链接', '公开显示', '建立者', '建立时间', '更新日期']);
    var reports = claim_getObjects_(rep).sort(function(a, b) { return String(b['日期']).localeCompare(String(a['日期'])); });
    return {
      success: true, canEdit: !s.readOnly,
      settings: { banner: map['大合照'] || '', heroTitle: map['首页标题'] || '', heroSubtitle: map['首页副标题'] || '', instagram: map['Instagram 链接'] || '' },
      reports: reports
    };
  } catch (err) { return { success: false, message: err.message }; }
}
function saveSiteSettings(token, data) {
  try {
    var s = requireAdminSession_(token);
    var sheet = site_settingsSheet_();
    var vals = { '大合照': data.banner, '首页标题': data.heroTitle, '首页副标题': data.heroSubtitle, 'Instagram 链接': data.instagram };
    SITE_KEYS_.forEach(function(k) {
      if (vals[k[0]] === undefined) return;
      var row = claim_findRow_(sheet, '设置项目', k[0]);
      if (row < 2) sheet.appendRow([k[0], String(vals[k[0]] || ''), k[1]]);
      else sheet.getRange(row, 2).setValue(String(vals[k[0]] || ''));
    });
    invalidateSheetCache_(sheet);
    try { clearPortalCache_(); } catch (e) {}
    writeLog_(token, '修改网站设定', '系统设置', '', s.name);
    return { success: true, message: '已保存，首页重新整理就会看到。' };
  } catch (err) { return { success: false, message: err.message }; }
}
function uploadSiteImage(token, fileName, mimeType, base64Data) {
  try {
    requireAdminSession_(token);
    var folder = drive_folder_('播青｜网站照片');
    var file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(String(base64Data).replace(/^.*,/, '')), mimeType || 'image/jpeg', fileName || 'photo.jpg'));
    // 首页是公开的，照片要让任何人都看得到
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { success: true, url: 'https://drive.google.com/file/d/' + file.getId() + '/view', thumb: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1200' };
  } catch (err) { return { success: false, message: err.message }; }
}
function saveActivityReport(token, data) {
  try {
    var s = requireAdminSession_(token);
    ensureTab_('活动报告', ['报告编号', '节目编号', '日期', '标题', '内容', '封面照片链接', '照片资料夹链接', '公开显示', '建立者', '建立时间', '更新日期']);
    if (!String(data.title || '').trim()) throw new Error('请填写标题。');
    var obj = {
      '节目编号': data.eventId || '', '日期': data.date ? parseDateInput_(data.date) : new Date(), '标题': String(data.title).trim(),
      '内容': String(data.content || ''), '封面照片链接': String(data.cover || ''), '照片资料夹链接': String(data.album || ''),
      '公开显示': data.isPublic ? 'TRUE' : 'FALSE'
    };
    if (data.id) {
      var rs = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('活动报告');
      var rrow = claim_findRow_(rs, '报告编号', data.id);
      if (rrow < 2) throw new Error('找不到这份报告。');
      var cur = claim_getObjectByRow_(rs, rrow, claim_getHeaders_(rs));
      if (!perm_isExec_(s) && String(cur['建立者'] || '') !== String(s.name || '')) throw new Error('只有建立这份报告的人或行政组可以修改。');
      obj['报告编号'] = data.id;
    } else obj['建立者'] = s.name;
    var id = admin_saveRecord_('活动报告', '报告编号', 'RPT', obj);
    try { clearPortalCache_(); } catch (e) {}
    writeLog_(token, '保存活动报告', '活动报告', id, obj['标题']);
    return { success: true, id: id, message: '已保存。' };
  } catch (err) { return { success: false, message: err.message }; }
}
function deleteActivityReport(token, id) {
  try {
    var s = requireAdminSession_(token);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('活动报告');
    var row = claim_findRow_(sheet, '报告编号', id);
    if (row < 2) throw new Error('找不到这份报告。');
    var cur = claim_getObjectByRow_(sheet, row, claim_getHeaders_(sheet));
    if (!perm_isExec_(s) && String(cur['建立者'] || '') !== String(s.name || '')) throw new Error('只有建立这份报告的人或行政组可以删除。');
    sheet.deleteRow(row);
    invalidateSheetCache_(sheet);
    try { clearPortalCache_(); } catch (e) {}
    writeLog_(token, '删除活动报告', '活动报告', id, '');
    return { success: true };
  } catch (err) { return { success: false, message: err.message }; }
}

function uploadClaimReceipt(token, fileName, mimeType, base64Data) {
  try {
    requireAdminSession_(token);

    var folder = drive_folder_('播青｜职员报销收据');

    var blob = Utilities.newBlob(
      Utilities.base64Decode(String(base64Data).replace(/^.*,/, '')),
      mimeType,
      fileName
    );

    var file = folder.createFile(blob);

    // Allow the web app to display the image directly
    file.setSharing(
      DriveApp.Access.ANYONE_WITH_LINK,
      DriveApp.Permission.VIEW
    );

    var fileId = file.getId();

    // Direct image URL for <img src="">
    var directUrl = 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1200';

    return {
      success: true,
      url: directUrl,
      fileId: fileId,
      driveUrl: file.getUrl()
    };

  } catch (err) {
    return {
      success: false,
      message: err.message
    };
  }
}


function claim_getHeaders_(s) { if (!s || s.getLastColumn() < 1) return []; return s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0].map(function(v){return String(v).trim();}); }
function claim_cleanVal_(v) { if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, 'Asia/Kuala_Lumpur', "yyyy-MM-dd'T'HH:mm:ss"); return v; }
function claim_getObjects_(s) {
  // 经由快取读取（见 Code.gs「十、读取快取层」），输出格式与原本完全相同。
  var grid = getSheetGrid_(s);
  return grid.rows.map(function(r) {
    var o = {};
    grid.headers.forEach(function(k, i) {
      if (!k) return;
      var d = gridDate_(r[i]);
      o[k] = d ? Utilities.formatDate(d, 'Asia/Kuala_Lumpur', "yyyy-MM-dd'T'HH:mm:ss") : r[i];
    });
    return o;
  });
}
function claim_getObjectByRow_(s, row, h) { if (!s) return {}; var v = s.getRange(row, 1, 1, h.length).getValues()[0]; var o={}; h.forEach(function(k,i){ if(k) o[k]=claim_cleanVal_(v[i]); }); return o; }
function claim_findRow_(s, colName, val) { if(!s) return -1; var h = claim_getHeaders_(s), c = h.indexOf(colName)+1; if(c<=0 || s.getLastRow()<2) return -1; var v = s.getRange(2, c, s.getLastRow()-1, 1).getValues(); for(var i=0;i<v.length;i++) if(String(v[i][0])===String(val)) return i+2; return -1; }
function claim_setValue_(s, row, colName, val) { if(!s) return; var c = claim_getHeaders_(s).indexOf(colName)+1; if(c>0) { s.getRange(row, c).setValue(val); invalidateSheetCache_(s); } }
function claim_appendObject_(s, obj) { if(!s) return; s.appendRow(claim_getHeaders_(s).map(function(h){ return obj.hasOwnProperty(h)?obj[h]:''; })); invalidateSheetCache_(s); }
function claim_createId_(s, colName, prefix) { if(!s) return prefix + '-0001'; var c = claim_getHeaders_(s).indexOf(colName)+1; var max = 0; if(c>0 && s.getLastRow()>=2) { s.getRange(2, c, s.getLastRow()-1, 1).getValues().forEach(function(r){ var m = String(r[0]||'').match(/(\d+)$/); if(m) max = Math.max(max, Number(m[1])); }); } return prefix+'-'+String(max+1).padStart(4,'0'); }
function submitOffering(token, data) {
  try {
    var session = requireAdminSession_(token);
    
    // 确保只有财政和管理员可以操作
    if (!perm_isFinance_(session)) {
      throw new Error('只有财政或查账可以新增奉献。');
    }

    // 动作1：将完整记录写入「奉献记录」工作表
        var offeringId = admin_saveRecord_('奉献记录', '奉献编号', 'OFF', {
          '奉献日期': data.date,
          '聚会 / 节目': data.eventName,
          '聚会人数': data.attendance,  // 新增这一行
          '金额': data.amount,
          '计算员': data.counter,       // 新增这一行
          '记录人': session.name + '（' + session.role + '）',
          '备注': data.remark
        });

    // 动作2：同步一笔「收入」到「财政」工作表，让总览自动计算
    admin_saveRecord_('财政', '交易编号', 'FIN', {
      '交易日期': data.date,
      '类型': '收入',
      '类别': '奉献',
      '说明': data.eventName ? '本周奉献: ' + data.eventName : '本周奉献',
      '金额': data.amount,
      '参考编号': offeringId,
      '账户': '奉献在手',
      '记录人': session.name + '（' + session.role + '）',
      '建立时间': new Date()
    });

    return { success: true, message: '奉献已记录，总收入已更新。' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}


/* ============================================================
   账号系统 + 届别任期
   ------------------------------------------------------------
   「用户」表：一个人一个账号（Email + 密码），只放个人资料。
   「职员任期」表：每人每一届一行，记录那一届的组别与职位。
   「系统设置」的「当届年份」决定目前是哪一届。
   任期状态：待批准 / 在任 / 已卸任 / 已辞职 / 未通过 / 已移除
   ============================================================ */

var AUTH_SHEET_ = '用户';
var TERM_SHEET_ = '职员任期';
var AUTH_ROLES_ = ['管理员', '主席', '副主席', '财政', '查账', '文书', '职员'];
var AUTH_GROUPS_ = ['行政组', '信仰组', '见证组', '宣教组', '公民组', '团契组', '财政', '文书', '查账'];
// 注册 / 申请时可以选的项目：主席、副主席、文书、财政、查账属于行政组
var REG_CHOICES_ = ['主席', '副主席', '文书', '财政', '查账', '信仰组', '见证组', '宣教组', '公民组', '团契组'];
var EXEC_ROLES_ = ['主席', '副主席', '文书', '财政', '查账'];

/** 把注册时的选择换成「组别 + 职位」。主席/副主席 → 行政组；文书/财政/查账 → 各自职位；其他 → 该组职员。 */
function term_fromChoice_(choice) {
  choice = String(choice || '').trim();
  if (choice === '主席' || choice === '副主席') return { group: '行政组', role: choice };
  if (['文书', '财政', '查账'].indexOf(choice) !== -1) return { group: choice, role: choice };
  return { group: choice, role: '职员' };
}
var AUTH_STATUSES_ = ['ACTIVE', 'PENDING', 'INACTIVE', 'REJECTED'];
var USER_HEADERS_ = ['用户编号', '人名', '邮箱', '电话号码', '状态', '系统管理员', '建立时间', '最后登录', '密码哈希', '密码盐'];
var TERM_HEADERS_ = ['任期编号', '年份', '用户编号', '人名', '组别', '职位', '状态', '开始日期', '结束日期', '备注', '建立时间'];
var __termYear_ = null;

/** 补上缺少的表头（加在最右边），不会动到现有资料。 */
function ensureHeaders_(sheet, cols) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h || '').trim(); });
  var missing = cols.filter(function(c) { return headers.indexOf(c) === -1; });
  if (!missing.length) return headers;
  var start = (lastCol === 1 && !headers[0]) ? 1 : lastCol + 1;
  sheet.getRange(1, start, 1, missing.length).setValues([missing]);
  invalidateSheetCache_(sheet);
  return sheet.getRange(1, 1, 1, start + missing.length - 1).getValues()[0].map(function(h) { return String(h || '').trim(); });
}

function auth_sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(AUTH_SHEET_);
  if (!sheet) {
    sheet = ss.insertSheet(AUTH_SHEET_);
    sheet.getRange(1, 1, 1, USER_HEADERS_.length).setValues([USER_HEADERS_]);
  } else {
    ensureHeaders_(sheet, USER_HEADERS_);
  }
  return sheet;
}

function auth_readTable_(sheet) {
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function(h) { return String(h || '').trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var o = { _row: i + 1 };
    for (var c = 0; c < headers.length; c++) {
      if (headers[c] && !o.hasOwnProperty(headers[c])) o[headers[c]] = values[i][c];
    }
    rows.push(o);
  }
  return { sheet: sheet, headers: headers, rows: rows };
}

function auth_readUsers_() {
  var t = auth_readTable_(auth_sheet_());
  return { sheet: t.sheet, headers: t.headers, users: t.rows };
}

function term_sheet_() {
  var sheet = ensureTab_(TERM_SHEET_, TERM_HEADERS_);
  ensureHeaders_(sheet, TERM_HEADERS_);
  return sheet;
}

function term_read_() {
  var t = auth_readTable_(term_sheet_());
  return { sheet: t.sheet, headers: t.headers, terms: t.rows.filter(function(r) { return String(r['任期编号'] || '').trim(); }) };
}

function auth_findByEmail_(users, email) {
  email = String(email || '').trim().toLowerCase();
  if (!email) return null;
  for (var i = 0; i < users.length; i++) {
    if (String(users[i]['邮箱'] || '').trim().toLowerCase() === email) return users[i];
  }
  return null;
}

function auth_findBy_(rows, col, value) {
  for (var i = 0; i < rows.length; i++) if (String(rows[i][col]) === String(value)) return rows[i];
  return null;
}

function auth_setCells_(sheet, headers, row, obj) {
  Object.keys(obj).forEach(function(k) {
    var c = headers.indexOf(k);
    if (c >= 0) sheet.getRange(row, c + 1).setValue(obj[k]);
  });
  invalidateSheetCache_(sheet);
}

function auth_appendRow_(sheet, headers, obj) {
  sheet.appendRow(headers.map(function(h) { return obj.hasOwnProperty(h) ? obj[h] : ''; }));
  invalidateSheetCache_(sheet);
}

function auth_hash_(password, salt) {
  var v = salt + '|' + password;
  var bytes = null;
  for (var i = 0; i < 300; i++) {
    bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, v, Utilities.Charset.UTF_8);
    v = Utilities.base64Encode(bytes) + salt;
  }
  return Utilities.base64Encode(bytes);
}

function auth_tempPassword_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  var out = '';
  for (var i = 0; i < 10; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function auth_fmt_(v, dateOnly) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, 'Asia/Kuala_Lumpur', dateOnly ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm');
  }
  return String(v || '');
}

function auth_today_() {
  var d = new Date(); d.setHours(0, 0, 0, 0); return d;
}

/** 目前是哪一届（系统设置「当届年份」，没有设定就用今年）。 */
function term_currentYear_() {
  if (__termYear_) return __termYear_;
  var y = 0;
  try {
    getSheetObjects_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SETTINGS)).forEach(function(item) {
      if (String(item['设置项目'] || '').trim() === '当届年份') y = Number(item['设置内容']) || 0;
    });
  } catch (ignore) {}
  __termYear_ = y || Number(Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyyy'));
  return __termYear_;
}

function term_setCurrentYear_(year) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SETTINGS);
  var t = auth_readTable_(sheet);
  var row = auth_findBy_(t.rows, '设置项目', '当届年份');
  if (row) auth_setCells_(sheet, t.headers, row._row, { '设置内容': year });
  else auth_appendRow_(sheet, t.headers, { '设置项目': '当届年份', '设置内容': year, '说明': '职员会当届年份（管理员在后台交接时更新）' });
  __termYear_ = Number(year);
}

function term_defaultRole_(group) {
  return term_fromChoice_(group).role;
}

/** 让某个用户（或全部人）已登入的 session 失效，下次操作会要求重新登入。 */
function auth_revokeUser_(userId) {
  if (userId) CacheService.getScriptCache().put('BOQ_REVOKE_' + userId, String(new Date().getTime()), 21600);
}
function auth_revokeAll_() {
  CacheService.getScriptCache().put('BOQ_SESSION_EPOCH', String(new Date().getTime()), 21600);
}

/** 依照当届任期建立登入资料。 */
function auth_buildSession_(user, terms) {
  var year = term_currentYear_();
  var uid = String(user['用户编号'] || '');
  var mine = terms.filter(function(t) { return String(t['用户编号']) === uid; });
  var current = mine.filter(function(t) { return Number(t['年份']) === year && String(t['状态']) === '在任'; })[0];
  var past = mine.filter(function(t) {
    return ['在任', '已卸任', '已辞职'].indexOf(String(t['状态'])) !== -1 && Number(t['年份']) <= year;
  }).sort(function(a, b) { return Number(b['年份']) - Number(a['年份']); });
  var sysAdmin = String(user['系统管理员'] || '').trim() === '是';
  var email = String(user['邮箱'] || '').trim().toLowerCase();

  var s = {
    userId: uid,
    name: String(user['人名'] || '').trim() || email,
    email: email,
    loginId: email,
    termYear: year,
    isSysAdmin: sysAdmin,
    loginTime: new Date().getTime(),
    terms: mine.map(function(t) {
      return { id: String(t['任期编号']), year: Number(t['年份']), group: String(t['组别'] || ''), role: String(t['职位'] || ''), status: String(t['状态'] || '') };
    })
  };
  if (current) {
    s.role = String(current['职位'] || '').trim() || '职员';
    s.group = String(current['组别'] || '').trim();
    s.viewYear = year;
    s.readOnly = false;
  } else if (past.length) {
    s.role = '卸任';
    s.group = String(past[0]['组别'] || '').trim();
    s.viewYear = Number(past[0]['年份']);
    s.readOnly = true;
  } else {
    s.role = '无任期';
    s.group = '';
    s.viewYear = year;
    s.readOnly = true;
  }
  if (sysAdmin) { s.role = '管理员'; s.readOnly = false; s.viewYear = year; }
  return s;
}

/** 注册新账号（不需要登入）：建立账号 + 那一届的任期申请，等管理员批准。 */
function registerAccount(data) {
  var lock = LockService.getScriptLock();
  try {
    data = data || {};
    var name = String(data.name || '').trim().slice(0, 40);
    var email = String(data.email || '').trim().toLowerCase();
    var phone = String(data.phone || '').trim().slice(0, 30);
    var password = String(data.password || '');
    var group = String(data.group || '').trim();
    var year = Number(data.year) || term_currentYear_();
    var cy = term_currentYear_();

    if (!name) return { success: false, message: '请填写姓名。' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { success: false, message: 'Email 格式不正确。' };
    if (password.length < 8) return { success: false, message: '密码至少要 8 个字符。' };
    if (REG_CHOICES_.indexOf(group) === -1 && AUTH_GROUPS_.indexOf(group) === -1) return { success: false, message: '请选择你的组别 / 职位。' };
    if (year !== cy && year !== cy + 1) return { success: false, message: '只能申请加入当届或下一届。' };

    lock.waitLock(15000);
    var u = auth_readUsers_();
    if (auth_findByEmail_(u.users, email)) {
      return { success: false, message: '这个 Email 已经有账号了。请直接登入，再按「申请加入届别」；忘记密码请按「忘记密码」。' };
    }

    var salt = Utilities.getUuid();
    var userId = claim_createId_(u.sheet, '用户编号', 'USR');
    auth_appendRow_(u.sheet, u.headers, {
      '用户编号': userId, '人名': name, '邮箱': email, '电话号码': phone, '状态': 'PENDING',
      '系统管理员': '', '建立时间': new Date(), '密码哈希': auth_hash_(password, salt), '密码盐': salt
    });
    var t = term_read_();
    auth_appendRow_(t.sheet, t.headers, {
      '任期编号': claim_createId_(t.sheet, '任期编号', 'TRM'), '年份': year, '用户编号': userId, '人名': name,
      '组别': term_fromChoice_(group).group, '职位': term_fromChoice_(group).role, '状态': '待批准', '建立时间': new Date()
    });
    lock.releaseLock();

    try {
      notify_send_(notify_emailsByRole_(['管理员', '主席']), [], '新账号等待批准：' + name + '（' + year + ' 届 ' + group + '）',
        ['有新的职员注册，等待你批准。', '', '姓名：' + name, 'Email：' + email, '申请加入：' + year + ' 届　' + group,
         phone ? '电话：' + phone : '', '', '请到后台「账号管理」批准并确认职位。']);
    } catch (mailErr) { console.log('注册通知失败：' + mailErr.message); }

    return { success: true, message: '注册成功！请等待管理员或主席批准，批准后会以 Email 通知你。' };
  } catch (err) {
    return { success: false, message: err.message };
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

/** 已有账号的人（回锅 / 卸任后再加入）申请加入当届或下一届。 */
function applyForTerm(token, year, group) {
  try {
    var session = requireAnySession_(token);
    year = Number(year);
    var cy = term_currentYear_();
    if (year !== cy && year !== cy + 1) throw new Error('只能申请加入当届或下一届。');
    if (REG_CHOICES_.indexOf(group) === -1 && AUTH_GROUPS_.indexOf(group) === -1) throw new Error('请选择组别 / 职位。');
    var t = term_read_();
    var dup = t.terms.filter(function(x) {
      return String(x['用户编号']) === String(session.userId) && Number(x['年份']) === year && ['待批准', '在任'].indexOf(String(x['状态'])) !== -1;
    });
    if (dup.length) throw new Error('你在 ' + year + ' 届已经有任期或申请了。');
    auth_appendRow_(t.sheet, t.headers, {
      '任期编号': claim_createId_(t.sheet, '任期编号', 'TRM'), '年份': year, '用户编号': session.userId, '人名': session.name,
      '组别': term_fromChoice_(group).group, '职位': term_fromChoice_(group).role, '状态': '待批准', '建立时间': new Date()
    });
    notify_send_(notify_emailsByRole_(['管理员', '主席']), [], session.name + ' 申请加入 ' + year + ' 届（' + group + '）',
      [session.name + '（' + session.email + '）申请加入 ' + year + ' 届　' + group + '。', '', '请到后台「账号管理」批准。']);
    return { success: true, message: '已送出申请，管理员或主席批准后会通知你。' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/** 忘记密码：通知管理员帮忙重设（不透露该 Email 是否存在）。 */
function requestPasswordReset(email) {
  try {
    email = String(email || '').trim().toLowerCase();
    var generic = { success: true, message: '已通知管理员。管理员重设后，临时密码会寄到你的 Email。' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { success: false, message: 'Email 格式不正确。' };
    var cache = CacheService.getScriptCache();
    var key = 'BOQ_RESETREQ_' + Utilities.base64EncodeWebSafe(Utilities.newBlob(email).getBytes());
    if (cache.get(key)) return generic;
    cache.put(key, '1', 1800);
    var user = auth_findByEmail_(auth_readUsers_().users, email);
    if (user) {
      notify_send_(notify_emailsByRole_(['管理员', '主席']), [], '重设密码请求：' + (user['人名'] || email),
        [(user['人名'] || '') + '（' + email + '）请求重设密码。', '', '请到后台「账号管理」的「所有账号」找到他，按「重设密码」。']);
    }
    return generic;
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function changeMyPassword(token, oldPassword, newPassword) {
  try {
    var session = requireAnySession_(token);
    newPassword = String(newPassword || '');
    if (newPassword.length < 8) throw new Error('新密码至少要 8 个字符。');
    var u = auth_readUsers_();
    var user = auth_findByEmail_(u.users, session.email);
    if (!user) throw new Error('找不到你的账号。');
    if (auth_hash_(String(oldPassword || ''), String(user['密码盐'] || '')) !== String(user['密码哈希'] || '')) throw new Error('目前密码不正确。');
    var salt = Utilities.getUuid();
    auth_setCells_(u.sheet, u.headers, user._row, { '密码哈希': auth_hash_(newPassword, salt), '密码盐': salt });
    return { success: true, message: '密码已更新。' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/* ---------------- 管理员：账号与任期 ---------------- */

/** 账号管理：管理员或当届主席。主席不能给人「管理员」职位，也不能改系统管理员的账号。 */
var ACCOUNT_MANAGER_ROLES_ = ['管理员', '主席'];
function auth_requireAdmin_(token) {
  var s = requireAdminSession_(token);
  if (ACCOUNT_MANAGER_ROLES_.indexOf(s.role) === -1) throw new Error('只有管理员或主席可以管理账号。');
  return s;
}
function auth_isFullAdmin_(s) { return perm_isAdmin_(s); }
/** 主席的限制：不能指派「管理员」、不能改职位是管理员的任期、不能改系统管理员账号。 */
function auth_chairGuard_(s, opts) {
  if (auth_isFullAdmin_(s)) return;
  opts = opts || {};
  if (opts.newRole === '管理员') throw new Error('主席不能指派「管理员」职位，请联系系统管理员。');
  if (opts.term && String(opts.term['职位'] || '').trim() === '管理员') throw new Error('这个任期是管理员，只有系统管理员可以修改。');
  if (opts.user && String(opts.user['系统管理员'] || '').trim() === '是') throw new Error('这是系统管理员的账号，主席不能修改。');
}

function listAccounts(token) {
  try {
    var accSession = auth_requireAdmin_(token);
    var u = auth_readUsers_();
    var t = term_read_();
    var accounts = u.users.filter(function(x) { return String(x['用户编号'] || '').trim(); }).map(function(x) {
      return {
        userId: String(x['用户编号'] || ''), name: String(x['人名'] || ''), email: String(x['邮箱'] || ''),
        phone: String(x['电话号码'] || ''), status: String(x['状态'] || '').trim().toUpperCase(),
        sysAdmin: String(x['系统管理员'] || '').trim() === '是', hasPassword: !!String(x['密码哈希'] || ''),
        createdAt: auth_fmt_(x['建立时间']), lastLogin: auth_fmt_(x['最后登录'])
      };
    });
    var terms = t.terms.map(function(x) {
      return {
        termId: String(x['任期编号']), year: Number(x['年份']), userId: String(x['用户编号'] || ''), name: String(x['人名'] || ''),
        group: String(x['组别'] || ''), role: String(x['职位'] || ''), status: String(x['状态'] || ''),
        start: auth_fmt_(x['开始日期'], true), end: auth_fmt_(x['结束日期'], true), note: String(x['备注'] || ''),
        createdAt: auth_fmt_(x['建立时间'])
      };
    });
    return { success: true, accounts: accounts, terms: terms, currentYear: term_currentYear_(),
      roles: auth_isFullAdmin_(accSession) ? AUTH_ROLES_ : AUTH_ROLES_.filter(function(r) { return r !== '管理员'; }),
      groups: AUTH_GROUPS_, fullAdmin: auth_isFullAdmin_(accSession) };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function auth_termContext_(termId) {
  var t = term_read_();
  var term = auth_findBy_(t.terms, '任期编号', termId);
  if (!term) throw new Error('找不到这个任期。');
  var u = auth_readUsers_();
  var user = auth_findBy_(u.users, '用户编号', term['用户编号']);
  return { t: t, term: term, u: u, user: user };
}

function approveTerm(token, termId, role, group) {
  try {
    var aSession = auth_requireAdmin_(token);
    if (AUTH_ROLES_.indexOf(role) === -1) throw new Error('职位不正确。');
    if (AUTH_GROUPS_.indexOf(group) === -1) throw new Error('组别不正确。');
    var c = auth_termContext_(termId);
    auth_chairGuard_(aSession, { newRole: role, user: c.user });
    var year = Number(c.term['年份']);
    var clash = c.t.terms.filter(function(x) {
      return String(x['用户编号']) === String(c.term['用户编号']) && Number(x['年份']) === year && String(x['状态']) === '在任' && String(x['任期编号']) !== String(termId);
    });
    if (clash.length) throw new Error('这个人在 ' + year + ' 届已经有在任的任期。');

    auth_setCells_(c.t.sheet, c.t.headers, c.term._row, {
      '状态': '在任', '职位': role, '组别': group, '开始日期': year === term_currentYear_() ? auth_today_() : ''
    });
    if (c.user && String(c.user['状态'] || '').toUpperCase() !== 'ACTIVE') {
      auth_setCells_(c.u.sheet, c.u.headers, c.user._row, { '状态': 'ACTIVE' });
    }
    auth_revokeUser_(c.term['用户编号']);
    writeLog_(token, '批准任期', TERM_SHEET_, termId, year + '｜' + c.term['人名'] + '｜' + group + '｜' + role);

    var email = c.user ? String(c.user['邮箱'] || '').trim() : '';
    if (email) {
      notify_send_([email], [], '你已加入 ' + year + ' 届职员会',
        ['你好 ' + (c.term['人名'] || '') + '，', '', (aSession.role === '主席' ? '主席 ' + aSession.name : '管理员') + ' 已批准你加入 ' + year + ' 届职员会。', '组别：' + group, '职位：' + role,
         year === term_currentYear_() ? '现在就可以用你的 Email 和密码登入后台了。' : '这是下一届的任期，交接后会自动生效。']);
    }
    return { success: true, message: '已批准。' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function rejectTerm(token, termId) {
  try {
    var rSession = auth_requireAdmin_(token);
    var c = auth_termContext_(termId);
    auth_chairGuard_(rSession, { term: c.term, user: c.user });
    auth_setCells_(c.t.sheet, c.t.headers, c.term._row, { '状态': '未通过' });
    if (c.user && String(c.user['状态'] || '').toUpperCase() === 'PENDING') {
      var others = c.t.terms.filter(function(x) {
        return String(x['用户编号']) === String(c.term['用户编号']) && String(x['任期编号']) !== String(termId) && ['待批准', '在任', '已卸任', '已辞职'].indexOf(String(x['状态'])) !== -1;
      });
      if (!others.length) auth_setCells_(c.u.sheet, c.u.headers, c.user._row, { '状态': 'REJECTED' });
    }
    var email = c.user ? String(c.user['邮箱'] || '').trim() : '';
    if (email) notify_send_([email], [], '加入职员会的申请未通过',
      ['你好 ' + (c.term['人名'] || '') + '，', '', '你申请加入 ' + c.term['年份'] + ' 届职员会没有通过。如有疑问，请联系团契职员。'], true);
    return { success: true, message: '已拒绝。' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function updateTerm(token, termId, changes) {
  try {
    var uSession = auth_requireAdmin_(token);
    changes = changes || {};
    var c = auth_termContext_(termId);
    auth_chairGuard_(uSession, { newRole: changes.role, term: c.term, user: c.user });
    var set = {};
    if (changes.role != null) { if (AUTH_ROLES_.indexOf(changes.role) === -1) throw new Error('职位不正确。'); set['职位'] = changes.role; }
    if (changes.group != null) { if (AUTH_GROUPS_.indexOf(changes.group) === -1) throw new Error('组别不正确。'); set['组别'] = changes.group; }
    auth_setCells_(c.t.sheet, c.t.headers, c.term._row, set);
    auth_revokeUser_(c.term['用户编号']);
    writeLog_(token, '更新任期', TERM_SHEET_, termId, JSON.stringify(set));
    return { success: true, message: '任期已更新。' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * 辞职 / 替换：原任期标为「已辞职」，可选择一位接任者，从生效日期起接手同一组别与职位。
 * type：'辞职'（保留纪录）或 '移除'（排错用，例如误加的任期）。
 */
function endTerm(token, termId, opts) {
  try {
    var eSession = auth_requireAdmin_(token);
    opts = opts || {};
    var c = auth_termContext_(termId);
    auth_chairGuard_(eSession, { term: c.term, user: c.user });
    var year = Number(c.term['年份']);
    var date = opts.date ? new Date(opts.date) : auth_today_();
    if (isNaN(date.getTime())) date = auth_today_();
    var note = String(opts.note || '').slice(0, 200);

    if (opts.type === '移除') {
      auth_setCells_(c.t.sheet, c.t.headers, c.term._row, { '状态': '已移除', '备注': note || c.term['备注'] || '' });
      auth_revokeUser_(c.term['用户编号']);
      return { success: true, message: '任期已移除。' };
    }

    var replacement = null;
    if (opts.replacementUserId) {
      replacement = auth_findBy_(c.u.users, '用户编号', opts.replacementUserId);
      if (!replacement || String(replacement['状态'] || '').toUpperCase() !== 'ACTIVE') throw new Error('接任的人必须是已启用的账号。');
      var busy = c.t.terms.filter(function(x) {
        return String(x['用户编号']) === String(opts.replacementUserId) && Number(x['年份']) === year && String(x['状态']) === '在任';
      });
      if (busy.length) throw new Error((replacement['人名'] || '') + ' 在 ' + year + ' 届已经有在任的任期（' + busy[0]['组别'] + '），请先调整。');
    }

    auth_setCells_(c.t.sheet, c.t.headers, c.term._row, {
      '状态': '已辞职', '结束日期': date,
      '备注': (note ? note + '；' : '') + (replacement ? '由 ' + replacement['人名'] + ' 接任' : '')
    });
    auth_revokeUser_(c.term['用户编号']);

    if (replacement) {
      auth_appendRow_(c.t.sheet, c.t.headers, {
        '任期编号': claim_createId_(c.t.sheet, '任期编号', 'TRM'), '年份': year, '用户编号': replacement['用户编号'],
        '人名': replacement['人名'], '组别': c.term['组别'], '职位': c.term['职位'], '状态': '在任',
        '开始日期': date, '备注': '接任 ' + c.term['人名'], '建立时间': new Date()
      });
      auth_revokeUser_(replacement['用户编号']);
      var rEmail = String(replacement['邮箱'] || '').trim();
      if (rEmail) notify_send_([rEmail], [], '你已接任 ' + year + ' 届 ' + c.term['组别'],
        ['你好 ' + (replacement['人名'] || '') + '，', '', '你已接任 ' + c.term['人名'] + ' 在 ' + year + ' 届的职务。',
         '组别：' + c.term['组别'], '职位：' + c.term['职位'], '生效日期：' + auth_fmt_(date, true), '',
         '登入后台就可以看到这一组之前的事工与报告资料。']);
    }
    writeLog_(token, '辞职/替换', TERM_SHEET_, termId, c.term['人名'] + (replacement ? ' → ' + replacement['人名'] : ''));
    return { success: true, message: replacement ? '已完成替换，' + replacement['人名'] + ' 会收到 Email 通知。' : '已记录辞职。' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/** 把某一届的在任名单复制到下一届（之后再修改换掉的人）。 */
function copyTermsToYear(token, fromYear, toYear) {
  try {
    auth_requireAdmin_(token);
    fromYear = Number(fromYear); toYear = Number(toYear);
    if (!fromYear || !toYear || toYear <= fromYear) throw new Error('年份不正确。');
    var t = term_read_();
    var has = {};
    t.terms.forEach(function(x) { if (Number(x['年份']) === toYear && String(x['状态']) !== '已移除' && String(x['状态']) !== '未通过') has[String(x['用户编号'])] = true; });
    var count = 0;
    t.terms.forEach(function(x) {
      if (Number(x['年份']) !== fromYear || ['在任', '已卸任'].indexOf(String(x['状态'])) === -1) return;
      if (has[String(x['用户编号'])]) return;
      auth_appendRow_(t.sheet, t.headers, {
        '任期编号': claim_createId_(t.sheet, '任期编号', 'TRM'), '年份': toYear, '用户编号': x['用户编号'], '人名': x['人名'],
        '组别': x['组别'], '职位': x['职位'], '状态': '在任', '备注': '从 ' + fromYear + ' 届复制', '建立时间': new Date()
      });
      has[String(x['用户编号'])] = true;
      count++;
    });
    return { success: true, message: '已复制 ' + count + ' 人到 ' + toYear + ' 届，请检查并修改换掉的人。' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/** 交接：当届年份改成新的一届，旧一届在任的人自动变成「已卸任」。 */
function handoverToYear(token, newYear) {
  try {
    var session = auth_requireAdmin_(token);
    var cy = term_currentYear_();
    newYear = Number(newYear);
    if (newYear !== cy + 1) throw new Error('只能交接到下一届（' + (cy + 1) + '）。');
    var t = term_read_();
    var nextCount = t.terms.filter(function(x) { return Number(x['年份']) === newYear && String(x['状态']) === '在任'; }).length;
    if (!nextCount) throw new Error(newYear + ' 届还没有任何在任的职员，请先批准或复制名单。');
    var today = auth_today_();
    t.terms.forEach(function(x) {
      if (Number(x['年份']) === cy && String(x['状态']) === '在任') {
        auth_setCells_(t.sheet, t.headers, x._row, { '状态': '已卸任', '结束日期': today });
      }
      if (Number(x['年份']) === newYear && String(x['状态']) === '在任' && !x['开始日期']) {
        auth_setCells_(t.sheet, t.headers, x._row, { '开始日期': today });
      }
    });
    term_setCurrentYear_(newYear);
    writeLog_(token, '换届交接', TERM_SHEET_, String(newYear), cy + ' → ' + newYear + '（' + session.name + '）');
    auth_revokeAll_();
    return { success: true, message: '已交接到 ' + newYear + ' 届。所有人需要重新登入。' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/** 账号本身的启用 / 停用（与任期无关）。 */
function updateAccount(token, userId, changes) {
  try {
    var session = auth_requireAdmin_(token);
    changes = changes || {};
    var u = auth_readUsers_();
    var user = auth_findBy_(u.users, '用户编号', userId);
    if (!user) throw new Error('找不到这个账号。');
    auth_chairGuard_(session, { user: user });
    if (changes.status == null || AUTH_STATUSES_.indexOf(changes.status) === -1) throw new Error('状态不正确。');
    if (String(user['邮箱'] || '').toLowerCase() === String(session.email || '').toLowerCase() && changes.status !== 'ACTIVE') {
      throw new Error('不能停用自己的账号。');
    }
    auth_setCells_(u.sheet, u.headers, user._row, { '状态': changes.status });
    auth_revokeUser_(userId);
    writeLog_(token, '更新账号状态', AUTH_SHEET_, userId, changes.status);
    return { success: true, message: '账号已更新。' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function resetAccountPassword(token, userId) {
  try {
    var pSession = auth_requireAdmin_(token);
    var u = auth_readUsers_();
    var user = auth_findBy_(u.users, '用户编号', userId);
    if (!user) throw new Error('找不到这个账号。');
    auth_chairGuard_(pSession, { user: user });
    var email = String(user['邮箱'] || '').trim();
    if (!email) throw new Error('这个账号没有 Email，请对方重新注册。');
    var temp = auth_tempPassword_();
    var salt = Utilities.getUuid();
    auth_setCells_(u.sheet, u.headers, user._row, { '密码哈希': auth_hash_(temp, salt), '密码盐': salt });
    writeLog_(token, '重设密码', AUTH_SHEET_, userId, email);
    var sent = notify_send_([email], [], '你的临时密码',
      ['你好 ' + (user['人名'] || '') + '，', '', (pSession.role === '主席' ? '主席 ' + pSession.name : '管理员') + ' 已经帮你重设播青后台的密码。', '临时密码：' + temp, '',
       '请用这个临时密码登入，然后按右上角「改密码」换成你自己的密码。']);
    if (sent) return { success: true, message: '临时密码已寄到 ' + email + '。' };
    return { success: true, message: 'Email 寄不出去，请把临时密码亲自告诉对方：' + temp };
  } catch (err) {
    return { success: false, message: err.message };
  }
}


/* ============================================================
   Email 通知
   ------------------------------------------------------------
   用 MailApp 寄出，寄件人是部署这个 Web App 的 Google 账号。
   一般 Gmail 账号每天约可寄 100 封。
   ============================================================ */

function notify_appUrl_() {
  try { return ScriptApp.getService().getUrl().split('?')[0] + '?page=admin'; } catch (e) { return ''; }
}

function notify_activeUsers_() {
  return auth_readUsers_().users.filter(function(x) {
    return String(x['状态'] || '').trim().toUpperCase() === 'ACTIVE' && String(x['邮箱'] || '').trim();
  });
}

/** 当届在任、职位符合的人的 Email（管理员也包括系统管理员）。 */
function notify_emailsByRole_(roles) {
  var users = notify_activeUsers_();
  var byId = {};
  users.forEach(function(x) { byId[String(x['用户编号'])] = String(x['邮箱']).trim().toLowerCase(); });
  var out = [];
  var year = term_currentYear_();
  term_read_().terms.forEach(function(t) {
    if (Number(t['年份']) !== year || String(t['状态']) !== '在任') return;
    if (roles.indexOf(String(t['职位'] || '').trim()) === -1) return;
    var e = byId[String(t['用户编号'])];
    if (e && out.indexOf(e) === -1) out.push(e);
  });
  if (roles.indexOf('管理员') !== -1) {
    users.forEach(function(x) {
      var e = String(x['邮箱']).trim().toLowerCase();
      if (String(x['系统管理员'] || '').trim() === '是' && out.indexOf(e) === -1) out.push(e);
    });
  }
  return out;
}

/** 当届在任、属于某一组的人的 Email。 */
function notify_emailsByGroup_(group) {
  var byId = {};
  notify_activeUsers_().forEach(function(x) { byId[String(x['用户编号'])] = String(x['邮箱']).trim().toLowerCase(); });
  var out = [];
  var year = term_currentYear_();
  term_read_().terms.forEach(function(t) {
    if (Number(t['年份']) !== year || String(t['状态']) !== '在任') return;
    if (ministryNormalizeGroup_(t['组别']) !== group) return;
    var e = byId[String(t['用户编号'])];
    if (e && out.indexOf(e) === -1) out.push(e);
  });
  return out;
}

function notify_emailByName_(name) {
  name = String(name || '').trim();
  if (!name) return '';
  var users = notify_activeUsers_();
  for (var i = 0; i < users.length; i++) {
    if (String(users[i]['人名'] || '').trim() === name) return String(users[i]['邮箱']).trim();
  }
  return '';
}

function notify_esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 寄出通知。to / cc 为 Email 阵列；lines 为每一行文字。
 * 成功回传 true；没有收件人、额度用完或寄信失败回传 false（不会让原本的操作失败）。
 */
function notify_send_(to, cc, subject, lines, hideButton) {
  try {
    to = (to || []).filter(String);
    cc = (cc || []).filter(function(e) { return e && to.indexOf(e) === -1; });
    if (!to.length) { to = cc; cc = []; }
    if (!to.length) return false;
    if (MailApp.getRemainingDailyQuota() < 1) { console.log('今日寄信额度已用完'); return false; }

    var url = hideButton ? '' : notify_appUrl_();
    var body = (lines || []).map(function(l) {
      return notify_esc_(l).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
    }).join('<br>');
    var html =
      '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#1E2B24;max-width:560px;">' +
      '<div style="background:#1F4D3A;color:#ffffff;padding:14px 18px;border-radius:10px 10px 0 0;font-weight:bold;">播青后台通知</div>' +
      '<div style="border:1px solid #E1E7E2;border-top:none;padding:18px;border-radius:0 0 10px 10px;">' + body +
      (url ? '<p style="margin-top:20px;"><a href="' + url + '" style="background:#1F4D3A;color:#ffffff;padding:9px 16px;border-radius:8px;text-decoration:none;">打开播青后台</a></p>' : '') +
      '<p style="color:#888888;font-size:12px;margin-top:18px;">这是系统自动发出的通知，请不要直接回复。</p></div></div>';

    var opts = { to: to.join(','), subject: '【播青】' + subject, htmlBody: html, name: '播青后台' };
    if (cc.length) opts.cc = cc.join(',');
    MailApp.sendEmail(opts);
    return true;
  } catch (err) {
    console.log('寄信失败：' + err.message);
    return false;
  }
}

/**
 * 每天早上执行：会议报告截止前 3 天，提醒还没提交的组。
 * 先在编辑器手动运行一次 installReminderTrigger() 来启动。
 */
function sendMeetingDeadlineReminders(e) {
  if (!trigger_isReal_(e)) editorOnly_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var meetings = claim_getObjects_(ss.getSheetByName(MIN_SHEET_MEETINGS));
  var subs = claim_getObjects_(ss.getSheetByName(MIN_SHEET_SUBMISSIONS));
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var sentCount = 0;

  meetings.forEach(function(m) {
    if (!m['报告截止日期']) return;
    var status = String(m['状态'] || '');
    if (status === '报告已生成' || status === '已完成') return;
    var due = new Date(m['报告截止日期']); due.setHours(0, 0, 0, 0);
    var days = Math.round((due - today) / 86400000);
    if (days !== 3) return;

    var year = Number(m['年份']), no = Number(m['会议次数']);
    MIN_GROUPS.forEach(function(g) {
      var sub = subs.filter(function(s) {
        return Number(s['年份']) === year && Number(s['会议次数']) === no && String(s['组别']) === g;
      })[0];
      var st = sub ? String(sub['状态'] || '未提交') : '未提交';
      if (st === '已提交' || st === '已确认') return;
      var emails = notify_emailsByGroup_(g);
      if (!emails.length) return;
      if (notify_send_(emails, [], g + '：第' + no + '次会议报告 3 天后截止',
        ['提醒 ' + g + '：', '', year + ' 年第 ' + no + ' 次会议（' + (m['会议类型'] || '') + '）的报告将在 ' +
         Utilities.formatDate(due, 'Asia/Kuala_Lumpur', 'yyyy-MM-dd') + ' 截止。',
         '目前状态：' + st, '', '请到后台「事工管理」更新事工资料，然后按「提交本组报告」。'])) sentCount++;
    });
  });
  return sentCount;
}

/** 在编辑器手动运行一次：建立每天早上 9 点的截止提醒。 */
function installReminderTrigger() {
  editorOnly_();
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendMeetingDeadlineReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendMeetingDeadlineReminders').timeBased().everyDays(1).atHour(9).inTimezone('Asia/Kuala_Lumpur').create();
  return '已设定：每天早上 9 点检查会议截止日期。';
}


/* ============================================================
   意见箱：主页（不用登入）提交，全部职员可在后台查看
   ============================================================ */

var FEEDBACK_SHEET_ = '意见箱';
var FEEDBACK_HEADERS_ = ['意见编号', '提交时间', '类别', '内容', '称呼', '联络方式', '状态', '处理备注', '处理人', '更新时间'];
var FEEDBACK_CATEGORIES_ = ['建议', '感恩', '代祷', '问题反映', '其他'];

function feedback_sheet_() {
  var sheet = ensureTab_(FEEDBACK_SHEET_, FEEDBACK_HEADERS_);
  ensureHeaders_(sheet, FEEDBACK_HEADERS_);
  return sheet;
}

function submitFeedback(data) {
  var lock = LockService.getScriptLock();
  try {
    data = data || {};
    if (String(data.website || '').trim()) return { success: true, message: '谢谢你的意见！' }; // 防机器人栏位

    var content = String(data.content || '').trim();
    if (content.length < 5) return { success: false, message: '请写多一点内容（至少 5 个字）。' };
    if (content.length > 2000) return { success: false, message: '内容太长了，请控制在 2000 字以内。' };
    var category = FEEDBACK_CATEGORIES_.indexOf(String(data.category || '')) !== -1 ? String(data.category) : '其他';

    var cache = CacheService.getScriptCache();
    var hourKey = 'BOQ_FB_' + Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyyyMMddHH');
    var count = Number(cache.get(hourKey) || 0);
    if (count >= 60) return { success: false, message: '目前提交的人太多，请稍后再试。' };
    cache.put(hourKey, String(count + 1), 3700);

    lock.waitLock(15000);
    var sheet = feedback_sheet_();
    claim_appendObject_(sheet, {
      '意见编号': claim_createId_(sheet, '意见编号', 'FB'),
      '提交时间': new Date(),
      '类别': category,
      '内容': content,
      '称呼': String(data.name || '').trim().slice(0, 40),
      '联络方式': String(data.contact || '').trim().slice(0, 80),
      '状态': '新',
      '处理备注': '',
      '处理人': '',
      '更新时间': new Date()
    });
    return { success: true, message: '谢谢你的意见！职员会认真阅读。' };
  } catch (err) {
    return { success: false, message: '送出失败，请稍后再试。' };
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function updateFeedback(token, id, status, note) {
  try {
    var session = requireAdminSession_(token);
    var sheet = feedback_sheet_();
    var row = claim_findRow_(sheet, '意见编号', id);
    if (row < 2) throw new Error('找不到这则意见。');
    if (status) {
      if (['新', '处理中', '已处理'].indexOf(status) === -1) throw new Error('状态不正确。');
      claim_setValue_(sheet, row, '状态', status);
    }
    if (note != null) claim_setValue_(sheet, row, '处理备注', String(note).slice(0, 1000));
    claim_setValue_(sheet, row, '处理人', session.name || '');
    claim_setValue_(sheet, row, '更新时间', new Date());
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}


/* ============================================================
   系统管理员「切换身份」：用任何职位 / 组别的身份查看与操作，方便检查和维修
   ============================================================ */
function switchViewAs(token, role, group) {
  try {
    var s = requireAnySession_(token);
    if (!s.isSysAdmin) throw new Error('只有系统管理员可以切换身份。');
    if (s.realGroup == null) s.realGroup = s.group || '';
    if (!role || role === '管理员') {
      s.role = '管理员';
      s.group = s.realGroup;
      s.readOnly = false;
      s.viewAs = false;
    } else {
      var readOnly = role === '卸任';
      if (!readOnly && AUTH_ROLES_.indexOf(role) === -1) throw new Error('职位不正确。');
      if (group && AUTH_GROUPS_.indexOf(group) === -1) throw new Error('组别不正确。');
      s.role = role;
      s.group = group || '';
      s.readOnly = readOnly;
      s.viewAs = true;
    }
    CacheService.getScriptCache().put('BOQ_SESSION_' + String(token), JSON.stringify(s), 21600);
    return { success: true, user: s };
  } catch (err) {
    return { success: false, message: err.message };
  }
}


/* ============================================================
   事奉轮值表（文书 / 财政 / 查账 / 行政组 / 管理员）
   ------------------------------------------------------------
   「事奉名单」：每个岗位可以排谁（下方名单，可在后台调整）。
   「轮值草稿」：半年轮值表的草稿（JSON），可以存草稿、再发布。
   发布时会直接写进「节目」的各岗位栏位，公开页面和后台节目会一起更新。
   ============================================================ */

var ROSTER_POSITIONS_ = ['负责组', '领会', '经节手册', '领唱/助唱', '司琴/吉他手', '电脑控制员', '招待员'];
var ROSTER_POOL_SHEET_ = '事奉名单';
var ROSTER_POOL_HEADERS_ = ['名单编号', '岗位', '姓名', '排序', '备注', '更新时间'];
var ROSTER_DRAFT_SHEET_ = '轮值草稿';
var ROSTER_DRAFT_HEADERS_ = ['草稿编号', '标题', '开始日期', '结束日期', '内容', '状态', '更新人', '更新时间', '发布人', '发布时间'];

function roster_canEdit_(s) {
  if (!s || s.readOnly) return false;
  return ['管理员', '文书', '财政', '查账'].indexOf(String(s.role || '')) !== -1 ||
    ['行政组', '文书', '财政', '查账'].indexOf(String(s.group || '')) !== -1;
}

function roster_require_(token) {
  var s = requireAdminSession_(token);
  if (!roster_canEdit_(s)) throw new Error('只有文书、财政、查账和行政组可以编辑轮值表。');
  return s;
}

function roster_day_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, 'Asia/Kuala_Lumpur', 'yyyy-MM-dd');
  return String(v || '').slice(0, 10);
}

function getRosterData(token) {
  try {
    roster_require_(token);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var pool = claim_getObjects_(ensureTab_(ROSTER_POOL_SHEET_, ROSTER_POOL_HEADERS_))
      .filter(function(r) { return String(r['岗位'] || '').trim() && String(r['姓名'] || '').trim(); })
      .map(function(r) { return { position: String(r['岗位']).trim(), name: String(r['姓名']).trim(), order: Number(r['排序']) || 0, note: String(r['备注'] || '') }; });
    var drafts = claim_getObjects_(ensureTab_(ROSTER_DRAFT_SHEET_, ROSTER_DRAFT_HEADERS_))
      .filter(function(d) { return String(d['草稿编号'] || '').trim(); })
      .map(function(d) {
        return { id: String(d['草稿编号']), title: String(d['标题'] || ''), start: roster_day_(d['开始日期']), end: roster_day_(d['结束日期']),
          status: String(d['状态'] || ''), updatedBy: String(d['更新人'] || ''), updatedAt: String(d['更新时间'] || '').replace('T', ' ').slice(0, 16),
          publishedBy: String(d['发布人'] || ''), publishedAt: String(d['发布时间'] || '').replace('T', ' ').slice(0, 16) };
      });
    var events = claim_getObjects_(ss.getSheetByName('节目')).filter(function(e) {
      return String(e['节目编号'] || '').trim() && String(e['状态'] || '').toUpperCase() !== 'INACTIVE';
    }).map(function(e) {
      var a = {};
      ROSTER_POSITIONS_.forEach(function(p) { a[p] = String(e[p] || ''); });
      return { id: String(e['节目编号']), date: roster_day_(e['日期']), name: String(e['节目名称'] || ''), status: String(e['状态'] || ''), note: String(e['主题'] || ''), assign: a };
    });
    var members = claim_getObjects_(ss.getSheetByName('契友')).filter(function(m) {
      return String(m['状态'] || '').toUpperCase() !== 'INACTIVE';
    }).map(function(m) { return String(m['姓名'] || '').trim(); }).filter(String);
    var cyR = term_currentYear_();
    var allTerms = term_read_().terms;
    var staff = {};
    [cyR, cyR + 1].forEach(function(y) {
      var s = { groups: {}, admin: [] };
      allTerms.forEach(function(t) {
        if (Number(t['年份']) !== y || String(t['状态']) !== '在任') return;
        var role = String(t['职位'] || '').trim(), group = String(t['组别'] || '').trim(), name = String(t['人名'] || '').trim();
        if (!name) return;
        if (EXEC_ROLES_.indexOf(role) !== -1) s.admin.push({ role: role, name: name });
        if (MIN_GROUPS.indexOf(group) !== -1 && group !== '行政组') {
          if (!s.groups[group]) s.groups[group] = [];
          if (s.groups[group].indexOf(name) === -1) s.groups[group].push(name);
        }
      });
      s.admin.sort(function(a, b) { return EXEC_ROLES_.indexOf(a.role) - EXEC_ROLES_.indexOf(b.role); });
      staff[y] = s;
    });
    // 每个日期是哪一组的事工（事工的「计划日期」或关联的节目日期），用来自动带出负责组
    var evDateById = {};
    events.forEach(function(e) { evDateById[e.id] = e.date; });
    var ministryDates = [];
    claim_getObjects_(ss.getSheetByName(MIN_SHEET_MINISTRY)).forEach(function(m) {
      if (String(m['状态'] || '') === '已停用') return;
      var g = ministryNormalizeGroup_(m['组别']);
      if (!g) return;
      var link = String(m['关联节目编号'] || m['节目编号'] || '').trim();
      var linked = !!(link && evDateById[link]);
      var d = linked ? evDateById[link] : roster_day_(m['计划日期']);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
      ministryDates.push({ date: d, group: g, name: String(m['事工名称'] || ''), id: String(m['事工编号'] || ''), linked: linked });
    });
    // 不活跃的契友（手动或超龄自动），自动排表时要跳过
    var inactive = [];
    claim_getObjects_(ss.getSheetByName('契友')).forEach(function(m) {
      if (String(m['状态'] || '').toUpperCase() !== 'INACTIVE') return;
      [m['姓名'], m['称呼']].forEach(function(n) { n = String(n || '').trim(); if (n && inactive.indexOf(n) === -1) inactive.push(n); });
    });
    return { success: true, positions: ROSTER_POSITIONS_, groups: MIN_GROUPS.slice(), pool: pool, drafts: drafts, events: events, members: members, staff: staff, currentYear: cyR, inactive: inactive, ministryDates: ministryDates };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function getRosterDraft(token, draftId) {
  try {
    roster_require_(token);
    var t = auth_readTable_(ensureTab_(ROSTER_DRAFT_SHEET_, ROSTER_DRAFT_HEADERS_));
    var row = auth_findBy_(t.rows, '草稿编号', draftId);
    if (!row) throw new Error('找不到这份草稿。');
    var content = {};
    try { content = JSON.parse(String(row['内容'] || '{}')); } catch (e) {}
    return { success: true, draft: { id: draftId, title: String(row['标题'] || ''), start: roster_day_(row['开始日期']), end: roster_day_(row['结束日期']), status: String(row['状态'] || ''), weeks: content.weeks || [] } };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/** 下方「各岗位名单」整份保存。rows：[{position, name, order, note}] */
function saveRosterPool(token, rows) {
  var lock = LockService.getScriptLock();
  try {
    roster_require_(token);
    lock.waitLock(15000);
    var sheet = ensureTab_(ROSTER_POOL_SHEET_, ROSTER_POOL_HEADERS_);
    var headers = claim_getHeaders_(sheet);
    var now = new Date();
    var clean = (rows || []).filter(function(r) {
      return r && ROSTER_POSITIONS_.indexOf(String(r.position)) !== -1 && String(r.name || '').trim();
    }).map(function(r, i) {
      var o = { '名单编号': 'POOL-' + (i + 1), '岗位': String(r.position), '姓名': String(r.name).trim().slice(0, 40), '排序': Number(r.order) || i + 1, '备注': String(r.note || '').slice(0, 100), '更新时间': now };
      return headers.map(function(h) { return o.hasOwnProperty(h) ? o[h] : ''; });
    });
    if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).clearContent();
    if (clean.length) sheet.getRange(2, 1, clean.length, headers.length).setValues(clean);
    invalidateSheetCache_(sheet);
    return { success: true, message: '名单已保存（' + clean.length + ' 人次）。' };
  } catch (err) {
    return { success: false, message: err.message };
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function roster_saveDraft_(session, draft, status) {
  var sheet = ensureTab_(ROSTER_DRAFT_SHEET_, ROSTER_DRAFT_HEADERS_);
  var t = auth_readTable_(sheet);
  var weeks = (draft.weeks || []).map(function(w) {
    var a = {};
    ROSTER_POSITIONS_.forEach(function(p) { a[p] = String((w.assign || {})[p] || '').trim().slice(0, 60); });
    return { date: String(w.date || '').slice(0, 10), eventName: String(w.eventName || '').slice(0, 60), suspended: !!w.suspended, note: String(w.note || '').slice(0, 100), assign: a };
  }).filter(function(w) { return /^\d{4}-\d{2}-\d{2}$/.test(w.date); });
  var json = JSON.stringify({ weeks: weeks });
  if (json.length > 45000) throw new Error('轮值表太大了，请缩短期间。');
  var obj = {
    '标题': String(draft.title || '').slice(0, 60), '开始日期': String(draft.start || ''), '结束日期': String(draft.end || ''),
    '内容': json, '状态': status, '更新人': session.name || '', '更新时间': new Date()
  };
  var row = draft.id ? auth_findBy_(t.rows, '草稿编号', draft.id) : null;
  if (row) {
    auth_setCells_(sheet, t.headers, row._row, obj);
    return { id: String(draft.id), weeks: weeks, row: row._row, headers: t.headers, sheet: sheet };
  }
  obj['草稿编号'] = claim_createId_(sheet, '草稿编号', 'RST');
  auth_appendRow_(sheet, t.headers, obj);
  return { id: obj['草稿编号'], weeks: weeks, row: sheet.getLastRow(), headers: t.headers, sheet: sheet };
}

function saveRosterDraft(token, draft) {
  try {
    var s = roster_require_(token);
    var r = roster_saveDraft_(s, draft || {}, '草稿');
    return { success: true, id: r.id, message: '草稿已保存。' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/** 发布：把轮值表写进「节目」。没有节目的日期会自动建立；暂停的日期标为「暂停」。 */
function publishRosterDraft(token, draft) {
  var lock = LockService.getScriptLock();
  try {
    var s = roster_require_(token);
    lock.waitLock(20000);
    var saved = roster_saveDraft_(s, draft || {}, '已发布');
    auth_setCells_(saved.sheet, saved.headers, saved.row, { '发布人': s.name || '', '发布时间': new Date() });

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('节目');
    ensureHeaders_(sheet, ROSTER_POSITIONS_.concat(['主题']));
    var t = auth_readTable_(sheet);
    var headers = t.headers;
    var byDate = {}, ids = {};
    t.rows.forEach(function(r) {
      ids[String(r['节目编号'])] = true;
      if (String(r['状态'] || '').toUpperCase() === 'INACTIVE' || !r['日期']) return;
      var key = roster_day_(r['日期']);
      if (!byDate[key]) byDate[key] = r;
    });

    var newRows = [], updated = 0, created = 0, paused = 0, now = new Date();
    saved.weeks.forEach(function(w) {
      var row = byDate[w.date];
      var set = { '更新日期': now };
      if (w.suspended) {
        // 不排人：节目名称是「暂停聚会」或空白 → 暂停；否则是照常的特别聚会（例如教区青团），说明写在主题
        var isPause = !w.eventName || w.eventName === '暂停聚会';
        set['状态'] = isPause ? '暂停' : 'ACTIVE';
        set['主题'] = w.note || (isPause ? '暂停聚会' : '');
        set['节目名称'] = w.eventName || '暂停聚会';
        ROSTER_POSITIONS_.forEach(function(p) { set[p] = ''; });
        paused++;
      } else {
        set['状态'] = 'ACTIVE';
        ROSTER_POSITIONS_.forEach(function(p) { set[p] = w.assign[p] || ''; });
        if (w.eventName) set['节目名称'] = w.eventName;
        if (row && String(row['状态'] || '') === '暂停' && String(row['主题'] || '').indexOf('暂停') !== -1) set['主题'] = '';
      }
      if (row) {
        var values = headers.map(function(h) { return set.hasOwnProperty(h) ? set[h] : (row.hasOwnProperty(h) ? row[h] : ''); });
        sheet.getRange(row._row, 1, 1, headers.length).setValues([values]);
        updated++;
      } else {
        var id = 'EVT-' + w.date.replace(/-/g, '');
        var n = 2;
        while (ids[id]) { id = 'EVT-' + w.date.replace(/-/g, '') + '-' + n; n++; }
        ids[id] = true;
        var parts = w.date.split('-');
        var obj = {
          '节目编号': id, '日期': new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])),
          '节目名称': set['节目名称'] || w.eventName || '青年团契聚会', '地点': '播恩堂', '公开显示': '是', '建立时间': now
        };
        Object.keys(set).forEach(function(k) { if (!obj.hasOwnProperty(k)) obj[k] = set[k]; });
        newRows.push(headers.map(function(h) { return obj.hasOwnProperty(h) ? obj[h] : ''; }));
        created++;
      }
    });
    if (newRows.length) sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, headers.length).setValues(newRows);
    invalidateSheetCache_(sheet);
    writeLog_(token, '发布轮值表', '节目', saved.id, (draft.title || '') + '｜更新 ' + updated + '，新增 ' + created + '，暂停 ' + paused);
    return { success: true, id: saved.id, message: '已发布：更新 ' + updated + ' 个节目，新增 ' + created + ' 个，不排人 ' + paused + ' 个。公开页面和节目列表已同步。' };
  } catch (err) {
    return { success: false, message: err.message };
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

/** 单一节目的事奉人员（「安排事奉」视窗），与轮值表写入同一组栏位。 */
function saveEventRoster(token, eventId, assign) {
  try {
    var s = requireAdminSession_(token);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('节目');
    var row = claim_findRow_(sheet, '节目编号', eventId);
    if (row < 2) throw new Error('找不到这个节目。');
    var headers = claim_getHeaders_(sheet);
    perm_requireEventEdit_(s, claim_getObjectByRow_(sheet, row, headers));
    var exec = perm_isExec_(s);
    var values = sheet.getRange(row, 1, 1, headers.length).getValues()[0];
    ROSTER_POSITIONS_.forEach(function(p) {
      if (p === '负责组' && !exec) return; // 负责组只有行政组可以改
      var c = headers.indexOf(p);
      if (c >= 0 && assign && assign.hasOwnProperty(p)) values[c] = String(assign[p] || '').trim().slice(0, 60);
    });
    var u = headers.indexOf('更新日期');
    if (u >= 0) values[u] = new Date();
    sheet.getRange(row, 1, 1, headers.length).setValues([values]);
    invalidateSheetCache_(sheet);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * 导出事奉人员表 PDF（横向 A4，样式跟纸本事奉表一样）。
 * 每三个月（一季）一页，每页有自己的标题和表格。
 * payload：{ title, rows:[{ date:'yyyy-mm-dd', dateText, eventName, special, note, assign }] }
 * 相邻内容一样的格子会自动合并；「不排人」的日期，说明会横跨所有岗位栏。
 */
function exportRosterPdf(token, payload) {
  try {
    roster_require_(token);
    payload = payload || {};
    var fileTitle = String(payload.title || '事奉人员表').trim().slice(0, 80) || '事奉人员表';
    var rows = (payload.rows || []).filter(function(r) { return /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || '')); }).slice(0, 120);
    if (!rows.length) throw new Error('这个范围没有日期。');
    rows.sort(function(a, b) { return String(a.date).localeCompare(String(b.date)); });

    // 按季度分组
    var groups = [], byKey = {};
    rows.forEach(function(r) {
      var y = Number(r.date.slice(0, 4)), m = Number(r.date.slice(5, 7));
      var key = y + '-Q' + Math.ceil(m / 3);
      if (!byKey[key]) { byKey[key] = { year: y, rows: [], months: [] }; groups.push(byKey[key]); }
      byKey[key].rows.push(r);
      if (byKey[key].months.indexOf(m) === -1) byKey[key].months.push(m);
    });

    var doc = DocumentApp.create(fileTitle);
    var body = doc.getBody();
    body.setPageWidth(842).setPageHeight(595);
    body.setMarginTop(34).setMarginBottom(28).setMarginLeft(28).setMarginRight(28);
    var titleParas = [];

    groups.forEach(function(g, gi) {
      var m1 = Math.min.apply(null, g.months), m2 = Math.max.apply(null, g.months);
      var title = g.year + '年播恩堂青团' + m1 + '月' + (m2 !== m1 ? '至' + m2 + '月' : '') + '事奉人员表';
      var tp;
      if (gi === 0) { tp = body.getParagraphs()[0]; tp.setText(title); }
      else { body.appendPageBreak(); tp = body.appendParagraph(title); }
      tp.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
      tp.setSpacingBefore(0).setSpacingAfter(10);
      titleParas.push(tp);
      roster_appendPdfTable_(body, g.rows);
    });

    body.editAsText().setFontFamily('Noto Serif CJK SC');
    // 重新设定表格字体大小、标题样式（editAsText 会盖过）
    var tables = body.getTables();
    tables.forEach(function(t) { t.editAsText().setFontSize(10); });
    titleParas.forEach(function(tp) { tp.editAsText().setFontSize(15).setBold(true); });
    tables.forEach(function(t) {
      var hdr = t.getRow(0);
      for (var c = 0; c < hdr.getNumCells(); c++) hdr.getCell(c).editAsText().setBold(true).setForegroundColor('#FFFFFF');
    });
    doc.saveAndClose();

    // 只转成 PDF 传回给浏览器下载；暂存的文件马上删掉，不会留在 Drive
    var docFile = DriveApp.getFileById(doc.getId());
    var pdfBlob = docFile.getAs(MimeType.PDF);
    var b64 = Utilities.base64Encode(pdfBlob.getBytes());
    try { docFile.setTrashed(true); } catch (ignoreTrash) {}
    return { success: true, base64: b64, fileName: fileTitle + '.pdf', pages: groups.length };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/** 一季的表格：表头紫色；相邻相同内容合并；不排人的说明合并整排。 */
function roster_appendPdfTable_(body, rows) {
  var cols = ['日期', '节目'].concat(ROSTER_POSITIONS_);
  var data = [cols], spans = [], kinds = [];
  rows.forEach(function(r) {
    var line = [String(r.dateText || ''), String(r.eventName || '')];
    var span = [];
    if (r.special) {
      line.push(String(r.note || ''));
      for (var e = 1; e < ROSTER_POSITIONS_.length; e++) line.push('');
      span.push([2, cols.length - 1]);
      kinds.push('special');
    } else {
      var vals = ROSTER_POSITIONS_.map(function(p) { return String((r.assign || {})[p] || '').trim(); });
      var k = 0, merged = false;
      while (k < vals.length) {
        var j = k;
        while (vals[k] && j + 1 < vals.length && vals[j + 1] === vals[k]) j++;
        line.push(vals[k] || '-');
        for (var x = k + 1; x <= j; x++) line.push('');
        if (j > k) { span.push([2 + k, 2 + j]); merged = true; }
        k = j + 1;
      }
      kinds.push(merged ? 'merged' : 'normal');
    }
    data.push(line);
    spans.push(span);
  });

  var table = body.appendTable(data);
  table.setBorderColor('#333333');
  table.setBorderWidth(0.75);
  var rest = Math.floor((842 - 56 - 78 - 112) / ROSTER_POSITIONS_.length);
  [78, 112].concat(ROSTER_POSITIONS_.map(function() { return rest; })).forEach(function(px, i) { table.setColumnWidth(i, px); });

  var tints = { special: '#DDEAF3', merged: '#E9F1E1', normal: null };
  for (var ri = 0; ri < table.getNumRows(); ri++) {
    var row = table.getRow(ri);
    var bg = ri === 0 ? '#5B3F78' : tints[kinds[ri - 1]];
    for (var ci = 0; ci < row.getNumCells(); ci++) {
      var cell = row.getCell(ci);
      cell.setPaddingTop(4).setPaddingBottom(4).setPaddingLeft(3).setPaddingRight(3);
      cell.setVerticalAlignment(DocumentApp.VerticalAlignment.CENTER);
      if (bg) cell.setBackgroundColor(bg);
      cell.getChild(0).asParagraph().setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    }
  }
  for (var rj = spans.length - 1; rj >= 0; rj--) {
    var rowEl = table.getRow(rj + 1);
    spans[rj].slice().sort(function(a, b) { return b[0] - a[0]; }).forEach(function(s) {
      for (var c = s[1]; c > s[0]; c--) rowEl.getCell(c).merge();
    });
  }
  return table;
}


/* ============================================================
   节目交换申请
   ------------------------------------------------------------
   负责组的职员想把自己的节目和另一个日期的节目对调：
   1. 送出申请 → Email 通知行政组和对方负责组。
   2. 行政组其中一人批准 + 对方负责组其中一人批准（对方没有负责组或同一组就只要行政组）。
   3. 两边都批准后自动交换：两天的「节目名称、主题、负责组、领会」对调，
      其他事奉岗位（经节手册、领唱、司琴、电脑、招待）留在原来的日期。
      两组相关的事工日期 / 关联节目、轮值表草稿也一起更新；公开首页读同一张表，自动更新。
   ============================================================ */

var SWAP_SHEET_ = '节目交换';
var SWAP_HEADERS_ = ['申请编号', '申请时间', '申请人', '申请人用户编号', '申请人组别',
  '节目编号', '节目日期', '节目名称', '负责组', '对方节目编号', '对方日期', '对方节目名称', '对方负责组',
  '原因', '状态', '行政组批准人', '行政组批准时间', '对方组批准人', '对方组批准时间', '处理备注', '完成时间'];
var SWAP_FIELDS_ = ['节目名称', '主题', '负责组', '领会'];
var SWAP_NOT_NEEDED_ = '（不需要）';

function swap_sheet_() {
  var sheet = ensureTab_(SWAP_SHEET_, SWAP_HEADERS_);
  ensureHeaders_(sheet, SWAP_HEADERS_);
  return sheet;
}

function swap_isExec_(s) { return perm_isExec_(s); }
function swap_inGroup_(s, group) {
  return !!(s && !s.readOnly && group && ministryNormalizeGroup_(s.group) === ministryNormalizeGroup_(group));
}
function swap_dateObj_(day) {
  var p = String(day).split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}
function swap_md_(day) {
  var p = String(day || '').split('-');
  return p.length === 3 ? Number(p[2]) + '/' + Number(p[1]) + '/' + p[0] : String(day || '');
}
function swap_readEvents_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('节目');
  var t = auth_readTable_(sheet);
  return { sheet: sheet, headers: t.headers, rows: t.rows.filter(function(r) { return String(r['节目编号'] || '').trim(); }) };
}
function swap_execEmails_() {
  var out = notify_emailsByRole_(EXEC_ROLES_);
  notify_emailsByGroup_('行政组').forEach(function(e) { if (out.indexOf(e) === -1) out.push(e); });
  return out;
}
function swap_userEmail_(userId, name) {
  var u = auth_findBy_(auth_readUsers_().users, '用户编号', userId);
  var e = u ? String(u['邮箱'] || '').trim() : '';
  return e || notify_emailByName_(name);
}
function swap_desc_(r) {
  return swap_md_(roster_day_(r['节目日期'])) + '「' + (r['节目名称'] || '') + '」（' + (r['负责组'] || '-') + '）⇄ ' +
    swap_md_(roster_day_(r['对方日期'])) + '「' + (r['对方节目名称'] || '') + '」（' + (r['对方负责组'] || '-') + '）';
}

/** 送出交换申请。data：{ eventId, targetId, reason } */
function requestProgramSwap(token, data) {
  var lock = LockService.getScriptLock();
  try {
    var s = requireAdminSession_(token);
    data = data || {};
    lock.waitLock(15000);
    var ev = swap_readEvents_();
    var a = auth_findBy_(ev.rows, '节目编号', data.eventId);
    var b = auth_findBy_(ev.rows, '节目编号', data.targetId);
    if (!a || !b) throw new Error('找不到节目，请重新载入后再试。');
    if (String(a['节目编号']) === String(b['节目编号'])) throw new Error('请选择另一个日期的节目。');
    var today = roster_day_(auth_today_());
    [a, b].forEach(function(e) {
      if (String(e['状态'] || '').toUpperCase() === 'INACTIVE' || String(e['状态'] || '') === '暂停') throw new Error('「' + (e['节目名称'] || '') + '」已停用或暂停，不能交换。');
      if (roster_day_(e['日期']) < today) throw new Error('已经过去的节目不能交换。');
    });
    var ga = ministryNormalizeGroup_(a['负责组']), gb = ministryNormalizeGroup_(b['负责组']);
    if (!swap_isExec_(s) && !swap_inGroup_(s, ga)) throw new Error('只有「' + (ga || '负责组') + '」的职员或行政组可以申请交换这个节目。');

    var sheet = swap_sheet_();
    var t = auth_readTable_(sheet);
    var busy = t.rows.filter(function(r) {
      return String(r['状态']) === '待批准' && [r['节目编号'], r['对方节目编号']].some(function(x) { return x === a['节目编号'] || x === b['节目编号']; });
    });
    if (busy.length) throw new Error('这两个节目其中一个已经有等待批准的交换申请（' + busy[0]['申请编号'] + '），请等那个处理完。');

    var needGroup = gb && gb !== ga;
    var id = claim_createId_(sheet, '申请编号', 'SWP');
    var row = {
      '申请编号': id, '申请时间': new Date(), '申请人': s.name || '', '申请人用户编号': s.userId || '', '申请人组别': s.group || '',
      '节目编号': a['节目编号'], '节目日期': swap_dateObj_(roster_day_(a['日期'])), '节目名称': a['节目名称'] || '', '负责组': ga,
      '对方节目编号': b['节目编号'], '对方日期': swap_dateObj_(roster_day_(b['日期'])), '对方节目名称': b['节目名称'] || '', '对方负责组': gb,
      '原因': String(data.reason || '').slice(0, 300), '状态': '待批准',
      '对方组批准人': needGroup ? '' : SWAP_NOT_NEEDED_
    };
    auth_appendRow_(sheet, t.headers, row);
    writeLog_(token, '申请交换节目', SWAP_SHEET_, id, swap_desc_(row));

    var lines = [s.name + '（' + (s.group || '') + '）申请交换节目：', '', swap_desc_(row), row['原因'] ? '原因：' + row['原因'] : '', '',
      needGroup ? '需要：行政组其中一人批准，以及「' + gb + '」其中一人批准。' : '需要：行政组其中一人批准。',
      '请到后台「节目事奉」页上方的「节目交换申请」批准或不批准。'];
    var to = swap_execEmails_();
    if (needGroup) notify_emailsByGroup_(gb).forEach(function(e) { if (to.indexOf(e) === -1) to.push(e); });
    var me = String(s.email || '').toLowerCase();
    notify_send_(to.filter(function(e) { return e !== me; }), [], '节目交换申请：' + swap_md_(roster_day_(a['日期'])) + ' ⇄ ' + swap_md_(roster_day_(b['日期'])), lines);
    return { success: true, id: id, message: '已送出申请，行政组' + (needGroup ? '和「' + gb + '」' : '') + '会收到 Email。批准后节目会自动交换。' };
  } catch (err) {
    return { success: false, message: err.message };
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

/** 批准：系统会自动判断你是以「行政组」还是「对方负责组」身份批准。两边都批准后马上交换。 */
function approveProgramSwap(token, id) {
  var lock = LockService.getScriptLock();
  try {
    var s = requireAdminSession_(token);
    lock.waitLock(20000);
    var sheet = swap_sheet_();
    var t = auth_readTable_(sheet);
    var r = auth_findBy_(t.rows, '申请编号', id);
    if (!r) throw new Error('找不到这个申请。');
    if (String(r['状态']) !== '待批准') throw new Error('这个申请已经是「' + r['状态'] + '」。');
    if (String(r['申请人用户编号'] || '') && String(r['申请人用户编号']) === String(s.userId || '')) throw new Error('不能批准自己的申请，要由其他人批准。');
    var set = {}, as = [];
    if (!String(r['行政组批准人'] || '') && swap_isExec_(s)) { set['行政组批准人'] = s.name; set['行政组批准时间'] = new Date(); as.push('行政组'); }
    if (!String(r['对方组批准人'] || '') && swap_inGroup_(s, r['对方负责组'])) { set['对方组批准人'] = s.name; set['对方组批准时间'] = new Date(); as.push(r['对方负责组']); }
    if (!as.length) throw new Error('你不需要批准这个申请（要由行政组或「' + (r['对方负责组'] || '对方负责组') + '」批准，或你那一份已经批准了）。');
    auth_setCells_(sheet, t.headers, r._row, set);
    Object.keys(set).forEach(function(k) { r[k] = set[k]; });
    writeLog_(token, '批准交换节目', SWAP_SHEET_, id, as.join('、'));

    var reqEmail = swap_userEmail_(r['申请人用户编号'], r['申请人']);
    if (String(r['行政组批准人'] || '') && String(r['对方组批准人'] || '')) {
      var done = swap_apply_(r, s);
      auth_setCells_(sheet, t.headers, r._row, { '状态': '已批准', '完成时间': new Date(), '处理备注': done.note });
      var to = [reqEmail].concat(notify_emailsByGroup_(ministryNormalizeGroup_(r['负责组'])));
      if (r['对方负责组']) notify_emailsByGroup_(ministryNormalizeGroup_(r['对方负责组'])).forEach(function(e) { if (to.indexOf(e) === -1) to.push(e); });
      notify_send_(to.filter(String), swap_execEmails_(), '节目已交换：' + swap_md_(roster_day_(r['节目日期'])) + ' ⇄ ' + swap_md_(roster_day_(r['对方日期'])),
        ['节目交换申请已批准，系统已经交换好了：', '', swap_desc_(r), '',
         '行政组批准：' + r['行政组批准人'] + (r['对方组批准人'] !== SWAP_NOT_NEEDED_ ? '　' + r['对方负责组'] + '批准：' + r['对方组批准人'] : ''),
         done.note, '', '节目列表、公开首页和事工日期已经更新。排轮值表的同工请到「轮值表」按「同步节目」。']);
      return { success: true, applied: true, message: '已批准，节目已经交换。' + done.note };
    }
    var waiting = !String(r['行政组批准人'] || '') ? '行政组' : r['对方负责组'];
    if (reqEmail) notify_send_([reqEmail], [], '交换申请：' + as.join('、') + ' 已批准',
      ['你的节目交换申请：', swap_desc_(r), '', s.name + '（' + as.join('、') + '）已批准，现在等待「' + waiting + '」批准。']);
    return { success: true, applied: false, message: '已批准，还要等「' + waiting + '」批准。' };
  } catch (err) {
    return { success: false, message: err.message };
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function rejectProgramSwap(token, id, note) {
  try {
    var s = requireAdminSession_(token);
    var sheet = swap_sheet_();
    var t = auth_readTable_(sheet);
    var r = auth_findBy_(t.rows, '申请编号', id);
    if (!r) throw new Error('找不到这个申请。');
    if (String(r['状态']) !== '待批准') throw new Error('这个申请已经是「' + r['状态'] + '」。');
    if (!swap_isExec_(s) && !swap_inGroup_(s, r['对方负责组'])) throw new Error('只有行政组或「' + (r['对方负责组'] || '对方负责组') + '」可以不批准。');
    note = String(note || '').slice(0, 200);
    auth_setCells_(sheet, t.headers, r._row, { '状态': '未通过', '处理备注': s.name + ' 不批准' + (note ? '：' + note : ''), '完成时间': new Date() });
    writeLog_(token, '不批准交换节目', SWAP_SHEET_, id, note);
    var reqEmail = swap_userEmail_(r['申请人用户编号'], r['申请人']);
    if (reqEmail) notify_send_([reqEmail], [], '交换申请未通过', ['你的节目交换申请：', swap_desc_(r), '', s.name + ' 不批准。' + (note ? '原因：' + note : ''), '节目维持原来的日期。']);
    return { success: true, message: '已记录不批准，申请人会收到 Email。' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function cancelProgramSwap(token, id) {
  try {
    var s = requireAdminSession_(token);
    var sheet = swap_sheet_();
    var t = auth_readTable_(sheet);
    var r = auth_findBy_(t.rows, '申请编号', id);
    if (!r) throw new Error('找不到这个申请。');
    if (String(r['状态']) !== '待批准') throw new Error('这个申请已经是「' + r['状态'] + '」。');
    var mine = String(r['申请人用户编号'] || '') === String(s.userId || '') || String(r['申请人']) === String(s.name);
    if (!mine && !perm_isAdmin_(s)) throw new Error('只有申请人自己可以取消。');
    auth_setCells_(sheet, t.headers, r._row, { '状态': '已取消', '处理备注': s.name + ' 取消', '完成时间': new Date() });
    return { success: true, message: '申请已取消。' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/** 真正交换：节目表 + 事工 + 轮值表草稿。回传 { note }。 */
function swap_apply_(r, s) {
  var ev = swap_readEvents_();
  var a = auth_findBy_(ev.rows, '节目编号', r['节目编号']);
  var b = auth_findBy_(ev.rows, '节目编号', r['对方节目编号']);
  if (!a || !b) throw new Error('其中一个节目已经被删除，不能交换。');
  var dA = roster_day_(a['日期']), dB = roster_day_(b['日期']);
  if (dA !== roster_day_(r['节目日期']) || dB !== roster_day_(r['对方日期']) ||
      ministryNormalizeGroup_(a['负责组']) !== ministryNormalizeGroup_(r['负责组']) || ministryNormalizeGroup_(b['负责组']) !== ministryNormalizeGroup_(r['对方负责组'])) {
    throw new Error('申请之后节目的日期或负责组已经被改过，请取消这个申请，重新申请。');
  }
  // 1. 节目表：两行的节目名称、主题、负责组、领会对调
  ensureHeaders_(ev.sheet, SWAP_FIELDS_);
  var headers = claim_getHeaders_(ev.sheet);
  var now = new Date();
  [[a, b], [b, a]].forEach(function(pair) {
    var row = pair[0], from = pair[1];
    var vals = ev.sheet.getRange(row._row, 1, 1, headers.length).getValues()[0];
    SWAP_FIELDS_.forEach(function(f) { var c = headers.indexOf(f); if (c >= 0) vals[c] = from.hasOwnProperty(f) ? from[f] : ''; });
    var u = headers.indexOf('更新日期'); if (u >= 0) vals[u] = now;
    ev.sheet.getRange(row._row, 1, 1, headers.length).setValues([vals]);
  });
  invalidateSheetCache_(ev.sheet);

  // 2. 事工：两组相关的事工换日期、改关联节目
  var gA = ministryNormalizeGroup_(a['负责组']), gB = ministryNormalizeGroup_(b['负责组']);
  var idA = String(a['节目编号']), idB = String(b['节目编号']);
  var moved = 0;
  var msheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MIN_SHEET_MINISTRY);
  if (msheet) {
    var mt = auth_readTable_(msheet);
    var plan = [];
    mt.rows.forEach(function(m) {
      if (!String(m['事工编号'] || '').trim() || String(m['状态'] || '') === '已停用') return;
      var g = ministryNormalizeGroup_(m['组别']);
      var link = String(m['关联节目编号'] || m['节目编号'] || '').trim();
      var pd = roster_day_(m['计划日期'] || m['计划时间']);
      if (gA && g === gA && (link === idA || (!link && pd === dA))) plan.push({ m: m, day: dB, id: link ? idB : '', from: dA });
      else if (gB && g === gB && (link === idB || (!link && pd === dB))) plan.push({ m: m, day: dA, id: link ? idA : '', from: dB });
    });
    plan.forEach(function(p) {
      var set = { '计划日期': swap_dateObj_(p.day), '计划时间': swap_dateObj_(p.day),
        '备注': (String(p.m['备注'] || '') ? String(p.m['备注']) + '；' : '') + '交换节目 ' + swap_md_(p.from) + ' → ' + swap_md_(p.day) + '（' + r['申请编号'] + '）',
        '更新者': s.name || '', '更新时间': now };
      if (p.id) { set['节目编号'] = p.id; set['关联节目编号'] = p.id; }
      auth_setCells_(msheet, mt.headers, p.m._row, set);
      moved++;
    });
  }

  // 3. 轮值表草稿：这两天的节目名称、负责组、领会也一起换
  var drafts = 0;
  try {
    var dsheet = ensureTab_(ROSTER_DRAFT_SHEET_, ROSTER_DRAFT_HEADERS_);
    var dt = auth_readTable_(dsheet);
    var nowA = { name: String(b['节目名称'] || ''), g: String(b['负责组'] || ''), l: String(b['领会'] || '') };
    var nowB = { name: String(a['节目名称'] || ''), g: String(a['负责组'] || ''), l: String(a['领会'] || '') };
    dt.rows.forEach(function(d) {
      var c; try { c = JSON.parse(String(d['内容'] || '{}')); } catch (e) { return; }
      var changed = false;
      (c.weeks || []).forEach(function(w) {
        var v = w.date === dA ? nowA : w.date === dB ? nowB : null;
        if (!v || w.suspended) return;
        w.eventName = v.name; w.assign = w.assign || {}; w.assign['负责组'] = v.g; w.assign['领会'] = v.l; changed = true;
      });
      if (changed) { auth_setCells_(dsheet, dt.headers, d._row, { '内容': JSON.stringify(c) }); drafts++; }
    });
  } catch (e) {}

  writeLog_('', '交换节目', '节目', idA + '⇄' + idB, swap_desc_(r) + '｜事工 ' + moved + '｜草稿 ' + drafts);
  return { note: '已更新 ' + moved + ' 个相关事工的日期' + (drafts ? '，' + drafts + ' 份轮值表' : '') + '。' };
}

/** 后台载入用：所有待批准的 + 最近 15 个已处理的交换申请。 */
function swap_list_(ss) {
  try {
    var sh = ss.getSheetByName(SWAP_SHEET_);
    if (!sh) return [];
    var all = claim_getObjects_(sh).filter(function(r) { return String(r['申请编号'] || '').trim(); });
    var pending = all.filter(function(r) { return String(r['状态']) === '待批准'; });
    var done = all.filter(function(r) { return String(r['状态']) !== '待批准'; }).slice(-15);
    return pending.concat(done);
  } catch (e) { return []; }
}
