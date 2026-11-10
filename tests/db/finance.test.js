// 阶段 4：Claim、奉献、财政交易、预算、财政报告（跟钱有关，重点测「不会重复记账」）
const test = require('node:test');
const assert = require('node:assert');
const { setup } = require('./helpers');

let H, db, U, rpc, tx, fails, asOwner, cy;
const claimsOf = (rows) => rows.claims.map((c) => c['报销说明']).sort();

test.before(async () => {
  H = await setup(); ({ db, U, rpc, tx, fails, asOwner, cy } = H);
  await H.user('sys', 'sys@example.com', '系统管理员', null, null, { sysAdmin: true });
  await H.user('chair', 'chair@example.com', '主席甲', '行政组', '主席');
  await H.user('fin', 'fin@example.com', '财政乙', '财政', '财政');
  await H.user('aud', 'aud@example.com', '查账丙', '查账', '查账');
  await H.user('faith', 'faith@example.com', '张三', '信仰组', '职员');
  await H.user('faith2', 'faith2@example.com', '张四', '信仰组', '职员');
  await H.user('wit', 'wit@example.com', '李四', '见证组', '职员');
  await H.user('old', 'old@example.com', '王五', '宣教组', '职员', { year: cy - 1, status: '已卸任' });
});
test.after(async () => { if (db) await db.stop(); });

/** 用某人身份提交 Claim（会 rollback，只用来测试权限） */
function submit(userKey, desc, amount, grp) {
  return rpc(U[userKey], 'select public.submit_claim($1)', [{ date: `${cy}-03-01`, description: desc, amount, group: grp, category: '活动' }]);
}
/** 直接写入一张 Claim（给后面的测试用） */async function insertClaim(userKey, desc, amount, grp, extra = {}) {
  const p = (await db.client.query('select name, email from public.profiles where id = $1', [U[userKey]])).rows[0];
  const r = await db.client.query(
    `insert into public.claims (applicant_id, applicant_name, applicant_email, claim_date, description, grp, amount, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [U[userKey], p.name, p.email, `${cy}-03-01`, desc, grp, amount, extra.status || 'PENDING']);
  return r.rows[0].id;
}

/* ---------- 提交 ---------- */

test('提交 Claim：职员可以；金额要正确；通知财政、cc 查账', async () => {
  await tx(U.faith, async (c) => {
    const r = (await c.query('select public.submit_claim($1) r', [{ date: `${cy}-03-01`, description: '买点心', amount: '45.50', group: '信仰组', receiptPath: `${cy}/1700000000-abc.jpg` }])).rows[0].r;
    assert.match(r.id, /^CLM-\d{4}$/);
    const m = (await asOwner(c, "select to_emails, cc_emails from public.email_outbox where subject like '新的 Claim 等待审核%'"))[0];
    assert.deepStrictEqual([m.to_emails, m.cc_emails], [['fin@example.com'], ['aud@example.com']]);
    for (const bad of ['0', '-5', 'abc', '']) await fails(c, 'select public.submit_claim($1)', [{ amount: bad }], /正确的金额/);
    await fails(c, 'select public.submit_claim($1)', [{ amount: '10', receiptPath: '../x' }], /收据路径不正确/);
  });
  await assert.rejects(submit('old', 'x', '10', ''), /只能查看/);
  await assert.rejects(rpc(null, 'select public.submit_claim($1)', [{ amount: '10' }]), /permission denied/);
});

/* ---------- 谁看得到 ---------- */

test('Claim 列表：财政看全部；职员看自己和自己组的；卸任只看自己的', async () => {
  await insertClaim('faith', '信仰组的', 10, '信仰组');
  await insertClaim('wit', '见证组的', 20, '见证组');
  await insertClaim('old', '卸任时的', 30, '宣教组');
  assert.deepStrictEqual(claimsOf(await rpc(U.fin, 'select public.list_claims()')), ['信仰组的', '卸任时的', '见证组的'].sort());
  assert.deepStrictEqual(claimsOf(await rpc(U.faith2, 'select public.list_claims()')), ['信仰组的'], '同组看得到');
  assert.deepStrictEqual(claimsOf(await rpc(U.wit, 'select public.list_claims()')), ['见证组的']);
  assert.deepStrictEqual(claimsOf(await rpc(U.old, 'select public.list_claims()')), ['卸任时的']);
});

/* ---------- 审核 ---------- */

test('审核：只有财政 / 查账；不能审自己的；批准会产生一笔现金支出', async () => {
  const id = (await db.client.query("select id from public.claims where description = '信仰组的'")).rows[0].id;
  await assert.rejects(rpc(U.chair, 'select public.review_claim($1, $2, $3)', [id, 'APPROVED', '']), /只有财政或查账可以审核/);
  await assert.rejects(rpc(U.faith, 'select public.review_claim($1, $2, $3)', [id, 'APPROVED', '']), /只有财政或查账可以审核/);
  await tx(U.fin, async (c) => {
    await fails(c, 'select public.review_claim($1, $2, $3)', [id, 'MAYBE', ''], /审核结果不正确/);
    const r = (await c.query('select public.review_claim($1, $2, $3) r', [id, 'APPROVED', '没问题'])).rows[0].r;
    assert.strictEqual(r.message, 'Claim 已批准。');
    const t = await asOwner(c, 'select type, category, amount, account from public.finance_txns where ref_id = $1', [id]);
    assert.deepStrictEqual(t.map((x) => [x.type, x.account, Number(x.amount)]), [['支出', '现金', 10]]);
    await fails(c, 'select public.review_claim($1, $2, $3)', [id, 'REJECTED', ''], /已经批准过了.*不能重复审核/);
  });
  const own = await insertClaim('fin', '财政自己的', 15, '财政');
  await assert.rejects(rpc(U.fin, 'select public.review_claim($1, $2, $3)', [own, 'APPROVED', '']), /不能审核自己的/);
  assert.strictEqual((await rpc(U.aud, 'select public.review_claim($1, $2, $3)', [own, 'APPROVED', ''])).success, true, '查账可以审财政的');
});

test('防重复：两个人同时批准同一张 Claim，只会成功一次、只有一笔支出', async () => {
  const id = await insertClaim('wit', '同时批准测试', 99, '见证组');
  const c1 = await db.connect(), c2 = await db.connect();
  const begin = async (c, uid) => {
    await c.query('begin');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: 'authenticated' })]);
    await c.query('set local role authenticated');
  };
  try {
    await begin(c1, U.fin); await begin(c2, U.aud);
    await c1.query('select public.review_claim($1, $2, $3)', [id, 'APPROVED', '']);
    // c2 会卡住等 c1 的锁；c1 commit 后 c2 重新读到「已批准」而失败
    const second = c2.query('select public.review_claim($1, $2, $3)', [id, 'APPROVED', '']).then(() => 'ok', (e) => e.message);
    await new Promise((r) => setTimeout(r, 300));
    await c1.query('commit');
    const msg = await second;
    await c2.query('rollback');
    assert.match(msg, /不能重复审核/);
    const n = (await db.client.query('select count(*)::int n from public.finance_txns where ref_id = $1', [id])).rows[0].n;
    assert.strictEqual(n, 1);
  } finally { await c1.end(); await c2.end(); }
});

test('资料库约束：同一张 Claim 不可能有两笔有效的财政交易', async () => {
  const id = (await db.client.query("select id from public.claims where description = '同时批准测试'")).rows[0].id;
  await assert.rejects(db.client.query(
    "insert into public.finance_txns (txn_date, type, amount, account, ref_id) values (current_date, '支出', 99, '现金', $1)", [id]), /duplicate key/);
});

/* ---------- 付款、确认收到 ---------- */

test('付款与确认：没批准不能付款；不能重复付款；只有申请人能确认；确认通知财政', async () => {
  const pending = await insertClaim('faith', '还没批准', 12, '信仰组');
  await assert.rejects(rpc(U.fin, 'select public.mark_claim_paid($1, $2, $3)', [pending, '现金', '']), /要先批准/);
  const id = (await db.client.query("select id from public.claims where description = '信仰组的'")).rows[0].id;
  await assert.rejects(rpc(U.faith, 'select public.mark_claim_paid($1, $2, $3)', [id, '现金', '']), /只有财政或查账可以标记已付款/);
  await tx(U.fin, async (c) => {
    // 先确认一下这张在之前的测试里批准过（tx 会 rollback，所以这里重新批准）
    await asOwner(c, "update public.claims set status = 'APPROVED' where id = $1", [id]);
    const r = (await c.query('select public.mark_claim_paid($1, $2, $3) r', [id, '银行转账', ''])).rows[0].r;
    assert.match(r.message, /已标记为已付款/);
    await fails(c, 'select public.mark_claim_paid($1, $2, $3)', [id, '现金', ''], /已经标记付款了/);
    await asOwner(c, `select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.faith2, role: 'authenticated' })]);
    await fails(c, 'select public.confirm_claim_received($1)', [id], /只有申请人自己/);
    await asOwner(c, `select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.faith, role: 'authenticated' })]);
    assert.strictEqual((await c.query('select public.confirm_claim_received($1) r', [id])).rows[0].r.message, '已确认收到，谢谢！');
    assert.strictEqual((await c.query('select public.confirm_claim_received($1) r', [id])).rows[0].r.message, '已经确认过了，谢谢！');
    const m = (await asOwner(c, "select to_emails, cc_emails from public.email_outbox where subject like 'Claim 已确认收到%'"))[0];
    assert.deepStrictEqual([m.to_emails, m.cc_emails], [['fin@example.com'], ['aud@example.com']]);
  });
});

test('卸任的人可以确认自己以前的 Claim 收到了', async () => {
  const id = (await db.client.query("select id from public.claims where description = '卸任时的'")).rows[0].id;
  await db.client.query("update public.claims set status = 'APPROVED' where id = $1", [id]);
  try {
    assert.strictEqual((await rpc(U.old, 'select public.confirm_claim_received($1)', [id])).success, true);
  } finally { await db.client.query("update public.claims set status = 'PENDING' where id = $1", [id]); }
});

/* ---------- 奉献 ---------- */

test('奉献：只有财政 / 查账；同时记一笔奉献在手的收入；按两次会被挡', async () => {
  await assert.rejects(rpc(U.chair, 'select public.submit_offering($1)', [{ date: `${cy}-03-02`, amount: '100' }]), /只有财政或查账可以新增奉献/);
  await tx(U.fin, async (c) => {
    const data = { date: `${cy}-03-02`, eventName: '青年团契聚会', amount: '120.00', attendance: '35', counter: '张三' };
    const r = (await c.query('select public.submit_offering($1) r', [data])).rows[0].r;
    const t = (await asOwner(c, 'select type, category, account, amount from public.finance_txns where ref_id = $1', [r.id]))[0];
    assert.deepStrictEqual([t.type, t.category, t.account, Number(t.amount)], ['收入', '奉献', '奉献在手', 120]);
    await fails(c, 'select public.submit_offering($1)', [data], /按了两次/);
    await c.query('select public.submit_offering($1)', [{ ...data, amount: '80' }]); // 不一样的金额可以
    await fails(c, 'select public.submit_offering($1)', [{ ...data, amount: '0' }], /正确的金额/);
  });
});

/* ---------- 财政交易、预算、报告 ---------- */

test('财政交易：只有财政 / 查账 / 管理员；自动产生的不能改金额；Claim 产生的不能删；删除只做标记', async () => {
  await assert.rejects(rpc(U.chair, 'select public.get_finance_data($1)', [cy]), /只有财政、查账或管理员/);
  await assert.rejects(rpc(U.faith, 'select public.save_finance_txn($1)', [{}]), /只有财政、查账或管理员/);
  assert.strictEqual((await rpc(U.sys, 'select public.get_finance_data($1)', [cy])).success, true);
  await tx(U.fin, async (c) => {
    await fails(c, 'select public.save_finance_txn($1)', [{ type: '转账', amount: '10', date: `${cy}-01-01`, account: '现金', toAccount: '现金' }], /转入的账户/);
    const t = (await c.query('select public.save_finance_txn($1) r', [{ type: '支出', amount: '30', date: `${cy}-02-01`, account: '现金', category: '文具' }])).rows[0].r;
    await c.query('select public.void_finance_txn($1)', [t.id]);
    const v = (await asOwner(c, 'select voided_at is not null v from public.finance_txns where id = $1', [t.id]))[0];
    assert.strictEqual(v.v, true, '资料要留着');
    const list = (await c.query('select public.get_finance_data($1) r', [cy])).rows[0].r.txns;
    assert.ok(!list.some((x) => x['交易编号'] === t.id), '删除后不显示');
    const clm = (await asOwner(c, "select id from public.finance_txns where ref_id like 'CLM-%' limit 1"))[0].id;
    await fails(c, 'select public.void_finance_txn($1)', [clm], /Claim 批准后产生的/);
    await fails(c, 'select public.save_finance_txn($1)', [{ id: clm, type: '支出', amount: '1', date: `${cy}-03-01`, account: '现金' }], /自动产生的/);
  });
});

test('财政报告：按预算项目分类，余额按账户计算，转账不算收入支出', async () => {
  await tx(U.fin, async (c) => {
    await asOwner(c, `update public.finance_txns set voided_at = now() where voided_at is null`); // 只算这个测试的交易
    await c.query('select public.save_finance_budget($1, $2)', [cy, JSON.stringify([
      { type: '收入', item: '奉献', budget: '5000' }, { type: '支出', item: '信仰组', budget: '800' }, { type: '支出', item: '文具', budget: '' }])]);
    const add = (d) => c.query('select public.save_finance_txn($1)', [d]);
    await add({ type: '收入', amount: '1000', date: `${cy}-01-05`, account: '银行', category: '上年余额' });
    await add({ type: '收入', amount: '300', date: `${cy}-01-10`, account: '奉献在手', category: '奉献' });
    await add({ type: '收入', amount: '50', date: `${cy}-01-11`, account: '现金', category: '义卖', description: '义卖收入' });
    await add({ type: '支出', amount: '120', date: `${cy}-01-12`, account: '现金', category: '点心', group: '信仰组' });
    await add({ type: '支出', amount: '20', date: `${cy}-01-13`, account: '现金', category: '杂费' });
    await add({ type: '转账', amount: '300', date: `${cy}-01-14`, account: '奉献在手', toAccount: '银行' });
    await add({ type: '收入', amount: '999', date: `${cy}-03-01`, account: '现金', category: '奉献' }); // 不在一月内
    const r = (await asOwner(c, 'select private.fin_report($1, 1) r', [cy]))[0].r;
    assert.strictEqual(r.title, `${cy}年播恩堂青年团契一月至一月财政报告`);
    const inc = Object.fromEntries(r.income.map((x) => [x.label, Number(x.actual)]));
    assert.deepStrictEqual(inc, { [`${cy - 1}年余额`]: 1000, '奉献': 300, '义卖': 50, '其他': 0 });
    const exp = Object.fromEntries(r.expense.map((x) => [x.label, Number(x.actual)]));
    assert.deepStrictEqual(exp, { '信仰组': 120, '文具': 0, '其他': 20 });
    assert.deepStrictEqual(Object.fromEntries(Object.entries(r.balances).map(([k, v]) => [k, Number(v)])),
      { '奉献在手': 0, '现金在手': -90, '银行存款': 1300 });
    assert.deepStrictEqual([Number(r.incomeTotal), Number(r.expenseTotal), Number(r.incomeBudget), Number(r.expenseBudget)], [1350, 140, 5000, 800]);
    assert.strictEqual(r.treasurer, '财政乙');
  });
});

/* ---------- 收据 ---------- */

test('收据：看得到 Claim 的人才看得到收据；未登入的人不行', async () => {
  const p = `${cy}/1700000001-rcp.jpg`;
  await db.client.query("update public.claims set receipt_path = $1 where description = '见证组的'", [p]);
  assert.strictEqual(await rpc(U.fin, 'select public.can_view_receipt($1)', [p]), true);
  assert.strictEqual(await rpc(U.wit, 'select public.can_view_receipt($1)', [p]), true);
  assert.strictEqual(await rpc(U.faith, 'select public.can_view_receipt($1)', [p]), false);
  assert.strictEqual(await rpc(U.wit, 'select public.can_view_receipt($1)', ['2026/不存在.jpg']), false);
  await assert.rejects(rpc(null, 'select public.can_view_receipt($1)', [p]), /permission denied/);
});
