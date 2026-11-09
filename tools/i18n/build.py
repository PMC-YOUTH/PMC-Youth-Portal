"""把中→EN 字典重新嵌进 web/admin.html 和首页。
新增字串：编辑 dict_admin.json / dict_index.json，然后运行  python tools/i18n/build.py"""
import json, re, os
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
eng = open(os.path.join(HERE, 'engine.js'), encoding='utf-8').read()
SK_A = ",#rpBody,#frPreview,#finTopReport,#pdfPreview,#ministryUpdatePlanPreview,#ministryHistoryContent"
SK_I = ",.ev-name,.roster dd,.report-body h3,.report-body p,#hero-section h1,#hero-section p"
for page, dk, sk in [('web/admin.html', 'dict_admin.json', SK_A), ('web/index.html', 'dict_index.json', SK_I)]:
    d = json.load(open(os.path.join(HERE, dk), encoding='utf-8'))
    js = eng.replace('__DICT__', json.dumps(d, ensure_ascii=False)).replace('__SKIP__', json.dumps(sk, ensure_ascii=False))
    assert '</script' not in js
    p = os.path.join(ROOT, page)
    s = open(p, encoding='utf-8').read()
    m = re.search(r'\n<script>\n/\* =+\n   中 / EN 系统语言切换.*?\n</script>', s, re.S)
    if m: s = s[:m.start()] + s[m.end():]
    i = s.rfind('\n</body>')
    s = s[:i] + '\n<script>\n' + js + '\n</script>' + s[i:]
    open(p, 'w', encoding='utf-8', newline='\n').write(s)
    print(page, len(s))
