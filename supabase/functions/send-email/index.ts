// PMC Youth Portal：寄出 email_outbox 里的信（Gmail SMTP，465 埠；Supabase 不允许 25 / 587 埠）
// 由 pg_cron 每分钟在「有待寄的信」时呼叫（private.kick_email_sender）。
// 需要的 Secrets（用户自己在 Supabase → Edge Functions → Secrets 设定，不放 repo）：
//   GMAIL_USER          例如 pmc.youth2010@gmail.com
//   GMAIL_APP_PASSWORD  Google 账号的「应用程式密码」（16 个字母）
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由 Supabase 自动提供。
// 信件格式沿用旧版 notify_send_：主旨前加【播青】、寄件名称「播青后台」、有「打开播青后台」按钮。
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import nodemailer from 'npm:nodemailer@6.9.16';

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function html(lines: string[], url: string): string {
  const body = (lines || []).map((l) => esc(l).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')).join('<br>');
  return '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#1E2B24;max-width:560px;">' +
    '<div style="background:#1F4D3A;color:#ffffff;padding:14px 18px;border-radius:10px 10px 0 0;font-weight:bold;">播青后台通知</div>' +
    '<div style="border:1px solid #E1E7E2;border-top:none;padding:18px;border-radius:0 0 10px 10px;">' + body +
    (url ? '<p style="margin-top:20px;"><a href="' + esc(url) + '" style="background:#1F4D3A;color:#ffffff;padding:9px 16px;border-radius:8px;text-decoration:none;">打开播青后台</a></p>' : '') +
    '<p style="color:#888888;font-size:12px;margin-top:18px;">这是系统自动发出的通知，请不要直接回复。</p></div></div>';
}

Deno.serve(async () => {
  const user = Deno.env.get('GMAIL_USER') || '';
  const pass = (Deno.env.get('GMAIL_APP_PASSWORD') || '').replace(/\s+/g, '');
  if (!user || !pass) return Response.json({ ok: false, message: '还没设定 GMAIL_USER / GMAIL_APP_PASSWORD' }, { status: 503 });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data, error } = await db.rpc('claim_email_batch', { p_limit: 20 });
  if (error) return Response.json({ ok: false, message: error.message }, { status: 500 });

  const emails = (data?.emails || []) as Array<{ id: number; to: string[]; cc: string[]; subject: string; lines: string[]; hideButton: boolean }>;
  if (!emails.length) return Response.json({ ok: true, sent: 0, quotaFull: !!data?.quotaFull });

  const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } });
  let sent = 0, failed = 0;
  for (const m of emails) {
    try {
      await transport.sendMail({
        from: { name: '播青后台', address: user },
        to: m.to.join(','), cc: m.cc.length ? m.cc.join(',') : undefined,
        subject: '【播青】' + m.subject,
        html: html(m.lines, m.hideButton ? '' : String(data.appUrl || '')),
        text: (m.lines || []).join('\n'),
      });
      await db.rpc('finish_email', { p_id: m.id, p_ok: true, p_error: null });
      sent++;
    } catch (e) {
      await db.rpc('finish_email', { p_id: m.id, p_ok: false, p_error: String((e as Error)?.message || e) });
      failed++;
    }
  }
  transport.close();
  return Response.json({ ok: true, sent, failed });
});
