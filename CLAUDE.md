# PMC Youth Portal（播青系统）— 给 Claude Code 的说明

卫理公会基督教播恩堂青年团契（PMC Youth，中文「播青」）的公开首页和职员后台。
正在从 Google Apps Script 改写成 **Supabase + GitHub Pages**。规划与进度：`docs/SUPABASE_PLAN.md`。

- 用户说简体中文，跟用户讲话用简体中文。界面文字用简体中文；英文由 `tools/i18n` 字典翻译。
- 英文名称一律写 **PMC Youth**，不要写 Boqing。
- 用户可能只用手机：需要用户操作的步骤要能在手机浏览器完成，写清楚按哪里。

## 档案

| 位置 | 内容 |
|---|---|
| `web/` | 静态网站（首页、职员后台）。`config.dev.js` / `config.prod.js` 只放 Supabase URL 和 publishable key |
| `supabase/migrations/` | 资料库结构与函数，依档名顺序套用 |
| `tests/db/` | 本地 Postgres 权限测试（`harness.js` 模拟 Supabase 角色和 auth） |
| `legacy/gas/` | 旧 GAS 版，**只当功能和权限规格参考**，不再部署 |
| `tools/i18n/` | 中→EN 字典 |
| `docs/EMAIL_TEST.md` | 17 种 Email 通知的规格与测试清单 |
| `.github/workflows/` | `test.yml` 自动测试；`pages.yml` 发布网站 |

## 环境

| | Supabase 专案 ID | 网站 |
|---|---|---|
| 测试版 dev | `ivvsxzojghvyuvjobrtp`（pmc-youth-dev） | Pages 的 `/dev/`，跟着 `main` |
| 正式版 prod | `vnlunozsmegngmzyzkkw`（pmc-youth-prod） | Pages 根目录，跟着最新的 `v*` 标签 |

## 工作流程

1. 改代码（migration 一律新增档案，不改已套用的旧档）。
2. `npm test` 全过。
3. migration 套用到 **dev**；推 `main`（网站 `/dev/` 自动更新）。
4. 请用户在 `/dev/` 测试。**用户说 OK 才**：migration 套用到 **prod** → 打 `vYYYY.MM.DD-N` 标签并推上去（正式版网站自动更新）。
5. 直接在 `main` 上 commit / push（用户已同意，不用分支）。

## 安全规则（一定要遵守）

1. **前端不能直接读写资料表。** 所有表开 RLS 且不给 anon / authenticated 表权限；`init` migration 已把 public 的预设权限关掉。
2. **前端只能呼叫明确 `grant execute` 的 `public` 函数（RPC）。** 每个这种函数：
   - `security definer`、`set search_path = ''`、物件名称写完整（`public.xxx`）。
   - 第一行检查身份：当届在任职员 / 有登入（含卸任只读）/ 匿名可用（只限首页公开资料、意见箱提交）。
   - 再用权限函数检查角色，规则照 `legacy/gas/src/AdminBackend.gs` 的「权限」区块：admin、exec、finance、看契友备注、改节目（行政组或该节目负责组，`EVENT_EXEC_FIELDS_` 只有行政组能改）。
   - 回传资料按角色过滤栏位，不做「一次回传全部资料」的 API。
3. 内部函数放 `private` schema（等于旧版 `_` 结尾函数）。
4. **跟钱有关或会产生纪录的动作**（Claim 审核/付款/收款确认、奉献、财政交易）：同一交易里 `select … for update` 锁住 → 重新读状态 → 检查不可重复 → 写入；另外用唯一约束防重复。
5. 每个新 RPC 都要有测试：该能用的角色能用、其他角色（含匿名、卸任、别组）被挡。
6. `service_role` / secret key、Gmail 应用程式密码、资料库密码**绝不**进 repo 或对话；由用户自己填进 Supabase Secrets。publishable key 是公开的，可以放 `web/config.*.js`。
7. **repo 是 Public**：不要 commit 契友个资、真实姓名范例、Sheet / CSV 汇出、截图。范例名字用「张三、李四」。
8. 改了界面中文字，要补 `tools/i18n` 的英文翻译，再跑 `npm run i18n`。

## 指令

```bash
npm install
npm test            # 资料库权限测试 + 旧 GAS 测试
npm run test:db     # 只跑资料库测试（需要本机 Postgres 16+）
npm run i18n        # 重新嵌入中英字典
```
