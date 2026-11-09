// 阶段 2：公开首页、节目、事奉、轮值表、节目交换、网站设定、活动报告、意见箱
const test = require('node:test');
const assert = require('node:assert');
const { setup } = require('./helpers');

let H, db, U, rpc, tx, fails, asOwner, cy;
const iso = (d) => d.toISOString().slice(0, 10);
const plus = (days) => { const d = new Date(Date.now() + 8 * 3600e3); d.setUTCDate(d.getUTCDate() + days); return iso(d); };
const ev = {}; // 测试节目 id

test.before(async () => {
  H = await setup(); ({ db, U, rpc, tx, fails, asOwner, cy } = H);
  await H.user('sys', 'sys@example.com', '系统管理员', null, null, { sysAdmin: true });
  await H.user('chair', 'chair@example.com', '主席甲', '行政组', '主席');
  await H.user('fin', 'fin@example.com', '财政乙', '财政', '财政');
  await H.user('faith', 'faith@example.com', '张三', '信仰组', '职员');
  await H.user('faith2', 'faith2@example.com', '张四', '信仰组', '职员');
  await H.user('wit', 'wit@example.com', '李四', '见证组', '职员');
  await H.user('old', 'old@example.com', '王五', '宣教组', '职员', { year: cy - 1, status: '已卸任' });
  const mk = async (key, date, name, grp, extra = {}) => {
    const r = await db.client.query(
      `insert into public.events (date, name, grp, leader, theme, status, is_public) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [date, name, grp, extra.leader || '', extra.theme || '', extra.status || 'ACTIVE', extra.isPublic !== false]);
    ev[key] = r.rows[0].id;
  };
  await mk('faithEv', plus(7), '信仰聚会', '信仰组', { leader: '领会甲', theme: '主题甲' });
  await mk('witEv', plus(14), '见证聚会', '见证组', { leader: '领会乙', theme: '主题乙' });
  await mk('secret', plus(1), '内部会议', '行政组', { isPublic: false });
  await mk('past', plus(-30), '以前的聚会', '信仰组');
  await db.client.query("insert into public.roster_assignments (event_id, date, role, name) values ($1, $2, '音响', '赵六')", [ev.faithEv, plus(7)]);
  await db.client.query("update public.site_settings set value = 'https://example.com/a.jpg' where key = '大合照'");
  await db.client.query("insert into public.activity_reports (title, date, is_public, created_by) values ('公开报告', $1, true, 'x'), ('内部报告', $1, false, 'x')", [plus(-3)]);
});
test.after(async () => { if (db) await db.stop(); });

/* ---------- 公开首页 ---------- */

test('首页：匿名可以读，只看到公开、启用的节目和公开报告', async () => {
  const d = await rpc(null, 'select public.get_public_portal_data()');
  assert.strictEqual(d.success, true);
  const names = d.weeks.flatMap((w) => w.events.map((e) => e['节目名称']));
  assert.ok(names.includes('信仰聚会'));
  assert.ok(!names.includes('内部会议'), '不公开的节目不应出现');
  const f = d.weeks.flatMap((w) => w.events).find((e) => e['节目名称'] === '信仰聚会');
  assert.deepStrictEqual(f.extraRoster, [{ role: '音响', name: '赵六' }]);
  assert.match(f['日期'], /^\d{4}-\d{2}-\d{2} 00:00:00$/);
  assert.deepStrictEqual(d.reports.map((r) => r['标题']), ['公开报告']);
  assert.ok(!('建立者' in d.reports[0]));
  assert.strictEqual(d.bannerUrl, 'https://example.com/a.jpg');
  assert.strictEqual(d.weeks.length, 6);
});

test('首页：匿名不能呼叫后台功能', async () => {
  for (const sql of ['select public.get_admin_events()', 'select public.list_feedback()', "select public.save_event('{}')",
                     'select public.get_roster_data()', "select public.request_program_swap('{}')"]) {
    await assert.rejects(rpc(null, sql), /permission denied/, sql);
  }
});

/* ---------- 意见箱 ---------- */

test('意见箱：匿名可以提交；太短、机器人、太多都会挡', async () => {
  await tx(null, async (c) => {
    const ok = (await c.query("select public.submit_feedback($1) r", [{ content: '希望多办户外活动', contact: '012-3456789', category: '建议' }])).rows[0].r;
    assert.strictEqual(ok.success, true);
    const short = (await c.query("select public.submit_feedback($1) r", [{ content: '好' }])).rows[0].r;
    assert.strictEqual(short.success, false);
    const bot = (await c.query("select public.submit_feedback($1) r", [{ content: '机器人的内容很长', website: 'x' }])).rows[0].r;
    assert.strictEqual(bot.success, true);
    const n = (await asOwner(c, 'select count(*)::int n from public.feedback'))[0].n;
    assert.strictEqual(n, 1, '机器人那笔不应该存进去');
    await asOwner(c, "insert into public.feedback (content) select '测试测试' from generate_series(1, 59)");
    const many = (await c.query("select public.submit_feedback($1) r", [{ content: '第六十一则意见' }])).rows[0].r;
    assert.match(many.message, /太多/);
  });
});

test('意见箱：联络方式只有行政组看得到；卸任的人看不到意见', async () => {
  await db.client.query("insert into public.feedback (content, contact) values ('后台测试意见', '012-0000000')");
  try {
    const exec = await rpc(U.chair, 'select public.list_feedback()');
    assert.strictEqual(exec.feedback[0]['联络方式'], '012-0000000');
    const staff = await rpc(U.faith, 'select public.list_feedback()');
    assert.strictEqual(staff.feedback.length, 1);
    assert.ok(!('联络方式' in staff.feedback[0]));
    assert.deepStrictEqual((await rpc(U.old, 'select public.list_feedback()')).feedback, []);
    await assert.rejects(rpc(U.old, "select public.update_feedback('FB-0001', '已处理', null)"), /只能查看/);
  } finally { await db.client.query('delete from public.feedback'); }
});

/* ---------- 节目 ---------- */

test('节目：卸任的人可以看节目，但看不到交换申请', async () => {
  const d = await rpc(U.old, 'select public.get_admin_events()');
  assert.ok(d.events.length >= 4);
  assert.deepStrictEqual(d.swaps, []);
  assert.strictEqual(d.perms.staff, false);
});

test('节目：只有行政组可以新增', async () => {
  await tx(U.chair, async (c) => {
    const r = (await c.query('select public.save_event($1) r', [{ date: plus(21), name: '新节目', group: '信仰组' }])).rows[0].r;
    assert.match(r.eventId, /^EVT-\d{4}$/);
  });
  await assert.rejects(rpc(U.faith, 'select public.save_event($1)', [{ date: plus(21), name: '新节目' }]), /只有行政组可以新增/);
  await assert.rejects(rpc(U.old, 'select public.save_event($1)', [{ date: plus(21), name: '新节目' }]), /只能查看/);
});

test('节目：负责组可以改内容，但日期、负责组、状态、公开显示不会被改', async () => {
  await tx(U.faith, async (c) => {
    await c.query('select public.save_event($1)', [{ eventId: ev.faithEv, name: '改过的名字', leader: '新领会',
      date: plus(60), group: '见证组', status: 'INACTIVE', publicDisplay: '否' }]);
    const e = (await asOwner(c, 'select name, leader, date::text d, grp, status, is_public from public.events where id = $1', [ev.faithEv]))[0];
    assert.deepStrictEqual([e.name, e.leader, e.d, e.grp, e.status, e.is_public], ['改过的名字', '新领会', plus(7), '信仰组', 'ACTIVE', true]);
  });
});

test('节目：别组不能改；行政组可以改日期和负责组', async () => {
  await assert.rejects(rpc(U.wit, 'select public.save_event($1)', [{ eventId: ev.faithEv, name: 'x' }]), /只能修改自己组/);
  await tx(U.chair, async (c) => {
    await c.query('select public.save_event($1)', [{ eventId: ev.faithEv, date: plus(8), group: '见证组', status: 'ACTIVE', publicDisplay: '否' }]);
    const e = (await asOwner(c, 'select date::text d, grp, is_public from public.events where id = $1', [ev.faithEv]))[0];
    assert.deepStrictEqual([e.d, e.grp, e.is_public], [plus(8), '见证组', false]);
  });
});

test('安排事奉：负责组可以排人，但不能改负责组；额外岗位只能负责组或行政组', async () => {
  await tx(U.faith, async (c) => {
    await c.query('select public.save_event_roster($1, $2)', [ev.faithEv, { '领会': '张三', '负责组': '见证组' }]);
    const e = (await asOwner(c, 'select leader, grp from public.events where id = $1', [ev.faithEv]))[0];
    assert.deepStrictEqual([e.leader, e.grp], ['张三', '信仰组']);
    await c.query('select public.save_extra_roster($1)', [{ eventId: ev.faithEv, role: '摄影', name: '李四' }]);
  });
  await assert.rejects(rpc(U.wit, 'select public.save_event_roster($1, $2)', [ev.faithEv, { '领会': 'x' }]), /只能修改自己组/);
  await assert.rejects(rpc(U.wit, 'select public.save_extra_roster($1)', [{ eventId: ev.faithEv, role: '摄影', name: 'x' }]), /只能修改自己组/);
  const rid = (await db.client.query('select id from public.roster_assignments limit 1')).rows[0].id;
  await assert.rejects(rpc(U.wit, 'select public.delete_extra_roster($1)', [rid]), /只能修改自己组/);
  assert.strictEqual((await rpc(U.chair, 'select public.delete_extra_roster($1)', [rid])).success, true);
});

/* ---------- 轮值表 ---------- */

test('轮值表：只有行政组、文书、财政、查账可以用', async () => {
  for (const k of ['sys', 'chair', 'fin']) {
    const d = await rpc(U[k], 'select public.get_roster_data()');
    assert.strictEqual(d.success, true, k);
  }
  const d = await rpc(U.chair, 'select public.get_roster_data()');
  assert.deepStrictEqual(d.staff[String(cy)].admin, [{ role: '主席', name: '主席甲' }, { role: '财政', name: '财政乙' }]);
  assert.deepStrictEqual(d.staff[String(cy)].groups['信仰组'].sort(), ['张三', '张四']);
  for (const k of ['faith', 'wit', 'old']) {
    await assert.rejects(rpc(U[k], 'select public.get_roster_data()'), /只有文书、财政、查账和行政组|只能查看/, k);
  }
});

test('轮值表：名单保存、草稿、发布会更新 / 新增 / 暂停节目', async () => {
  await tx(U.fin, async (c) => {
    const pool = (await c.query('select public.save_roster_pool($1) r', [JSON.stringify([{ position: '领会', name: '张三' }, { position: '乱写', name: 'x' }, { position: '司琴/吉他手', name: '' }])])).rows[0].r;
    assert.match(pool.message, /1 人次/);
    const weeks = [
      { date: plus(7), eventName: '信仰聚会', assign: { '负责组': '信仰组', '领会': '张三', '司琴/吉他手': '李四' } },
      { date: plus(28), eventName: '新的聚会', assign: { '负责组': '见证组', '领会': '李四' } },
      { date: plus(35), suspended: true, eventName: '', note: '' },
      { date: 'bad-date', eventName: '会被丢掉' }];
    const saved = (await c.query('select public.save_roster_draft($1) r', [{ title: '测试轮值表', start: plus(7), end: plus(35), weeks }])).rows[0].r;
    const draft = (await c.query('select public.get_roster_draft($1) r', [saved.id])).rows[0].r.draft;
    assert.strictEqual(draft.weeks.length, 3, '不正确的日期要被丢掉');
    const pub = (await c.query('select public.publish_roster_draft($1) r', [{ id: saved.id, title: '测试轮值表', weeks }])).rows[0].r;
    assert.match(pub.message, /更新 1 个节目，新增 2 个，不排人 1 个/);
    const rows = await asOwner(c, 'select date::text d, name, grp, leader, piano, status, location from public.events where date = any($1::date[]) order by date',
      [[plus(7), plus(28), plus(35)]]);
    assert.deepStrictEqual(rows.map((r) => [r.name, r.grp, r.leader, r.status]), [
      ['信仰聚会', '信仰组', '张三', 'ACTIVE'], ['新的聚会', '见证组', '李四', 'ACTIVE'], ['暂停聚会', '', '', '暂停']]);
    assert.strictEqual(rows[0].piano, '李四');
    assert.strictEqual(rows[1].location, '播恩堂');
    const st = (await asOwner(c, 'select status, published_by from public.roster_drafts where id = $1', [saved.id]))[0];
    assert.deepStrictEqual([st.status, st.published_by], ['已发布', '财政乙']);
  });
  await assert.rejects(rpc(U.faith, 'select public.publish_roster_draft($1)', [{ weeks: [] }]), /只有文书、财政、查账和行政组/);
});

/* ---------- 节目交换 ---------- */

test('交换：申请 → 行政组批准 → 对方组批准 → 自动交换，草稿也跟着改，通知寄给对的人', async () => {
  await tx(U.faith, async (c) => {
    await asOwner(c, "insert into public.roster_drafts (title, content) values ('草稿', $1)",
      [{ weeks: [{ date: plus(7), eventName: '信仰聚会', suspended: false, assign: { '负责组': '信仰组', '领会': '领会甲' } }] }]);
    const req = (await c.query('select public.request_program_swap($1) r', [{ eventId: ev.faithEv, targetId: ev.witEv, reason: '讲员不能来' }])).rows[0].r;
    assert.match(req.message, /行政组和「见证组」会收到 Email/);
    const mail = (await asOwner(c, "select to_emails from public.email_outbox where subject like '节目交换申请：%'"))[0];
    assert.deepStrictEqual(mail.to_emails.sort(), ['chair@example.com', 'fin@example.com', 'wit@example.com'], '申请人自己不收');
    await fails(c, 'select public.approve_program_swap($1)', [req.id], /不能批准自己的申请/);
    await fails(c, 'select public.request_program_swap($1)', [{ eventId: ev.faithEv, targetId: ev.witEv }], /已经有等待批准/);

    // 同组的另一个人不是行政组、也不是对方组 → 不需要他批准
    await asOwner(c, `select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.faith2, role: 'authenticated' })]);
    await fails(c, 'select public.approve_program_swap($1)', [req.id], /你不需要批准/);
    await fails(c, 'select public.reject_program_swap($1, $2)', [req.id, ''], /只有行政组或「见证组」/);

    await asOwner(c, `select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.chair, role: 'authenticated' })]);
    const a1 = (await c.query('select public.approve_program_swap($1) r', [req.id])).rows[0].r;
    assert.deepStrictEqual([a1.applied, a1.message], [false, '已批准，还要等「见证组」批准。']);

    await asOwner(c, `select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.wit, role: 'authenticated' })]);
    const a2 = (await c.query('select public.approve_program_swap($1) r', [req.id])).rows[0].r;
    assert.strictEqual(a2.applied, true);
    assert.match(a2.message, /已更新 1 份轮值表/);

    const rows = await asOwner(c, 'select id, name, grp, leader, theme, date::text d from public.events where id = any($1)', [[ev.faithEv, ev.witEv]]);
    const A = rows.find((r) => r.id === ev.faithEv), B = rows.find((r) => r.id === ev.witEv);
    assert.deepStrictEqual([A.name, A.grp, A.leader, A.theme, A.d], ['见证聚会', '见证组', '领会乙', '主题乙', plus(7)]);
    assert.deepStrictEqual([B.name, B.grp, B.leader, B.theme, B.d], ['信仰聚会', '信仰组', '领会甲', '主题甲', plus(14)]);
    const w = (await asOwner(c, "select content -> 'weeks' -> 0 w from public.roster_drafts where title = '草稿'"))[0].w;
    assert.deepStrictEqual([w.eventName, w.assign['负责组'], w.assign['领会']], ['见证聚会', '见证组', '领会乙']);
    const done = (await asOwner(c, "select to_emails, cc_emails from public.email_outbox where subject like '节目已交换：%'"))[0];
    assert.ok(done.to_emails.includes('faith@example.com') && done.to_emails.includes('wit@example.com'));
    assert.ok(done.cc_emails.includes('chair@example.com'));
  });
});

test('交换：别组不能申请；过去的节目不能换；申请人可以取消', async () => {
  await assert.rejects(rpc(U.wit, 'select public.request_program_swap($1)', [{ eventId: ev.faithEv, targetId: ev.witEv }]), /只有「信仰组」的职员或行政组/);
  await assert.rejects(rpc(U.faith, 'select public.request_program_swap($1)', [{ eventId: ev.past, targetId: ev.witEv }]), /已经过去/);
  await assert.rejects(rpc(U.old, 'select public.request_program_swap($1)', [{ eventId: ev.faithEv, targetId: ev.witEv }]), /只能查看/);
  await tx(U.faith, async (c) => {
    const req = (await c.query('select public.request_program_swap($1) r', [{ eventId: ev.faithEv, targetId: ev.witEv }])).rows[0].r;
    const r = (await c.query('select public.cancel_program_swap($1) r', [req.id])).rows[0].r;
    assert.strictEqual(r.message, '申请已取消。');
  });
});

/* ---------- 网站设定、活动报告 ---------- */

test('网站设定：职员可以改，卸任不行', async () => {
  await tx(U.faith, async (c) => {
    await c.query('select public.save_site_settings($1)', [{ heroTitle: '欢迎', instagram: 'https://instagram.com/x' }]);
    const s = (await c.query('select public.get_site_settings() r')).rows[0].r;
    assert.deepStrictEqual([s.settings.heroTitle, s.settings.instagram, s.settings.banner], ['欢迎', 'https://instagram.com/x', 'https://example.com/a.jpg']);
  });
  await assert.rejects(rpc(U.old, 'select public.save_site_settings($1)', [{ heroTitle: 'x' }]), /只能查看/);
  assert.strictEqual((await rpc(U.old, 'select public.get_site_settings()')).canEdit, false);
});

test('活动报告：建立的人或行政组可以改和删，别人不行', async () => {
  await tx(U.faith, async (c) => {
    const r = (await c.query('select public.save_activity_report($1) r', [{ title: '我的报告', isPublic: true }])).rows[0].r;
    await c.query('select public.save_activity_report($1)', [{ id: r.id, title: '我的报告（改）' }]);
    await asOwner(c, `select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.wit, role: 'authenticated' })]);
    await fails(c, 'select public.save_activity_report($1)', [{ id: r.id, title: 'x' }], /只有建立这份报告的人或行政组/);
    await fails(c, 'select public.delete_activity_report($1)', [r.id], /只有建立这份报告的人或行政组/);
    await asOwner(c, `select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.chair, role: 'authenticated' })]);
    assert.strictEqual((await c.query('select public.delete_activity_report($1) r', [r.id])).rows[0].r.success, true);
  });
  await assert.rejects(rpc(U.faith, 'select public.save_activity_report($1)', [{ title: '' }]), /请填写标题/);
});
