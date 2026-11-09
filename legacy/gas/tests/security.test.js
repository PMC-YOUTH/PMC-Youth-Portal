const { makeEnv } = require('./gas-mock.js');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; } else { fail++; console.log('FAIL:', msg); } };
const YEAR = new Date().getFullYear();
function setup(opts) {
  const g = makeEnv(opts);
  g.__mk('系统设置', ['设置项目', '设置内容', '说明'], [{ '设置项目': '当届年份', '设置内容': YEAR }]);
  g.__mk('用户', ['用户编号', '人名', '邮箱', '电话号码', '状态', '系统管理员', '建立时间', '最后登录', '密码哈希', '密码盐'], [
    { '用户编号': 'USR-1', '人名': '财政A', '邮箱': 'fin@x.com', '状态': 'ACTIVE' },
    { '用户编号': 'USR-2', '人名': '查账B', '邮箱': 'aud@x.com', '状态': 'ACTIVE' },
    { '用户编号': 'USR-3', '人名': '团契C', '邮箱': 'fel@x.com', '状态': 'ACTIVE' },
    { '用户编号': 'USR-4', '人名': '主席D', '邮箱': 'chair@x.com', '状态': 'ACTIVE' },
    { '用户编号': 'USR-5', '人名': '旧人E', '邮箱': 'old@x.com', '状态': 'ACTIVE' },
    { '用户编号': 'USR-6', '人名': '系统F', '邮箱': 'sys@x.com', '状态': 'ACTIVE', '系统管理员': '是' },
  ]);
  g.__mk('职员任期', ['任期编号', '年份', '用户编号', '人名', '组别', '职位', '状态', '开始日期', '结束日期', '备注', '建立时间'], [
    { '任期编号': 'T1', '年份': YEAR, '用户编号': 'USR-1', '人名': '财政A', '组别': '行政组', '职位': '财政', '状态': '在任' },
    { '任期编号': 'T2', '年份': YEAR, '用户编号': 'USR-2', '人名': '查账B', '组别': '行政组', '职位': '查账', '状态': '在任' },
    { '任期编号': 'T3', '年份': YEAR, '用户编号': 'USR-3', '人名': '团契C', '组别': '团契组', '职位': '职员', '状态': '在任' },
    { '任期编号': 'T4', '年份': YEAR, '用户编号': 'USR-4', '人名': '主席D', '组别': '行政组', '职位': '主席', '状态': '在任' },
    { '任期编号': 'T5', '年份': YEAR - 1, '用户编号': 'USR-5', '人名': '旧人E', '组别': '信仰组', '职位': '职员', '状态': '已卸任' },
  ]);
  g.__mk('职员报销', ['报销编号', '申请人姓名', '申请人邮箱', '报销日期', '节目编号', '报销说明', '类别', '组别', '金额', '收据链接', '状态', '财政同步', '审核人', '审核备注', '审核时间', '建立时间'], [
    { '报销编号': 'CLM-0001', '申请人姓名': '团契C', '申请人邮箱': 'fel@x.com', '报销日期': '2026-11-01', '报销说明': '点心', '组别': '团契组', '金额': 50, '状态': 'PENDING', '财政同步': '否' },
    { '报销编号': 'CLM-0002', '申请人姓名': '财政A', '申请人邮箱': 'fin@x.com', '报销日期': '2026-11-01', '报销说明': '文具', '组别': '行政组', '金额': 20, '状态': 'PENDING', '财政同步': '否' },
    { '报销编号': 'CLM-0003', '申请人姓名': '团契C', '申请人邮箱': 'fel@x.com', '报销日期': '2026-11-02', '报销说明': '奖品', '组别': '团契组', '金额': 30, '状态': 'PENDING', '财政同步': '否' },
  ]);
  g.__mk('财政', ['交易编号', '交易日期', '类型', '类别', '组别', '说明', '金额', '参考编号', '账户', '记录人', '建立时间', '更新日期'], [
    { '交易编号': 'FIN-0001', '类型': '支出', '金额': 30, '参考编号': 'CLM-0003', '说明': '已存在' },
  ]);
  g.__mk('节目', ['节目编号', '日期', '节目名称', '主题', '地点', '负责组', '领会', '经节手册', '领唱/助唱', '司琴/吉他手', '电脑控制员', '招待员', '状态', '公开显示', '建立时间', '更新日期'], [
    { '节目编号': 'EVT-0001', '日期': new Date(YEAR + 1, 0, 10), '节目名称': '团契之夜', '负责组': '团契组', '状态': 'ACTIVE', '公开显示': '是' },
    { '节目编号': 'EVT-0002', '日期': new Date(YEAR + 1, 0, 17), '节目名称': '查经', '负责组': '信仰组', '状态': 'ACTIVE', '公开显示': '是' },
  ]);
  g.__mk('事奉人员', ['排表编号', '节目编号', '日期', '事奉岗位', '契友姓名', '状态', '建立时间', '更新日期'], [
    { '排表编号': 'ROS-0001', '节目编号': 'EVT-0002', '事奉岗位': '音响', '契友姓名': '甲', '状态': 'ACTIVE' }]);
  g.__mk('契友', ['契友编号', '姓名', '英文名', '电话号码', '生日', '小组', '入会状态', '状态', '状态原因', '需要关心', '备注', '建立时间', '更新日期'], [
    { '契友编号': 'CY-0001', '姓名': '小明', '电话号码': '012-3456789', '入会状态': '已入会', '状态': 'ACTIVE', '备注': '家里有事', '需要关心': '是' }]);
  g.__mk('意见箱', ['意见编号', '提交时间', '类别', '内容', '称呼', '联络方式', '状态', '处理备注', '处理人', '更新时间'], [
    { '意见编号': 'FB-0001', '类别': '代祷', '内容': '为家人祷告', '称呼': '无名', '联络方式': '011-111', '状态': '新' }]);
  g.__mk('会议记录', ['记录编号', '会议日期', '会议名称', '档案类型', '档案链接', '建立时间']);
  g.__mk('活动报告', ['报告编号', '节目编号', '日期', '标题', '内容', '封面照片链接', '照片资料夹链接', '公开显示', '建立者', '建立时间', '更新日期'], [
    { '报告编号': 'RPT-0001', '标题': '主席的报告', '建立者': '主席D' }]);
  g.__mk('节目交换', g.SWAP_HEADERS_);
  // mark schemas checked so getAdminEvents skips sheet creation
  ['ADMIN', 'MINISTRY', 'FIN'].forEach(f => g.markSchemaChecked_(f));
  const tok = {};
  const users = g.auth_readUsers_().users, terms = g.term_read_().terms;
  users.forEach(u => { const t = 'tok-' + u['用户编号']; g.__store['BOQ_SESSION_' + t] = JSON.stringify(g.auth_buildSession_(u, terms)); tok[u['人名']] = t; });
  g.__gridMemo_ = {};
  return { g, tok };
}
const fresh = g => { for (const k in g.__gridMemo_) delete g.__gridMemo_[k]; };

// 1. legacy API gone
{ const { g } = setup();
  ['loginStaff', 'createFirstAdmin', 'getAdminData', 'requirePermission_', 'getSession_', 'pinMatches_', 'logoutStaff', 'saveEvent', 'deleteEvent', 'saveRoster', 'deleteRoster', 'getClaimsForAdmin', 'getFinanceSummary']
    .forEach(n => ok(typeof g[n] === 'undefined', 'legacy still defined: ' + n)); }

// 2. reviewClaim
{ const { g, tok } = setup();
  let r = g.reviewClaim(tok['团契C'], 'CLM-0001', 'APPROVED', ''); ok(!r.success && /只有财政/.test(r.message), 'non-finance blocked: ' + r.message);
  r = g.reviewClaim(tok['财政A'], 'CLM-0001', 'MAYBE', ''); ok(!r.success, 'bad decision blocked');
  r = g.reviewClaim('', 'CLM-0001', 'APPROVED', ''); ok(!r.success && /登录已过期/.test(r.message), 'no token blocked');
  r = g.reviewClaim(tok['财政A'], 'CLM-0001', 'APPROVED', ''); ok(r.success, 'first approval ok ' + r.message);
  fresh(g); r = g.reviewClaim(tok['查账B'], 'CLM-0001', 'APPROVED', ''); ok(!r.success && /不能重复审核/.test(r.message), 'second approval blocked: ' + r.message);
  r = g.reviewClaim(tok['财政A'], 'CLM-0001', 'REJECTED', 'x'); ok(!r.success, 'reject after approve blocked');
  const fins = g.__rows('财政').filter(x => x['参考编号'] === 'CLM-0001'); ok(fins.length === 1, 'exactly one FIN for CLM-0001, got ' + fins.length);
  ok(g.__rows('职员报销')[0]['状态'] === 'APPROVED', 'status approved');
  r = g.reviewClaim(tok['财政A'], 'CLM-0002', 'APPROVED', ''); ok(!r.success && /自己的/.test(r.message), 'own claim blocked: ' + r.message);
  r = g.reviewClaim(tok['查账B'], 'CLM-0002', 'APPROVED', ''); ok(r.success, 'other reviewer can approve');
  r = g.reviewClaim(tok['查账B'], 'CLM-0003', 'APPROVED', ''); ok(r.success, 'approve claim with pre-existing FIN');
  ok(g.__rows('财政').filter(x => x['参考编号'] === 'CLM-0003').length === 1, 'pre-existing FIN not duplicated');
  // markClaimPaid twice
  r = g.markClaimPaid(tok['财政A'], 'CLM-0001', '现金', ''); ok(r.success, 'paid ok');
  r = g.markClaimPaid(tok['财政A'], 'CLM-0001', '现金', ''); ok(!r.success && /已经标记付款/.test(r.message), 'paid twice blocked');
  r = g.confirmClaimReceived(tok['查账B'], 'CLM-0001'); ok(!r.success, 'other cannot confirm received');
  r = g.confirmClaimReceived(tok['团契C'], 'CLM-0001'); ok(r.success, 'owner confirm');
  r = g.confirmClaimReceived(tok['团契C'], 'CLM-0001'); ok(r.success && /已经确认过/.test(r.message), 'confirm twice idempotent');
}

// 3. getAdminEvents field filtering
{ const { g, tok } = setup();
  let d = g.getAdminEvents(tok['团契C']); ok(d.success, 'staff load ' + d.message);
  ok(d.members.length === 1 && !('备注' in d.members[0]) && d.members[0]['电话号码'], 'staff: member remark stripped, phone kept');
  ok(d.feedback.length === 1 && !('联络方式' in d.feedback[0]), 'staff: feedback contact stripped');
  ok(d.perms && d.perms.exec === false && d.perms.memberPrivate === false, 'staff perms');
  ok(d.claims.every(c => c['组别'] === '团契组' || c['申请人姓名'] === '团契C'), 'staff sees only own/group claims');
  fresh(g); d = g.getAdminEvents(tok['主席D']); ok(d.members[0]['备注'] === '家里有事' && d.feedback[0]['联络方式'] === '011-111', 'chair sees private fields');
  ok(d.claims.length === 1, 'chair (not finance) claims filtered to own/group: ' + d.claims.length);
  fresh(g); d = g.getAdminEvents(tok['财政A']); ok(d.claims.length === 3, 'finance sees all claims');
  ok(!('备注' in d.members[0]), 'finance does not see member remark');
  fresh(g); d = g.getAdminEvents(tok['旧人E']); ok(d.success && d.members.length === 0 && d.feedback.length === 0 && d.swaps.length === 0, 'readOnly gets no members/feedback');
  ok(d.claims.length === 0, 'readOnly claims own only');
  let x = g.getFinanceData(tok['团契C'], YEAR); ok(!x.success, 'staff blocked from finance data');
  x = g.getFinanceData(tok['主席D'], YEAR); ok(!x.success, 'chair blocked from finance data');
  x = g.getFinanceReportPreview(tok['旧人E'], YEAR, 1); ok(!x.success, 'readOnly blocked from finance preview');
  x = g.listAccounts(tok['团契C']); ok(!x.success, 'staff blocked from accounts');
}

// 4. events
{ const { g, tok } = setup();
  let r = g.updateAdminEvent(tok['团契C'], { eventId: 'EVT-0002', name: '偷改', date: '2027-05-05' }); ok(!r.success && /自己组/.test(r.message), 'other group event blocked: ' + r.message);
  r = g.updateAdminEvent(tok['团契C'], { eventId: '', name: '新节目', date: '2027-05-05' }); ok(!r.success && /只有行政组/.test(r.message), 'non-exec cannot create');
  const before = g.__rows('节目')[0]['日期'];
  r = g.updateAdminEvent(tok['团契C'], { eventId: 'EVT-0001', name: '团契之夜2', date: '2030-01-01', group: '信仰组', status: 'INACTIVE', publicDisplay: '否' }); ok(r.success, 'own group edit ok ' + r.message);
  const e1 = g.__rows('节目')[0];
  ok(e1['节目名称'] === '团契之夜2' && e1['负责组'] === '团契组' && e1['状态'] === 'ACTIVE' && e1['公开显示'] === '是' && String(new Date(e1['日期']).getFullYear()) === String(YEAR + 1), 'exec-only fields untouched: ' + JSON.stringify(e1));
  r = g.updateAdminEvent(tok['主席D'], { eventId: 'EVT-0002', name: '查经', date: '2027-02-02', group: '信仰组', status: '暂停', publicDisplay: '是' }); ok(r.success && g.__rows('节目')[1]['状态'] === '暂停', 'exec can change status');
  r = g.updateAdminEvent(tok['主席D'], { eventId: 'EVT-9999', name: 'x' }); ok(!r.success, 'unknown event id rejected (no ghost create)');
  r = g.updateAdminEvent(tok['旧人E'], { eventId: 'EVT-0001', name: 'x' }); ok(!r.success, 'readOnly blocked');
  r = g.saveEventRoster(tok['团契C'], 'EVT-0002', { '领会': 'X' }); ok(!r.success, 'roster other group blocked');
  r = g.saveEventRoster(tok['团契C'], 'EVT-0001', { '领会': '阿C', '负责组': '信仰组' }); ok(r.success && g.__rows('节目')[0]['领会'] === '阿C' && g.__rows('节目')[0]['负责组'] === '团契组', 'own roster ok, group locked');
  r = g.deleteAdminRoster(tok['团契C'], 'ROS-0001'); ok(!r.success, 'delete extra roster of other group blocked');
  r = g.deleteAdminRoster(tok['主席D'], 'ROS-9999'); ok(!r.success && g.__rows('事奉人员').length === 1, 'delete unknown roster does not create row');
  r = g.saveAdminRoster(tok['团契C'], { eventId: 'EVT-0001', role: '音响', name: '乙' }); ok(r.success, 'add extra roster own event');
  r = g.saveAdminRoster(tok['团契C'], { eventId: 'EVT-0002', role: '音响', name: '乙' }); ok(!r.success, 'add extra roster other event blocked');
}

// 5. members / reports
{ const { g, tok } = setup();
  let r = g.saveAdminMember(tok['团契C'], { memberId: 'CY-0001', name: '小明', remark: '被改', active: true }); ok(r.success, 'staff edit member');
  ok(g.__rows('契友')[0]['备注'] === '家里有事', 'staff cannot overwrite remark');
  r = g.saveAdminMember(tok['主席D'], { memberId: 'CY-0001', name: '小明', remark: '已跟进', active: true }); ok(g.__rows('契友')[0]['备注'] === '已跟进', 'chair can edit remark');
  r = g.saveAdminMember(tok['旧人E'], { name: '某人' }); ok(!r.success, 'readOnly cannot add member');
  r = g.saveAdminMember(tok['主席D'], { memberId: 'CY-9999', name: '某人' }); ok(!r.success, 'unknown member id rejected');
  r = g.deleteActivityReport(tok['团契C'], 'RPT-0001'); ok(!r.success, 'cannot delete others report');
  r = g.saveActivityReport(tok['团契C'], { id: 'RPT-0001', title: 'hack' }); ok(!r.success, 'cannot edit others report');
}

// 6. maintenance & view-as
{ const { g, tok } = setup();
  const thr = f => { try { f(); return false; } catch (e) { return /编辑器/.test(e.message); } };
  ok(thr(() => g.initializePortalSheets()), 'initializePortalSheets editor-only');
  ok(thr(() => g.importSchedule2026()), 'importSchedule2026 editor-only');
  ok(thr(() => g.installReminderTrigger()), 'installReminderTrigger editor-only');
  ok(thr(() => g.initializeMinistrySystem()), 'initializeMinistrySystem editor-only');
  ok(thr(() => g.sendMeetingDeadlineReminders({ triggerUid: 'FAKE' })), 'reminders with fake trigger blocked');
  let ran = true; try { g.sendMeetingDeadlineReminders({ triggerUid: 'REALUID' }); } catch (e) { ran = /编辑器/.test(e.message) ? false : true; } ok(ran, 'reminders via real trigger allowed');
  const r = g.switchViewAs(tok['系统F'], '职员', '团契组'); ok(r.success, 'view-as');
  const s = g.requireAnySession_(tok['系统F']); ok(!g.perm_isAdmin_(s) && !g.perm_isExec_(s), 'view-as 职员 not treated as admin');
  ok(!g.listAccounts(tok['系统F']).success, 'view-as 职员 cannot open accounts');
  g.switchViewAs(tok['系统F'], '', ''); ok(g.perm_isAdmin_(g.requireAnySession_(tok['系统F'])), 'back to admin');
}
{ const g = setup({ activeUser: 'owner@x.com' }).g; let okk = true; try { g.editorOnly_(); } catch (e) { okk = false; } ok(okk, 'editor run allowed'); }

// 7. writeLog_ still works with new session
{ const { g, tok } = setup(); g.__mk('操作记录', ['操作编号', '操作时间', '用户编号', '姓名', '权限', '操作', '模块', '资料编号', '说明']);
  g.writeLog_(tok['主席D'], 't', 'm', 'id', 'd'); ok(g.__rows('操作记录')[0]['姓名'] === '主席D', 'writeLog uses new session'); }

console.log(`passed ${pass}, failed ${fail}`);
