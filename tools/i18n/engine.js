/* ============================================================
   中 / EN 系统语言切换
   ------------------------------------------------------------
   只翻译系统画面（按钮、标题、说明、提示）。报告内容、契友名字、事工内容、
   节目名称等资料保持原文：放在 data-noi18n 或下面 SKIP 里的区块不会翻译。
   新增画面文字时，在 DICT 加一行「中文: English」就可以。
   ============================================================ */
(function () {
  var DICT = __DICT__;
  var SKIP = 'script,style,textarea,code,[data-noi18n],[contenteditable="true"]' + __SKIP__;
  var KEY = 'pmcy_lang';
  var HAN = /[㐀-鿿]/;
  var ATTRS = ['placeholder', 'title', 'data-tip', 'aria-label', 'alt'];
  var SAFE2 = ['领会', '领唱', '司琴', '日期', '金额', '状态', '组别', '类别', '备注', '原因', '地点', '讲员', '主题', '说明', '预算', '职位', '收入', '支出', '转账', '现金', '银行', '账户', '草稿', '发布', '节目', '事工', '会议', '议案', '报告', '已批准', '待批准', '你有', '共有', '还有', '已经', '截止', '岗位', '人数', '次数', '名单', '契友', '职员', '组长', '账号', '任期', '奉献', '交换', '申请', '主席', '文书', '财政', '查账', '卸任'];
  var WD = { '日': 'Sun', '一': 'Mon', '二': 'Tue', '三': 'Wed', '四': 'Thu', '五': 'Fri', '六': 'Sat' };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var lang = 'zh';
  try { lang = localStorage.getItem(KEY) === 'en' ? 'en' : 'zh'; } catch (e) {}

  function han(s) { var n = 0; for (var i = 0; i < s.length; i++) if (HAN.test(s[i])) n++; return n; }
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  var fragKeys = Object.keys(DICT).filter(function (k) { return (han(k) >= 3 && k.length >= 3) || SAFE2.indexOf(k) !== -1 || (han(k) >= 2 && k.length >= 3); })
    .sort(function (a, b) { return b.length - a.length; });
  var RX = fragKeys.length ? new RegExp(fragKeys.map(esc).join('|'), 'g') : null;
  var OPEN = '(（「“"\'/[ \n\t\u3000', CLOSE = ')）」”"\'.,;:!?、，。：；/] \n\t\u3000';

  function glue(a, b) { return a && b && OPEN.indexOf(a) === -1 && CLOSE.indexOf(b) === -1; }
  function asciiPunct(s) {
    return s.replace(/（/g, ' (').replace(/）/g, ') ').replace(/：/g, ': ').replace(/，/g, ', ').replace(/、/g, ', ')
      .replace(/。/g, '. ').replace(/；/g, '; ').replace(/「|」|“|”/g, '"').replace(/？/g, '? ').replace(/！/g, '! ').replace(/｜/g, ' | ').replace(/　/g, ' ')
      .replace(/ {2,}/g, ' ').replace(/ ([),.;:!?])/g, '$1').replace(/\( /g, '(');
  }
  function prePatterns(s) {
    return s.replace(/第\s*(\d+)\s*次会议/g, 'Meeting $1').replace(/第\s*(\d+)\s*次/g, 'No. $1').replace(/(\d{4})\s*年\s*/g, '$1 ');
  }
  function patterns(s) {
    return s.replace(/(\d{4})\s+(\d{1,2})\s*月/g, function (m, y, mo) { return (MON[Number(mo) - 1] || mo) + ' ' + y; })
      .replace(/(\d{1,2})\s*月(?![份底初中])/g, function (m, mo) { return MON[Number(mo) - 1] || m; })
      .replace(/(\d{4})\s*届/g, '$1 term').replace(/(\d+)\s*岁/g, '$1 yrs')
      .replace(/周([日一二三四五六])/g, function (m, d) { return WD[d]; }).replace(/星期([日一二三四五六])/g, function (m, d) { return WD[d]; });
  }
  function tr(s) {
    if (s == null) return s;
    s = String(s);
    if (lang !== 'en' || !HAN.test(s)) return s;
    var t = s.trim();
    if (DICT.hasOwnProperty(t)) { var v = DICT[t]; if (/[：:]$/.test(t) && /:$/.test(v)) v += ' '; return s.replace(t, v); }
    var m = t.match(/^(\d{1,2})\s*月$/);
    if (m && MON[Number(m[1]) - 1]) return MON[Number(m[1]) - 1];
    var out = prePatterns(s);
    if (RX && out.length <= 160) {
      out = out.replace(RX, function (k, off, str) {
        var e = DICT[k];
        if (glue(str.charAt(off - 1), e.charAt(0))) e = ' ' + e;
        if (glue(e.charAt(e.length - 1), str.charAt(off + k.length))) e = e + ' ';
        return e;
      });
    }
    out = patterns(out);
    if (!HAN.test(out)) out = asciiPunct(out);
    return out;
  }

  var store = new WeakMap();
  function skipped(el) { return !el || (el.closest && el.closest(SKIP)); }
  function doText(n) {
    var p = n.parentElement;
    if (skipped(p)) return;
    var cur = n.nodeValue, rec = store.get(n);
    if (lang !== 'en' && !rec) return;
    if (!rec || cur !== rec.out) { if (!HAN.test(cur) && !(rec && cur === rec.zh)) { if (rec) store.delete(n); return; } rec = { zh: cur }; }
    if (p.tagName === 'OPTION' && !p.hasAttribute('value')) p.setAttribute('value', rec.zh.trim());
    var o = rec.zh;
    if (lang === 'en') {
      o = tr(rec.zh);
      if (o !== rec.zh) {
        var pv = n.previousSibling ? (n.previousSibling.textContent || '') : '', nx = n.nextSibling ? (n.nextSibling.textContent || '') : '';
        if (/^[A-Za-z0-9"(]/.test(o) && glue(pv.slice(-1), o.charAt(0))) o = ' ' + o;
        if (/[A-Za-z0-9:,)"]$/.test(o) && glue(o.slice(-1), nx.charAt(0))) o = o + ' ';
      }
    }
    rec.out = o;
    store.set(n, rec);
    if (cur !== rec.out) n.nodeValue = rec.out;
  }
  function doAttrs(el) {
    if (!el.closest || el.closest('[data-noi18n]')) return;
    var rec = store.get(el);
    if (lang !== 'en' && !rec) return;
    rec = rec || {};
    ATTRS.forEach(function (a) {
      if (!el.hasAttribute || !el.hasAttribute(a)) return;
      var cur = el.getAttribute(a), r = rec[a];
      if (!r || cur !== r.out) { if (!HAN.test(cur)) return; r = { zh: cur }; }
      r.out = lang === 'en' ? tr(r.zh) : r.zh;
      rec[a] = r;
      if (cur !== r.out) el.setAttribute(a, r.out);
    });
    store.set(el, rec);
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { doAttrs(root); if (skipped(root)) return; }
    var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (n.nodeType === 1) { if (n.matches(SKIP)) { doAttrs(n); return NodeFilter.FILTER_REJECT; } return NodeFilter.FILTER_ACCEPT; }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n; while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  }
  function syncButtons() {
    document.querySelectorAll('.lang-toggle').forEach(function (b) { b.textContent = lang === 'en' ? '中文' : 'EN'; b.title = lang === 'en' ? '切换到中文' : 'Switch to English'; });
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh';
  }
  var titleZh = null;
  function applyAll() {
    if (titleZh === null) titleZh = document.title;
    document.title = lang === 'en' ? tr(titleZh) : titleZh;
    walk(document.body);
    syncButtons();
  }
  var obs = new MutationObserver(function (list) {
    list.forEach(function (m) {
      if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') doAttrs(m.target);
      else m.addedNodes.forEach(walk);
    });
  });

  var _alert = window.alert, _confirm = window.confirm, _prompt = window.prompt;
  window.alert = function (m) { return _alert.call(window, tr(m)); };
  window.confirm = function (m) { return _confirm.call(window, tr(m)); };
  window.prompt = function (m, d) { return _prompt.call(window, tr(m), d); };

  window.PMC_I18N = {
    tr: tr,
    lang: function () { return lang; },
    set: function (l) {
      lang = l === 'en' ? 'en' : 'zh';
      try { localStorage.setItem(KEY, lang); } catch (e) {}
      applyAll();
    },
    toggle: function () { this.set(lang === 'en' ? 'zh' : 'en'); }
  };
  function start() {
    applyAll();
    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
