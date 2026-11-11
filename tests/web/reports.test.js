// 报告 Word 组装（web/js/reports.js）：用假资料产生会议报告、议案、财政报告，检查 Word 档结构正确
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const JSZip = require('jszip');

const ctx = { window: {}, JSZip, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'js', 'reports.js'), 'utf8'), ctx);
const R = ctx.window.PMC_REPORTS;

const GROUPS = ['行政组', '信仰组', '见证组', '宣教组', '公民组', '团契组'];
const CATS = ['牧区青团事工', '聚会', '教区 & 年会青团事工'];
const src = {
  year: 2026, meetingNo: 2, meetingType: '第一次进度会议', groups: GROUPS, categories: CATS,
  groupStaff: { '信仰组': '张三、李四' },
  ministries: [
    { '事工编号': 'MIN-0001', '组别': '信仰组', '类别': '聚会', '序号': '2.2', '事工名称': '祷告会', '目的': '一起祷告', '进行方式': '每月一次',
      '目标/指标': '15 人', '预算': 200, '计划日期': '2026-03-01T00:00:00' },
    { '事工编号': 'MIN-0002', '组别': '信仰组', '类别': '聚会', '序号': '2.1', '事工名称': '查经 & 分享 <测试>', '目的': '', '进行方式': '', '预算': '' },
  ],
  updates: [
    { '事工编号': 'MIN-0001', '会议次数': 2, '状态': '进行中', '本次进度': '已办两次', '本次结果': '', '参与人数': 12, '本次支出': 50,
      '本次预算调整': '是', '新预算': 300, '日期变更': '否', '进行方式变更': '否', '下一步': '继续' },
  ],
  stats: [{ '事工编号': 'MIN-0001', '统计日期': '2026-04-05T00:00:00', '统计项目': '出席', '数值': 12, '单位': '人', '备注': '' }],
};

async function unzip(b64) {
  const zip = await JSZip.loadAsync(Buffer.from(b64, 'base64'));
  const names = Object.keys(zip.files).sort();
  return { zip, names, doc: await zip.file('word/document.xml').async('string') };
}

test('会议报告资料：照旧版规则整理（排序、预算调整、统计、累计支出）', () => {
  const d = R.buildReportData(src);
  const g = d.groups.find((x) => x.group === '信仰组');
  assert.strictEqual(g.staff, '张三、李四');
  const rows = g.categories[0].rows;
  assert.deepStrictEqual(rows.map((r) => r.serial), ['2.1', '2.2'], '按序号排序');
  const r = rows[1];
  assert.strictEqual(r.budget, 300, '预算调整后用新预算');
  assert.match(r.result, /预算：RM 300\.00/);
  assert.match(r.result, /进度：已办两次/);
  assert.match(r.result, /4月：出席：12 人/);
  assert.match(r.result, /支出：RM 50\.00/);
  assert.match(r.purposeMethod, /日期：2026\/03\/01/);
});

test('会议报告 Word：结构正确、特殊字元有跳脱、有页码', async () => {
  const data = R.buildReportData(src);
  const out = await R.buildMeetingReport(data, 'report', null, null);
  assert.strictEqual(out.title, '2026年播恩堂青年团契第二次会议报告');
  const { names, doc, zip } = await unzip(out.docx);
  assert.deepStrictEqual(names.filter((n) => !n.endsWith('/')),
    ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/footer1.xml', 'word/styles.xml']);
  assert.match(doc, /第二次会议报告/);
  assert.match(doc, /查经 &amp; 分享 &lt;测试&gt;/);
  assert.ok(!/<测试>/.test(doc), '不能有没跳脱的 <');
  assert.match(await zip.file('word/footer1.xml').async('string'), / PAGE /);
});

test('议案 Word：首页用预设内容（主席开始祷告、各组报告）', async () => {
  const staff = { roles: { '主席': '主席甲', '财政': '财政乙', '文书': '文书丙' }, all: ['主席甲', '财政乙', '文书丙'] };
  const cover = R.defaultCover(2026, 2, { '会议日期': '2026-05-03T00:00:00' }, staff, { '信仰组': '张三、李四' }, GROUPS);
  assert.strictEqual(cover.chair, '主席甲');
  assert.strictEqual(cover.agenda[0].person, '主席甲');
  assert.ok(cover.agenda.some((a) => a.type === 'groups' && a.rows.find((x) => x.label === '信仰组').person === '张三'));
  const out = await R.buildMeetingReport(R.buildReportData(src), 'motion', cover, null);
  assert.strictEqual(out.title, '2026年播恩堂青年团契第二次会议议案');
  const { doc } = await unzip(out.docx);
  assert.match(doc, /开始祷告/);
  assert.match(doc, /pageBreakBefore/);
});

test('财政报告 Word：表格数字、签名图片放进档案', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const report = {
    title: '2026年播恩堂青年团契一月至三月财政报告', year: 2026, month: 3,
    income: [{ label: '2025年余额', budget: '', actual: 1000, opening: true }, { label: '奉献', budget: 5000, actual: 1234.5 }],
    expense: [{ label: '信仰组', budget: 800, actual: 120 }],
    balances: { '奉献在手': 0, '现金在手': -90, '银行存款': 2204.5 },
    incomeBudget: 5000, incomeTotal: 2234.5, expenseBudget: 800, expenseTotal: 120, others: [], treasurer: '财政乙', auditor: '查账丙',
  };
  const out = await R.buildFinanceReport(report, { treasurer: png });
  const { names, doc, zip } = await unzip(out.docx);
  assert.ok(names.includes('word/media/rIdSig1.png'), '签名图片要在档案里');
  assert.match(doc, /1,234\.50/);
  assert.match(doc, /财政：财政乙/);
  assert.match(await zip.file('word/_rels/document.xml.rels').async('string'), /rIdSig1/);
  const fin = await R.buildMeetingReport(R.buildReportData(src), 'report', null, { report, sigs: {}, month: 3 });
  assert.match((await unzip(fin.docx)).doc, /财政报告（1月至3月） – 财政乙/);
});
