// 阶段 3：契友资料、会议记录、轮值表的契友名单
const test = require('node:test');
const assert = require('node:assert');
const { setup } = require('./helpers');

let H, db, U, rpc, tx, fails, asOwner, cy;

test.before(async () => {
  H = await setup(); ({ db, U, rpc, tx, fails, asOwner, cy } = H);
  await H.user('sys', 'sys@example.com', '系统管理员', null, null, { sysAdmin: true });
  await H.user('chair', 'chair@example.com', '主席甲', '行政组', '主席');
  await H.user('sec', 'sec@example.com', '文书丙', '文书', '文书');
  await H.user('fin', 'fin@example.com', '财政乙', '财政', '财政');
  await H.user('faith', 'faith@example.com', '张三', '信仰组', '职员');
  await H.user('old', 'old@example.com', '王五', '宣教组', '职员', { year: cy - 1, status: '已卸任' });
  await db.client.query(`insert into public.members (name, nickname, phone, remark, birthday) values
    ('李四', '阿四', '012-3456789', '家里有事，需要关心', '2000-01-15'),
    ('赵六', '六六', '', '', null)`);
  await db.client.query("insert into public.members (name, nickname, status, status_reason) values ('钱七', '小七', 'INACTIVE', '出国')");
});
test.after(async () => { if (db) await db.stop(); });

test('契友名单：备注只有管理员、主席、副主席、文书看得到', async () => {
  for (const k of ['sys', 'chair', 'sec']) {
    const d = await rpc(U[k], 'select public.list_members()');
    assert.strictEqual(d.members.find((m) => m['姓名'] === '李四')['备注'], '家里有事，需要关心', k);
  }
  for (const k of ['fin', 'faith']) {
    const d = await rpc(U[k], 'select public.list_members()');
    assert.strictEqual(d.members.length, 3, k);
    assert.ok(!('备注' in d.members[0]), k + ' 不应该看到备注');
  }
});

test('契友名单：卸任的人和未登入的人看不到', async () => {
  assert.deepStrictEqual((await rpc(U.old, 'select public.list_members()')).members, []);
  await assert.rejects(rpc(null, 'select public.list_members()'), /permission denied/);
  await assert.rejects(rpc(null, 'select public.save_member($1)', [{ name: 'x' }]), /permission denied/);
});

test('契友资料：年龄自动算、电话自动排版', async () => {
  await tx(U.faith, async (c) => {
    const r = (await c.query('select public.save_member($1) r', [{ name: '新契友', phone: '0123456789', birthday: '2005-06-01', group: '第一组' }])).rows[0].r;
    const m = (await c.query('select public.list_members() r')).rows[0].r.members.find((x) => x['契友编号'] === r.memberId);
    assert.strictEqual(m['电话号码'], '012-3456789');
    assert.match(m['年龄'], /^\d+$/);
    assert.deepStrictEqual([m['小组'], m['入会状态'], m['状态']], ['第一组', '未入会', 'ACTIVE']);
  });
  await assert.rejects(rpc(U.faith, 'select public.save_member($1)', [{ name: '' }]), /华文姓名必填/);
  await assert.rejects(rpc(U.old, 'select public.save_member($1)', [{ name: 'x' }]), /只能查看/);
  await assert.rejects(rpc(U.faith, 'select public.save_member($1)', [{ memberId: 'CY-9999', name: 'x' }]), /找不到这位契友/);
});

test('契友资料：没权限的人保存时，原本的备注不会被清掉', async () => {
  const id = (await db.client.query("select id from public.members where name = '李四'")).rows[0].id;
  await tx(U.faith, async (c) => {
    await c.query('select public.save_member($1)', [{ memberId: id, name: '李四', remark: '我想偷改', active: false, reason: '工作忙' }]);
    const m = (await asOwner(c, 'select remark, status, status_reason from public.members where id = $1', [id]))[0];
    assert.deepStrictEqual([m.remark, m.status, m.status_reason], ['家里有事，需要关心', 'INACTIVE', '工作忙']);
  });
  await tx(U.sec, async (c) => {
    await c.query('select public.save_member($1)', [{ memberId: id, name: '李四', remark: '已经好转' }]);
    assert.strictEqual((await asOwner(c, 'select remark from public.members where id = $1', [id]))[0].remark, '已经好转');
  });
});

test('超龄：设了年龄上限后，超龄的活跃契友自动改成不活跃', async () => {
  await tx(U.chair, async (c) => {
    await asOwner(c, "update public.app_settings set value = '20'::jsonb where key = 'member_age_limit'");
    const d = (await c.query('select public.list_members() r')).rows[0].r;
    assert.strictEqual(d.ageLimit, 20);
    const li = d.members.find((m) => m['姓名'] === '李四');
    assert.deepStrictEqual([li['状态'], li['状态原因']], ['INACTIVE', '超龄']);
    assert.strictEqual(d.members.find((m) => m['姓名'] === '赵六')['状态'], 'ACTIVE', '没有生日的不处理');
  });
});

test('会议记录：职员可以登记，卸任的人只能看', async () => {
  await tx(U.faith, async (c) => {
    const r = (await c.query('select public.save_meeting_doc($1) r', [{ date: '2026-05-01', name: '第三次职员会', type: '会议记录', path: '2026/1700000000-abc.pdf' }])).rows[0].r;
    assert.match(r.id, /^MTG-\d{4}$/);
    const list = (await c.query('select public.list_meeting_docs() r')).rows[0].r.meetings;
    assert.deepStrictEqual([list[0]['会议名称'], list[0]['档案路径']], ['第三次职员会', '2026/1700000000-abc.pdf']);
    await fails(c, 'select public.save_meeting_doc($1)', [{ name: 'x', path: '../secret' }], /档案路径不正确/);
    await fails(c, 'select public.save_meeting_doc($1)', [{ name: '', path: '2026/a.pdf' }], /请填写会议名称/);
  });
  await assert.rejects(rpc(U.old, 'select public.save_meeting_doc($1)', [{ name: 'x', path: '2026/a.pdf' }]), /只能查看/);
  assert.strictEqual((await rpc(U.old, 'select public.list_meeting_docs()')).success, true);
  await assert.rejects(rpc(null, 'select public.list_meeting_docs()'), /permission denied/);
});

test('Storage 用的身份检查：只回答自己，不会出错', async () => {
  assert.strictEqual(await rpc(U.faith, 'select public.is_current_staff()'), true);
  assert.strictEqual(await rpc(U.old, 'select public.is_current_staff()'), false);
  assert.strictEqual(await rpc(U.old, 'select public.is_signed_in_member()'), true);
  await assert.rejects(rpc(null, 'select public.is_current_staff()'), /permission denied/);
});

test('轮值表：有契友名单，不活跃的人（含称呼）列在 inactive', async () => {
  const d = await rpc(U.fin, 'select public.get_roster_data()');
  assert.deepStrictEqual(d.members.sort(), ['李四', '赵六'].sort());
  assert.deepStrictEqual(d.inactive.sort(), ['小七', '钱七'].sort());
});
