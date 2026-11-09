// 阶段 0：基础设定的安全测试
const test = require('node:test');
const assert = require('node:assert');
const harness = require('./harness');

let db;
test.before(async () => { db = await harness.start(); });
test.after(async () => { if (db) await db.stop(); });

test('ping：匿名和登入者都能呼叫', async () => {
  for (const role of ['anon', 'authenticated']) {
    const r = await db.as(role, role === 'authenticated' ? '00000000-0000-0000-0000-000000000001' : null,
      (c) => c.query('select public.ping() as p'));
    assert.strictEqual(r.rows[0].p.ok, true);
  }
});

test('之后在 public 新建的资料表：anon / authenticated 预设不能读写', async () => {
  await db.client.query('create table public.t_secret (id int, note text)');
  await db.client.query("insert into public.t_secret values (1, 'x')");
  for (const role of ['anon', 'authenticated']) {
    const msg = await db.denied(db.as(role, null, (c) => c.query('select * from public.t_secret')));
    assert.match(msg, /permission denied/);
    const msg2 = await db.denied(db.as(role, null, (c) => c.query("insert into public.t_secret values (2, 'y')")));
    assert.match(msg2, /permission denied/);
  }
  await db.client.query('drop table public.t_secret');
});

test('之后在 public 新建的函数：没 grant 就不能呼叫', async () => {
  await db.client.query('create function public.f_secret() returns int language sql as $$ select 42 $$');
  for (const role of ['anon', 'authenticated']) {
    const msg = await db.denied(db.as(role, null, (c) => c.query('select public.f_secret()')));
    assert.match(msg, /permission denied/);
  }
  await db.client.query('drop function public.f_secret()');
});

test('private schema：前端完全碰不到', async () => {
  await db.client.query('create function private.f_internal() returns int language sql as $$ select 1 $$');
  for (const role of ['anon', 'authenticated']) {
    const msg = await db.denied(db.as(role, null, (c) => c.query('select private.f_internal()')));
    assert.match(msg, /permission denied/);
  }
  await db.client.query('drop function private.f_internal()');
});
