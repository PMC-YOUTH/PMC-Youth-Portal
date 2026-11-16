#!/usr/bin/env python3
"""阶段 7：把旧 GAS 版 Google Sheet（下载成 .xlsx）转成 Supabase 的导入 SQL。

用法：python3 -I tools/import/xlsx_to_sql.py <旧资料.xlsx> <输出资料夹>
- 每张表产生一个 .sql 档（用 jsonb 一次插入，旧编号照旧保留）。
- 重复执行安全：已存在的编号不会再插（on conflict do nothing）；名单 / 预算整份覆盖。
- 最后一个档把各编号的序号调到最大值，之后新增的资料不会撞号。
- 资料档（xlsx、产生的 sql）绝不放进 repo。
"""
import datetime as dt
import json
import os
import sys

import openpyxl

TZ = '+08:00'
SPLIT = '-- @@split@@\n'  # 旧资料的时间都是马来西亚时间


def rows(wb, name):
    r = [x for x in wb[name].iter_rows(values_only=True) if any(c not in (None, '') for c in x)]
    if not r:
        return []
    h = r[0]
    return [dict(zip(h, list(x) + [None] * len(h))) for x in r[1:]]


def s(v):
    if v is None:
        return ''
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    if isinstance(v, dt.datetime):
        return v.strftime('%Y-%m-%d %H:%M')
    if isinstance(v, dt.time):
        return v.strftime('%H:%M')
    return str(v).strip()


def d(v):
    if v in (None, ''):
        return None
    if isinstance(v, (dt.datetime, dt.date)):
        return v.strftime('%Y-%m-%d')
    t = str(v).strip()[:10]
    dt.date.fromisoformat(t)
    return t


def ts(v):
    if v in (None, ''):
        return None
    if isinstance(v, dt.datetime):
        return v.strftime('%Y-%m-%dT%H:%M:%S') + TZ
    return None


def n(v):
    if v in (None, ''):
        return None
    return float(v)


def b(v, default=False):
    if v in (None, ''):
        return default
    if isinstance(v, bool):
        return v
    return str(v).strip().upper() in ('TRUE', '是', 'YES', '1')


def sql_insert(table, cols, data, conflict='(id) do nothing'):
    """jsonb 一次插入。空字串 / null / false 的栏位不放进 JSON（档案小一点），插入时再补回预设值。"""
    keep = {c for c, t in cols if t not in ('text', 'boolean')}
    slim = [{k: v for k, v in r.items() if k in keep or v not in ('', None, False) or k == 'is_public'} for r in data]
    col_defs = ', '.join(f'{c} {t}' for c, t in cols)
    names = ', '.join(c for c, _ in cols)
    picks = ', '.join(c if c == 'ref_id' else f"coalesce({c}, '')" if t == 'text' else f'coalesce({c}, false)' if t == 'boolean' else c for c, t in cols)
    out, chunk = [], []
    for r in slim + [None]:   # 每份约 8KB，方便分批执行
        if r is not None:
            chunk.append(r)
        if chunk and (r is None or len(json.dumps(chunk, ensure_ascii=False).encode()) > 8000):
            payload = json.dumps(chunk, ensure_ascii=False, separators=(',', ':')).replace("'", "''")
            out.append(f"insert into public.{table} ({names})\n"
                       f"select {picks} from jsonb_to_recordset('{payload}'::jsonb) as x({col_defs})\n"
                       f"on conflict {conflict};\n")
            chunk = []
    return SPLIT.join(out)


def main(src, out):
    wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
    os.makedirs(out, exist_ok=True)
    files = {}

    # 契友
    files['01_members'] = sql_insert('members', [
        ('id', 'text'), ('name', 'text'), ('english_name', 'text'), ('nickname', 'text'), ('phone', 'text'),
        ('email', 'text'), ('gender', 'text'), ('birthday', 'date'), ('grp', 'text'), ('position', 'text'),
        ('membership', 'text'), ('status', 'text'), ('status_reason', 'text'), ('needs_care', 'boolean'),
        ('photo_url', 'text'), ('join_date', 'date'), ('remark', 'text'), ('created_at', 'timestamptz'), ('updated_at', 'timestamptz')],
        [{'id': s(r['契友编号']), 'name': s(r['姓名']), 'english_name': s(r['英文名']), 'nickname': s(r['称呼']),
          'phone': s(r['电话号码']), 'email': s(r['电邮']), 'gender': s(r['性别']), 'birthday': d(r['生日']),
          'grp': s(r['小组']), 'position': s(r['职位']), 'membership': s(r.get('入会状态')) or '未入会',
          'status': 'INACTIVE' if s(r['状态']).upper() == 'INACTIVE' else 'ACTIVE', 'status_reason': s(r.get('状态原因')),
          'needs_care': b(r.get('需要关心')), 'photo_url': s(r['照片链接']), 'join_date': d(r['加入日期']),
          'remark': s(r['备注']), 'created_at': ts(r['建立时间']) or ts(dt.datetime.now()),
          'updated_at': ts(r['更新日期']) or ts(r['建立时间']) or ts(dt.datetime.now())}
         for r in rows(wb, '契友')])

    # 节目（事奉人员直接在节目栏位里）
    files['02_events'] = sql_insert('events', [
        ('id', 'text'), ('date', 'date'), ('start_time', 'text'), ('end_time', 'text'), ('name', 'text'), ('theme', 'text'),
        ('content', 'text'), ('location', 'text'), ('speaker', 'text'), ('status', 'text'), ('is_public', 'boolean'),
        ('cover_url', 'text'), ('grp', 'text'), ('leader', 'text'), ('verse', 'text'), ('singer', 'text'), ('piano', 'text'),
        ('computer', 'text'), ('usher', 'text')],
        [{'id': s(r['节目编号']), 'date': d(r['日期']), 'start_time': s(r['开始时间']), 'end_time': s(r['结束时间']),
          'name': s(r['节目名称']), 'theme': s(r['主题']), 'content': s(r['内容']), 'location': s(r['地点']),
          'speaker': s(r['讲员']), 'status': s(r['状态']) if s(r['状态']) in ('ACTIVE', '暂停', 'INACTIVE') else 'ACTIVE',
          'is_public': b(r['公开显示'], True), 'cover_url': s(r['封面照片链接']), 'grp': s(r['负责组']), 'leader': s(r['领会']),
          'verse': s(r['经节手册']), 'singer': s(r['领唱/助唱']), 'piano': s(r['司琴/吉他手']), 'computer': s(r['电脑控制员']),
          'usher': s(r['招待员'])}
         for r in rows(wb, '节目')])

    # 各岗位名单（整份）
    pool = [{'position': s(r['岗位']), 'name': s(r['姓名'])[:40], 'order': int(n(r['排序']) or i + 1), 'note': s(r['备注'])[:100]}
            for i, r in enumerate(rows(wb, '事奉名单')) if s(r['姓名'])]
    pj = json.dumps(pool, ensure_ascii=False, separators=(',', ':')).replace("'", "''")
    files['03_roster_pool'] = (f"insert into public.roster_pool (id, items, updated_by, updated_at) values (1, '{pj}'::jsonb, '旧系统导入', now())\n"
                               "on conflict (id) do update set items = excluded.items, updated_by = excluded.updated_by, updated_at = now();\n")

    # 事工
    files['04_ministries'] = sql_insert('ministries', [
        ('id', 'text'), ('year', 'int'), ('grp', 'text'), ('category', 'text'), ('serial', 'text'), ('name', 'text'),
        ('purpose', 'text'), ('method', 'text'), ('target', 'text'), ('planned_date', 'date'), ('budget', 'numeric'),
        ('pic', 'text'), ('event_id', 'text'), ('status', 'text'), ('sort_order', 'numeric'), ('created_by', 'text'),
        ('created_at', 'timestamptz'), ('updated_at', 'timestamptz')],
        [{'id': s(r['事工编号']), 'year': int(r['年份']), 'grp': s(r['组别']), 'category': s(r['类别']), 'serial': s(r['序号']),
          'name': s(r['事工名称']), 'purpose': s(r['目的']), 'method': s(r['进行方式']), 'target': s(r['目标/指标']),
          'planned_date': d(r['计划日期']) or (d(r['计划时间']) if isinstance(r['计划时间'], (dt.date, dt.datetime)) else None),
          'budget': n(r['预算']), 'pic': s(r['负责人']), 'event_id': s(r['关联节目编号']) or s(r['节目编号']),
          'status': s(r['状态']) or '计划中', 'sort_order': n(r['排序']), 'created_by': '旧系统导入',
          'created_at': ts(r['建立时间']) or ts(dt.datetime.now()), 'updated_at': ts(r['更新日期']) or ts(r['建立时间']) or ts(dt.datetime.now())}
         for r in rows(wb, '事工')])

    # 事工更新
    files['05_ministry_updates'] = sql_insert('ministry_updates', [
        ('id', 'text'), ('ministry_id', 'text'), ('year', 'int'), ('meeting_no', 'int'), ('grp', 'text'), ('status', 'text'),
        ('date_changed', 'text'), ('new_date', 'date'), ('method_changed', 'text'), ('current_method', 'text'),
        ('progress', 'text'), ('result', 'text'), ('attendance', 'numeric'), ('budget_changed', 'text'), ('new_budget', 'numeric'),
        ('expense', 'numeric'), ('next_step', 'text'), ('attachment_url', 'text'), ('updated_by', 'text'), ('updated_at', 'timestamptz')],
        [{'id': s(r['更新编号']), 'ministry_id': s(r['事工编号']), 'year': int(r['年份']), 'meeting_no': int(r['会议次数']),
          'grp': s(r['组别']), 'status': s(r['状态']), 'date_changed': s(r['日期变更']) or '否', 'new_date': d(r['新日期']),
          'method_changed': s(r['进行方式变更']) or '否', 'current_method': s(r['本次进行方式']), 'progress': s(r['本次进度']),
          'result': s(r['本次结果']), 'attendance': n(r['参与人数']), 'budget_changed': s(r['本次预算调整']) or '否',
          'new_budget': n(r['新预算']), 'expense': n(r['本次支出']), 'next_step': s(r['下一步']), 'attachment_url': s(r['附件链接']),
          'updated_by': s(r['更新人']), 'updated_at': ts(r['更新时间']) or ts(dt.datetime.now())}
         for r in rows(wb, '事工更新')], conflict='do nothing')

    # 会议（2026 已有的更新、2027 新增）+ 组提交
    meet = [{'id': s(r['会议编号']), 'year': int(r['年份']), 'meeting_no': int(r['会议次数']), 'meeting_type': s(r['会议类型']),
             'meeting_date': d(r['会议日期']), 'status': s(r['状态']) or '未开始', 'report_deadline': d(r['报告截止日期']),
             'report_doc_url': s(r['报告Doc链接']), 'report_pdf_url': s(r['报告PDF链接']), 'generated_at': ts(r['生成时间']),
             'remark': s(r['备注']), 'cover': json.loads(r['议案资料']) if s(r['议案资料']) else None}
            for r in rows(wb, '会议')]
    files['06_meetings'] = sql_insert('ministry_meetings', [
        ('id', 'text'), ('year', 'int'), ('meeting_no', 'int'), ('meeting_type', 'text'), ('meeting_date', 'date'), ('status', 'text'),
        ('report_deadline', 'date'), ('report_doc_url', 'text'), ('report_pdf_url', 'text'), ('generated_at', 'timestamptz'),
        ('remark', 'text'), ('cover', 'jsonb')], meet,
        conflict=('(year, meeting_no) do update set meeting_type = excluded.meeting_type, meeting_date = excluded.meeting_date, '
                  'status = excluded.status, report_deadline = excluded.report_deadline, report_doc_url = excluded.report_doc_url, '
                  'report_pdf_url = excluded.report_pdf_url, generated_at = excluded.generated_at, remark = excluded.remark, cover = excluded.cover'))
    files['06_meetings'] += sql_insert('ministry_submissions', [
        ('id', 'text'), ('year', 'int'), ('meeting_no', 'int'), ('grp', 'text'), ('status', 'text'), ('submitted_by', 'text'),
        ('submitted_at', 'timestamptz'), ('note', 'text'), ('updated_at', 'timestamptz')],
        [{'id': s(r['提交编号']), 'year': int(r['年份']), 'meeting_no': int(r['会议次数']), 'grp': s(r['组别']), 'status': s(r['状态']),
          'submitted_by': s(r['提交人']), 'submitted_at': ts(r['提交时间']), 'note': s(r['文书备注']),
          'updated_at': ts(r['更新时间']) or ts(dt.datetime.now())}
         for r in rows(wb, '会议组提交')], conflict='do nothing')

    # 预算
    budgets = {}
    for r in sorted(rows(wb, '预算'), key=lambda r: (n(r['排序']) or 0)):
        budgets.setdefault(int(r['年份']), []).append({'type': '支出' if s(r['类型']) == '支出' else '收入', 'item': s(r['项目'])[:80],
                                                      'desc': s(r['说明'])[:200], 'budget': n(r['预算']) if n(r['预算']) is not None else ''})
    files['07_budgets'] = ''.join(
        f"insert into public.budgets (year, items, updated_by) values ({y}, '{json.dumps(it, ensure_ascii=False, separators=(',', ':')).replace(chr(39), chr(39) * 2)}'::jsonb, '旧系统导入')\n"
        "on conflict (year) do update set items = excluded.items, updated_by = excluded.updated_by, updated_at = now();\n"
        for y, it in budgets.items())

    # 奉献、财政（奉献先，财政的参考编号 OFF-xxxx 才对得上）
    files['08_offerings'] = sql_insert('offerings', [
        ('id', 'text'), ('offering_date', 'date'), ('event_name', 'text'), ('attendance', 'int'), ('amount', 'numeric'),
        ('counter', 'text'), ('recorded_by', 'text'), ('remark', 'text'), ('created_at', 'timestamptz')],
        [{'id': s(r['奉献编号']), 'offering_date': d(r['奉献日期']), 'event_name': s(r['聚会 / 节目']),
          'attendance': int(n(r['聚会人数'])) if n(r['聚会人数']) is not None else None, 'amount': n(r['金额']),
          'counter': s(r['计算员']), 'recorded_by': s(r['记录人']), 'remark': s(r['备注']),
          'created_at': ts(r['建立时间']) or ts(dt.datetime.now())}
         for r in rows(wb, '奉献记录')])
    files['09_finance'] = sql_insert('finance_txns', [
        ('id', 'text'), ('txn_date', 'date'), ('type', 'text'), ('category', 'text'), ('grp', 'text'), ('description', 'text'),
        ('amount', 'numeric'), ('account', 'text'), ('to_account', 'text'), ('ref_id', 'text'), ('remark', 'text'),
        ('recorded_by', 'text'), ('created_at', 'timestamptz'), ('updated_at', 'timestamptz')],
        [{'id': s(r['交易编号']), 'txn_date': d(r['交易日期']), 'type': s(r['类型']), 'category': s(r['类别']), 'grp': s(r['组别']),
          'description': s(r['说明']), 'amount': n(r['金额']), 'account': s(r['账户']), 'to_account': s(r['转入账户']),
          'ref_id': s(r['参考编号']) or None,
          'remark': '；'.join(x for x in (s(r['备注']), ('付款方式：' + s(r['付款方式'])) if s(r['付款方式']) else '') if x),
          'recorded_by': s(r['记录人']), 'created_at': ts(r['建立时间']) or ts(dt.datetime.now()),
          'updated_at': ts(r['更新日期']) or ts(r['建立时间']) or ts(dt.datetime.now())}
         for r in rows(wb, '财政')])

    # 会议记录（旧的 Google Drive 链接照旧）
    files['10_meeting_docs'] = sql_insert('meeting_docs', [
        ('id', 'text'), ('meeting_date', 'date'), ('name', 'text'), ('doc_type', 'text'), ('file_url', 'text'), ('created_at', 'timestamptz')],
        [{'id': s(r['记录编号']), 'meeting_date': d(r['会议日期']), 'name': s(r['会议名称']), 'doc_type': s(r['档案类型']),
          'file_url': s(r['档案链接']), 'created_at': ts(r['建立时间']) or ts(dt.datetime.now())}
         for r in rows(wb, '会议记录')])

    # 序号调到最大，之后新增不撞号
    seqs = [('member_code_seq', 'members'), ('ministry_code_seq', 'ministries'), ('ministry_update_code_seq', 'ministry_updates'),
            ('ministry_sub_code_seq', 'ministry_submissions'), ('offering_code_seq', 'offerings'), ('fin_code_seq', 'finance_txns'),
            ('meeting_doc_code_seq', 'meeting_docs'), ('claim_code_seq', 'claims')]
    files['99_sequences'] = ''.join(
        f"select setval('public.{q}', greatest((select last_value from public.{q}), "
        f"coalesce((select max((substring(id from '(\\d+)$'))::bigint) from public.{t}), 0), 1));\n" for q, t in seqs)

    for k, v in files.items():
        for i, part in enumerate(x for x in v.split(SPLIT) if x.strip()):
            name = f'{k}_{i + 1:02d}.sql'
            with open(os.path.join(out, name), 'w', encoding='utf-8') as f:
                f.write(part)
            print(name, len(part.encode()))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
