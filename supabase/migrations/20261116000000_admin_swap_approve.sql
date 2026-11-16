-- 节目交换：管理员可以直接批准（包括自己提出的申请），一次批准就完成交换。
-- 「切换身份」查看时不算管理员（private.is_admin 已经处理），一般职员的规则不变：
-- 申请人不能批准自己的申请；要行政组一人 + 对方负责组一人批准。
create or replace function public.approve_program_swap(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := private.require_staff(); r public.program_swaps; v_as text[] := '{}'; v_note text; v_req text; v_waiting text;
        v_admin boolean := private.is_admin(s);
begin
  select * into r from public.program_swaps where id = p_id for update;
  if not found then raise exception '找不到这个申请。'; end if;
  if r.status <> '待批准' then raise exception '这个申请已经是「%」。', r.status; end if;
  if r.requester_id = (s ->> 'userId')::uuid and not v_admin then raise exception '不能批准自己的申请，要由其他人批准。'; end if;
  if r.exec_by = '' and (v_admin or private.is_exec(s)) then
    update public.program_swaps set exec_by = s ->> 'name', exec_at = now() where id = r.id;
    v_as := v_as || case when v_admin then '管理员' else '行政组' end;
  end if;
  if r.other_by = '' and (v_admin or private.in_group(s, r.target_group)) then
    update public.program_swaps set other_by = s ->> 'name', other_at = now() where id = r.id;
    if not v_admin then v_as := v_as || r.target_group; elsif cardinality(v_as) = 0 then v_as := v_as || '管理员'::text; end if;
  end if;
  if cardinality(v_as) = 0 then
    raise exception '你不需要批准这个申请（要由行政组或「%」批准，或你那一份已经批准了）。', coalesce(nullif(r.target_group, ''), '对方负责组');
  end if;
  select * into r from public.program_swaps where id = r.id;
  perform private.log(s, '批准交换节目', '节目交换', r.id, array_to_string(v_as, '、'));
  select email into v_req from public.profiles where id = r.requester_id;

  if r.exec_by <> '' and r.other_by <> '' then
    v_note := private.swap_apply(r);
    update public.program_swaps set status = '已批准', done_at = now(), note = v_note where id = r.id;
    perform private.log(s, '交换节目', '节目', r.event_id || '⇄' || r.target_id, private.swap_desc(r));
    perform private.notify(array[v_req] || private.emails_by_group(r.event_group)
                             || case when r.target_group <> '' then private.emails_by_group(r.target_group) else '{}'::text[] end,
      private.swap_exec_emails(), '节目已交换：' || private.md(r.event_date) || ' ⇄ ' || private.md(r.target_date),
      array['节目交换申请已批准，系统已经交换好了：', '', private.swap_desc(r), '',
            case when v_admin and '管理员' = any (v_as) and r.exec_by = r.other_by then '管理员批准：' || r.exec_by
                 else '行政组批准：' || r.exec_by || case when r.other_by <> '（不需要）' then '　' || r.target_group || '批准：' || r.other_by else '' end end,
            v_note, '', '节目列表和公开首页已经更新。排轮值表的同工请到「轮值表」按「同步节目」。']);
    return jsonb_build_object('success', true, 'applied', true, 'message', '已批准，节目已经交换。' || v_note);
  end if;
  v_waiting := case when r.exec_by = '' then '行政组' else r.target_group end;
  perform private.notify(array[v_req], '{}', '交换申请：' || array_to_string(v_as, '、') || ' 已批准',
    array['你的节目交换申请：', private.swap_desc(r), '', (s ->> 'name') || '（' || array_to_string(v_as, '、') || '）已批准，现在等待「' || v_waiting || '」批准。']);
  return jsonb_build_object('success', true, 'applied', false, 'message', '已批准，还要等「' || v_waiting || '」批准。');
end $$;
