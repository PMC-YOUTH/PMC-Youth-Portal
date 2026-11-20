// 网站设定「导出资料（CSV）」：只有管理员能导出；表名只能是清单里的；每次导出都有纪录
const test = require('node:test');
const assert = require('node:assert');
const { setup } = require('./helpers');

let H, db, U, rpc, tx, asOwner, cy;

test.before(async () => {
  H = await setup(); ({ db, U, rpc, tx, asOwner, cy } = H);
  await H.user('sys', 'sys@example.com', '系统管理员', null, null, { sysAdmin: true });
  await H.user('admin', 'admin@example.com', '管理员甲', '行政组', '管理员');
  await H.user('chair', 'chair@example.com', '主席甲', '行政组', '主席');
  await H.user('fin', 'fin@example.com', '财政乙', '财政', '财政');
  await H.user('faith', 'faith@example.com', '张三', '信仰组', '职员');
  await H.user('old', 'old@example.com', '王五', '宣教组', '管理员', { year: cy - 1, status: '已卸任' });
  await db.client.query("insert into public.members (name, phone, remark) values ('张三', '012-0000000', '私人备注')");
});
test.after(async () => { if (db) await db.stop(); });

test('导出：管理员（职位或系统管理员）可以导出清单里的每一张表', async () => {
  const list = (await rpc(U.admin, 'select public.export_table_list()')).tables;
  assert.ok(list.includes('members') && list.includes('finance_txns') && list.length === 22);
  for (const who of [U.admin, U.sys]) {
    for (const t of list) {
      const r = await rpc(who, 'select public.export_table($1)', [t]);
      assert.strictEqual(r.success, true, t);
      assert.ok(Array.isArray(r.rows), t);
    }
  }
  const m = (await rpc(U.admin, "select public.export_table('members')")).rows;
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].remark, '私人备注', '备份要包含全部栏位');
});

test('导出：主席、财政、一般职员、卸任、匿名都不行', async () => {
  for (const who of [U.chair, U.fin, U.faith]) {
    await assert.rejects(rpc(who, "select public.export_table('members')"), /只有管理员可以导出资料/);
    await assert.rejects(rpc(who, 'select public.export_table_list()'), /只有管理员可以导出资料/);
  }
  await assert.rejects(rpc(U.old, "select public.export_table('members')"), /只能查看|只有管理员/);
  await assert.rejects(rpc(null, "select public.export_table('members')"), /permission denied/);
  await assert.rejects(rpc(null, 'select public.export_table_list()'), /permission denied/);
});

test('导出：系统管理员「切换身份」成主席时不能导出', async () => {
  await tx(U.sys, async (c) => {
    await asOwner(c, "update public.profiles set view_as_role = '主席', view_as_group = '行政组' where id = $1", [U.sys]);
    await assert.rejects(c.query("select public.export_table('members')"), /只有管理员可以导出资料/);
  });
});

test('导出：不在清单的表、奇怪的表名一律拒绝', async () => {
  for (const t of ['email_outbox', 'app_settings', 'finance_signatures', 'members; drop table public.members', 'auth.users', '', null]) {
    await assert.rejects(rpc(U.admin, 'select public.export_table($1)', [t]), /不能导出这张表/, String(t));
  }
});

test('导出：每次导出都记进操作记录', async () => {
  await tx(U.admin, async (c) => {
    await c.query("select public.export_table('finance_txns')");
    const log = await asOwner(c, "select name, action, data_id, description from public.audit_logs where action = '导出资料' order by id desc limit 1");
    assert.deepStrictEqual([log[0].name, log[0].data_id, log[0].description], ['管理员甲', 'finance_txns', '0 笔']);
  });
});
