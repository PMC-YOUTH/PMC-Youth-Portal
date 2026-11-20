// web/vendor/ 里的第三方程序：内容要跟 npm 官方版本一样（防止被偷偷改掉）。
// 更新版本时：从 npm 下载、核对 npm 的 integrity 后放进 web/vendor/，再更新这里的 SHA-384。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const V = path.join(__dirname, '..', '..', 'web', 'vendor');
const EXPECTED = {
  'supabase-2.45.4.js': 'sha384-0w2KAL2YHP6wKOkUDzkCDGgVvfmHnj02DHeQ6XcHOgTfFsGyonKOpShMH1x6nk9o',
  'jszip-3.10.1.min.js': 'sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG',
};

test('vendor 档案的 SHA-384 跟 npm 官方版本一致', () => {
  for (const [f, sha] of Object.entries(EXPECTED)) {
    const got = 'sha384-' + crypto.createHash('sha384').update(fs.readFileSync(path.join(V, f))).digest('base64');
    assert.strictEqual(got, sha, f + ' 的内容跟记录的不一样');
  }
});

test('网页只从 vendor/ 载入第三方程序，不连外部 CDN', () => {
  for (const page of ['admin.html', 'index.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'web', page), 'utf8');
    const ext = [...html.matchAll(/<script[^>]+src="(https?:[^"]+)"/g)].map((m) => m[1]);
    assert.deepStrictEqual(ext, [], page + ' 还在载入外部程序');
  }
});
