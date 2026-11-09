# 播青系统改版规划：GAS + Google Sheets → GitHub + Supabase

状态：**已确认方向**（2026-11-09 用户决定见第 7 节）
日期：2026-11-09

## 0. 目标与原则

- 功能、界面、权限规则跟现在的 GAS 版一样（`src/` 是规格来源），不趁机加新功能。
- 界面沿用 `Admin.html` / `Index.html` 的 HTML、CSS 和 i18n，只把 `google.script.run.xxx()` 换成 Supabase 呼叫。
- **安全规则照搬 CLAUDE.md**：权限只看后端；每个给网页用的动作都在后端检查登入和角色；回传资料按角色过滤栏位；跟钱有关的动作要防重复。
- 契友资料、CSV 汇出、截图一律不进 repo。

## 1. 架构

```
浏览器（静态网页：首页 + 职员后台）
   │  supabase-js（只带 anon key，没有任何秘密）
   ▼
Supabase
 ├─ Auth：Email + 密码登入
 ├─ Postgres：资料表（全部开 RLS）+ 业务函数（RPC）
 ├─ Storage：照片、收据、签名、会议记录、报告
 ├─ Edge Functions：寄 Email（Gmail SMTP）、产生 DOCX/PDF 报告
 └─ pg_cron：每天 9 点会议截止提醒
```

### 1.1 后端写法：Postgres 函数（RPC）

现在每个 GAS API（例如 `reviewClaim`）都改成一个 Postgres 函数，前端用 `supabase.rpc('review_claim', {...})` 呼叫。

- 函数用 `security definer`，第一行检查身份，等同现在的 `requireAdminSession_` + `perm_*`：
  - `auth_require_staff()`：当届在任职员（等于 `requireAdminSession_`）
  - `auth_require_any()`：有登入，含卸任只读（等于 `requireAnySession_`）
  - `perm_is_admin()`、`perm_is_exec()`、`perm_is_finance()`、`perm_can_see_member_private()`、`perm_can_edit_event(event_id)`：规则跟 `AdminBackend.gs` 的「权限」区块完全一样
- 资料表**全部开 RLS，前端不能直接写入任何表**（没有 insert/update/delete policy）。所有写入都只能经过函数，这样每个动作一定先做权限检查，跟现在一样。
- 读取也经过函数，函数按角色过滤栏位（例如契友「备注」只有 `MEMBER_PRIVATE_ROLES_` 看得到，意见箱「联络方式」同样处理）。
- 只有公开首页的资料（公开节目、公开活动报告、网站设定）开放匿名读取，而且是经过 `get_public_portal_data()` 一个函数，只回传公开栏位。
- 内部函数放在 `private` schema，前端呼叫不到（等于现在的 `_` 结尾函数）。

**跟钱有关的动作**（`review_claim`、`mark_claim_paid`、`confirm_claim_received`、`submit_offering`、财政交易）：
在同一个资料库交易里 `select ... for update` 锁住那一笔 → 重新读状态 → 检查不可重复 → 写入。
另外加资料库约束当第二道防线，例如 `finance_txn.ref_id` 唯一（同一张 Claim 不可能产生两笔支出）、Claim 状态只能照 PENDING → APPROVED/REJECTED → PAID → RECEIVED 的顺序变。

### 1.2 Email（Gmail SMTP）

- 业务函数不直接寄信，而是在**同一个交易里**写一笔到 `email_outbox` 表（收件人、cc、主旨、内容）。动作失败就不会有信；动作成功信一定排进队列。
- Edge Function `send-email` 每分钟（pg_cron）把 outbox 里的信用 Gmail SMTP 寄出，记录成功或失败。
- 寄件人 pmc.youth2010@gmail.com，名称「播青后台」，主旨前面【播青】，跟现在一样。17 种通知的收件人规则照 `docs/EMAIL_TEST.md`。
- Gmail 应用程式密码由用户自己在 Supabase Dashboard → Edge Functions → Secrets 填入，代码和 repo 里不会有。
- 额度：Gmail SMTP 每天约 500 位收件人，超过就留在 outbox 隔天再寄。

### 1.3 档案（Storage）

| 现在 Drive 资料夹 | Bucket | 谁能看 |
|---|---|---|
| 播青｜网站照片 | `site-photos`（public） | 任何人 |
| 播青｜会议记录 | `meeting-docs`（private） | 职员（signed URL） |
| 播青｜职员报销收据 | `receipts`（private） | 申请人本人、财政、查账、管理员 |
| 播青｜签名 | `signatures`（private） | 本人、财政报告产生时 |
| 播青｜事工会议报告 | `reports`（private） | 职员 |

现在 GAS 版是「知道链接的人可以查看」，改版后收据和会议记录变成只有有权限的人看得到，比现在严格。

### 1.4 报告（事工会议报告、财政报告、轮值表 PDF）✅ PDF 用浏览器列印

现在的做法：后端自己组 Word（OOXML）→ 用 Google Drive 转成 PDF。没有 Google 之后：

- **DOCX**：现有的 OOXML 组装代码（`rpt*_` 函数）几乎可以原样搬到 Edge Function（Deno + JSZip），版式不变。
- **PDF** 要选一种：
  - **A（建议）**：浏览器「列印 → 存成 PDF」。后台已经有报告预览画面，补一份列印用 CSS 就好。免费、版式可控，但 PDF 是使用者在自己电脑产生再上传。
  - **B**：外部转档服务（例如 Gotenberg / CloudConvert）把 DOCX 转 PDF，版式跟 Word 一模一样，但要多一个服务，CloudConvert 免费额度有限。
  - **C**：先只做 DOCX，PDF 以后再说。

### 1.5 登入

- Supabase Auth（Email + 密码）。注册、忘记密码、重设密码改用 Supabase 内建流程（信也走 Gmail SMTP）。
- `profiles` 表对应现在的「用户」工作表（人名、电话、状态、系统管理员），`terms` 表对应「职员任期」。
- 权限照现在的逻辑从「当年在任任期」算出来（`auth_buildSession_`）：当届在任 → 职位/组别；只有往届 → 卸任只读；系统管理员 → 管理员。
- 「切换身份」（系统管理员模拟其他职位）存在 `profiles.view_as`，权限函数会读它，跟现在一样。
- 旧账号密码不搬（杂凑方式不同，而且是测试资料）。第一个管理员 pmc.youth2010@gmail.com 用一次性 SQL 设定，其他人重新注册、由管理员批准。

### 1.6 网站托管 ✅ repo 改回 Public，用 GitHub Pages

repo 已改成 Private。GitHub Pages 在免费方案不能用 Private repo，所以要选：

- **A（建议）**：Cloudflare Pages 或 Netlify，接 GitHub repo，push 后自动部署，Private repo 免费，每个分支有预览网址（等于现在的 /dev）。
- **B**：GitHub Pro（每月约 USD 4）才能用 Private repo 的 Pages。
- **C**：repo 改回 Public 用 GitHub Pages（代码里已经没有契友姓名，但旧 commit 里还有，要先清历史）。

## 2. 资料表（对应现在的工作表）

| 工作表 | 资料表 | 备注 |
|---|---|---|
| 用户 | `profiles`（+ `auth.users`） | 密码由 Supabase Auth 管 |
| 职员任期 | `terms` | 年份、组别、职位、状态（在任 / 已卸任 / 已辞职 / 申请中 / 已拒绝） |
| 契友 | `members` | 备注只有指定角色看得到 |
| 节目 | `events` | `EVENT_EXEC_FIELDS_` 只有行政组能改 |
| 事奉人员 | `roster_assignments` | |
| 事奉名单 | `roster_pool` | |
| 轮值草稿 | `roster_drafts` | 内容存 jsonb |
| 节目交换 | `program_swaps` | 双方批准流程照现在 |
| 活动报告 | `activity_reports` | |
| 会议记录 | `meeting_docs` | 档案在 Storage |
| 职员报销 | `claims` | 状态机 + 唯一约束 |
| 奉献 | `offerings` | |
| 财政 | `finance_txns` | 账户：奉献在手 / 现金 / 银行；`ref_id` 唯一 |
| 预算 | `budget_items` | |
| 意见箱 | `feedback` | 匿名可提交（函数里限制长度和频率） |
| 系统设置 | `site_settings` | 首页大合照、标题、Instagram |
| 会议 | `ministry_meetings` | |
| 事工 | `ministries` | |
| 事工更新 | `ministry_updates` | |
| 事工统计 | `ministry_stats` | |
| 会议组提交 | `ministry_submissions` | |
| 操作记录 | `audit_logs` | 只能新增，不能改或删 |
| — | `email_outbox` | 新增：Email 队列 |

编号：现在是 `FIN-0001` 这种文字编号。新表用 uuid 当主键，另外保留一个看得懂的 `code` 栏位（例如 `CLM-0001`），画面上显示 `code`。

金额用 `numeric(12,2)`，日期用 `date`，时间用 `timestamptz`，时区 Asia/Kuala_Lumpur。

## 3. 开发环境与测试

- **两个 Supabase 专案**（免费方案最多 2 个）：`pmc-youth-dev`（测试，等于现在的 /dev）和 `pmc-youth-prod`（正式）。都建在 **Singapore（ap-southeast-1）**。
- 资料库结构全部用 migration 档放在 `supabase/migrations/`，先套用到 dev，测试通过才套用到 prod。
- 测试：
  - 每个权限函数和 RPC 都写 SQL 测试，用不同角色（管理员、财政、查账、某组职员、卸任、未登入）逐一检查「能做的能做、不能做的会被挡」。现有 `tests/security.test.js` 的 77 项检查全部转成新测试。
  - 钱的动作测试重复呼叫、同时呼叫，确认不会出现两笔。
  - 前端用 Playwright 跑主要流程。
- 新流程：改代码 → 跑测试 → 推到 dev 测试网址 → 你在 dev 测 → 你说 OK → 套用到 prod → git commit + push。

## 4. 旧资料搬移（只搬一部分）

- 你从旧 Google Sheet 汇出要保留的工作表（CSV），直接在对话里上传。
- 我写汇入脚本放在 `tools/import/`（脚本进 repo，**CSV 不进 repo**，`.gitignore` 已挡 `*.csv`），先汇入 dev 给你核对，再汇入 prod。
- 要搬的工作表（已确认）：**契友、节目、事工计划（事工）、财政**。

## 5. 分阶段

| 阶段 | 内容 | 完成标准 |
|---|---|---|
| 0 | 建 dev/prod 专案、网站托管、repo 结构、测试框架 | 空白网站能连到 dev |
| 1 | 资料表、登入、权限函数、账号与任期管理 | 权限测试全过；能注册、批准、登入 |
| 2 | 公开首页、网站设定、节目、事奉、轮值表、节目交换 | 首页和节目功能在 dev 可用 |
| 3 | 契友、意见箱、活动报告、会议记录、档案上传 | |
| 4 | Claim、奉献、财政、预算（钱的部分） | 防重复测试全过 |
| 5 | 事工管理、会议报告、财政报告（DOCX/PDF）、签名 | 报告版式跟现在一样 |
| 6 | Email（outbox + Gmail SMTP）、每天提醒 | `docs/EMAIL_TEST.md` 17 项全部测过 |
| 7 | 汇入旧资料、正式上线、停用 GAS 版 | |

每个阶段做完都在 dev 给你测，你 OK 才进下一阶段。

## 6. 风险与限制

- **重写的工作量大**：后端约 5,600 行、91 个 API。阶段 4、5 最花时间。
- **免费方案限制**：Supabase 免费专案 7 天没人用会暂停（要手动按恢复）；资料库 500 MB、Storage 1 GB。照片多的话可能要升级（Pro 每月约 USD 25）。
- **Gmail SMTP**：用应用程式密码，Google 若改政策可能失效；寄太多会被当垃圾邮件。之后有团契网域可以换 Resend。
- **个资**：契友资料会放在 Supabase（第三方服务）。资料库在新加坡机房。
- Public repo：契友资料、CSV、截图、密码、Gmail 应用程式密码、service_role key 绝不能进 repo（anon key 本来就是公开的，可以放）。

## 7. 已确认的决定（2026-11-09）

1. Supabase：已在团契账号重建，地区 Singapore。
2. 网站托管：repo 改回 **Public**，用 **GitHub Pages**。改 Public 前先清掉含契友姓名的旧 commit。
3. PDF：**浏览器列印**存成 PDF；DOCX 由 Edge Function 产生。
4. 旧资料搬：**契友、节目、事工计划、财政**。
