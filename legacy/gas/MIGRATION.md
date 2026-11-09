# 搬到新账号 + GitHub

下面的「旧账号」指现在拥有 Sheet 和 Apps Script 的账号，「新账号」指准备好的团契专用 Email（也是 GitHub 账号）。
登入 Google、GitHub、clasp 都要你自己在浏览器操作，Claude Code 不会也不应该帮你输入密码。

---

## A. 把资料和系统搬到新账号

1. **旧账号**打开播青的 Google Sheet → 共享 → 把新账号加为「编辑者」。
2. **新账号**打开那个 Sheet → 档案 → 建立副本，命名例如「播青系统资料库」。
   - 副本会连同绑定的 Apps Script 一起复制（新的 Script ID），全部资料、账号、密码（加密后的）都在。
   - 以下这些**不会**跟着复制，后面步骤会补：Web App 部署、每天的提醒触发器、Script Properties。
3. 新账号在副本里：扩充功能 → Apps Script → 专案设定（齿轮）→ 复制 **Script ID**，接着做 B 部分，把 repo 里的最新代码推上去（副本里的是旧版，没有 Drive 总资料夹和 Email 测试功能）。
4. 推好后，在新账号的 Apps Script 编辑器依序**手动运行**（上方下拉选单选函数 → 执行，第一次会要求授权，按允许）：
   1. `setupDriveRoot` — 在新账号 Drive 建立「播青系统」总资料夹和子资料夹。执行记录会显示链接。
   2. `testEmail` — 寄一封测试信到新账号，确认可以寄信。
   3. `installReminderTrigger` — 建立每天 9 点的会议截止提醒。
5. 部署 → 新部署 → 类型 Web App → 执行身份「我」、存取权「任何人」→ 部署。记下新的 /exec 网址和**部署 ID**。
6. 用新网址测试：首页、职员登入（大家原本的 Email 和密码照样能用）、上传一个档案（应该出现在「播青系统」资料夹里）。
7. 把新网址更新到所有分享过的地方（Instagram、群组公告、书签）。
8. **停掉旧系统**，避免两边同时有人写资料：
   - 旧账号 Apps Script → 部署 → 管理部署 → 把旧的 Web App 封存（Archive）。
   - 旧账号 Apps Script → 触发器（时钟图示）→ 删掉每天的提醒触发器。
   - 旧 Sheet 可以留着当备份，但改成只读（共享里把其他人改成检视者）。

### 旧的档案怎么办

旧账号 Drive 里的「播青｜会议记录」「播青｜网站照片」「播青｜职员报销收据」「播青｜签名」「播青｜事工会议报告」，链接还会继续有效（因为是「知道链接的人可查看」），但档案还是旧账号的。
建议把这些资料夹的**拥有权转移**给新账号（Drive 右键 → 共享 → 把新账号设为拥有者，新账号要接受），然后把它们拖进新的「播青系统」资料夹。系统是用资料夹名称找的，所以移进去以后新上传的档案会接着放进原本的资料夹。

---

## B. 放上 GitHub，用 Claude Code 开发

一次性准备（在你的电脑）：

1. 安装 Node.js（LTS）和 Git。
2. 用**新账号**打开 https://script.google.com/home/usersettings ，把「Google Apps Script API」打开。
3. 在 GitHub（新账号）建立一个 **Private** repo，例如 `pmc-youth-portal`。repo 里会有契友名单的栏位名称和系统逻辑，不要设成 Public。
4. 解压这个资料夹，在里面执行：

   ```bash
   git init
   git config user.name "播青"
   git config user.email "新账号的 email"
   git add .
   git commit -m "播青系统：从 Apps Script 搬到 GitHub"
   git branch -M main
   git remote add origin https://github.com/<新账号>/pmc-youth-portal.git
   git push -u origin main
   ```

5. 安装 clasp 并登入新账号（会打开浏览器让你登入）：

   ```bash
   npm install
   npx clasp login
   ```

6. 把 `.clasp.json.example` 复制成 `.clasp.json`，填入 A-3 的 Script ID。`.clasp.json` 不会被 commit。
7. 第一次推之前先核对项目设定：

   ```bash
   mkdir ../pmc-youth-check && cd ../pmc-youth-check
   npx clasp clone <Script ID>
   ```

   比较 `../pmc-youth-check/appsscript.json` 和 repo 里的 `src/appsscript.json`。如果线上那份多了东西（例如 `oauthScopes`），以线上那份为准，复制进 repo 再 commit。然后可以删掉 `pmc-youth-check`。
8. 回到 repo：

   ```bash
   npm test
   npx clasp push
   ```

之后每次修改：在 repo 里改 → `npm test` → `npx clasp push`（更新 /dev）→ 测试 → `npx clasp deploy -i <部署ID> -d "说明"`（更新 /exec，网址不变）→ `git commit` / `git push`。

用 Claude Code：在 repo 资料夹里打开 Claude Code，它会先读 `CLAUDE.md`。

---

## C. 核对清单

- [ ] 新账号的 Sheet 副本建立好，Script ID 记下来
- [ ] repo 推上 GitHub（Private）
- [ ] `clasp push` 成功
- [ ] `setupDriveRoot`、`testEmail`、`installReminderTrigger` 都运行过
- [ ] 新 Web App 部署好，网址已更新到各处
- [ ] `docs/EMAIL_TEST.md` 全部测过
- [ ] 旧部署封存、旧触发器删除、旧 Sheet 改只读
- [ ] 旧 Drive 资料夹拥有权转给新账号并移进「播青系统」
