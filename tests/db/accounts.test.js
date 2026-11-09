// 阶段 1：账号、任期、权限
// 每个测试都在交易里执行，结束后 rollback，测试之间互不影响。
const test = require('node:test');
const assert = require('node:assert');
const harness = require('./harness');

let db, cy;
const U = {}; // 测试用户 id

async function newUser(email, meta) {
  const r = await db.client.query(
    'insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [email, meta || null]);
  return r.rows[0].id;
}
async function staffUser(key, email, name, grp, role, { year, status = '在任', sysAdmin = false } = {}) {
  const id = await newUser(email, null);
  await db.client.query('update public.profiles set name = $2, status = $3, is_sys_admin = $4 where id = $1',
    [id, name, 'ACTIVE', sysAdmin]);
  if (grp) {
    await db.client.query(
      'insert into public.terms (year, user_id, name, grp, role, status) values ($1, $2, $3, $4, $5, $6)',
      [year || cy, id, name, grp, role, status]);
  }
  U[key] = id;
  return id;
}

/** 以某个用户身份呼叫 RPC；userId 为 null 表示匿名 */
function rpc(userId, sql, params) {
  return db.as(userId ? 'authenticated' : 'anon', userId, (c) => c.query(sql, params).then((r) => r.rows[0] && Object.values(r.rows[0])[0]));
}
/** 在交易里预期失败：用 savepoint，失败后交易还能继续用 */
async function fails(c, sql, params, re) {
  await c.query('savepoint expect_fail');
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query('rollback to savepoint expect_fail');
    if (re) assert.match(e.message, re);
    return;
  }
  throw new Error('预期失败，但成功执行了：' + sql);
}
/** 同一个交易里做几件事（例如先批准再检查结果） */
function tx(userId, fn) {
  return db.as(userId ? 'authenticated' : 'anon', userId, fn);
}

test.before(async () => {
  db = await harness.start();
  cy = (await db.client.query('select private.current_year() y')).rows[0].y;
  await staffUser('sys', 'sys@example.com', '系统管理员', null, null, { sysAdmin: true });
  await staffUser('chair', 'chair@example.com', '主席甲', '行政组', '主席');
  await staffUser('fin', 'fin@example.com', '财政乙', '财政', '财政');
  await staffUser('aud', 'aud@example.com', '查账丙', '查账', '查账');
  await staffUser('staff', 'staff@example.com', '张三', '信仰组', '职员');
  await staffUser('old', 'old@example.com', '李四', '见证组', '职员', { year: cy - 1, status: '已卸任' });
  U.pending = await newUser('new@example.com', { name: '王五', phone: '012-3456789', group: '宣教组', year: String(cy) });
});
test.after(async () => { if (db) await db.stop(); });

/* ---------- 全面检查 ---------- */

test('全面检查：public 的每个资料表都开了 RLS，前端没有任何表权限', async () => {
  const r = await db.client.query(`
    select c.relname, c.relrowsecurity,
           has_table_privilege('anon', c.oid, 'select,insert,update,delete') a,
           has_table_privilege('authenticated', c.oid, 'select,insert,update,delete') b
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'`);
  assert.ok(r.rows.length >= 5);
  for (const t of r.rows) {
    assert.ok(t.relrowsecurity, `${t.relname} 没开 RLS`);
    assert.ok(!t.a && !t.b, `${t.relname} 前端有表权限`);
  }
});

test('全面检查：匿名只能呼叫 ping；登入者能呼叫的函数都是 security definer 且固定 search_path', async () => {
  const r = await db.client.query(`
    select p.proname, p.prosecdef, p.proconfig,
           has_function_privilege('anon', p.oid, 'execute') a,
           has_function_privilege('authenticated', p.oid, 'execute') b
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`);
  for (const f of r.rows) {
    if (f.proname === 'ping') continue;
    assert.ok(!f.a, `匿名可以呼叫 ${f.proname}`);
    if (f.b) {
      assert.ok(f.prosecdef, `${f.proname} 不是 security definer`);
      assert.ok((f.proconfig || []).some((x) => x.startsWith('search_path=')), `${f.proname} 没固定 search_path`);
    }
  }
});

/* ---------- 注册 ---------- */

test('注册：建立待批准账号与任期，并通知管理员和主席', async () => {
  const p = (await db.client.query('select * from public.profiles where id = $1', [U.pending])).rows[0];
  assert.strictEqual(p.status, 'PENDING');
  assert.strictEqual(p.name, '王五');
  const t = (await db.client.query('select * from public.terms where user_id = $1', [U.pending])).rows;
  assert.strictEqual(t.length, 1);
  assert.deepStrictEqual([t[0].status, t[0].grp, t[0].role, t[0].year], ['待批准', '宣教组', '职员', cy]);
  const o = (await db.client.query("select * from public.email_outbox where subject like '新账号等待批准：王五%'")).rows;
  assert.strictEqual(o.length, 1);
  assert.deepStrictEqual(o[0].to_emails.sort(), ['chair@example.com', 'sys@example.com']);
});

test('注册：主席 / 文书的选择会对应到正确的组别和职位', async () => {
  await db.client.query('begin');
  try {
    const a = await newUser('c2@example.com', { name: '甲', group: '主席', year: String(cy) });
    const b = await newUser('c3@example.com', { name: '乙', group: '文书', year: String(cy + 1) });
    const r = (await db.client.query('select user_id, grp, role, year from public.terms where user_id = any($1)', [[a, b]])).rows;
    const byUser = Object.fromEntries(r.map((x) => [x.user_id, x]));
    assert.deepStrictEqual([byUser[a].grp, byUser[a].role], ['行政组', '主席']);
    assert.deepStrictEqual([byUser[b].grp, byUser[b].role, byUser[b].year], ['文书', '文书', cy + 1]);
  } finally { await db.client.query('rollback'); }
});

test('注册：资料不正确会被拒绝', async () => {
  for (const [meta, msg] of [
    [{ name: '', group: '信仰组' }, /请填写姓名/],
    [{ name: '甲', group: '乱写' }, /组别/],
    [{ name: '甲', group: '信仰组', year: String(cy + 2) }, /当届或下一届/],
  ]) {
    await db.client.query('begin');
    try { await assert.rejects(newUser('bad@example.com', meta), msg); } finally { await db.client.query('rollback'); }
  }
});

/* ---------- 登入后的身份 ---------- */

test('身份：各角色的权限计算跟旧版一样', async () => {
  const get = async (k) => rpc(U[k], 'select public.get_my_session(false)');
  const sys = await get('sys');
  assert.strictEqual(sys.user.role, '管理员');
  assert.deepStrictEqual(sys.perms, { admin: true, exec: true, finance: true, memberPrivate: true, staff: true });
  const chair = await get('chair');
  assert.strictEqual(chair.user.role, '主席');
  assert.deepStrictEqual(chair.perms, { admin: false, exec: true, finance: false, memberPrivate: true, staff: true });
  const fin = await get('fin');
  assert.deepStrictEqual(fin.perms, { admin: false, exec: true, finance: true, memberPrivate: false, staff: true });
  const staff = await get('staff');
  assert.deepStrictEqual([staff.user.role, staff.user.group], ['职员', '信仰组']);
  assert.deepStrictEqual(staff.perms, { admin: false, exec: false, finance: false, memberPrivate: false, staff: true });
  const old = await get('old');
  assert.deepStrictEqual([old.user.role, old.user.readOnly, old.user.viewYear], ['卸任', true, cy - 1]);
  assert.deepStrictEqual(old.perms, { admin: false, exec: false, finance: false, memberPrivate: false, staff: false });
});

test('身份：待批准、停用、未登入都进不去', async () => {
  await assert.rejects(rpc(U.pending, 'select public.get_my_session(false)'), /等待管理员或主席批准/);
  await assert.rejects(rpc(null, 'select public.get_my_session(false)'), /permission denied/);
  await db.client.query("update public.profiles set status = 'INACTIVE' where id = $1", [U.staff]);
  try {
    await assert.rejects(rpc(U.staff, 'select public.get_my_session(false)'), /未启用/);
  } finally {
    await db.client.query("update public.profiles set status = 'ACTIVE' where id = $1", [U.staff]);
  }
});

/* ---------- 账号管理权限 ---------- */

test('账号管理：只有管理员和主席可以看账号列表', async () => {
  assert.strictEqual((await rpc(U.sys, 'select public.list_accounts()')).fullAdmin, true);
  const c = await rpc(U.chair, 'select public.list_accounts()');
  assert.strictEqual(c.fullAdmin, false);
  assert.ok(!c.roles.includes('管理员'), '主席的职位选单不应该有管理员');
  for (const k of ['fin', 'aud', 'staff', 'old']) {
    await assert.rejects(rpc(U[k], 'select public.list_accounts()'), /只有管理员或主席|只能查看/, k);
  }
  await assert.rejects(rpc(U.pending, 'select public.list_accounts()'), /等待/);
  await assert.rejects(rpc(null, 'select public.list_accounts()'), /permission denied/);
});

test('批准：主席可以批准，账号变成启用，申请人收到通知', async () => {
  await tx(U.chair, async (c) => {
    const term = (await c.query('select public.list_accounts() r')).rows[0].r.terms.find((t) => t.userId === U.pending);
    const r = (await c.query('select public.approve_term($1, $2, $3) r', [term.termId, '职员', '宣教组'])).rows[0].r;
    assert.strictEqual(r.success, true);
    await c.query('reset role');
    const p = (await c.query('select status from public.profiles where id = $1', [U.pending])).rows[0];
    assert.strictEqual(p.status, 'ACTIVE');
    const t = (await c.query('select status, start_date from public.terms where id = $1', [term.termId])).rows[0];
    assert.strictEqual(t.status, '在任');
    assert.ok(t.start_date);
    const o = (await c.query("select to_emails from public.email_outbox where subject = $1", [`你已加入 ${cy} 届职员会`])).rows;
    assert.deepStrictEqual(o[0].to_emails, ['new@example.com']);
    const log = (await c.query("select name, action from public.audit_logs where action = '批准任期'")).rows;
    assert.deepStrictEqual(log[0], { name: '主席甲', action: '批准任期' });
  });
});

test('批准：主席不能指派管理员，系统管理员可以；其他人不能批准', async () => {
  const termId = (await db.client.query('select id from public.terms where user_id = $1', [U.pending])).rows[0].id;
  await assert.rejects(rpc(U.chair, 'select public.approve_term($1, $2, $3)', [termId, '管理员', '行政组']), /主席不能指派/);
  assert.strictEqual((await rpc(U.sys, 'select public.approve_term($1, $2, $3)', [termId, '管理员', '行政组'])).success, true);
  for (const k of ['fin', 'staff', 'old']) {
    await assert.rejects(rpc(U[k], 'select public.approve_term($1, $2, $3)', [termId, '职员', '宣教组']), /只有管理员或主席|只能查看/);
  }
  await assert.rejects(rpc(U.chair, 'select public.approve_term($1, $2, $3)', [termId, '乱写', '宣教组']), /职位不正确/);
});

test('批准：同一个人同一届不能有两个在任任期', async () => {
  await tx(U.sys, async (c) => {
    await c.query('reset role');
    const t = (await c.query(
      "insert into public.terms (year, user_id, name, grp, role, status) values ($1, $2, '张三', '见证组', '职员', '未通过') returning id",
      [cy, U.staff])).rows[0].id;
    await c.query('set local role authenticated');
    await fails(c, 'select public.approve_term($1, $2, $3)', [t, '职员', '见证组'], /已经有在任的任期/);
  });
});

test('拒绝：账号只有这一个申请时，账号变成 REJECTED', async () => {
  await tx(U.chair, async (c) => {
    const termId = (await c.query('select public.list_accounts() r')).rows[0].r.terms.find((t) => t.userId === U.pending).termId;
    await c.query('select public.reject_term($1)', [termId]);
    await c.query('reset role');
    assert.strictEqual((await c.query('select status from public.profiles where id = $1', [U.pending])).rows[0].status, 'REJECTED');
    assert.strictEqual((await c.query('select status from public.terms where id = $1', [termId])).rows[0].status, '未通过');
  });
});

test('主席：不能改系统管理员的账号，也不能改职位是管理员的任期', async () => {
  await assert.rejects(rpc(U.chair, 'select public.update_account($1, $2)', [U.sys, { status: 'INACTIVE' }]), /系统管理员的账号/);
  await assert.rejects(rpc(U.chair, 'select public.prepare_password_reset($1)', [U.sys]), /系统管理员的账号/);
  await tx(U.chair, async (c) => {
    await c.query('reset role');
    const t = (await c.query(
      "insert into public.terms (year, user_id, name, grp, role, status) values ($1, $2, '财政乙', '行政组', '管理员', '已卸任') returning id",
      [cy - 1, U.fin])).rows[0].id;
    await c.query('set local role authenticated');
    await fails(c, 'select public.update_term($1, $2)', [t, { role: '职员' }], /只有系统管理员可以修改/);
    await fails(c, 'select public.end_term($1, $2)', [t, { type: '移除' }], /只有系统管理员可以修改/);
  });
});

test('账号：不能停用自己；可以停用别人；状态值要正确', async () => {
  await assert.rejects(rpc(U.chair, 'select public.update_account($1, $2)', [U.chair, { status: 'INACTIVE' }]), /不能停用自己/);
  assert.strictEqual((await rpc(U.chair, 'select public.update_account($1, $2)', [U.staff, { status: 'INACTIVE' }])).success, true);
  await assert.rejects(rpc(U.chair, 'select public.update_account($1, $2)', [U.staff, { status: 'X' }]), /状态不正确/);
});

test('重设密码：回传 Email 给前端寄链接，并留下记录', async () => {
  await tx(U.chair, async (c) => {
    const r = (await c.query('select public.prepare_password_reset($1) r', [U.staff])).rows[0].r;
    assert.deepStrictEqual([r.success, r.email], [true, 'staff@example.com']);
    await c.query('reset role');
    assert.strictEqual((await c.query("select count(*)::int n from public.audit_logs where action = '重设密码'")).rows[0].n, 1);
  });
  await assert.rejects(rpc(U.fin, 'select public.prepare_password_reset($1)', [U.staff]), /只有管理员或主席/);
});

/* ---------- 申请加入、辞职替换、复制、交接 ---------- */

test('申请加入：卸任的人可以申请当届，不能重复申请', async () => {
  await tx(U.old, async (c) => {
    const r = (await c.query('select public.apply_for_term($1, $2) r', [cy, '信仰组'])).rows[0].r;
    assert.strictEqual(r.success, true);
    await fails(c, 'select public.apply_for_term($1, $2)', [cy, '见证组'], /已经有任期或申请/);
  });
  await assert.rejects(rpc(U.old, 'select public.apply_for_term($1, $2)', [cy + 2, '信仰组']), /当届或下一届/);
  await assert.rejects(rpc(U.staff, 'select public.apply_for_term($1, $2)', [cy, '见证组']), /已经有任期或申请/);
});

test('辞职替换：原任期已辞职，接任的人得到同一组别职位，并收到通知', async () => {
  const termId = (await db.client.query('select id from public.terms where user_id = $1 and year = $2', [U.staff, cy])).rows[0].id;
  await tx(U.chair, async (c) => {
    const r = (await c.query('select public.end_term($1, $2) r',
      [termId, { type: '辞职', date: `${cy}-06-01`, note: '工作忙', replacementUserId: U.old }])).rows[0].r;
    assert.match(r.message, /李四 会收到 Email/);
    await c.query('reset role');
    const old = (await c.query('select status, end_date, note from public.terms where id = $1', [termId])).rows[0];
    assert.strictEqual(old.status, '已辞职');
    assert.strictEqual(old.note, '工作忙；由 李四 接任');
    const nw = (await c.query("select grp, role, status from public.terms where user_id = $1 and year = $2 and status = '在任'", [U.old, cy])).rows[0];
    assert.deepStrictEqual(nw, { grp: '信仰组', role: '职员', status: '在任' });
    assert.strictEqual((await c.query("select count(*)::int n from public.email_outbox where $1 = any(to_emails) and subject like '你已接任%'", ['old@example.com'])).rows[0].n, 1);
  });
});

test('辞职替换：接任的人这一届已在任就不行', async () => {
  const termId = (await db.client.query('select id from public.terms where user_id = $1 and year = $2', [U.staff, cy])).rows[0].id;
  await assert.rejects(rpc(U.chair, 'select public.end_term($1, $2)', [termId, { replacementUserId: U.fin }]), /已经有在任的任期/);
});

test('复制名单 + 交接：旧一届变已卸任，当届年份 +1', async () => {
  await tx(U.chair, async (c) => {
    await fails(c, 'select public.handover_to_year($1)', [cy + 1], /还没有任何在任的职员/);
    const r = (await c.query('select public.copy_terms_to_year($1, $2) r', [cy, cy + 1])).rows[0].r;
    assert.match(r.message, /已复制 4 人/); // 主席、财政、查账、张三
    await fails(c, 'select public.handover_to_year($1)', [cy + 2], /只能交接到下一届/);
  });
  await tx(U.chair, async (c) => {
    await c.query('select public.copy_terms_to_year($1, $2)', [cy, cy + 1]);
    const r = (await c.query('select public.handover_to_year($1) r', [cy + 1])).rows[0].r;
    assert.strictEqual(r.success, true);
    await c.query('reset role');
    assert.strictEqual((await c.query('select private.current_year() y')).rows[0].y, cy + 1);
    const prev = (await c.query("select count(*)::int n from public.terms where year = $1 and status = '在任'", [cy])).rows[0].n;
    assert.strictEqual(prev, 0);
    await c.query('set local role authenticated');
    const s = (await c.query('select public.get_my_session(false) r')).rows[0].r;
    assert.deepStrictEqual([s.user.role, s.user.termYear], ['主席', cy + 1]);
  });
});

/* ---------- 切换身份 ---------- */

test('切换身份：只有系统管理员可以；切换后权限照所选身份计算', async () => {
  await assert.rejects(rpc(U.chair, 'select public.switch_view_as($1, $2)', ['职员', '信仰组']), /只有系统管理员/);
  await tx(U.sys, async (c) => {
    const r = (await c.query('select public.switch_view_as($1, $2) r', ['职员', '信仰组'])).rows[0].r;
    assert.deepStrictEqual([r.user.role, r.user.group, r.user.viewAs], ['职员', '信仰组', true]);
    assert.strictEqual(r.perms.admin, false);
    await fails(c, 'select public.list_accounts()', undefined, /只有管理员或主席/);
  });
  await tx(U.sys, async (c) => {
    await c.query('select public.switch_view_as($1, $2)', ['卸任', '']);
    await fails(c, 'select public.list_accounts()', undefined, /只能查看/);
    const back = (await c.query('select public.switch_view_as($1, $2) r', ['管理员', ''])).rows[0].r;
    assert.deepStrictEqual([back.user.role, back.perms.admin], ['管理员', true]);
  });
});
