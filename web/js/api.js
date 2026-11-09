/* PMC Youth Portal 前端 API：旧 GAS 函数名称 → Supabase。
 * 权限全部在资料库函数里检查；这里只做呼叫、格式转换和使用者看得懂的错误讯息。
 * 回传格式沿用旧版：{ success: true/false, message, ... }。 */
(function () {
  var cfg = window.PMC_CONFIG || {};
  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'pmcyouth-auth' }
  });
  window.PMC_SB = sb;

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function baseUrl() { return location.origin + location.pathname.replace(/[^/]*$/, ''); }
  function adminUrl() { return baseUrl() + 'admin.html'; }

  async function rpc(name, params) {
    var r = await sb.rpc(name, params || {});
    if (r.error) throw new Error(friendly(r.error.message));
    return r.data;
  }
  /** 包一层：出错时回传 { success:false, message }，跟旧版一样 */
  function safe(fn) {
    return async function () {
      try { return await fn.apply(null, arguments); }
      catch (e) { return { success: false, message: friendly(e && e.message) }; }
    };
  }
  function friendly(msg) {
    msg = String(msg || '');
    if (/Invalid login credentials/i.test(msg)) return 'Email 或密码不正确。';
    if (/User already registered/i.test(msg)) return '这个 Email 已经有账号了。请直接登入，再按「申请加入届别」；忘记密码请按「忘记密码」。';
    if (/rate limit|too many requests|For security purposes/i.test(msg)) return '尝试次数太多，请稍后再试。';
    if (/Password should be at least/i.test(msg)) return '密码至少要 8 个字符。';
    if (/JWT expired|not authenticated|permission denied/i.test(msg)) return '登录已过期，请重新登录。';
    if (/Failed to fetch|NetworkError/i.test(msg)) return '网络连线有问题，请稍后再试。';
    return msg || '操作失败';
  }

  var API = {
    /* ---------- 网址 ---------- */
    getAdminUrl: async function () { return baseUrl() + '?page=admin'; },

    /* ---------- 登入 / 注册 / 密码 ---------- */
    adminLogin: safe(async function (email, password) {
      email = String(email || '').trim().toLowerCase();
      if (!email || !password) return { success: false, message: '请输入 Email 和密码。' };
      var r = await sb.auth.signInWithPassword({ email: email, password: String(password) });
      if (r.error) return { success: false, message: friendly(r.error.message) };
      try {
        var s = await rpc('get_my_session', { p_login: true });
        return { success: true, token: 'supabase', user: s.user, perms: s.perms, message: '登录成功。' };
      } catch (e) {
        await sb.auth.signOut();
        return { success: false, message: e.message };
      }
    }),

    adminLogout: async function () { await sb.auth.signOut(); return { success: true }; },

    getAdminSession: safe(async function () {
      var cur = await sb.auth.getSession();
      if (!cur.data || !cur.data.session) return { success: false };
      var s = await rpc('get_my_session', { p_login: false });
      return { success: true, user: s.user, perms: s.perms };
    }),

    registerAccount: safe(async function (data) {
      data = data || {};
      var name = String(data.name || '').trim().slice(0, 40);
      var email = String(data.email || '').trim().toLowerCase();
      var phone = String(data.phone || '').trim().slice(0, 30);
      var password = String(data.password || '');
      if (!name) return { success: false, message: '请填写姓名。' };
      if (!EMAIL_RE.test(email)) return { success: false, message: 'Email 格式不正确。' };
      if (password.length < 8) return { success: false, message: '密码至少要 8 个字符。' };
      if (!data.group) return { success: false, message: '请选择你的组别 / 职位。' };
      var r = await sb.auth.signUp({
        email: email, password: password,
        options: { data: { name: name, phone: phone, group: String(data.group), year: String(data.year || '') } }
      });
      if (r.error) {
        if (/Database error/i.test(r.error.message)) return { success: false, message: '注册失败：请检查姓名、组别和届别（只能申请当届或下一届）。' };
        return { success: false, message: friendly(r.error.message) };
      }
      // 还没批准，先登出
      await sb.auth.signOut();
      return { success: true, message: '注册成功！请等待管理员或主席批准，批准后会以 Email 通知你。' };
    }),

    requestPasswordReset: safe(async function (email) {
      email = String(email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return { success: false, message: 'Email 格式不正确。' };
      var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: adminUrl() });
      if (r.error) return { success: false, message: friendly(r.error.message) };
      return { success: true, message: '如果这个 Email 有账号，重设密码的链接已经寄出，请到信箱查看（也看看垃圾邮件）。' };
    }),

    changeMyPassword: safe(async function (_token, oldPassword, newPassword) {
      newPassword = String(newPassword || '');
      if (newPassword.length < 8) return { success: false, message: '新密码至少要 8 个字符。' };
      var u = await sb.auth.getUser();
      var email = u.data && u.data.user && u.data.user.email;
      if (!email) return { success: false, message: '登录已过期，请重新登录。' };
      var check = await sb.auth.signInWithPassword({ email: email, password: String(oldPassword || '') });
      if (check.error) return { success: false, message: '目前密码不正确。' };
      var r = await sb.auth.updateUser({ password: newPassword });
      if (r.error) return { success: false, message: friendly(r.error.message) };
      return { success: true, message: '密码已更新。' };
    }),

    /* ---------- 任期申请 / 账号管理 ---------- */
    applyForTerm: safe(async function (_t, year, group) { return rpc('apply_for_term', { p_year: Number(year), p_choice: group }); }),
    listAccounts: safe(async function () { return rpc('list_accounts'); }),
    approveTerm: safe(async function (_t, termId, role, group) { return rpc('approve_term', { p_term_id: termId, p_role: role, p_group: group }); }),
    rejectTerm: safe(async function (_t, termId) { return rpc('reject_term', { p_term_id: termId }); }),
    updateTerm: safe(async function (_t, termId, changes) { return rpc('update_term', { p_term_id: termId, p_changes: changes || {} }); }),
    endTerm: safe(async function (_t, termId, opts) { return rpc('end_term', { p_term_id: termId, p_opts: opts || {} }); }),
    copyTermsToYear: safe(async function (_t, from, to) { return rpc('copy_terms_to_year', { p_from: Number(from), p_to: Number(to) }); }),
    handoverToYear: safe(async function (_t, year) { return rpc('handover_to_year', { p_new_year: Number(year) }); }),
    updateAccount: safe(async function (_t, userId, changes) { return rpc('update_account', { p_user_id: userId, p_changes: changes || {} }); }),
    resetAccountPassword: safe(async function (_t, userId) {
      var r = await rpc('prepare_password_reset', { p_user_id: userId });
      var sent = await sb.auth.resetPasswordForEmail(r.email, { redirectTo: adminUrl() });
      if (sent.error) return { success: false, message: '链接寄不出去：' + friendly(sent.error.message) };
      return { success: true, message: '重设密码的链接已寄到 ' + r.email + '。' };
    }),
    switchViewAs: safe(async function (_t, role, group) { return rpc('switch_view_as', { p_role: role || '', p_group: group || '' }); }),

    /* ---------- 暂时的替代（阶段 2 换成真的） ---------- */
    getPortalBranding: async function () { return { success: false }; },
    refreshAdminCache: async function () { return { success: true, message: '资料已同步' }; }
  };
  window.PMC_API = API;

  /* ---------- 点了 Email 里的重设密码链接回来：请对方设定新密码 ---------- */
  sb.auth.onAuthStateChange(function (event) {
    if (event === 'PASSWORD_RECOVERY') setTimeout(showNewPasswordForm, 0);
  });
  function showNewPasswordForm() {
    if (document.getElementById('pmcNewPw')) return;
    var box = document.createElement('div');
    box.id = 'pmcNewPw';
    box.setAttribute('style', 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;');
    box.innerHTML =
      '<div style="background:#fff;color:#1E2B24;border-radius:14px;padding:20px;max-width:360px;width:100%;font:15px/1.6 system-ui,sans-serif;">' +
      '<div style="font-weight:700;font-size:17px;margin-bottom:8px;">设定新密码</div>' +
      '<p style="margin:0 0 12px;color:#66756C;font-size:13px;">请输入新密码（至少 8 个字符），设定好后用新密码登入。</p>' +
      '<input id="pmcNewPw1" type="password" autocomplete="new-password" placeholder="新密码" style="width:100%;padding:10px;margin-bottom:8px;border:1px solid #E1E7E2;border-radius:8px;font-size:15px;box-sizing:border-box;">' +
      '<input id="pmcNewPw2" type="password" autocomplete="new-password" placeholder="再输入一次" style="width:100%;padding:10px;margin-bottom:8px;border:1px solid #E1E7E2;border-radius:8px;font-size:15px;box-sizing:border-box;">' +
      '<div id="pmcNewPwMsg" style="color:#b91c1c;font-size:13px;min-height:20px;"></div>' +
      '<button id="pmcNewPwBtn" style="width:100%;padding:11px;border:0;border-radius:8px;background:#1F4D3A;color:#fff;font-size:15px;">保存新密码</button></div>';
    document.body.appendChild(box);
    document.getElementById('pmcNewPwBtn').onclick = async function () {
      var a = document.getElementById('pmcNewPw1').value, b = document.getElementById('pmcNewPw2').value;
      var msg = document.getElementById('pmcNewPwMsg');
      if (a.length < 8) { msg.textContent = '密码至少要 8 个字符。'; return; }
      if (a !== b) { msg.textContent = '两次输入的密码不一样。'; return; }
      var r = await sb.auth.updateUser({ password: a });
      if (r.error) { msg.textContent = friendly(r.error.message); return; }
      await sb.auth.signOut();
      box.remove();
      alert('新密码已设定，请用新密码登入。');
      location.href = adminUrl();
    };
  }
})();
