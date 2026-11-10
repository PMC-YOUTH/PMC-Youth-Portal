// 本地 Postgres 测试环境：建立暂时资料库 → 套 Supabase 模拟 → 依序套用 supabase/migrations → 提供以不同身份执行 SQL 的工具。
// 用法：在测试档 const db = await require('./harness').start(); ... await db.stop();
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..', '..');
const PORT = Number(process.env.PGTEST_PORT || 54329);

function pgBin(name) {
  const base = '/usr/lib/postgresql';
  const vers = fs.existsSync(base) ? fs.readdirSync(base).sort((a, b) => Number(b) - Number(a)) : [];
  for (const v of vers) { const p = path.join(base, v, 'bin', name); if (fs.existsSync(p)) return p; }
  return name; // 已在 PATH
}

// Postgres 不能以 root 执行；root 时改用 postgres 用户
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
function run(bin, args) {
  if (isRoot) return execFileSync('runuser', ['-u', 'postgres', '--', pgBin(bin), ...args], { stdio: 'pipe' });
  return execFileSync(pgBin(bin), args, { stdio: 'pipe' });
}

async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmcyouth-pg-'));
  const data = path.join(dir, 'data');
  if (isRoot) execFileSync('chown', ['-R', 'postgres', dir]);
  run('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C.UTF-8']);
  run('pg_ctl', ['-D', data, '-o', `-p ${PORT} -k ${dir} -c listen_addresses=''`, '-l', path.join(dir, 'log'), '-w', 'start']);

  const client = new Client({ host: dir, port: PORT, user: 'postgres', database: 'postgres' });
  await client.connect();
  await client.query(fs.readFileSync(path.join(__dirname, 'supabase-shim.sql'), 'utf8'));
  const migDir = path.join(ROOT, 'supabase', 'migrations');
  for (const f of fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
    try { await client.query(fs.readFileSync(path.join(migDir, f), 'utf8')); }
    catch (e) { e.message = `migration ${f}: ${e.message}`; throw e; }
  }

  /** 以某个身份执行：role = 'anon' | 'authenticated' | 'service_role'；userId 给 authenticated 用。整个过程在交易里，结束后 rollback。 */
  async function as(role, userId, fn) {
    await client.query('begin');
    try {
      const claims = JSON.stringify(userId ? { sub: userId, role } : { role });
      await client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
      await client.query(`set local role ${role}`);
      return await fn(client);
    } finally {
      await client.query('rollback');
    }
  }

  /** 预期会被挡：回传错误讯息；没被挡就丢错。 */
  async function denied(promise) {
    try { await promise; } catch (e) { return e.message; }
    throw new Error('预期被拒绝，但成功执行了');
  }

  async function stop() {
    await client.end();
    try { run('pg_ctl', ['-D', data, '-m', 'immediate', 'stop']); } catch (_) {}
    fs.rmSync(dir, { recursive: true, force: true });
  }

  /** 另开一条连线（测试同时操作用），用完要 end() */
  async function connect() {
    const c = new Client({ host: dir, port: PORT, user: 'postgres', database: 'postgres' });
    await c.connect();
    return c;
  }

  return { client, as, denied, stop, connect };
}

module.exports = { start };
