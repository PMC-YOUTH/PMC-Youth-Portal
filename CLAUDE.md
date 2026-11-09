# 播青系统（boqing-portal）— 给 Claude Code 的说明

卫理公会基督教播恩堂青年团契（播青）的公开首页和职员后台。
Google Apps Script（V8）Web App，资料存在跟项目绑定的 Google Sheet，档案存在 Google Drive。
用户主要说华语（简体）。界面文字一律用简体中文；英文由 i18n 字典在前端翻译。

## 档案

| 档案 | 内容 |
|---|---|
| `src/Code.gs` | `doGet`（`?page=admin` 进后台，否则首页）、公开首页资料 `getPublicPortalData`、工作表快取层 `getSheetGrid_` / `invalidateSheetCache_`、操作记录 `writeLog_`、初始化 |
| `src/AdminBackend.gs` | 登入（Email + SHA-256 加盐 300 轮）、Session、**权限 `perm_*`**、节目、事奉、契友、Claim、奉献、意见箱、网站设定、账号与任期、Email 通知 `notify_*`、轮值表、节目交换 `swap_*`、Drive 储存 `drive_*` |
| `src/MinistryBackend.gs` | 事工管理、事工会议报告（Google Doc / PDF）、财政 `fin_*`、签名 |
| `src/Admin.html` | 职员后台（单一档案：HTML + CSS + JS），最后面嵌了 i18n 引擎 |
| `src/Index.html` | 公开首页，最后面嵌了 i18n 引擎 |
| `src/appsscript.json` | 项目设定（时区 Asia/Kuala_Lumpur、Drive 进阶服务 v3、Web App 以部署者身份执行、任何人可开） |
| `tools/i18n/` | 中→EN 字典与引擎。改了界面文字要在 `dict_admin.json` / `dict_index.json` 加翻译，然后 `npm run i18n` |
| `tests/` | 用 Node 模拟 Apps Script（`gas-mock.js`）跑后端测试 |

## 工作流程

- **只在 repo 里改代码，不要再在网页编辑器改。** `clasp push` 会整个盖掉网页编辑器的内容。
- 改完：`npm run check` → `npm test` → `clasp push`（推到 /dev）→ 用户在 /dev 测 → `clasp deploy -i <部署ID>` 更新正式版 /exec（网址不变）。
- 改了 `Admin.html` / `Index.html` 的中文字，记得补翻译并 `npm run i18n`。不需要翻译的资料区块加 `data-noi18n`。
- Commit 讯息用简短中文或英文都可以。

## 安全规则（一定要遵守）

1. **名字不以 `_` 结尾的全局函数，任何人都能从浏览器用 `google.script.run` 呼叫。**
   - 给网页用的 API：第一行就要 `requireAdminSession_(token)`（当届职员）或 `requireAnySession_(token)`（含卸任只读），再用 `perm_*` 检查角色。
   - 只给编辑器手动运行的维护函数：第一行 `editorOnly_()`。
   - 时间触发器的函数：`if (!trigger_isReal_(e)) editorOnly_();`
   - 内部函数一律用 `_` 结尾。
2. 权限只看后端。前端隐藏按钮只是方便，后端每个 API 都要自己检查。权限表在 `AdminBackend.gs` 的「权限」区块：
   - `perm_isAdmin_`：职位管理员，或系统管理员（「切换身份」时依所选身份）
   - `perm_isExec_`：管理员、主席、副主席、文书、财政、查账，或组别行政组
   - `perm_isFinance_`：管理员、财政、查账
   - `perm_canSeeMemberPrivate_`：契友「备注」（`MEMBER_PRIVATE_ROLES_`）
   - `perm_canEditEvent_`：行政组，或该节目的负责组；`EVENT_EXEC_FIELDS_` 只有行政组能改
3. 回传资料要按角色过滤栏位（看 `getAdminEvents`）。不要再加「一次回传全部资料」的 API。
4. 涉及钱或会产生纪录的动作（`reviewClaim`、`markClaimPaid`、`submitOffering` 等）：`LockService` 排队 → 重新读状态 → 检查不可重复 → 才写入。
5. 写入工作表后要 `invalidateSheetCache_(sheet)`（`admin_saveRecord_` 已经会做）。
6. 不要把契友个资、Sheet 汇出或截图 commit 进 repo。

## 资料与储存

- Sheet 用 `SpreadsheetApp.getActiveSpreadsheet()`（项目绑定在 Sheet 上，没有写死 Sheet ID）。
- 档案：全部经过 `drive_folder_(名称)`，放在 Script Properties `DRIVE_ROOT_FOLDER_ID` 指定的「播青系统」总资料夹底下。第一次在编辑器运行 `setupDriveRoot()` 会建立。
  子资料夹：播青｜会议记录、播青｜网站照片、播青｜职员报销收据、播青｜签名、播青｜事工会议报告。
- 首页照片、会议记录、收据是「知道链接的人可以查看」。

## Email

- 全部经过 `notify_send_(to, cc, subject, lines)`，用 `MailApp`，寄件人是部署 Web App 的账号，寄件名称「播青后台」。
- 个人 Gmail 每天大约 100 位收件人的额度；`notify_send_` 额度用完会跳过并记 log。
- 测试：编辑器运行 `testEmail()`；完整检查表在 `docs/EMAIL_TEST.md`。

## 待办

见 `docs/MIGRATION.md`（搬到新账号）与 `docs/EMAIL_TEST.md`（逐项测试 Email 通知）。
