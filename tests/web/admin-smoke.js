// 后台页面冒烟测试（不连真的 Supabase）：用 Playwright 开 web/admin.html，
// 把 Supabase 的 Auth / RPC 回应换成假资料，检查登入 → 进入后台 → 账号管理能正常显示、没有 JS 错误。
// 用法：node tests/web/admin-smoke.js <supabase-js UMD 档案路径>
// （需要可用的 Playwright + Chromium；不在 npm test 里跑）
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..', 'web');
const UMD = process.argv[2];
if (!UMD || !fs.existsSync(UMD)) { console.error('请给 supabase-js UMD 档案路径'); process.exit(2); }
const SUPA = 'https://ivvsxzojghvyuvjobrtp.supabase.co';
const SITE = 'http://pmc.test/';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const userId = '00000000-0000-0000-0000-0000000000aa';
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: userId, role: 'authenticated', exp: now + 3600, email: 'pmc.test@example.com' })}.sig`;
const authUser = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'pmc.test@example.com', app_metadata: {}, user_metadata: {} };
const session = {
  success: true,
  user: { userId, name: '测试管理员', email: 'pmc.test@example.com', loginId: 'pmc.test@example.com', termYear: 2026, isSysAdmin: true,
    terms: [], role: '管理员', group: '', realGroup: '', readOnly: false, viewYear: 2026, viewAs: false },
  perms: { admin: true, exec: true, finance: true, memberPrivate: true, staff: true }
};
const accounts = {
  success: true, currentYear: 2026, fullAdmin: true,
  roles: ['管理员', '主席', '副主席', '财政', '查账', '文书', '职员'],
  groups: ['行政组', '信仰组', '见证组', '宣教组', '公民组', '团契组', '财政', '文书', '查账'],
  accounts: [{ userId, name: '测试管理员', email: 'pmc.test@example.com', phone: '', status: 'ACTIVE', sysAdmin: true, hasPassword: true, createdAt: '', lastLogin: '' },
             { userId: 'u2', name: '张三', email: 'zhang@example.com', phone: '', status: 'PENDING', sysAdmin: false, hasPassword: true, createdAt: '', lastLogin: '' }],
  terms: [{ termId: 't1', year: 2026, userId: 'u2', name: '张三', group: '信仰组', role: '职员', status: '待批准', start: '', end: '', note: '', createdAt: '' }]
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  const rpcCalls = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('https://cdn.jsdelivr.net/npm/@supabase/supabase-js')) return route.fulfill({ path: UMD, contentType: 'application/javascript' });
    if (url.startsWith(SUPA + '/auth/v1/token')) {
      return route.fulfill({ json: { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user: authUser } });
    }
    if (url.startsWith(SUPA + '/auth/v1/user')) return route.fulfill({ json: authUser });
    if (url.startsWith(SUPA + '/auth/v1/logout')) return route.fulfill({ status: 204, body: '' });
    if (url.startsWith(SUPA + '/rest/v1/rpc/')) {
      const fn = url.split('/rpc/')[1].split('?')[0];
      rpcCalls.push(fn);
      if (fn === 'get_my_session') return route.fulfill({ json: session });
      if (fn === 'list_accounts') return route.fulfill({ json: accounts });
      return route.fulfill({ json: { success: true, message: 'ok' } });
    }
    if (url.startsWith(SITE)) {
      let rel = url.slice(SITE.length).split('?')[0] || 'index.html';
      if (rel === 'config.js') rel = 'config.dev.js';
      const f = path.join(ROOT, rel);
      if (fs.existsSync(f)) return route.fulfill({ path: f });
      return route.fulfill({ status: 404, body: 'not found' });
    }
    return route.abort();
  });

  const fail = (m) => { console.error('FAIL ' + m); process.exitCode = 1; };

  await page.goto(SITE + 'admin.html');
  await page.waitForSelector('#loginId');
  await page.fill('#loginId', 'pmc.test@example.com');
  await page.fill('#loginPin', 'password123');
  await page.evaluate(() => login());
  await page.waitForSelector('#appPage', { state: 'visible', timeout: 10000 }).catch(() => fail('登入后没有进入后台'));
  if (!rpcCalls.includes('get_my_session')) fail('没有呼叫 get_my_session');
  console.log('登入后的使用者：', await page.evaluate(() => currentUser && currentUser.name + ' / ' + currentUser.role));

  // 账号管理
  await page.evaluate(() => loadAccounts());
  await page.waitForTimeout(800);
  if (!rpcCalls.includes('list_accounts')) fail('没有呼叫 list_accounts');
  const hasPending = await page.evaluate(() => (document.getElementById('termTop') || document.body).closest('body').textContent.includes('张三') && !!accountsData);
  if (!hasPending) fail('账号管理没有显示待批准的申请');

  // 还没搬的功能：要走 failure handler，不能让页面坏掉
  const msg = await page.evaluate(() => new Promise((res) => {
    google.script.run.withSuccessHandler(() => res('ok?')).withFailureHandler((e) => res(e.message)).someFunctionNotPorted('x');
  }));
  if (!/搬移中/.test(msg)) fail('未搬功能的讯息不对：' + msg);

  // 登出
  await page.evaluate(() => logout());
  await page.waitForSelector('#loginPage', { state: 'visible' });

  const real = errors.filter((e) => !/favicon/.test(e));
  if (real.length) fail('页面有错误：\n  ' + real.join('\n  '));
  console.log('RPC 呼叫：', rpcCalls.join(', '));
  await page.screenshot({ path: process.env.SHOT || '/dev/null' }).catch(() => {});
  await browser.close();
  console.log(process.exitCode ? '冒烟测试失败' : '冒烟测试通过');
})();
