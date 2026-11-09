// 资料库测试共用工具：建立测试用户、以某身份呼叫、交易里预期失败
const assert = require('node:assert');
const harness = require('./harness');

async function setup() {
  const db = await harness.start();
  const cy = (await db.client.query('select private.current_year() y')).rows[0].y;
  const U = {};

  async function newUser(email, meta) {
    const r = await db.client.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [email, meta || null]);
    return r.rows[0].id;
  }
  /** 建立已启用的用户；grp 有值时加一个任期 */
  async function user(key, email, name, grp, role, { year, status = '在任', sysAdmin = false } = {}) {
    const id = await newUser(email, null);
    await db.client.query("update public.profiles set name = $2, status = 'ACTIVE', is_sys_admin = $3 where id = $1", [id, name, sysAdmin]);
    if (grp) {
      await db.client.query('insert into public.terms (year, user_id, name, grp, role, status) values ($1, $2, $3, $4, $5, $6)',
        [year || cy, id, name, grp, role, status]);
    }
    U[key] = id;
    return id;
  }
  /** 以某个用户（null = 匿名）呼叫一句 SQL，回传第一列第一栏 */
  function rpc(userId, sql, params) {
    return db.as(userId ? 'authenticated' : 'anon', userId, (c) => c.query(sql, params).then((r) => r.rows[0] && Object.values(r.rows[0])[0]));
  }
  /** 同一交易里做几件事，结束后 rollback */
  function tx(userId, fn) { return db.as(userId ? 'authenticated' : 'anon', userId, fn); }
  /** 交易里预期失败（用 savepoint，之后还能继续） */
  async function fails(c, sql, params, re) {
    await c.query('savepoint expect_fail');
    try { await c.query(sql, params); } catch (e) {
      await c.query('rollback to savepoint expect_fail');
      if (re) assert.match(e.message, re);
      return;
    }
    throw new Error('预期失败，但成功执行了：' + sql);
  }
  /** 在交易里以管理员身份（postgres）执行 */
  async function asOwner(c, sql, params) {
    const who = (await c.query('select current_user u')).rows[0].u;
    await c.query('reset role');
    try { return (await c.query(sql, params)).rows; } finally { await c.query(`set local role ${who}`); }
  }
  return { db, cy, U, user, newUser, rpc, tx, fails, asOwner };
}

module.exports = { setup };
