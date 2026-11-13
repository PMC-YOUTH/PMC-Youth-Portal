// 阶段 6：寄信队列（领信 / 记录结果 / 每日额度）、测试信、会议截止提醒
const test = require('node:test');
const assert = require('node:assert');
const { setup } = require('./helpers');

let H, db, U, rpc, tx, fails, asOwner, cy;

test.before(async () => {
  H = await setup(); ({ db, U, rpc, tx, fails, asOwner, cy } = H);
  await H.user('sys', 'sys@example.com', '系统管理员', null, null, { sysAdmin: true });
  await H.user('chair', 'chair@example.com', '主席甲', '行政组', '主席');
  await H.user('faith', 'faith@example.com', '张三', '信仰组', '职员');
  await H.user('wit', 'wit@example.com', '李四', '见证组', '职员');
});
test.after(async () => { if (db) await db.stop(); });

const svc = (fn) => db.as('service_role', null, fn);

test('寄信队列：只有寄信程序（service role）能领信和记结果；职员和匿名都不行', async () => {
  for (const who of [U.chair, null]) {
    await assert.rejects(rpc(who, 'select public.claim_email_batch(5)'), /permission denied/);
    await assert.rejects(rpc(who, 'select public.finish_email(1, true, null)'), /permission denied/);
  }
});

test('领信：领走的信会锁住不重复领；成功变 SENT；失败会重试，5 次后 FAILED', async () => {
  await svc(async (c) => {
    await asOwner(c, "insert into public.email_outbox (to_emails, subject, lines) values ('{a@example.com}', '第一封', '{你好}'), ('{b@example.com}', '第二封', '{}')");
    const b1 = (await c.query('select public.claim_email_batch(10) r')).rows[0].r;
    assert.deepStrictEqual(b1.emails.map((e) => e.subject), ['第一封', '第二封']);
    const b2 = (await c.query('select public.claim_email_batch(10) r')).rows[0].r;
    assert.deepStrictEqual(b2.emails, [], '锁住的不能再领');
    await c.query('select public.finish_email($1, true, null)', [b1.emails[0].id]);
    await c.query('select public.finish_email($1, false, $2)', [b1.emails[1].id, 'SMTP 错误']);
    const rows = await asOwner(c, 'select subject, status, attempts, error from public.email_outbox order by id');
    assert.deepStrictEqual(rows.map((r) => [r.subject, r.status]), [['第一封', 'SENT'], ['第二封', 'PENDING']]);
    assert.strictEqual(rows[1].error, 'SMTP 错误');
    await asOwner(c, "update public.email_outbox set attempts = 5, locked_until = null where subject = '第二封'");
    await c.query('select public.finish_email($1, false, $2)', [b1.emails[1].id, '又失败']);
    assert.strictEqual((await asOwner(c, "select status from public.email_outbox where subject = '第二封'"))[0].status, 'FAILED');
  });
});

test('每日额度：超过额度的信留到之后再寄', async () => {
  await svc(async (c) => {
    await asOwner(c, "update public.app_settings set value = '3'::jsonb where key = 'email_daily_limit'");
    await asOwner(c, "insert into public.email_outbox (to_emails, subject, status, sent_at) values ('{x@example.com,y@example.com}', '已寄', 'SENT', now())");
    await asOwner(c, "insert into public.email_outbox (to_emails, cc_emails, subject) values ('{a@example.com}', '{}', '一位'), ('{b@example.com}', '{c@example.com}', '两位')");
    const b = (await c.query('select public.claim_email_batch(10) r')).rows[0].r;
    assert.deepStrictEqual(b.emails.map((e) => e.subject), ['一位'], '已用 2 位，额度 3，只够再寄 1 位');
    assert.strictEqual(b.quotaLeft, 0);
  });
});

test('测试信：只有管理员；寄给自己', async () => {
  await assert.rejects(rpc(U.chair, 'select public.queue_test_email()'), /只有管理员可以寄测试信/);
  await tx(U.sys, async (c) => {
    const r = (await c.query('select public.queue_test_email() r')).rows[0].r;
    assert.match(r.message, /sys@example\.com/);
    const m = (await asOwner(c, "select to_emails from public.email_outbox where subject = '测试信'"))[0];
    assert.deepStrictEqual(m.to_emails, ['sys@example.com']);
  });
});

test('截止提醒：3 天后截止、还没提交的组才收到；已提交或已生成报告的不提醒', async () => {
  await svc(async (c) => {
    await asOwner(c, 'select private.ensure_meetings($1)', [cy]);
    await asOwner(c, "update public.ministry_meetings set report_deadline = private.today() + 3 where year = $1 and meeting_no = 2", [cy]);
    await asOwner(c, "update public.ministry_meetings set report_deadline = private.today() + 3, status = '报告已生成' where year = $1 and meeting_no = 3", [cy]);
    await asOwner(c, "insert into public.ministry_submissions (year, meeting_no, grp, status) values ($1, 2, '见证组', '已提交')", [cy]);
    const n = (await asOwner(c, 'select private.send_meeting_deadline_reminders() n'))[0].n;
    const mails = await asOwner(c, "select to_emails, subject from public.email_outbox where subject like '%3 天后截止' order by subject");
    assert.strictEqual(n, 2, '行政组 + 信仰组（见证组已提交；其他组没有职员）');
    assert.deepStrictEqual(mails.map((m) => m.to_emails[0]).sort(), ['chair@example.com', 'faith@example.com']);
    assert.ok(mails.every((m) => /第2次会议报告 3 天后截止/.test(m.subject)));
  });
});

test('有待寄的信才叫寄信程序；没设定网址就什么都不做（本地没有 pg_net 也不会出错）', async () => {
  await svc(async (c) => {
    await asOwner(c, "insert into public.email_outbox (to_emails, subject) values ('{a@example.com}', '待寄')");
    await asOwner(c, 'select private.kick_email_sender()');   // functions_url 是空的 → 直接结束
  });
});
