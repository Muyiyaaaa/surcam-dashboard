# 盯盯车数据面板（surcam-webviewer）

「Lk盯盯车」(SurCam) 的**只读**第三方数据面板：本机脚本用你自己的 token 拉取账号权限内的数据，加密落到 GitHub 仓库，用 GitHub Pages 在手机上随时查看。

> 原则：只用 GET 读取自己的数据，不碰任何写操作 / 广告上报 / 权益接口；额度之内该怎样就怎样。
> 服务端 CORS 已封禁浏览器直连（`Origin not allowed`），所以采用「本机同步 → 静态页」架构，token 不进浏览器、不出本机。

## 面板内容

- **车况**：电量、续航（电/油）、位置、充电状态、胎压、保养剩余、USB 存储、哨兵视频、累计费用明细
- **行程**：逐日历史 + 每条明细（起终点、能耗、费用、急加/急刹/急转、红绿灯、最高速、达成率、内燃时刻），含服务端费用口径（省级油价/电价）
- **统计**：今日/近7天/近30天/全部汇总，每日里程柱状图、能耗趋势（含综合能耗 = 3.15×油 + 0.9×电）、达成率趋势、月度费用（电/油/过路）、本月日历热力图
- **权益**：使用时长余额、RT 额度、积分及流水、勋章、签到、抽奖/补签机会、订阅码/授权码、时长日志
- **其他**：围栏配置、哨兵状态、当前停车计费、竞赛与荣誉、通知中心
- 长期趋势：每次同步记录实时快照（续航/电量等，一天多次），积累后可看电池趋势

## 目录结构

```
webviewer/
├── sync.js               # 只读同步脚本（Node ≥18，零依赖）
├── sync.bat              # 同步 + 可选 git 推送
├── config.json           # 本地配置（已 gitignore，含口令）
├── config.example.json   # 配置模板
└── docs/                 # GitHub Pages 静态站点
    ├── index.html / style.css / app.js   # 面板（无外部依赖）
    ├── icon.svg / manifest.webmanifest   # 可"添加到主屏幕"
    └── data/             # 同步产物：data.enc(或 data.json) + meta.json
```

## 部署步骤（一次性）

1. **建仓库**：在 GitHub 新建一个仓库。
   - 公开仓库：免费可用 Pages，**务必保持加密**（默认开启）。
   - 私有仓库：Pages 需要 GitHub Pro；付费后可在 config.json 里设 `"encrypt": false`。
2. **推送代码**：把 `webviewer/` 里所有内容作为仓库根目录推上去（`docs/`、`sync.js`、`.github/` 等；`config.json` 不会也不应上传）。
3. **开 Pages**：仓库 Settings → Pages → Source 选 `Deploy from a branch`，分支 `main`，目录 `/ (root)` 的 `docs` 文件夹（即选 `main` / `docs`）。等 1~2 分钟生效。
4. **本地配置**：
   ```
   copy config.example.json config.json   # 编辑 passphrase（默认已生成随机口令在 config.json）
   ```
   token 默认读取 `../autosign/token.txt`（抓包/刷新方法见 autosign 目录 README）。
5. **首次同步**：双击 `sync.bat`（或 `node sync.js`），成功后 `docs/data/` 会出现加密数据文件。
6. **推送数据**：`sync.bat push`，然后手机访问 `https://<用户名>.github.io/<仓库名>/`，输入口令解锁（之后免输）。

## 日常使用

- **每天更新数据**：运行 `sync.bat push`（可挂 Windows 计划任务，参考 autosign 的做法）。
- **token 有效期约 3 天**：过期后 sync 会提示，运行 `..\autosign\refresh_token.bat` 刷新后即可。
- 手机浏览器打开后可「添加到主屏幕」，像 App 一样全屏使用。
- 换口令/锁定：页脚「锁定 / 换口令」清除本地缓存。

## 可选：GitHub Actions 定时同步

见 `.github/workflows/sync.yml`（默认关闭需手动启用 + 配 secrets）。由于 token 3 天过期，Actions 模式需要定期更新 secret 里的 `SURCAM_TOKEN`，不如本机计划任务省心，按需选择。

## 加密说明

- `data.enc` = `SURCAM1.<salt>.<iv>.<密文>`，AES-256-GCM，密钥由口令经 PBKDF2-SHA256（20 万次）派生。
- 口令只存在于本机 `config.json` 和你脑子里；GitHub 上只有密文。
- 页面解密后缓存于手机 localStorage，数据更新后会要求重新输入一次。

## 隐私与边界

- 同步范围是**你账号权限内的只读数据**（行程/车况/权益/通知等 GET 接口），不含直播流和媒体文件。
- 行程数据含位置信息：公开仓库必须保持加密；不要把 `config.json` 或解密后的数据提交上去。
- 本项目不修改服务端任何数据、不绕过任何权益限制；实时查看等受时长限制的功能仍需在小程序内正常使用。
