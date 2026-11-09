/* 转接器：让沿用自 GAS 版的页面继续用 google.script.run.xxx(...) 的写法，
 * 实际改呼叫 window.PMC_API.xxx(...)（api.js，背后是 Supabase）。
 * 还没搬好的功能会走 withFailureHandler，显示「还在搬移中」。 */
(function () {
  function runner(onOk, onFail, userObject) {
    return new Proxy({}, {
      get: function (_, name) {
        if (name === 'withSuccessHandler') return function (fn) { return runner(fn, onFail, userObject); };
        if (name === 'withFailureHandler') return function (fn) { return runner(onOk, fn, userObject); };
        if (name === 'withUserObject') return function (o) { return runner(onOk, onFail, o); };
        if (typeof name !== 'string') return undefined;
        return function () {
          var args = Array.prototype.slice.call(arguments);
          Promise.resolve()
            .then(function () {
              var impl = window.PMC_API && window.PMC_API[name];
              if (!impl) throw new Error('这个功能还在搬移中，暂时不能用。');
              return impl.apply(null, args);
            })
            .then(function (res) { if (onOk) onOk(res, userObject); },
                  function (err) {
                    var e = err instanceof Error ? err : new Error((err && err.message) || String(err));
                    if (onFail) onFail(e, userObject); else console.warn('[' + name + ']', e.message);
                  });
        };
      }
    });
  }
  window.google = window.google || {};
  window.google.script = window.google.script || {};
  Object.defineProperty(window.google.script, 'run', { get: function () { return runner(null, null, undefined); } });
})();
