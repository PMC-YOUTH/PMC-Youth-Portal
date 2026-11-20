# 备份与防暂停

Supabase 免费方案：资料库备份**不能下载**，一星期内使用者查询太少专案会被**暂停**。
所以用 GitHub Actions 自己做两件事：

| 排程 | 档案 | 时间（马来西亚） | 做什么 |
|---|---|---|---|
| Keep Supabase awake | `.github/workflows/keepalive.yml` | 每天 11:17 | 呼叫正式版和测试版的 `ping`、首页公开资料。失败会寄 Email 给 repo 拥有者 |
| Backup prod database | `.github/workflows/backup.yml` | 每星期一 02:43 | `pg_dump` 正式版 → 加密 → 存成 Actions 档案（保留 90 天） |

两个都可以在 GitHub → Actions → 选该排程 → **Run workflow** 手动执行。

注意：Public repo 连续 60 天没有 commit，GitHub 会自动停用排程。收到 GitHub 的提醒信时，到 Actions 页面按 **Enable workflow**。

## 第一次设定（用户自己做，手机浏览器可以）

密码只放 GitHub Secrets，不要贴在对话或 repo 里。

1. **资料库连线字串**
   1. Supabase → 选 **pmc-youth-prod** → 上方 **Connect**。
   2. 选 **Session pooler**（GitHub 的机器不支援 IPv6，不能用 Direct connection），复制 URI。
      样子像 `postgresql://postgres.vnlunozsmegngmzyzkkw:[YOUR-PASSWORD]@aws-...pooler.supabase.com:5432/postgres`。
   3. 把 `[YOUR-PASSWORD]` 换成资料库密码。忘了的话：Project Settings → Database → **Reset database password**。
2. **加密密语**：自己想一句至少 16 个字的密语，**另外记在安全的地方**。没有它，备份档打不开。
3. GitHub → repo **PMC-Youth-Portal** → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**，新增两个：
   - `PROD_DB_URL`：第 1 步的连线字串
   - `BACKUP_PASSPHRASE`：第 2 步的密语
4. Actions → **Backup prod database** → **Run workflow**，确认跑成功（绿色勾）。

## 备份里有什么

- `public`：契友、节目、事工、会议、财政、奉献、Claim、账号资料、任期……全部资料表
- `private`：内部函数
- `auth`：登入账号（含密码杂凑）
- `storage`：档案目录（**不含档案本身**：照片、收据、会议记录档案要另外从 Supabase Storage 下载）

## 还原（需要电脑）

```bash
# 1. GitHub → Actions → Backup prod database → 选一次执行 → 下载 artifact（zip），解压得到 .dump.gpg
gpg -d pmc-youth-prod-YYYYMMDD-HHMM.dump.gpg > backup.dump      # 会问加密密语
# 2. 先看内容
pg_restore --list backup.dump | less
# 3. 只还原某张表的资料（例：契友），到一个暂存资料库比对后再决定怎么搬回去
pg_restore --no-owner --no-privileges --data-only --table=members -d "<暂存资料库连线字串>" backup.dump
```

整个还原到新的 Supabase 专案：先套用 `supabase/migrations/` 建立结构，再用 `--data-only` 还原资料。
