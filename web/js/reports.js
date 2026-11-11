/* PMC Youth Portal：会议报告 / 议案 / 财政报告的 Word 组装（在浏览器执行）
 * 版式程式码从 legacy/gas/src/MinistryBackend.gs 原样搬过来（标「旧版原样」的区块不要随便改，改了版式会变）；
 * 只把 Apps Script 专用的部分（打包 zip、日期格式、读 Sheet）换成浏览器版本。
 * 用法：window.PMC_REPORTS.buildMeetingReport(...) / buildFinanceReport(...)，回传 Word 档的 base64。 */
(function () {
  'use strict';

  /* ---------- 替代 Apps Script 的小工具 ---------- */
  function parseDateInput_(v) {
    if (!v) return null;
    if (Object.prototype.toString.call(v) === '[object Date]') return v;
    var s = String(v).trim(), m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var d = new Date(s.replace(' ', 'T'));
    return isNaN(d.getTime()) ? null : d;
  }
  function pad2_(n) { return String(n).padStart(2, '0'); }
  function ministryFormatDate_(value) {
    var d = parseDateInput_(value);
    return d ? d.getFullYear() + '/' + pad2_(d.getMonth() + 1) + '/' + pad2_(d.getDate()) : '';
  }
  function ministryMoney_(value) {
    var n = Number(value);
    if (isNaN(n)) return String(value || '');
    return 'RM ' + n.toFixed(2);
  }

  /* ---------- 旧版原样：预算、序号 ---------- */
function ministryEffectiveBudget_(planBudget, updates) {
  var effective = (planBudget === '' || planBudget == null) ? '' : Number(planBudget);
  (updates || []).slice().sort(function(a, b) {
    return Number(a['会议次数'] || 0) - Number(b['会议次数'] || 0);
  }).forEach(function(update) {
    if (update['本次预算调整'] === '是' && update['新预算'] !== '' && update['新预算'] != null) {
      var n = Number(update['新预算']);
      if (!isNaN(n)) effective = n;
    }
  });
  return effective;
}
function ministrySerialNumber_(serial) {
  var m = String(serial || '').match(/\.(\d+)$/);
  return m ? Number(m[1]) : 999999;
}

  /* ---------- 旧版原样：Word XML 小工具、各组表格、议案首页 ---------- */
var RPT_FONT_LATIN_ = 'Century Gothic';
var RPT_FONT_CJK_ = 'KaiTi';
var RPT_SZ_ = 22;
var RPT_COLS_ = [700, 1980, 4360, 3420];
var RPT_CN_ = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
var RPT_SHEET_BUDGET_ = '预算';
var RPT_FIN_ACCOUNTS_ = ['奉献在手', '现金', '银行'];

function rptCn_(n) {
  n = Number(n) || 0;
  if (n <= 10) return RPT_CN_[n];
  if (n < 20) return '十' + (n % 10 ? RPT_CN_[n % 10] : '');
  return RPT_CN_[Math.floor(n / 10)] + '十' + (n % 10 ? RPT_CN_[n % 10] : '');
}
function rptEsc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}
function rptMoney_(n, dashZero) {
  if (n === '' || n == null || isNaN(Number(n))) return dashZero ? '-' : '';
  n = Math.round(Number(n) * 100) / 100;
  if (dashZero && Math.abs(n) < 0.005) return '-';
  var s = Math.abs(n).toFixed(2).split('.');
  s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '-' : '') + s.join('.');
}

/* ---------- Word XML 小工具 ---------- */
function rptRun_(text, o) {
  o = o || {};
  var rpr = '';
  if (o.font) rpr += '<w:rFonts w:ascii="' + o.font + '" w:hAnsi="' + o.font + '" w:cs="' + o.font + '"' + (o.fontCjk ? ' w:eastAsia="' + o.fontCjk + '"' : '') + '/>';
  if (o.b) rpr += '<w:b/><w:bCs/>';
  if (o.sz) rpr += '<w:sz w:val="' + o.sz + '"/><w:szCs w:val="' + o.sz + '"/>';
  if (o.u) rpr += '<w:u w:val="single"/>';
  var x = '';
  String(text == null ? '' : text).split(/(\t|\n)/).forEach(function(p) {
    if (p === '\t') x += '<w:tab/>';
    else if (p === '\n') x += '<w:br/>';
    else if (p) x += '<w:t xml:space="preserve">' + rptEsc_(p) + '</w:t>';
  });
  return x ? '<w:r>' + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') + x + '</w:r>' : '';
}
/** 支援 **粗体** 的文字 */
function rptRich_(text, o) {
  o = o || {};
  var out = '';
  String(text == null ? '' : text).split('**').forEach(function(s, i) {
    if (!s) return;
    var oo = {}; for (var k in o) oo[k] = o[k];
    oo.b = o.b || (i % 2 === 1);
    out += rptRun_(s, oo);
  });
  return out;
}
function rptPara_(runs, p) {
  p = p || {};
  var ppr = '';
  if (p.keepNext) ppr += '<w:keepNext/>';
  if (p.pageBreakBefore) ppr += '<w:pageBreakBefore/>';
  if (p.tabs && p.tabs.length) ppr += '<w:tabs>' + p.tabs.map(function(t) { return '<w:tab w:val="' + (t.val || 'left') + '" w:pos="' + t.pos + '"/>'; }).join('') + '</w:tabs>';
  ppr += '<w:spacing w:before="' + (p.before || 0) + '" w:after="' + (p.after || 0) + '" w:line="' + (p.line || 240) + '" w:lineRule="auto"/>';
  if (p.left || p.hanging) ppr += '<w:ind w:left="' + (p.left || 0) + '"' + (p.hanging ? ' w:hanging="' + p.hanging + '"' : '') + '/>';
  if (p.jc) ppr += '<w:jc w:val="' + p.jc + '"/>';
  if (p.sz) ppr += '<w:rPr><w:sz w:val="' + p.sz + '"/><w:szCs w:val="' + p.sz + '"/></w:rPr>';
  return '<w:p><w:pPr>' + ppr + '</w:pPr>' + (runs || '') + '</w:p>';
}
function rptBorderSet_(names, sz) {
  return names.map(function(n) { return '<w:' + n + ' w:val="single" w:sz="' + (sz || 4) + '" w:space="0" w:color="000000"/>'; }).join('');
}
function rptNoBorder_(names) {
  return names.map(function(n) { return '<w:' + n + ' w:val="nil"/>'; }).join('');
}
function rptTc_(w, inner, o) {
  o = o || {};
  var p = '<w:tcW w:w="' + w + '" w:type="dxa"/>';
  if (o.span) p += '<w:gridSpan w:val="' + o.span + '"/>';
  if (o.borders) p += '<w:tcBorders>' + o.borders + '</w:tcBorders>';
  if (o.vAlign) p += '<w:vAlign w:val="' + o.vAlign + '"/>';
  return '<w:tc><w:tcPr>' + p + '</w:tcPr>' + (inner || rptPara_('')) + '</w:tc>';
}
function rptTable_(widths, rowsXml, o) {
  o = o || {};
  var total = widths.reduce(function(a, b) { return a + b; }, 0);
  var pr = '<w:tblW w:w="' + total + '" w:type="dxa"/>';
  if (o.jc) pr += '<w:jc w:val="' + o.jc + '"/>';
  pr += '<w:tblBorders>' + (o.borders || rptBorderSet_(['top', 'left', 'bottom', 'right', 'insideH', 'insideV'])) + '</w:tblBorders>';
  pr += '<w:tblLayout w:type="fixed"/>';
  pr += '<w:tblCellMar><w:left w:w="' + (o.pad == null ? 100 : o.pad) + '" w:type="dxa"/><w:right w:w="' + (o.pad == null ? 100 : o.pad) + '" w:type="dxa"/></w:tblCellMar>';
  return '<w:tbl><w:tblPr>' + pr + '</w:tblPr><w:tblGrid>' + widths.map(function(w) { return '<w:gridCol w:w="' + w + '"/>'; }).join('') + '</w:tblGrid>' + rowsXml + '</w:tbl>';
}

var RPT_LIST_RE_ = /^((?:[a-z]|[ivx]{1,4})[\)\.]|\d{1,2}[\)）]|\d{1,2}\.(?=\s)|[•●\-–])\s*/;

/** 把事工栏位的文字（含小标记）变成段落 */
function rptCellBlocks_(text, width) {
  var lines = String(text == null ? '' : text).replace(/\r/g, '').split('\n');
  var xml = '', lastTable = false, i = 0;
  while (i < lines.length) {
    var ln = lines[i];
    if (/^\s*\|/.test(ln)) {
      var rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(lines[i].replace(/^\s*\|/, '').split('|').map(function(c) { return c.trim().replace(/\\n/g, '\n'); }));
        i++;
      }
      xml += rptNestedTable_(rows, width);
      lastTable = true;
      continue;
    }
    var m = ln.match(/^([ 　]*)/);
    var sp = m[1].replace(/　/g, '  ').length;
    var level = Math.floor(sp / 4);
    var body = ln.slice(m[1].length);
    var lm = body.match(RPT_LIST_RE_);
    if (lm && body.length > lm[0].length) {
      var pre = lm[1];
      var hang = pre.length >= 3 ? 420 : 300;
      var left = level * 300 + hang;
      xml += rptPara_(rptRich_(pre) + rptRun_('\t') + rptRich_(body.slice(lm[0].length)), { left: left, hanging: hang, tabs: [{ pos: left }] });
    } else {
      xml += rptPara_(rptRich_(body), { left: level * 300 });
    }
    lastTable = false;
    i++;
  }
  if (!xml || lastTable) xml += rptPara_('');
  return xml;
}
function rptNestedTable_(rows, width) {
  var n = Math.max.apply(null, rows.map(function(r) { return r.length; }));
  var w = Math.floor((width - 40) / n);
  var widths = []; for (var k = 0; k < n; k++) widths.push(w);
  var x = rows.map(function(r) {
    var cells = '';
    for (var c = 0; c < n; c++) cells += rptTc_(w, rptCellBlocks_(r[c] || '', w - 120));
    return '<w:tr>' + cells + '</w:tr>';
  }).join('');
  return rptTable_(widths, x, { pad: 60 });
}

/* ---------- 组别报告表 ---------- */
function rptGroupXml_(g, index) {
  var W = RPT_COLS_;
  var x = rptPara_(rptRun_(index + '．' + g.group + (g.staff ? ' – ' + g.staff : '')), { keepNext: true, after: 40 });
  var hdr = '<w:tr><w:trPr><w:tblHeader/></w:trPr>' +
    ['序', '事工', '目的/进行方式', '结果'].map(function(h, i) { return rptTc_(W[i], rptPara_(rptRun_(h), { jc: 'center' }), { vAlign: 'center' }); }).join('') + '</w:tr>';
  var rows = '';
  var total = 0;
  (g.categories || []).forEach(function(sec) {
    rows += '<w:tr><w:trPr><w:cantSplit/></w:trPr>' + rptTc_(10460, rptPara_(rptRun_(sec.category, { b: true }), { keepNext: true }), { span: 4 }) + '</w:tr>';
    (sec.rows || []).forEach(function(r) {
      total += Number(r.expense && r.expense.cumulative || 0);
      rows += '<w:tr>' +
        rptTc_(W[0], rptCellBlocks_(r.serial, W[0] - 200)) +
        rptTc_(W[1], rptCellBlocks_(r.name, W[1] - 200)) +
        rptTc_(W[2], rptCellBlocks_(r.purposeMethod, W[2] - 200)) +
        rptTc_(W[3], rptCellBlocks_(r.result, W[3] - 200)) + '</w:tr>';
    });
  });
  if (!(g.categories || []).length) {
    rows += '<w:tr>' + rptTc_(W[0], '') + rptTc_(W[1] + W[2] + W[3], rptPara_(rptRun_('本组暂无事工资料。')), { span: 3 }) + '</w:tr>';
  }
  rows += '<w:tr><w:trPr><w:cantSplit/></w:trPr>' +
    rptTc_(W[0] + W[1] + W[2], rptPara_(rptRun_('总支出'), { jc: 'right' }), { span: 3 }) +
    rptTc_(W[3], rptPara_(rptRun_('RM ' + rptMoney_(total)))) + '</w:tr>';
  return x + rptTable_(W, hdr + rows) + rptPara_('', { after: 120 });
}

/* ---------- 议案首页 ---------- */
function rptCoverXml_(year, no, c) {
  c = c || {};
  var x = rptPara_(rptRun_(year + '年播恩堂青年团契第' + rptCn_(no) + '次会议议案', { b: true, u: true }), { jc: 'center', after: 200 });
  var info = function(label, val) { return rptPara_(rptRun_(label + '：' + (val || '')), { line: 276 }); };
  x += info('日期', rptCoverDate_(c.date));
  x += info('开始时间', c.start);
  x += info('地点', c.venue);
  x += info('主持', c.chair);
  x += info('记录', c.recorder);
  x += rptPara_(rptRun_('出席者：' + (c.present || []).join('、')), { left: 900, hanging: 900, line: 276 });
  x += rptPara_(rptRun_('缺席者：' + (c.absent || []).join('、')), { left: 900, hanging: 900, line: 276 });
  x += rptPara_('', { line: 276 });
  x += rptPara_(rptRun_('会议议程', { b: true, u: true }), { line: 276, after: 40 });
  var L = { line: 276 };
  (c.agenda || []).forEach(function(a, i) {
    var num = '（' + rptCn_(i + 1) + '）';
    var t = String(a.title || '').trim();
    if (a.type === 'motion') {
      x += rptPara_(rptRich_(num + t + '：'), L);
      x += rptPara_(rptRun_('提议：' + (a.proposer || '') + '\t附议：' + (a.seconder || '') + '\t' + (a.result || '全体通过')), { left: 720, tabs: [{ pos: 5040 }, { pos: 9380 }], line: 276 });
    } else if (a.type === 'groups') {
      x += rptPara_(rptRich_(num + t + '：'), L);
      var items = (a.rows || []).filter(function(r) { return r && (r.label || r.person); });
      for (var k = 0; k < items.length; k += 2) {
        var s = items[k].label + '：' + (items[k].person || '');
        if (items[k + 1]) s += '\t' + items[k + 1].label + '：' + (items[k + 1].person || '');
        x += rptPara_(rptRun_(s), { left: 720, tabs: [{ pos: 5040 }], line: 276 });
      }
      String(a.extra || '').split('\n').forEach(function(e) { if (e.trim()) x += rptPara_(rptRich_(e.trim()), { left: 720, line: 276 }); });
    } else if (a.type === 'bullets') {
      x += rptPara_(rptRich_(num + t + '：'), L);
      (a.items || []).forEach(function(b) {
        if (String(b || '').trim()) x += rptPara_(rptRun_('•\t') + rptRich_(String(b).trim()), { left: 900, hanging: 180, tabs: [{ pos: 900 }], line: 276 });
      });
    } else {
      x += rptPara_(rptRich_(num + t + (a.person ? '：' + a.person : '')), L);
    }
  });
  return x;
}
function rptCoverDate_(v) {
  if (!v) return '';
  var d = (typeof gridDate_ === 'function' ? gridDate_(v) : null) || new Date(String(v).replace(' ', 'T'));
  if (!d || isNaN(d.getTime())) return String(v);
  var wk = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日（星期' + wk + '）';
}


  /* ---------- 旧版原样（只换打包方式）：组装 .docx ---------- */
function rptBuildDocx_(bodyXml, images, name) {  // 回传 Promise<base64>
  images = images || [];
  var NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  var sect = '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="400" w:gutter="0"/></w:sectPr>';
  var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + '><w:body>' + bodyXml + sect + '</w:body></w:document>';
  var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="' + RPT_FONT_LATIN_ + '" w:hAnsi="' + RPT_FONT_LATIN_ + '" w:eastAsia="' + RPT_FONT_CJK_ + '" w:cs="' + RPT_FONT_LATIN_ + '"/>' +
    '<w:sz w:val="' + RPT_SZ_ + '"/><w:szCs w:val="' + RPT_SZ_ + '"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    '</w:styles>';
  var footer = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ' + NS + '><w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr><w:t>1</w:t></w:r>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>';
  var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
    images.map(function(im) { return '<Relationship Id="' + im.rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + im.rid + '.png"/>'; }).join('') +
    '</Relationships>';
  var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>';
  var root = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  var zip = new JSZip();
  zip.file('[Content_Types].xml', ct);
  zip.file('_rels/.rels', root);
  zip.file('word/document.xml', doc);
  zip.file('word/styles.xml', styles);
  zip.file('word/footer1.xml', footer);
  zip.file('word/_rels/document.xml.rels', rels);
  images.forEach(function(im) { zip.file('word/media/' + im.rid + '.png', String(im.blob).replace(/^.*,/, ''), { base64: true }); });
  return zip.generateAsync({ type: 'base64', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
function rptImageRun_(rid, id, cx, cy) {
  return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + id + '" name="Sig' + id + '"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' + id + '" name="sig' + id + '.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
}

  /* ---------- 旧版原样：财政报告表格 + 签名 ---------- */
function fin_reportXml_(r, images, sigBlobs) {
  var F = { font: 'Times New Roman', fontCjk: 'SimSun', sz: 20 };
  var run = function(t, b) { return rptRun_(t, { font: F.font, fontCjk: F.fontCjk, sz: F.sz, b: !!b }); };
  var P = function(t, jc, b) { return rptPara_(run(t, b), { jc: jc || 'left', sz: F.sz }); };
  var W = [2900, 1150, 1150, 2800, 1150, 1150];
  var mid = rptBorderSet_(['left']);
  var x = rptPara_(rptRun_(r.title, { font: F.font, fontCjk: F.fontCjk, sz: 22, b: true, u: true }), { jc: 'center', after: 160 });
  var rows = '';
  rows += '<w:tr>' + rptTc_(W[0] + W[1] + W[2], P('收入', 'center', true), { span: 3 }) + rptTc_(W[3] + W[4] + W[5], P('支出', 'center', true), { span: 3, borders: mid }) + '</w:tr>';
  var bottom = rptBorderSet_(['bottom']);
  rows += '<w:tr>' + ['事项', '预算', '实际'].map(function(h, i) { return rptTc_(W[i], P(h, 'center', true), { borders: bottom }); }).join('') +
    ['事项', '预算', '实际'].map(function(h, i) { return rptTc_(W[i + 3], P(h, 'center', true), { borders: bottom + (i === 0 ? mid : '') }); }).join('') + '</w:tr>';
  var right = r.expense.slice();
  right.push({ label: '', budget: '', actual: '', blank: true });
  right.push({ label: '奉献在手', budget: '', actual: r.balances['奉献在手'] || '', bal: true });
  right.push({ label: '现金在手', budget: '', actual: r.balances['现金在手'], bal: true });
  right.push({ label: '银行存款', budget: '', actual: r.balances['银行存款'], bal: true });
  var n = Math.max(r.income.length, right.length);
  var fmtB = function(v) { return v === '-' ? '-' : (v === '' || v == null ? '' : rptMoney_(v, true)); };
  var fmtA = function(it) { if (!it || it.blank) return ''; if (it.bal) return it.actual ? rptMoney_(it.actual) : ''; return rptMoney_(it.actual, true); };
  for (var i = 0; i < n; i++) {
    var a = r.income[i], b = right[i];
    rows += '<w:tr>' +
      rptTc_(W[0], P(a ? a.label : '')) + rptTc_(W[1], P(a ? fmtB(a.budget) : '', 'right')) + rptTc_(W[2], P(a ? fmtA(a) : '', 'right')) +
      rptTc_(W[3], P(b ? b.label : ''), { borders: mid }) + rptTc_(W[4], P(b ? fmtB(b.budget) : '', 'right')) + rptTc_(W[5], P(b ? fmtA(b) : '', 'right')) + '</w:tr>';
  }
  var expTotal = Math.round((r.expenseTotal + r.balances['奉献在手'] + r.balances['现金在手'] + r.balances['银行存款']) * 100) / 100;
  var top = rptBorderSet_(['top']);
  rows += '<w:tr>' + rptTc_(W[0], P('')) + rptTc_(W[1], P(rptMoney_(r.incomeBudget), 'right', true), { borders: top }) + rptTc_(W[2], P(rptMoney_(r.incomeTotal), 'right', true), { borders: top }) +
    rptTc_(W[3], P(''), { borders: mid }) + rptTc_(W[4], P(rptMoney_(r.expenseBudget), 'right', true), { borders: top }) + rptTc_(W[5], P(rptMoney_(expTotal), 'right', true), { borders: top }) + '</w:tr>';
  x += rptTable_(W, rows, { jc: 'center', pad: 80, borders: rptBorderSet_(['top', 'left', 'bottom', 'right']) + rptNoBorder_(['insideH', 'insideV']) });
  x += rptPara_('', { after: 120 });
  if (r.others && r.others.length) {
    x += P('其他：');
    r.others.forEach(function(o) { x += rptPara_(run(o.desc, true) + run('\t' + rptMoney_(o.amount), true), { tabs: [{ pos: 4200, val: 'right' }] }); });
  }
  x += rptPara_('', { after: 200 });
  sigBlobs = sigBlobs || {};
  var cell = function(label, name, key) {
    var inner = rptPara_(run(label + '：' + (name || ''), true), { jc: 'center', after: 60 });
    var blob = sigBlobs[key];
    if (blob) {
      var rid = 'rIdSig' + (images.length + 1);
      images.push({ rid: rid, blob: blob });
      inner += rptPara_(rptImageRun_(rid, 100 + images.length, 1463040, 731520), { jc: 'center' });
    } else inner += rptPara_('', { after: 600 });
    return inner;
  };
  x += rptTable_([4600, 4600], '<w:tr>' + rptTc_(4600, cell('财政', r.treasurer, 'treasurer')) + rptTc_(4600, cell('查账', r.auditor, 'auditor')) + '</w:tr>',
    { jc: 'center', borders: rptNoBorder_(['top', 'left', 'bottom', 'right', 'insideH', 'insideV']) });
  return x;
}

  /* ---------- 议案首页的预设内容（旧版 rptDefaultCover_，资料改由参数传入） ---------- */
  function rptDefaultCoverFrom_(year, no, meeting, staff, groupStaff, MIN_GROUPS) {
    var rptStaffByRole_ = function () { return staff; };
    var ministryGetAllGroupStaff_ = function () { return groupStaff; };
    return (
function (year, no, meeting) {
  var staff = rptStaffByRole_(year);
  var groupStaff = ministryGetAllGroupStaff_(year);
  var chair = staff.roles['主席'] || '';
  var treasurer = staff.roles['财政'] || '';
  var month = '';
  var md = meeting && meeting['会议日期'] ? new Date(String(meeting['会议日期']).replace(' ', 'T')) : null;
  if (md && !isNaN(md.getTime())) month = rptCn_(Math.max(1, md.getMonth()));
  var agenda = [{ type: 'text', title: '开始祷告', person: chair }];
  if (no > 1) agenda.push({ type: 'motion', title: '接收' + year + '年第' + rptCn_(no - 1) + '次会议议案', proposer: '', seconder: '', result: '全体通过' });
  agenda.push({
    type: 'groups', title: '各组报告',
    rows: MIN_GROUPS.map(function(g) { return { label: g, person: String(groupStaff[g] || '').split('、')[0] || '' }; }),
    extra: '财政报告（一月至' + (month || '　') + '月）：' + treasurer
  });
  agenda.push({ type: 'bullets', title: '讨论事项', items: [] });
  agenda.push({ type: 'motion', title: '接收' + year + '年第' + rptCn_(no) + '次会议报告', proposer: '', seconder: '', result: '全体通过' });
  agenda.push({ type: 'motion', title: '接收财政报告（一月至' + (month || '　') + '月）', proposer: '', seconder: '', result: '全体通过' });
  agenda.push({ type: 'text', title: '结束祷告', person: '' });
  agenda.push({ type: 'text', title: '结束时间', person: '' });
  return {
    date: meeting && meeting['会议日期'] ? String(meeting['会议日期']).slice(0, 10) : '',
    start: '', venue: '播恩堂', chair: chair, recorder: staff.roles['文书'] || '',
    present: staff.all, absent: [], agenda: agenda
  };
}
    )(year, no, meeting);
  }

  /* ---------- 会议报告资料（旧版 getMinistryReportData 的整理规则） ---------- */
  function buildReportData(src) {
    var MIN_GROUPS = src.groups, MIN_CATEGORIES = src.categories, meetingNo = Number(src.meetingNo);
    var allMinistries = src.ministries || [], allUpdates = src.updates || [], allStats = src.stats || [];
    var staffMap = src.groupStaff || {};
    var groups = MIN_GROUPS.map(function (group) {
      var items = allMinistries.filter(function (m) { return String(m['组别'] || '') === group; });
      items.sort(function (a, b) {
        var ca = MIN_CATEGORIES.indexOf(String(a['类别'] || '')), cb = MIN_CATEGORIES.indexOf(String(b['类别'] || ''));
        if (ca !== cb) return ca - cb;
        var na = ministrySerialNumber_(String(a['序号'] || '')), nb = ministrySerialNumber_(String(b['序号'] || ''));
        if (na !== nb) return na - nb;
        return String(a['事工名称'] || '').localeCompare(String(b['事工名称'] || ''));
      });
      var rows = items.map(function (m) {
        var updates = allUpdates.filter(function (u) { return String(u['事工编号'] || '') === String(m['事工编号'] || ''); });
        updates.sort(function (a, b) { return Number(a['会议次数'] || 0) - Number(b['会议次数'] || 0); });
        var latest = updates.length ? updates[updates.length - 1] : null;
        var stats = allStats.filter(function (s) { return String(s['事工编号'] || '') === String(m['事工编号'] || ''); });
        var expenseSummary = { latest: '', cumulative: 0 };
        updates.forEach(function (u) {
          if (u['本次支出'] !== '' && u['本次支出'] != null && !isNaN(Number(u['本次支出']))) expenseSummary.cumulative += Number(u['本次支出']);
        });
        if (latest && latest['本次支出'] !== '' && latest['本次支出'] != null) expenseSummary.latest = Number(latest['本次支出']);

        var resultParts = [];
        if (m['目标/指标']) resultParts.push('目标：' + String(m['目标/指标']));
        var effectiveBudget = ministryEffectiveBudget_(m['预算'], updates);
        if (effectiveBudget !== '' && effectiveBudget != null && !isNaN(Number(effectiveBudget))) resultParts.push('预算：' + ministryMoney_(effectiveBudget));
        if (meetingNo > 1 && latest) {
          if (latest['状态']) resultParts.push('状态：' + String(latest['状态']));
          if (latest['日期变更'] === '是' && latest['新日期']) resultParts.push('日期调整：' + ministryFormatDate_(latest['新日期']));
          if (latest['进行方式变更'] === '是' && latest['本次进行方式']) resultParts.push('进行方式调整：' + String(latest['本次进行方式']));
          if (latest['本次进度']) resultParts.push('进度：' + String(latest['本次进度']));
          if (latest['本次结果']) resultParts.push('结果：' + String(latest['本次结果']));
          if (latest['参与人数'] !== '' && latest['参与人数'] != null) resultParts.push('参与人数：' + String(latest['参与人数']));
          if (latest['下一步']) resultParts.push('下一步：' + String(latest['下一步']));
        }
        if (latest && latest['本次预算调整'] === '是' && latest['新预算'] !== '' && latest['新预算'] != null) resultParts.push('预算调整：' + ministryMoney_(latest['新预算']));
        if (stats.length) {
          var statLines = stats.map(function (stat) {
            var valueText = stat['数值'] !== '' && stat['数值'] != null ? String(stat['数值']) : '';
            var unitText = String(stat['单位'] || ''), itemText = String(stat['统计项目'] || '');
            var dateObj = parseDateInput_(stat['统计日期']);
            var line = itemText;
            if (valueText) line += '：' + valueText + (unitText ? ' ' + unitText : '');
            if (dateObj) line = (dateObj.getMonth() + 1) + '月' + '：' + line;
            if (stat['备注']) line += '（' + String(stat['备注']) + '）';
            return line;
          }).filter(function (x) { return x; });
          if (statLines.length) resultParts.push(statLines.join('\n'));
        }
        if (expenseSummary.cumulative > 0) resultParts.push('支出：' + ministryMoney_(expenseSummary.cumulative));
        var pm = [];
        if (m['目的']) pm.push(String(m['目的']));
        if (m['进行方式']) pm.push(String(m['进行方式']));
        var plannedDate = ministryFormatDate_(m['计划日期'] || m['计划时间']);
        if (plannedDate && pm.join('\n').indexOf('日期') === -1) pm.push('日期：' + plannedDate);
        var verbatim = latest && String(latest['本次结果'] || '').trim() ? String(latest['本次结果']) : '';
        return {
          ministryId: m['事工编号'], serial: m['序号'], name: m['事工名称'], purpose: m['目的'], method: m['进行方式'],
          purposeMethod: pm.join('\n'), target: m['目标/指标'], plannedDate: plannedDate, budget: effectiveBudget, pic: m['负责人'],
          category: m['类别'], result: verbatim || resultParts.join('\n'), statistics: stats, linkedEvents: [], latestUpdate: latest,
          expense: expenseSummary
        };
      });
      return {
        group: group, staff: staffMap[group] || '',
        categories: MIN_CATEGORIES.map(function (c) { return { category: c, rows: rows.filter(function (r) { return r.category === c; }) }; })
          .filter(function (sec) { return sec.rows.length > 0; })
      };
    });
    return { success: true, year: Number(src.year), meetingNo: meetingNo, meetingType: src.meetingType, groups: groups };
  }

  /* ---------- 一键生成（旧版 generateMinistryMeetingReport / generateFinanceReport 的组装部分） ---------- */
  async function buildMeetingReport(data, version, cover, fin) {
    var year = Number(data.year), meetingNo = Number(data.meetingNo);
    var body = '';
    if (version === 'motion') body += rptCoverXml_(year, meetingNo, cover);
    else body += rptPara_(rptRun_(year + '年播恩堂青年团契第' + rptCn_(meetingNo) + '次会议报告', { b: true, u: true }), { jc: 'center', after: 200 });
    var first = true;
    data.groups.forEach(function (g, i) {
      var gx = rptGroupXml_(g, i + 1);
      if (first && version === 'motion') gx = gx.replace('<w:p><w:pPr><w:keepNext/>', '<w:p><w:pPr><w:keepNext/><w:pageBreakBefore/>');
      first = false;
      body += gx;
    });
    var images = [];
    if (fin) {
      var fx = fin_reportXml_(fin.report, images, fin.sigs || {});
      var head = rptPara_(rptRun_((data.groups.length + 1) + '. 财政报告（1月至' + Number(fin.month) + '月） – ' + (fin.report.treasurer || '')), { pageBreakBefore: true, after: 60 });
      body += head + fx;
    }
    var name = year + '年播恩堂青年团契第' + rptCn_(meetingNo) + '次会议' + (version === 'motion' ? '议案' : '报告');
    return { title: name, docx: await rptBuildDocx_(body, images, name) };
  }
  async function buildFinanceReport(report, sigs) {
    var images = [];
    var body = fin_reportXml_(report, images, sigs || {});
    return { title: report.title, docx: await rptBuildDocx_(body, images, report.title) };
  }

  window.PMC_REPORTS = { buildReportData: buildReportData, defaultCover: rptDefaultCoverFrom_, buildMeetingReport: buildMeetingReport,
                         buildFinanceReport: buildFinanceReport, cn: rptCn_ };
})();
