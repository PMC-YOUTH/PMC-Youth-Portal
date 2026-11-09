"""把中→EN 字典重新嵌进 src/Admin.html 和 src/Index.html。
新增字串：编辑 dict_admin.json / dict_index.json，然后运行  python tools/i18n/build.py"""
import json, re, os
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..', 'src')
eng = open(os.path.join(HERE, 'engine.js'), encoding='utf-8').read()
SK_A = ",#rpBody,#frPreview,#finTopReport,#pdfPreview,#ministryUpdatePlanPreview,#ministryHistoryContent"
SK_I = ",.ev-name,.roster dd,.report-body h3,.report-body p,#hero-section h1,#hero-section p"
for page, dk, sk in [('Admin.html', 'dict_admin.json', SK_A), ('Index.html', 'dict_index.json', SK_I)]:
    d = json.load(open(os.path.join(HERE, dk), encoding='utf-8'))
    js = eng.replace('__DICT__', json.dumps(d, ensure_ascii=False)).replace('__SKIP__', json.dumps(sk, ensure_ascii=False))
    assert '</script' not in js
    p = os.path.join(SRC, page)
    s = open(p, encoding='utf-8').read()
    m = re.search(r'\n<script>\n/\* =+\n   中 / EN 系统语言切换.*?\n</script>', s, re.S)
    if m: s = s[:m.start()] + s[m.end():]
    i = s.rfind('\n</body>')
    s = s[:i] + '\n<script>\n' + js + '\n</script>' + s[i:]
    open(p, 'w', encoding='utf-8', newline='\n').write(s)
    print(page, len(s))
