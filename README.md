# PMC Youth Portal（播青系统）

卫理公会基督教播恩堂青年团契（PMC Youth）的公开首页与职员后台。

- 技术：静态网页（GitHub Pages）+ Supabase（Postgres、Auth、Storage、Edge Functions）
- 状态：从 Google Apps Script 改写中，进度见 `docs/SUPABASE_PLAN.md`
- 网站：正式版在 GitHub Pages 根目录，测试版在 `/dev/`

## 文件

- `CLAUDE.md` — 架构、安全规则、开发流程
- `docs/SUPABASE_PLAN.md` — 改版规划与阶段
- `docs/EMAIL_TEST.md` — Email 通知规格与测试清单
- `legacy/gas/` — 旧 GAS 版（只作规格参考）

## 常用指令

```bash
npm install
npm test          # 全部测试
npm run i18n      # 改了界面文字后重新嵌入中英字典
```

## 发布

- 推到 `main` → 测试版 `/dev/` 自动更新。
- 测试 OK 后打标签（例如 `v2026.11.09-1`）并推上去 → 正式版自动更新。
