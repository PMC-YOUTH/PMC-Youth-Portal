-- 阶段 4：职员 Claim、奉献、财政交易、预算、财政报告数字
-- 规格来源：legacy/gas/src/AdminBackend.gs（submitClaim、reviewClaim、markClaimPaid、confirmClaimReceived、submitOffering）
--          legacy/gas/src/MinistryBackend.gs（getFinanceData、saveFinanceTxn、deleteFinanceTxn、saveFinanceBudget、fin_computeReport_）
-- 跟钱有关的动作：同一交易里锁住那一笔 → 重新读状态 → 检查不可重复 → 写入；资料库约束再挡一次。
-- 这个档案不用任何删除类的指令（Supabase 会要求确认，用户在手机上看不到确认框）；财政交易「删除」只做标记。

/* ============================================================
   资料表
   ============================================================ */

create sequence public.claim_code_seq;
create table public.claims (
  id text primary key default ('CLM-' || lpad(nextval('public.claim_code_seq')::text, 4, '0')),
  applicant_id uuid,
  applicant_name text not null,
  applicant_email text not null default '',
  claim_date date,
  event_id text not null default '',
  description text not null default '',
  category text not null default '',
  grp text not null default '',
  amount numeric(12, 2) not null check (amount > 0),
  receipt_path text not null default '',   -- Storage「receipts」里的路径（不公开）
  receipt_url text not null default '',    -- 旧资料的外部链接
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  fin_synced boolean not null default false,
  reviewer text not null default '',
  review_note text not null default '',
  reviewed_at timestamptz,
  paid_at timestamptz,
  paid_by text not null default '',
  pay_method text not null default '',
  pay_note text not null default '',
  received_at timestamptz,
  created_at timestamptz not null default now(),
  -- 状态只能往前走：没批准不能付款，没付款不能确认收到（确认收到时会顺便补付款时间）
  check (paid_at is null or status = 'APPROVED'),
  check (received_at is null or (status = 'APPROVED' and paid_at is not null))
);
alter table public.claims enable row level security;

create sequence public.offering_code_seq;
create table public.offerings (
  id text primary key default ('OFF-' || lpad(nextval('public.offering_code_seq')::text, 4, '0')),
  offering_date date not null,
  event_name text not null default '',
  attendance int,
  amount numeric(12, 2) not null check (amount > 0),
  counter text not null default '',       -- 计算员
  recorded_by text not null default '',
  recorded_by_id uuid,
  remark text not null default '',
  created_at timestamptz not null default now()
);
alter table public.offerings enable row level security;

create sequence public.fin_code_seq;
create table public.finance_txns (
  id text primary key default ('FIN-' || lpad(nextval('public.fin_code_seq')::text, 4, '0')),
  txn_date date not null,
  type text not null check (type in ('收入', '支出', '转账')),
  category text not null default '',
  grp text not null default '',
  description text not null default '',
  amount numeric(12, 2) not null check (amount > 0),
  account text not null check (account in ('奉献在手', '现金', '银行')),
  to_account text not null default '' check (to_account in ('', '奉献在手', '现金', '银行')),
  ref_id text,                             -- CLM-xxxx / OFF-xxxx：自动产生的交易
  remark text not null default '',
  recorded_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,                   -- 「删除」只做标记，资料保留
  voided_by text not null default '',
  check (type <> '转账' or (to_account <> '' and to_account <> account))
);
alter table public.finance_txns enable row level security;
-- 同一张 Claim / 同一笔奉献最多只有一笔有效的财政交易（防重复记账的最后一道防线）
create unique index finance_txns_one_per_ref on public.finance_txns (ref_id) where ref_id is not null and voided_at is null;
create index finance_txns_date on public.finance_txns (txn_date);

-- 预算：每年一笔，整份存（保存时整份覆盖）
create table public.budgets (
  year int primary key check (year between 2000 and 2100),
  items jsonb not null default '[]'::jsonb,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.budgets enable row level security;

/* ============================================================
   内部工具
   ============================================================ */

create or replace function private.require_finance(p_write boolean) returns jsonb
language plpgsql stable set search_path = '' as $$
declare s jsonb := case when p_write then private.require_staff() else private.session() end;
begin
  if not private.is_finance(s) then raise exception '只有财政、查账或管理员可以使用财政功能。' using errcode = '42501'; end if;
  return s;
end $$;

create or replace function private.money(n numeric) returns text
language sql immutable set search_path = '' as $$
  select trim(trailing '.' from trim(trailing '0' from to_char(n, 'FM999999990.00')))
$$;

create or replace function private.cn_num(n int) returns text
language sql immutable set search_path = '' as $$
  select case when n <= 10 then (array['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'])[n + 1]
              when n < 20 then '十' || case when n % 10 > 0 then (array['一', '二', '三', '四', '五', '六', '七', '八', '九'])[n % 10] else '' end
              else (array['一', '二', '三', '四', '五', '六', '七', '八', '九'])[n / 10] || '十'
                   || case when n % 10 > 0 then (array['一', '二', '三', '四', '五', '六', '七', '八', '九'])[n % 10] else '' end end
$$;

-- 这张 Claim 是不是我的
create or replace function private.claim_is_mine(s jsonb, c public.claims) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(c.applicant_id = nullif(s ->> 'userId', '')::uuid
                  or (c.applicant_email <> '' and lower(c.applicant_email) = lower(coalesce(s ->> 'email', ''))), false)
$$;

-- 看得到哪些 Claim（旧版 claim_listForSession_）：卸任只看自己的；财政 / 查账 / 管理员看全部；其他人看自己的和自己组的
create or replace function private.claim_visible(s jsonb, c public.claims) returns boolean
language sql immutable set search_path = '' as $$
  select case
    when (s ->> 'readOnly')::boolean then private.claim_is_mine(s, c)
    when private.is_finance(s) then true
    else private.claim_is_mine(s, c) or (coalesce(s ->> 'group', '') <> '' and c.grp = s ->> 'group')
  end
$$;

create or replace function private.claim_json(c public.claims) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    '报销编号', c.id, '申请人姓名', c.applicant_name, '申请人邮箱', c.applicant_email, '报销日期', private.d_admin(c.claim_date),
    '节目编号', c.event_id, '报销说明', c.description, '类别', c.category, '组别', c.grp, '金额', c.amount,
    '收据路径', c.receipt_path, '收据链接', c.receipt_url, '状态', c.status, '财政同步', case when c.fin_synced then '是' else '否' end,
    '审核人', c.reviewer, '审核备注', c.review_note, '审核时间', private.ts_admin(c.reviewed_at),
    '付款时间', private.ts_admin(c.paid_at), '付款人', c.paid_by, '付款方式', c.pay_method, '付款备注', c.pay_note,
    '收款确认时间', private.ts_admin(c.received_at), '建立时间', private.ts_admin(c.created_at))
$$;

create or replace function private.txn_json(t public.finance_txns) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    '交易编号', t.id, '交易日期', private.d_admin(t.txn_date), '类型', t.type, '类别', t.category, '组别', t.grp,
    '说明', t.description, '金额', t.amount, '账户', t.account, '转入账户', t.to_account, '参考编号', coalesce(t.ref_id, ''),
    '备注', t.remark, '记录人', t.recorded_by, '建立时间', private.ts_admin(t.created_at), '更新日期', private.ts_admin(t.updated_at))
$$;

-- 那一年担任某职位的人（在任或已卸任），用在报告的签名栏（旧版 rptStaffByRole_）
create or replace function private.staff_by_role(p_year int, p_role text) returns text
language sql stable set search_path = '' as $$
  select coalesce((select name from public.terms where year = p_year and role = p_role and status in ('在任', '已卸任')
                   order by created_at limit 1), '')
$$;

/* ---------- 「一月至 X 月」财政报告的数字（旧版 fin_computeReport_） ---------- */
create or replace function private.fin_report(p_year int, p_month int) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_month int := least(12, greatest(1, coalesce(p_month, 12)));
  v_start date := make_date(p_year, 1, 1);
  v_end date := (make_date(p_year, v_month, 1) + interval '1 month')::date;
  v_items jsonb := coalesce((select items from public.budgets where year = p_year), '[]'::jsonb);
  v_inc_names text[]; v_exp_names text[];
  inc_act jsonb := '{}'; exp_act jsonb := '{}'; bal jsonb := '{"奉献在手": 0, "现金": 0, "银行": 0}';
  v_others jsonb := '[]'; v_opening numeric := 0;
  t public.finance_txns; v_acct text; v_key text;
  v_income jsonb; v_expense jsonb; b jsonb; k text;
begin
  select coalesce(array_agg(x ->> 'item' order by ord), '{}') into v_inc_names
    from jsonb_array_elements(v_items) with ordinality y(x, ord) where x ->> 'type' = '收入';
  select coalesce(array_agg(x ->> 'item' order by ord), '{}') into v_exp_names
    from jsonb_array_elements(v_items) with ordinality y(x, ord) where x ->> 'type' = '支出';

  for t in select * from public.finance_txns where voided_at is null and txn_date >= v_start and txn_date < v_end order by txn_date, id loop
    v_acct := t.account;
    if t.type = '收入' then
      bal := jsonb_set(bal, array[v_acct], to_jsonb((bal ->> v_acct)::numeric + t.amount));
      if t.category = '上年余额' then v_opening := v_opening + t.amount; continue; end if;
      v_key := case when t.category = any (v_inc_names) then t.category when t.category <> '' and t.category <> '其他' then t.category else '其他' end;
      inc_act := jsonb_set(inc_act, array[v_key], to_jsonb(coalesce((inc_act ->> v_key)::numeric, 0) + t.amount));
      if v_key = '其他' then
        v_others := v_others || jsonb_build_object('desc', coalesce(nullif(t.description, ''), t.category), 'amount', t.amount);
      end if;
    elsif t.type = '支出' then
      bal := jsonb_set(bal, array[v_acct], to_jsonb((bal ->> v_acct)::numeric - t.amount));
      v_key := case when t.category = any (v_exp_names) then t.category when t.grp = any (v_exp_names) then t.grp else '其他' end;
      exp_act := jsonb_set(exp_act, array[v_key], to_jsonb(coalesce((exp_act ->> v_key)::numeric, 0) + t.amount));
    else
      bal := jsonb_set(bal, array[v_acct], to_jsonb((bal ->> v_acct)::numeric - t.amount));
      bal := jsonb_set(bal, array[t.to_account], to_jsonb((bal ->> t.to_account)::numeric + t.amount));
    end if;
  end loop;

  v_income := jsonb_build_array(jsonb_build_object('label', (p_year - 1) || '年余额', 'budget', '', 'actual', v_opening, 'opening', true));
  for b in select x from jsonb_array_elements(v_items) x where x ->> 'type' = '收入' loop
    v_income := v_income || jsonb_build_object('label', (b ->> 'item') || coalesce(b ->> 'desc', ''), 'budget', b -> 'budget',
                                               'actual', coalesce((inc_act ->> (b ->> 'item'))::numeric, 0));
    inc_act := inc_act - (b ->> 'item');
  end loop;
  for k in select jsonb_object_keys(inc_act) loop
    if k <> '其他' then v_income := v_income || jsonb_build_object('label', k, 'budget', '-', 'actual', (inc_act ->> k)::numeric); end if;
  end loop;
  if not ('其他' = any (v_inc_names)) then
    v_income := v_income || jsonb_build_object('label', '其他', 'budget', '-', 'actual', coalesce((inc_act ->> '其他')::numeric, 0));
  end if;

  v_expense := '[]';
  for b in select x from jsonb_array_elements(v_items) x where x ->> 'type' = '支出' loop
    v_expense := v_expense || jsonb_build_object('label', (b ->> 'item') || coalesce(b ->> 'desc', ''), 'budget', b -> 'budget',
                                                 'actual', coalesce((exp_act ->> (b ->> 'item'))::numeric, 0));
  end loop;
  if not ('其他' = any (v_exp_names)) and coalesce((exp_act ->> '其他')::numeric, 0) <> 0 then
    v_expense := v_expense || jsonb_build_object('label', '其他', 'budget', '-', 'actual', (exp_act ->> '其他')::numeric);
  end if;

  return jsonb_build_object(
    'year', p_year, 'month', v_month,
    'title', p_year || '年播恩堂青年团契一月至' || private.cn_num(v_month) || '月财政报告',
    'income', v_income, 'expense', v_expense,
    'balances', jsonb_build_object('奉献在手', (bal ->> '奉献在手')::numeric, '现金在手', (bal ->> '现金')::numeric, '银行存款', (bal ->> '银行')::numeric),
    'incomeBudget', (select coalesce(sum((x ->> 'budget')::numeric), 0) from jsonb_array_elements(v_income) x where x ->> 'budget' ~ '^-?[0-9.]+$'),
    'incomeTotal', (select coalesce(sum((x ->> 'actual')::numeric), 0) from jsonb_array_elements(v_income) x),
    'expenseBudget', (select coalesce(sum((x ->> 'budget')::numeric), 0) from jsonb_array_elements(v_expense) x where x ->> 'budget' ~ '^-?[0-9.]+$'),
    'expenseTotal', (select coalesce(sum((x ->> 'actual')::numeric), 0) from jsonb_array_elements(v_expense) x),
    'others', v_others,
    'treasurer', private.staff_by_role(p_year, '财政'), 'auditor', private.staff_by_role(p_year, '查账'));
end $$;

/* ============================================================
   Claim
   ============================================================ */

create or replace function public.list_claims() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := private.session();
begin
  return jsonb_build_object('success', true, 'claims', (select coalesce(jsonb_agg(private.claim_json(c) order by c.created_at), '[]'::jsonb)
    from public.claims c where private.claim_visible(s, c)));
end $$;

create or replace function public.submit_claim(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s jsonb := private.require_staff(); c public.claims; v_amount numeric; v_path text := btrim(coalesce(p_data ->> 'receiptPath', ''));
begin
  begin v_amount := round(replace(coalesce(p_data ->> 'amount', ''), ',', '')::numeric, 2);
  exception when others then v_amount := null; end;
  if v_amount is null or v_amount <= 0 then raise exception '请填写正确的金额。'; end if;
  if v_amount > 100000 then raise exception '金额太大了，请检查。'; end if;
  if v_path <> '' and v_path !~ '^[0-9]{4}/[A-Za-z0-9._-]+$' then raise exception '收据路径不正确，请重新上传。'; end if;
  insert into public.claims (applicant_id, applicant_name, applicant_email, claim_date, event_id, description, category, grp, amount, receipt_path)
  values ((s ->> 'userId')::uuid, s ->> 'name', coalesce(s ->> 'email', ''), coalesce(private.parse_date(p_data ->> 'date'), private.today()),
          private.clip(p_data ->> 'eventId', 40), private.clip(p_data ->> 'description', 500), private.clip(p_data ->> 'category', 60),
          private.clip(p_data ->> 'group', 40), v_amount, v_path)
  returning * into c;
  perform private.log(s, '提交 Claim', '职员报销', c.id, 'RM' || private.money(c.amount));
  perform private.notify(private.emails_by_role(array['财政']), private.emails_by_role(array['查账']),
    '新的 Claim 等待审核：' || c.applicant_name || ' RM' || private.money(c.amount),
    array_remove(array['有一张新的 Claim 等待财政审核。', '', '编号：' || c.id,
      '申请人：' || c.applicant_name || case when coalesce(s ->> 'group', '') <> '' then '（' || (s ->> 'group') || '）' else '' end,
      '日期：' || private.fmt_date(c.claim_date), '组别：' || c.grp, '类别：' || c.category, '金额：RM' || private.money(c.amount),
      '说明：' || c.description, case when c.receipt_path <> '' then '收据：已上传（请到后台查看）' end], null));
  return jsonb_build_object('success', true, 'id', c.id, 'message', '报销已提交，财政会收到 Email 通知。');
end $$;

-- 审核：只有 PENDING 可以审核；批准时先写财政支出（唯一约束挡重复），再改状态
create or replace function public.review_claim(p_id text, p_decision text, p_remark text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_staff(); c public.claims; v_dec text := upper(btrim(coalesce(p_decision, ''))); v_remark text := left(coalesce(p_remark, ''), 500);
begin
  if not private.is_finance(s) then raise exception '只有财政或查账可以审核。' using errcode = '42501'; end if;
  if v_dec not in ('APPROVED', 'REJECTED') then raise exception '审核结果不正确。'; end if;
  select * into c from public.claims where id = p_id for update;
  if not found then raise exception '找不到这个 Claim。'; end if;
  if c.status <> 'PENDING' then
    raise exception '这张 Claim 已经%过了%，不能重复审核。', case c.status when 'APPROVED' then '批准' when 'REJECTED' then '拒绝' else '处理' end,
      case when c.reviewer <> '' then '（' || c.reviewer || '）' else '' end;
  end if;
  if private.claim_is_mine(s, c) and not private.is_admin(s) then raise exception '不能审核自己的 Claim，请由另一位财政或查账审核。'; end if;

  if v_dec = 'APPROVED' then
    if not exists (select 1 from public.finance_txns where ref_id = c.id and voided_at is null) then
      insert into public.finance_txns (txn_date, type, category, grp, description, amount, account, ref_id, recorded_by)
      values (coalesce(c.claim_date, private.today()), '支出', coalesce(nullif(c.category, ''), '报销'), c.grp,
              left('报销：' || c.description || '（' || c.applicant_name || '）', 300), c.amount, '现金', c.id, s ->> 'name');
    end if;
  end if;
  update public.claims set status = v_dec, fin_synced = (v_dec = 'APPROVED'), reviewer = (s ->> 'name') || '（' || (s ->> 'role') || '）',
         review_note = v_remark, reviewed_at = now()
   where id = c.id;
  perform private.log(s, case when v_dec = 'APPROVED' then '批准 Claim' else '拒绝 Claim' end, '职员报销', c.id, v_remark);
  perform private.notify(array[c.applicant_email], private.emails_by_role(array['查账']),
    'Claim ' || case when v_dec = 'APPROVED' then '已批准' else '被拒绝' end || '：RM' || private.money(c.amount) || ' ' || c.description,
    array_remove(array['你的 Claim ' || case when v_dec = 'APPROVED' then '已经批准。' else '被拒绝了。' end, '',
      '编号：' || c.id, '申请人：' || c.applicant_name, '金额：RM' || private.money(c.amount), '说明：' || c.description,
      '审核人：' || (s ->> 'name'), case when v_remark <> '' then '备注：' || v_remark end], null));
  return jsonb_build_object('success', true, 'message', case when v_dec = 'APPROVED' then 'Claim 已批准。' else 'Claim 已拒绝。' end);
end $$;

create or replace function public.mark_claim_paid(p_id text, p_method text, p_remark text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_staff(); c public.claims; v_method text := coalesce(nullif(private.clip(p_method, 40), ''), '现金');
begin
  if not private.is_finance(s) then raise exception '只有财政或查账可以标记已付款。' using errcode = '42501'; end if;
  select * into c from public.claims where id = p_id for update;
  if not found then raise exception '找不到这个 Claim。'; end if;
  if c.status <> 'APPROVED' then raise exception '要先批准，才能标记已付款。'; end if;
  if c.paid_at is not null then raise exception '这张 Claim 已经标记付款了（%）。', c.paid_by; end if;
  update public.claims set paid_at = now(), paid_by = (s ->> 'name') || '（' || (s ->> 'role') || '）', pay_method = v_method,
         pay_note = left(coalesce(p_remark, ''), 300)
   where id = c.id;
  perform private.log(s, 'Claim 已付款', '职员报销', c.id, v_method);
  perform private.notify(array[c.applicant_email], '{}', 'Claim 已付款：RM' || private.money(c.amount) || ' ' || c.description,
    array['财政已经把这笔 Claim 的钱付给你了。', '', '编号：' || c.id, '金额：RM' || private.money(c.amount), '付款方式：' || v_method,
          '付款人：' || (s ->> 'name'), '', '收到钱后，请登入播青后台，在「职员 Claim」按「确认已收到」。']);
  return jsonb_build_object('success', true, 'message', '已标记为已付款，申请人会收到 Email。');
end $$;

-- 申请人确认收到款项（卸任的人也可以确认自己的）
create or replace function public.confirm_claim_received(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.session(); c public.claims;
begin
  select * into c from public.claims where id = p_id for update;
  if not found then raise exception '找不到这个 Claim。'; end if;
  if not private.claim_is_mine(s, c) and not private.is_admin(s) then raise exception '只有申请人自己可以确认收到款项。' using errcode = '42501'; end if;
  if c.status <> 'APPROVED' then raise exception '这个 Claim 还没有批准。'; end if;
  if c.received_at is not null then return jsonb_build_object('success', true, 'message', '已经确认过了，谢谢！'); end if;
  update public.claims set received_at = now(), paid_at = coalesce(paid_at, now()) where id = c.id;
  perform private.log(s, 'Claim 确认收款', '职员报销', c.id, s ->> 'name');
  perform private.notify(private.emails_by_role(array['财政']), private.emails_by_role(array['查账']),
    'Claim 已确认收到：' || c.applicant_name || ' RM' || private.money(c.amount),
    array[c.applicant_name || ' 已确认收到 Claim 的款项。', '', '编号：' || c.id, '金额：RM' || private.money(c.amount), '说明：' || c.description]);
  return jsonb_build_object('success', true, 'message', '已确认收到，谢谢！');
end $$;

/* ============================================================
   奉献
   ============================================================ */

-- 新增奉献：同时记一笔「收入 / 奉献 / 奉献在手」。2 分钟内同日期、同聚会、同金额视为重复提交。
create or replace function public.submit_offering(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s jsonb := private.require_staff(); o public.offerings; v_amount numeric; v_date date := private.parse_date(p_data ->> 'date');
  v_event text := private.clip(p_data ->> 'eventName', 120); v_att int;
begin
  if not private.is_finance(s) then raise exception '只有财政或查账可以新增奉献。' using errcode = '42501'; end if;
  begin v_amount := round(replace(coalesce(p_data ->> 'amount', ''), ',', '')::numeric, 2);
  exception when others then v_amount := null; end;
  if v_amount is null or v_amount <= 0 then raise exception '请填写正确的金额。'; end if;
  if v_date is null then raise exception '请填写日期。'; end if;
  v_att := case when coalesce(p_data ->> 'attendance', '') ~ '^\d{1,5}$' then (p_data ->> 'attendance')::int end;

  perform pg_advisory_xact_lock(hashtext('offering'));
  if exists (select 1 from public.offerings where offering_date = v_date and event_name = v_event and amount = v_amount
               and created_at > now() - interval '2 minutes') then
    raise exception '刚刚已经记录过一笔一样的奉献（同日期、同聚会、同金额），请检查是不是按了两次。';
  end if;

  insert into public.offerings (offering_date, event_name, attendance, amount, counter, recorded_by, recorded_by_id, remark)
  values (v_date, v_event, v_att, v_amount, private.clip(p_data ->> 'counter', 60), (s ->> 'name') || '（' || (s ->> 'role') || '）',
          (s ->> 'userId')::uuid, left(coalesce(p_data ->> 'remark', ''), 300))
  returning * into o;
  insert into public.finance_txns (txn_date, type, category, description, amount, account, ref_id, recorded_by)
  values (v_date, '收入', '奉献', case when v_event <> '' then '本周奉献: ' || v_event else '本周奉献' end, v_amount, '奉献在手', o.id,
          (s ->> 'name') || '（' || (s ->> 'role') || '）');
  perform private.log(s, '新增奉献', '奉献记录', o.id, 'RM' || private.money(v_amount));
  return jsonb_build_object('success', true, 'id', o.id, 'message', '奉献已记录，总收入已更新。');
end $$;

/* ============================================================
   财政
   ============================================================ */

create or replace function public.get_finance_data(p_year int) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := private.require_finance(false); v_year int := coalesce(nullif(p_year, 0), private.current_year());
        v_month int := case when v_year = extract(year from private.today())::int then extract(month from private.today())::int else 12 end;
begin
  return jsonb_build_object(
    'success', true, 'year', v_year, 'month', v_month, 'role', s ->> 'role', 'canWrite', not (s ->> 'readOnly')::boolean,
    'txns', (select coalesce(jsonb_agg(private.txn_json(t) order by t.txn_date desc, t.id desc), '[]'::jsonb)
               from public.finance_txns t where t.voided_at is null and extract(year from t.txn_date)::int = v_year),
    'budget', coalesce((select items from public.budgets where year = v_year), '[]'::jsonb),
    'summary', private.fin_report(v_year, v_month),
    'groups', to_jsonb(private.ministry_groups()),
    'accounts', to_jsonb(array['奉献在手', '现金', '银行']),
    'mySignature', false);   -- 签名：阶段 5 补上
end $$;

create or replace function public.save_finance_txn(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s jsonb := private.require_finance(true); t public.finance_txns;
  v_type text := coalesce(p_data ->> 'type', ''); v_amount numeric; v_date date := private.parse_date(p_data ->> 'date');
  v_acct text := coalesce(p_data ->> 'account', ''); v_to text; v_cat text; v_id text := nullif(btrim(coalesce(p_data ->> 'id', '')), '');
begin
  if v_type not in ('收入', '支出', '转账') then raise exception '类型不正确。'; end if;
  begin v_amount := round(replace(coalesce(p_data ->> 'amount', ''), ',', '')::numeric, 2);
  exception when others then v_amount := null; end;
  if v_amount is null or v_amount <= 0 then raise exception '请填写金额。'; end if;
  if v_date is null then raise exception '请填写日期。'; end if;
  if v_acct not in ('奉献在手', '现金', '银行') then raise exception '请选择账户。'; end if;
  v_to := case when v_type = '转账' then coalesce(p_data ->> 'toAccount', '') else '' end;
  if v_type = '转账' and (v_to not in ('奉献在手', '现金', '银行') or v_to = v_acct) then raise exception '请选择转入的账户。'; end if;
  v_cat := coalesce(nullif(private.clip(p_data ->> 'category', 60), ''), case when v_type = '转账' then '转账' else '其他' end);

  if v_id is not null then
    select * into t from public.finance_txns where id = v_id and voided_at is null for update;
    if not found then raise exception '找不到这笔交易。'; end if;
    if t.ref_id ~ '^(CLM|OFF)-' and t.amount <> v_amount then
      raise exception '这笔是 Claim / 奉献自动产生的，金额请在原本的记录修改。';
    end if;
    update public.finance_txns set txn_date = v_date, type = v_type, category = v_cat, grp = private.clip(p_data ->> 'group', 40),
           description = left(coalesce(p_data ->> 'description', ''), 300), amount = v_amount, account = v_acct, to_account = v_to,
           remark = left(coalesce(p_data ->> 'remark', ''), 300), recorded_by = (s ->> 'name') || '（' || (s ->> 'role') || '）', updated_at = now()
     where id = t.id returning * into t;
  else
    insert into public.finance_txns (txn_date, type, category, grp, description, amount, account, to_account, remark, recorded_by)
    values (v_date, v_type, v_cat, private.clip(p_data ->> 'group', 40), left(coalesce(p_data ->> 'description', ''), 300), v_amount,
            v_acct, v_to, left(coalesce(p_data ->> 'remark', ''), 300), (s ->> 'name') || '（' || (s ->> 'role') || '）')
    returning * into t;
  end if;
  perform private.log(s, '财政记录', '财政', t.id, v_type || ' ' || v_cat || ' RM' || private.money(v_amount));
  return jsonb_build_object('success', true, 'id', t.id, 'message', '已保存。');
end $$;

-- 「删除」财政交易：只做标记（资料保留，查账可以追）；Claim 批准产生的不能删
create or replace function public.void_finance_txn(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_finance(true); t public.finance_txns;
begin
  select * into t from public.finance_txns where id = p_id and voided_at is null for update;
  if not found then raise exception '找不到这笔交易。'; end if;
  if t.ref_id ~ '^CLM-' then raise exception '这笔是 Claim 批准后产生的，不能在这里删除。'; end if;
  update public.finance_txns set voided_at = now(), voided_by = coalesce(s ->> 'name', '') where id = t.id;
  perform private.log(s, '删除财政记录', '财政', t.id, t.description);
  return jsonb_build_object('success', true);
end $$;

create or replace function public.save_finance_budget(p_year int, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_finance(true); v_items jsonb;
begin
  if p_year is null or p_year < 2000 or p_year > 2100 then raise exception '年份不正确。'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'type', case when x ->> 'type' = '支出' then '支出' else '收入' end,
           'item', left(btrim(x ->> 'item'), 80), 'desc', left(coalesce(x ->> 'desc', ''), 200),
           'budget', case when coalesce(x ->> 'budget', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then to_jsonb(round((x ->> 'budget')::numeric, 2)) else to_jsonb(''::text) end)
         order by ord), '[]'::jsonb)
    into v_items
    from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) with ordinality y(x, ord)
   where btrim(coalesce(x ->> 'item', '')) <> '';
  insert into public.budgets (year, items, updated_by, updated_at) values (p_year, v_items, coalesce(s ->> 'name', ''), now())
  on conflict (year) do update set items = excluded.items, updated_by = excluded.updated_by, updated_at = now();
  perform private.log(s, '保存预算', '预算', p_year::text, jsonb_array_length(v_items) || ' 项');
  return jsonb_build_object('success', true, 'message', '预算已保存。');
end $$;

/* ---------- 给 Storage 规则用：这张收据我看得到吗（只回答自己） ---------- */
create or replace function public.can_view_receipt(p_path text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb;
begin
  s := private.session();
  return exists (select 1 from public.claims c where c.receipt_path = p_path and private.claim_visible(s, c));
exception when others then
  return false;
end $$;

/* ---------- 权限 ---------- */
do $$
declare f text;
begin
  foreach f in array array['public.list_claims()', 'public.submit_claim(jsonb)', 'public.review_claim(text, text, text)',
    'public.mark_claim_paid(text, text, text)', 'public.confirm_claim_received(text)', 'public.submit_offering(jsonb)',
    'public.get_finance_data(int)', 'public.save_finance_txn(jsonb)', 'public.void_finance_txn(text)',
    'public.save_finance_budget(int, jsonb)', 'public.can_view_receipt(text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

/* ---------- Storage：收据（不公开）。职员上传；上传的人自己、以及看得到那张 Claim 的人可以看 ---------- */
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $q$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'application/pdf'])
      on conflict (id) do nothing
    $q$;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'receipts: staff upload') then
      execute $q$
        create policy "receipts: staff upload" on storage.objects for insert to authenticated
          with check (bucket_id = 'receipts' and public.is_current_staff())
      $q$;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'receipts: owner or claim viewers read') then
      execute $q$
        create policy "receipts: owner or claim viewers read" on storage.objects for select to authenticated
          using (bucket_id = 'receipts' and (owner = auth.uid() or public.can_view_receipt(name)))
      $q$;
    end if;
  end if;
end $$;
