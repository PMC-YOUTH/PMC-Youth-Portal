// 阶段 5：事工、会议、组别提交、报告资料、议案、财政报告签名、报告存档、交换节目时事工一起搬
const test = require('node:test');
const assert = require('node:assert');
const { setup } = require('./helpers');

let H, db, U, rpc, tx, fails, asOwner, cy;
const plan = (o) => Object.assign({ year: String(cy), group: '信仰组', category: '聚会', name: '祷告会' }, o);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test.before(async () => {
  H = await setup(); ({ db, U, rpc, tx, fails, asOwner, cy } = H);
  await H.user('sys', 'sys@example.com', '系统管理员', null, null, { sysAdmin: true });
  await H.user('chair', 'chair@example.com', '主席甲', '行政组', '主席');
  await H.user('sec', 'sec@example.com', '文书丙', '文书', '文书');
  await H.user('fin', 'fin@example.com', '财政乙', '财政', '财政');
  await H.user('faith', 'faith@example.com', '张三', '信仰组', '职员');
  await H.user('wit', 'wit@example.com', '李四', '见证组', '职员');
  await H.user('old', 'old@example.com', '王五', '信仰组', '职员', { year: cy - 1, status: '已卸任' });
  const ins = (grp, name, year = cy, extra = {}) => db.client.query(
    `insert into public.ministries (year, grp, category, serial, name, budget, event_id, planned_date) values ($1, $2, '聚会', $3, $4, $5, $6, $7) returning id`,
    [year, grp, extra.serial || '', name, extra.budget || null, extra.eventId || '', extra.planned || null]).then((r) => r.rows[0].id);
  U.mFaith = await ins('信仰组', '信仰组的事工', cy, { budget: 100 });
  U.mWit = await ins('见证组', '见证组的事工');
  U.mOld = await ins('信仰组', '去年的事工', cy - 1);
});
test.after(async () => { if (db) await db.stop(); });

/* ---------- 看得到什么 ---------- */

test('事工资料：各组只看自己组；文书、管理员看全部', async () => {
  const names = (d) => d.ministries.map((m) => m['事工名称']).sort();
  assert.deepStrictEqual(names(await rpc(U.faith, 'select public.get_ministry_system_data($1, 2)', [cy])), ['信仰组的事工']);
  assert.deepStrictEqual(names(await rpc(U.wit, 'select public.get_ministry_system_data($1, 2)', [cy])), ['见证组的事工']);
  assert.deepStrictEqual(names(await rpc(U.sec, 'select public.get_ministry_system_data($1, 2)', [cy])), ['信仰组的事工', '见证组的事工']);
  const d = await rpc(U.sec, 'select public.get_ministry_system_data($1, 2)', [cy]);
  assert.strictEqual(d.user.isOffice, true);
  assert.strictEqual((await rpc(U.chair, 'select public.get_ministry_system_data($1, 2)', [cy])).user.isOffice, false, '主席不是文书');
  await assert.rejects(rpc(null, 'select public.get_ministry_system_data($1, 2)', [cy]), /permission denied/);
});

test('事工历史：别组看不到', async () => {
  assert.strictEqual((await rpc(U.faith, 'select public.get_ministry_history($1)', [U.mFaith])).ministry['事工名称'], '信仰组的事工');
  await assert.rejects(rpc(U.faith, 'select public.get_ministry_history($1)', [U.mWit]), /不能查看其他组/);
  await assert.rejects(rpc(U.fin, 'select public.get_ministry_history($1)', [U.mWit]), /还没有组别任期/);
});

/* ---------- 改 ---------- */

test('年度计划：自己组可以新增（序号自动编），别组不行；上一届锁定只读', async () => {
  await tx(U.faith, async (c) => {
    const r1 = (await c.query('select public.save_ministry_plan($1) r', [plan({ name: '新事工一', budget: '150' })])).rows[0].r;
    const r2 = (await c.query('select public.save_ministry_plan($1) r', [plan({ name: '新事工二' })])).rows[0].r;
    assert.deepStrictEqual([r1.ministry['序号'], r2.ministry['序号']], ['2.1', '2.2']);
    assert.strictEqual(Number(r1.ministry['预算']), 150);
    await fails(c, 'select public.save_ministry_plan($1)', [plan({ group: '见证组' })], /不能查看其他组/);
    await fails(c, 'select public.save_ministry_plan($1)', [plan({ category: '乱写' })], /类别不正确/);
    await fails(c, 'select public.save_ministry_plan($1)', [plan({ ministryId: U.mWit })], /不能查看其他组/);
    await fails(c, 'select public.save_ministry_plan($1)', [plan({ ministryId: U.mOld, year: String(cy - 1) })], /已锁定为只读/);
  });
  await assert.rejects(rpc(U.old, 'select public.save_ministry_plan($1)', [plan()]), /只能查看/);
  assert.strictEqual((await rpc(U.sys, 'select public.save_ministry_plan($1)', [plan({ ministryId: U.mOld, year: String(cy - 1), name: '管理员改的' })])).success, true, '管理员可以改上一届');
});

test('会议更新：同一个事工同一次会议只有一笔（再存就是更新）', async () => {
  await tx(U.faith, async (c) => {
    const d = { ministryId: U.mFaith, year: String(cy), meetingNo: '2', status: '进行中', progress: '第一次', expense: '30' };
    const a = (await c.query('select public.save_ministry_update($1) r', [d])).rows[0].r;
    const b = (await c.query('select public.save_ministry_update($1) r', [{ ...d, progress: '改过了', expense: '' }])).rows[0].r;
    assert.strictEqual(a.updateId, b.updateId);
    const u = (await asOwner(c, 'select progress, expense from public.ministry_updates where ministry_id = $1', [U.mFaith]));
    assert.deepStrictEqual([u.length, u[0].progress, u[0].expense], [1, '改过了', null]);
    await fails(c, 'select public.save_ministry_update($1)', [{ ...d, ministryId: U.mWit }], /不能查看其他组/);
    await fails(c, 'select public.save_ministry_update($1)', [{ ...d, meetingNo: '5' }], /会议次数不正确/);
  });
});

test('事工统计：自己组可以记，别组不行', async () => {
  await tx(U.faith, async (c) => {
    const r = (await c.query('select public.save_ministry_stat($1) r', [{ ministryId: U.mFaith, year: String(cy), meetingNo: '2', item: '出席', value: '12', unit: '人' }])).rows[0].r;
    assert.match(r.statId, /^STAT-/);
    await fails(c, 'select public.save_ministry_stat($1)', [{ ministryId: U.mWit, year: String(cy), meetingNo: '2', item: 'x' }], /不能查看其他组/);
    await fails(c, 'select public.save_ministry_stat($1)', [{ ministryId: U.mFaith, year: String(cy), meetingNo: '2', item: '' }], /请填写统计项目/);
  });
});

/* ---------- 提交、会议 ---------- */

test('组别提交：组员提交会通知文书；只有文书 / 管理员能改状态', async () => {
  await tx(U.faith, async (c) => {
    const r = (await c.query('select public.submit_ministry_group_report($1, 2, $2, $3) r', [cy, '', '请查看'])).rows[0].r;
    assert.strictEqual(r.message, '信仰组 已提交，文书会收到 Email 通知。');
    const m = (await asOwner(c, "select to_emails from public.email_outbox where subject like '信仰组 已提交%'"))[0];
    assert.deepStrictEqual(m.to_emails, ['sec@example.com']);
    await fails(c, 'select public.submit_ministry_group_report($1, 2, $2, $3)', [cy, '见证组', ''], /不能查看其他组/);
    await fails(c, 'select public.set_ministry_group_submission_status($1, 2, $2, $3, $4)', [cy, '信仰组', '已确认', ''], /只有文书或管理员/);
  });
  await tx(U.sec, async (c) => {
    await c.query('select public.set_ministry_group_submission_status($1, 2, $2, $3, $4)', [cy, '信仰组', '已退回', '请补资料']);
    const x = (await asOwner(c, 'select status, note from public.ministry_submissions where year = $1 and meeting_no = 2', [cy]))[0];
    assert.deepStrictEqual([x.status, x.note], ['已退回', '请补资料']);
    await fails(c, 'select public.set_ministry_group_submission_status($1, 2, $2, $3, $4)', [cy, '信仰组', '乱写', ''], /提交状态不正确/);
  });
});

test('会议：只有文书 / 管理员能改；会议报告中心会自动建好四次会议', async () => {
  const center = await rpc(U.sec, 'select public.get_meeting_center_data($1)', [cy]);
  assert.strictEqual(center.meetings.length, 4);
  assert.deepStrictEqual(center.meetings.map((m) => m['会议类型']), ['年度策划会议', '第一次进度会议', '第二次进度会议', '年度总结会议']);
  assert.deepStrictEqual(center.progress['2']['信仰组'], { total: 1, updated: 0 });
  await assert.rejects(rpc(U.faith, 'select public.save_ministry_meeting($1)', [{ year: String(cy), meetingNo: '2' }]), /只有文书或管理员/);
  await tx(U.sec, async (c) => {
    const r = (await c.query('select public.save_ministry_meeting($1) r', [{ year: String(cy), meetingNo: '2', meetingDate: `${cy}-05-03`, status: '进行中' }])).rows[0].r;
    assert.strictEqual(r.meetingId, `MTG-${cy}-02`);
  });
});

/* ---------- 报告资料、议案 ---------- */

test('会议报告资料：只有文书 / 管理员；不含已停用的事工；更新只到这一次会议', async () => {
  await db.client.query("insert into public.ministries (year, grp, category, name, status) values ($1, '信仰组', '聚会', '停用的', '已停用')", [cy]);
  await db.client.query("insert into public.ministry_updates (ministry_id, year, meeting_no, grp, progress) values ($1, $2, 3, '信仰组', '第三次的')", [U.mFaith, cy]);
  const src = await rpc(U.sec, 'select public.get_ministry_report_source($1, 2)', [cy]);
  assert.ok(!src.ministries.some((m) => m['事工名称'] === '停用的'));
  assert.ok(!src.updates.some((u) => u['本次进度'] === '第三次的'), '第二次会议的报告不含第三次的更新');
  assert.deepStrictEqual(src.groupStaff['信仰组'], '张三');
  for (const k of ['faith', 'chair', 'fin', 'old']) {
    await assert.rejects(rpc(U[k], 'select public.get_ministry_report_source($1, 2)', [cy]), /只有文书或管理员|只能查看/, k);
  }
});

test('议案首页：文书、主席可以编辑；职员不行；清除后回到预设', async () => {
  const g = await rpc(U.faith, 'select public.get_meeting_cover($1, 2)', [cy]);
  assert.deepStrictEqual([g.saved, g.canEdit, g.staffRoles['主席']], [false, false, '主席甲']);
  assert.strictEqual((await rpc(U.chair, 'select public.get_meeting_cover($1, 2)', [cy])).canEdit, true);
  await assert.rejects(rpc(U.faith, 'select public.save_meeting_cover($1, 2, $2)', [cy, { date: `${cy}-05-03` }]), /只有文书、主席或管理员/);
  await tx(U.chair, async (c) => {
    await c.query('select public.save_meeting_cover($1, 2, $2)', [cy, { date: `${cy}-05-10`, venue: '播恩堂' }]);
    const r = (await c.query('select public.get_meeting_cover($1, 2) r', [cy])).rows[0].r;
    assert.deepStrictEqual([r.saved, r.cover.venue, r.meeting['会议日期']], [true, '播恩堂', `${cy}-05-10T00:00:00`]);
    await c.query('select public.save_meeting_cover($1, 2, null)', [cy]);
    assert.strictEqual((await c.query('select public.get_meeting_cover($1, 2) r', [cy])).rows[0].r.saved, false);
  });
});

/* ---------- 财政报告签名 ---------- */

test('财政报告签名：财政可以签；格式不对会挡；文书准备议案时拿得到', async () => {
  await assert.rejects(rpc(U.faith, 'select public.store_finance_signatures($1, 3, $2)', [cy, { treasurer: PNG }]), /只有财政、查账或管理员/);
  await tx(U.fin, async (c) => {
    await fails(c, 'select public.store_finance_signatures($1, 3, $2)', [cy, { treasurer: 'javascript:alert(1)' }], /签名图片不正确/);
    const r = (await c.query('select public.store_finance_signatures($1, 3, $2) r', [cy, { treasurer: PNG }])).rows[0].r;
    assert.deepStrictEqual(Object.keys(r.sigs), ['treasurer']);
    await asOwner(c, `select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.sec, role: 'authenticated' })]);
    const m = (await c.query('select public.get_finance_report_for_meeting($1, 3) r', [cy])).rows[0].r;
    assert.strictEqual(m.sigs.treasurer, PNG);
    assert.match(m.report.title, /一月至三月财政报告/);
    await asOwner(c, `select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.fin, role: 'authenticated' })]);
    const cleared = (await c.query('select public.store_finance_signatures($1, 3, $2) r', [cy, { treasurer: '' }])).rows[0].r;
    assert.deepStrictEqual(cleared.sigs, {}, '空字串 = 拿掉签名');
  });
  await assert.rejects(rpc(U.faith, 'select public.get_finance_report_for_meeting($1, 3)', [cy]), /只有文书或管理员/);
});

/* ---------- 存档 ---------- */

test('报告存档：财政报告要财政；会议报告要文书；会议状态变成「报告已生成」', async () => {
  const path = `${cy}/1700000000-report.docx`;
  await assert.rejects(rpc(U.sec, 'select public.save_generated_report($1)', [{ kind: 'finance', title: 'x', path }]), /只有财政、查账或管理员/);
  await assert.rejects(rpc(U.fin, 'select public.save_generated_report($1)', [{ kind: 'report', title: 'x', path }]), /只有文书或管理员/);
  await tx(U.sec, async (c) => {
    await fails(c, 'select public.save_generated_report($1)', [{ kind: 'report', title: 'x', path: '../x' }], /请先生成/);
    await c.query('select public.save_generated_report($1)', [{ kind: 'motion', year: String(cy), meetingNo: '2', title: '第二次会议议案', path }]);
    const m = (await asOwner(c, 'select status, report_doc_path from public.ministry_meetings where year = $1 and meeting_no = 2', [cy]))[0];
    assert.deepStrictEqual([m.status, m.report_doc_path], ['报告已生成', path]);
    const docs = (await c.query('select public.list_meeting_docs() r')).rows[0].r.meetings;
    const d = docs.find((x) => x['会议名称'] === '第二次会议议案');
    assert.deepStrictEqual([d['档案类型'], d['Word路径'], d['保存人']], ['会议议案', path, '文书丙（文书）']);
  });
});

/* ---------- 交换节目：事工日期一起搬；轮值表看得到事工日期 ---------- */

test('交换节目：两组相关的事工换日期、改关联节目', async () => {
  const d = (n) => { const x = new Date(Date.now() + 8 * 3600e3); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const ev = async (date, name, grp) => (await db.client.query('insert into public.events (date, name, grp) values ($1, $2, $3) returning id', [date, name, grp])).rows[0].id;
  const a = await ev(d(10), '信仰聚会', '信仰组'), b = await ev(d(17), '见证聚会', '见证组');
  await db.client.query('update public.ministries set event_id = $1 where id = $2', [a, U.mFaith]);
  await db.client.query('update public.ministries set event_id = $1 where id = $2', ['', U.mWit]);
  await db.client.query('update public.ministries set planned_date = $1 where id = $2', [d(17), U.mWit]);
  const roster = await rpc(U.chair, 'select public.get_roster_data()');
  assert.ok(roster.ministryDates.some((x) => x.id === U.mFaith && x.date === d(10) && x.linked), '轮值表要看得到事工日期');
  await tx(U.faith, async (c) => {
    const req = (await c.query('select public.request_program_swap($1) r', [{ eventId: a, targetId: b }])).rows[0].r;
    await asOwner(c, `select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.chair, role: 'authenticated' })]);
    await c.query('select public.approve_program_swap($1)', [req.id]);
    await asOwner(c, `select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.wit, role: 'authenticated' })]);
    const r = (await c.query('select public.approve_program_swap($1) r', [req.id])).rows[0].r;
    assert.match(r.message, /已更新 2 个相关事工的日期/);
    const ms = await asOwner(c, 'select id, planned_date::text pd, event_id from public.ministries where id = any($1)', [[U.mFaith, U.mWit]]);
    const f = ms.find((x) => x.id === U.mFaith), w = ms.find((x) => x.id === U.mWit);
    assert.deepStrictEqual([f.pd, f.event_id], [d(17), b], '信仰组的事工跟着节目搬到 B 日期');
    assert.deepStrictEqual([w.pd, w.event_id], [d(10), ''], '见证组没关联节目的事工按计划日期搬');
  });
});
