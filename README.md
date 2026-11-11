# 弈间 · 中国象棋

一个教 9～12 岁孩子下中国象棋的网页游戏。孩子是「小主公」，对面是会让着教棋的对手「司马懿」，身边有军师「诸葛亮」：每一步都可以先在棋盘上试走，军师看了给一句点评；想不出来可以拆「锦囊」，也可以点按钮或打字问军师。目标只有一个：让孩子爱上下棋。

- 原生 JavaScript 模块，没有框架，没有打包器；搜索引擎跑在 Web Worker 里。
- iPad 优先（横屏 1180x820 为主），桌面浏览器和 360 像素以上的手机也能用。
- 军师的讲解有两种来源：家里电脑上的「军师服务」把棋局事实交给大模型来说（需要网关的 key）；没有军师服务时，由本地规则直接讲解，不联网。
- 无需账号。棋局保存在浏览器里，可以导出、导入存档。

在线版本（GitHub Pages，没有军师服务，由本地军师讲解）：https://gnailegoac.github.io/yijian-xiangqi/

## 孩子今天怎么下棋：家里的电脑 + iPad

电脑当服务器，iPad 用浏览器打开电脑上的地址。

1. 在电脑上装好 Node.js（22 或更高，推荐 24）。第一次使用先在项目目录运行一次：

   ```powershell
   npm ci
   ```

2. 启动（两种方式任选其一）：

   ```powershell
   npm start -- --host 0.0.0.0
   ```

   或者直接双击项目目录里的 `启动象棋.cmd`（它做的就是上面这条命令）。**窗口要一直开着**，关掉窗口游戏就停了。第一次启动时 Windows 防火墙会询问是否允许 Node.js 联网，请允许「专用网络」。

3. 窗口里会打印出可以用的地址和军师的状态，例如：

   ```text
   弈间已启动
     本机地址：http://127.0.0.1:5173
     局域网地址：http://192.168.1.50:5173
     局域网地址：http://MY-PC:5173
     军师模式：live（大模型军师已接通）
     在 iPad 上用同一个地址打开，并“添加到主屏幕”
     请一直用同一个地址（电脑名打得开就用电脑名，否则在路由器里给电脑固定 IP）：存档跟着地址走，换地址前先在设置里“导出存档”
   ```

4. 在 iPad 上用 Safari 打开其中一个「局域网地址」，也就是 `http://<电脑的局域网地址>:5173`。注意是 `http`，不是 `https`；iPad 和电脑要连同一个路由器。

5. 打开后点 Safari 的分享按钮，选 **「添加到主屏幕」**。以后从主屏幕的图标进入：全屏、没有地址栏，而且 Safari 不会因为七天没访问就清掉这个网站的存档。

### 请一直用同一个地址

存档（下到一半的棋局、孩子的兵法境界和设置）保存在 iPad 的浏览器里，并且**只属于打开它的那个地址**。换一个地址（比如电脑的 IP 变了）打开，就像换了一个新网站，看不到原来的存档。所以：

- 优先用电脑名的地址（上面例子里的 `http://MY-PC:5173`），只要 iPad 上打得开，它就不会变。
- 电脑名打不开时，在路由器里给这台电脑固定一个 IP（DHCP 保留地址），然后一直用这个 IP。
- **换地址之前先导出存档**：菜单 → 设置 → 存档 → 「导出存档」，会下载一个 `弈间存档-日期.json`。用新地址第一次打开时，开始画面上有「导入存档」；之后在设置里也能导入。清理浏览器数据之前同样先导出。

### 只在这台电脑上玩

```powershell
npm start
```

然后打开 http://127.0.0.1:5173 。这种方式只有本机能访问，iPad 打不开。电脑对手跑在模块 Worker 里，必须通过 `http://` 访问，不能直接双击 `index.html`。

### `scripts/serve.js` 的参数

```text
node scripts/serve.js [--port 5173] [--host 127.0.0.1] [--dist] [--mock] [--api-only]
```

| 参数 | 作用 |
|---|---|
| `--port` | 端口，默认 5173 |
| `--host` | 监听地址，默认 `127.0.0.1`（只有本机）；`0.0.0.0` 让局域网里的设备也能访问 |
| `--dist` | 不读源码，改为提供 `npm run build` 生成的 `dist/` |
| `--mock` | 军师用固定的模拟回复，不访问大模型（测试用，等价于 `npm run start:mock`） |
| `--api-only` | 只提供 `/api`（军师服务），不提供页面 |

通过 npm 传参数时要多写一个 `--`，例如 `npm start -- --port 5174`。

这个服务器只提供白名单里的文件：`index.html`、`favicon.svg`、`manifest.webmanifest`，以及 `src/`、`styles/`、`dev/` 三个目录里扩展名为 `.html .js .css .svg .json .webmanifest .png .txt` 的文件。其余一律 404，包括 `.env.local`、`.git`、`server/`、`scripts/`、`tests/`、`node_modules/`、`legacy/`、`package.json`。

## 军师服务（大模型）的配置：`.env.local`

军师服务是 `npm start` 自带的一个小代理（`/api`）：浏览器只把棋局事实发给它，由它带着 key 去问大模型网关，再把回答一段一段传回来。key 只存在于电脑上这个进程的内存里，不会发给浏览器，也不会打印到窗口里。

1. 把 `.env.example` 复制一份，改名为 `.env.local`。
2. 填上 `COACH_BASE_URL`（网关地址）和 `COACH_API_KEY`（网关的 key）。
3. 重新 `npm start`。窗口里「军师模式」显示 `live` 就接通了；也可以打开 `http://127.0.0.1:5173/api/health` 看状态。

**安全须知**

- **永远不要提交 `.env.local`**，也不要发给别人。它已经写在 `.gitignore` 里。
- **请在网关后台给这把 key 设一个消费上限。**
- 默认只有本机和家里局域网（内网地址）的设备能用军师服务；每个 IP 和每天的请求数都有上限（见下表）。

没有 `.env.local`，或者没有填 key：游戏照常能玩，军师模式是 `off`，由本地军师讲解。游戏里的「设置」会写明军师没有接通的原因。

`.env.local` 里可以写的变量（除了前两项都可以不写；`.env.example` 里有同一份清单）：

| 变量 | 默认值 | 含义 |
|---|---|---|
| `COACH_BASE_URL` | 无 | OpenAI 兼容网关的地址，例如 `https://gateway.example.com/v1` |
| `COACH_API_KEY` | 无 | 网关的 key。没有它、又没开模拟模式时，军师模式是 `off`（`no_key`） |
| `COACH_MODEL` | `openai/openai/gpt-6-sol` | 每一种讲解用的模型 |
| `COACH_QUICK_MODEL` | 同 `COACH_MODEL` | 开局和「对手走了一步」这两种一句话讲解用的模型 |
| `COACH_REASONING_EFFORT` | `low` | 推理强度；留空或填 `none` 表示不传这个参数 |
| `COACH_MAX_TOKENS` / `COACH_MAX_TOKENS_OVER` | `1200` / `1600` | 一次回答 / 终局小结最多生成的 token 数 |
| `COACH_UPSTREAM_TIMEOUT_MS` | `60000` | 等网关回答的最长时间（毫秒） |
| `COACH_MOCK` / `COACH_MOCK_CHUNK_MS` | `0` / `15` | 模拟模式开关 / 模拟回复每一小段之间的间隔（毫秒） |
| `COACH_ALLOWED_ORIGINS` | 空 | 额外允许的**其他网站**来源（逗号分隔，必须完全一致）。页面和 `/api` 是同一个地址时不用填，家里的 iPad 就是这种情况 |
| `COACH_ALLOW_NO_ORIGIN` | `0` | 填 `1` 时接受不带 `Origin` 头的 POST（curl、测试脚本） |
| `COACH_PUBLIC` | `0` | 填 `1` 时接受本机和内网地址以外的访问者 |
| `COACH_RATE_BURST` / `COACH_RATE_PER_MIN` | `20` / `30` | 每个 IP 的限速（令牌桶：可突发次数 / 每分钟补充次数） |
| `COACH_IP_DAILY` / `COACH_GLOBAL_DAILY` | `600` / `2000` | 每天（UTC）的请求上限：每个 IP / 全部合计 |
| `COACH_TRUST_PROXY` | `0` | 填 `1` 时从 `x-forwarded-for` 的第一段取访问者 IP（前面有反向代理时才需要） |
| `COACH_SIGNING_KEY` | 自动推导 | 给军师回复签名用的密钥，至少 32 个字符 |
| `COACH_FREE_TEXT` | `1` | 填 `0` 时不接受孩子自己打字提问，只保留按钮提问 |

启动时会读取项目目录里的 `.env` 和 `.env.local`，同名变量以 `.env.local` 为准；启动命令所在的环境里已经设置的同名变量优先于这两个文件。变量的值不会被打印出来。

## 在线版本（GitHub Pages）没有军师服务

GitHub Pages 只能放静态文件，放不了带 key 的代理，所以在线版本**没有军师服务，由本地军师讲解**：试走点评、三个锦囊、按钮提问、终局小结都照常有，只是没有打字提问的输入框。棋力、教学对手和存档与家里的版本完全一样。

如果以后把军师服务单独部署到一个 `https` 地址，在仓库的 Actions 变量里设置 `COACH_API_BASE`，在线版本就会去连它；不设置就是没有。

## 浏览器要求

- iPad：iPadOS / Safari **16.4 或更高**。
- 电脑和安卓：Chrome **111 或更高**（同代的 Edge 也可以）。
- 自动化测试跑的是 Chromium 模拟出来的 iPad（横屏 1180x820、竖屏 820x1180）和手机（360x740），不是真正的 Safari。**iPad 上真实 Safari 的检查需要家长自己动手做一遍**：横屏、竖屏各下几步，试走、确认、悔棋、拆锦囊、问军师、听听音效，再从主屏幕图标进一次。
- 如果棋盘上出现「棋局的算力没能启动。点一下重试，或者换一个新一点的浏览器（Safari、Chrome、Edge）。」：说明浏览器没能启动搜索引擎的 Worker。游戏没有备用的主线程引擎，这时不能下棋；点一下提示可以重试，仍然不行就升级系统或换一个符合上面版本要求的浏览器。

## 构建和部署

```powershell
npm run build
```

生成 `dist/`：

- `src/` 和 `styles/` 被复制到 `dist/a/<构建号>/` 下，`index.html` 里的引用同时改写过去。每次发布的构建号不同，浏览器缓存里的新旧模块不会混用。
- `dist/icons/` 里的三个图标（主屏幕图标和清单图标）由 `scripts/make-icons.js` 直接画出来，不依赖图片库。
- `dist/config.json` 写明这一版有没有军师服务（默认没有）。
- 构建同时是一次检查，任何一项不过都会失败，并且不留下 `dist/`：模块之间的引用规则、引用的文件是否都存在、有没有用到老 iPad 不支持或需要 https 的接口、页面加载的每个文件是否都在 `dist/` 里、`dist/` 里有没有混进密钥或 `server/`、`scripts/`、`tests/`、`dev/`、`legacy/`、`.env*`。

在本机检查构建结果：

```powershell
node scripts/serve.js --dist --port 5174
```

推送到 `main` 后，GitHub Actions（`.github/workflows/deploy.yml`）依次做三件事：`check`（类型检查、全部单元测试、构建）、`e2e`（Playwright 浏览器测试），两者都通过后 `deploy` 重新构建并发布到 GitHub Pages。

## 测试与检查

```powershell
npm ci                # 安装依赖（只需一次）
npm run check         # 类型检查 + 全部单元测试 + 构建（提交前跑这个）
npm test              # 只跑单元测试（Node 自带的测试框架，不需要浏览器、网络和 key）
npm run typecheck     # 只跑类型检查
npm run test:slow     # 耗时较长的引擎测试（perft、大量对局的对拍）
npm run test:e2e      # 浏览器端到端测试（Playwright + 模拟军师）
npm run test:sim      # 教学对手的模拟对局，检查它“让得合适”
npm run bench         # 搜索引擎的速度基准（只供参考）
npm run coach:bench   # 对真实大模型的延迟、依据和字数检查（要 key，会产生费用）
```

- `npm run test:e2e` 使用本机的 Chrome；装在别处时用环境变量 `PLAYWRIGHT_CHROME_PATH` 指向 Chrome 或 Chromium 的可执行文件。它会自己用模拟军师启动一个 5173 端口的服务器；**如果 5173 端口上已经开着 `npm start`，测试会直接用那一个**，军师接着真实大模型时就会花钱，所以跑之前先把它关掉。
- `npm run coach:bench` 需要 `.env.local` 里的 key，并且先在另一个窗口里 `npm start`。它按固定的请求和一盘 30 步的剧本去问真实的大模型，报告首字时间、是否出现棋盘上不存在的着法、是否超出字数；不达标会失败。
- `npm run test:sim` 和 `npm run bench` 只用本机算力，不联网。

## 目录

- `index.html`、`manifest.webmanifest`、`favicon.svg`、`styles/`：页面外壳和样式。
- `src/core/`：规则引擎、记谱、搜索（Worker）、棋局事实、教学对手。
- `src/coach/`：交给军师的事实包、本地军师的句子、和军师服务对话的客户端。
- `src/game/`：对局状态机、任务与取消、存档、导演（决定什么时候讲什么）。
- `src/ui/`：棋盘、特效、音效、诸葛亮和司马懿、对话区、按钮与弹层。
- `src/app.js`、`src/config.js`：装配入口和 `config.json` 的读取。
- `server/`：军师服务（校验、限流、签名、提示词、调用网关）。只在电脑上运行，不会进入 `dist/`。
- `scripts/serve.js`：本地服务器（白名单静态文件 + `/config.json` + `/icons` + `/api`）。
- `scripts/build.js`、`scripts/make-icons.js`：静态构建和图标。
- `tests/unit/`、`tests/slow/`、`tests/e2e/`：单元测试、慢测试、浏览器测试。
- `dev/`：各个界面部件的独立调试页，只在 `npm start`（不带 `--dist`）时能访问，不会进入 `dist/`。
