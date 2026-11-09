const { makeEnv } = require('./gas-mock.js');
const props = {}; const created = [];
function mkFolder(name, parent) { const kids = []; const f = { name, id: 'F' + (created.length + 1), kids,
  getName: () => name, getId: () => f.id, getUrl: () => 'https://drive/' + f.id,
  getFoldersByName: n => { const m = kids.filter(k => k.name === n); return { hasNext: () => m.length > 0, next: () => m.shift() }; },
  createFolder: n => { const c = mkFolder(n, f); kids.push(c); return c; } }; created.push([name, parent ? parent.name : 'MyDrive']); return f; }
const myDrive = mkFolder('MyDrive');
const g = makeEnv({ activeUser: 'owner@x.com' });
g.PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) };
g.DriveApp = { getFolderById: id => { const f = (function find(x) { if (x.id === id) return x; for (const k of x.kids) { const r = find(k); if (r) return r; } })(myDrive); if (!f) throw new Error('nf'); return f; },
  getFoldersByName: n => myDrive.getFoldersByName(n), createFolder: n => myDrive.createFolder(n) };
// before setup: falls back to My Drive
const vm = require('vm');
let f = vm.runInContext("drive_folder_('播青｜签名')", g); console.log('fallback parent:', created.at(-1));
vm.runInContext("__driveRoot_ = undefined; __driveFolders_ = {};", g);
console.log(vm.runInContext('setupDriveRoot()', g).split('\n')[0], props);
vm.runInContext("__driveRoot_ = undefined; __driveFolders_ = {};", g);
f = vm.runInContext("drive_folder_('播青｜会议记录')", g);
console.log('after setup parent of 会议记录:', created.filter(c => c[0] === '播青｜会议记录'), 'total created', created.length);
