# 弈间 · 中国象棋

一个无需账号、无外部运行依赖的中国象棋小游戏。使用原生 JavaScript、SVG 棋盘和 Web Worker 电脑对手，适配桌面与手机。

在线游戏：https://gnailegoac.github.io/yijian-xiangqi/

源码推送至 `main` 后，GitHub Actions 会运行规则与 AI 测试、构建并发布至 GitHub Pages。

## 开始对弈

安装 Node.js 22 或更高版本后，在项目目录运行：

```powershell
npm start
```

打开 http://127.0.0.1:5173 。电脑对手使用 JavaScript 模块 Worker，需要通过 HTTP 访问，不能直接双击 `index.html`。

也可以双击本目录的 `启动象棋.cmd`，保持启动窗口运行，然后打开上面的地址。

## 功能

- 人机对弈，入门、进阶、挑战三档；可执红或执黑。
- 双人同屏，在同一设备轮流走棋。
- 合法落点提示，马腿、象眼、九宫、过河、炮架、自将及将帅照面规则。
- 将军、将死、困毙判定；困毙判负。
- 悔棋、走棋建议、翻转棋盘、可开关音效、认输、中文棋谱下载。
- 自动保存到当前浏览器，刷新可续局；存档恢复时逐步校验合法性。
- 快捷键：U 悔棋、F 翻转、H 提示、Esc 取消选择；方向键在棋盘移动焦点，空格或回车选子和落子。

人机模式悔棋会退回自己上次落子之前；电脑思考期间也可以悔棋。执黑时，电脑开局第一步不可单独悔去。

当前版本适合休闲对弈，未实现正式比赛的长将、长捉与自然限着裁决，也没有跨设备联网对战。电脑为本地启发式搜索，难度档位不代表专业等级。

## 构建和部署

```powershell
npm run build
```

将生成的 `dist/` 目录部署到任意静态站点托管服务。全部资源使用相对路径，支持 GitHub Pages 子目录。没有后台服务、API key 或外部字体。

检查构建产物：

```powershell
node scripts/serve.js --dist --port 5174
```

如需让同一局域网的手机访问，运行 `node scripts/serve.js --host 0.0.0.0`，在手机打开电脑局域网 IP 的 5173 端口；操作系统可能需要放行防火墙。每个浏览器仍是独立棋局。

## 验证

```powershell
npm ci
npm run check
npm run test:e2e
```

规则与 AI 使用 Node 内置测试。浏览器测试使用 Playwright 和本机 Chrome；如未安装 Chrome，可用 `PLAYWRIGHT_CHROME_PATH` 环境变量指定 Chromium 可执行文件。

## 文件

- `src/engine.js`：纯函数规则引擎。
- `src/ai.js`、`src/ai-worker.js`：限时迭代加深、alpha beta、静态搜索和后台计算。
- `src/app.js`：交互、存档、棋谱和界面状态。
- `styles.css`：响应式中式布局。
- `scripts/serve.js`、`scripts/build.js`：本地服务器与静态构建。
