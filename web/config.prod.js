// 正式版（pmc-youth-prod）。publishable key 本来就是公开的，只能做 RLS / grant 允许的事。
// 绝对不要把 service_role / secret key 放进 web/。
window.PMC_CONFIG = {
  env: 'prod',
  supabaseUrl: 'https://vnlunozsmegngmzyzkkw.supabase.co',
  supabaseKey: 'sb_publishable_hEBL-RWJ3jQNtedhHWvngw_3gVYHtq-'
};
