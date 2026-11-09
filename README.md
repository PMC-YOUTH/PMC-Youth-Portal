# 播青系统

卫理公会基督教播恩堂青年团契（播青）的公开首页与职员后台。

- 技术：Google Apps Script（V8）Web App + Google Sheets（资料）+ Google Drive（档案）
- 首页：Web App 网址；职员后台：网址加 `?page=admin`
- 介面：简体中文，可切换 English

## 文件

- `CLAUDE.md` — 架构、安全规则、开发流程（Claude Code 会自动读）
- `docs/MIGRATION.md` — 搬到新账号、放上 GitHub、设定 clasp 的步骤
- `docs/EMAIL_TEST.md` — 每一种 Email 通知的测试清单

## 常用指令

```bash
npm install          # 第一次
npx clasp login      # 用团契账号登入（浏览器）
npm test             # 后端测试（Node 模拟 Apps Script）
npm run i18n         # 改了界面文字后，重新嵌入中英字典
npx clasp push       # 推到 Apps Script（/dev 开发版）
npx clasp deploy -i <部署ID> -d "说明"   # 更新正式版 /exec
```
