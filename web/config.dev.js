// 测试版（pmc-youth-dev）。publishable key 本来就是公开的，只能做 RLS / grant 允许的事。
// 绝对不要把 service_role / secret key 放进 web/。
window.PMC_CONFIG = {
  env: 'dev',
  supabaseUrl: 'https://ivvsxzojghvyuvjobrtp.supabase.co',
  supabaseKey: 'sb_publishable_HhhNIRIzSalzdW0JBMX2HQ_K0Afa254'
};
