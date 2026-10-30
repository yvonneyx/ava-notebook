# 开发与运行说明

[返回项目介绍](../README.md) · [目录与依赖边界](architecture.md)

## 开发与构建

需要 Node.js 22.13+。Notebook 只有浏览器 Wasm 版本，使用同一套命令进行开发、构建和预览：

```sh
nvm use
npm ci
npm run dev
npm run build
npm run preview
```

Vite 默认开发地址为 `http://localhost:5173`，构建产物位于 `dist/`。无需启动后端、数据库或配置服务端环境变量。`vercel.json` 使用 `npm run build` 和 `dist`，可从仓库部署；本地构建不会自动发布。

仓库的 `vendor/antv-ava-4.0.0-beta.3.tgz` 固定本次完整 AVA 构建，部署无需访问同级 AVA 目录。Notebook 只导入 `@antv/ava/duckdb-wasm`；AVA 自身的其他引擎保持原样，不进入前端构建。修改 SDK 后更新固定依赖：

```sh
pnpm --dir ../AVA build
(cd ../AVA && pnpm pack --pack-destination ../ava-notebook/vendor)
npm install ./vendor/antv-ava-4.0.0-beta.3.tgz
```

左下角「连接分析模型」填写 OpenAI 兼容的 Chat Completions 地址、模型名称和 API Key。模型设置及 Key 保存在当前浏览器的网站数据中，清除网站数据后需重新配置。模型接口必须允许浏览器跨域调用，HTTPS 页面应使用 HTTPS 模型地址。问题、数据结构和查询结果等上下文会发往用户选择的模型服务。

## 分析策略

输入区可选择 Direct 快速分析或 Loop 深入分析。Direct 按「生成查询 → 执行 → 总结」运行，SQL 失败时自动修正。Loop 按模型返回的动作探索数据、修正方案、执行查询并核验结果，默认最多 12 轮，必要时由 AVA 执行最终查询。两种策略都支持停止；SQL、错误、结果和步骤文本实时保存。

界面按「分析问题 → 查询说明 → SQL 与结果 → 证据局限 → 分析结论 → 后续计划」组织笔记。查询完成后 SQL 默认折叠；运行中或失败的查询展开。每条查询都有独立结果，可切换 Data / Chart，并从详情保存柱状图。图谱展示同一份记录的来源关系。

只接受新版 `context.eventId`、`stepId` 和 `parentStepIds` 事件结构，不解析旧 `context.operationId`、顶层 `id` 或 `parentIds`。步骤编号取自新版 `stepstart/stepend.data.step`，不作为身份标识。不提供暂停、单步、SQL 修改或检查点分支。旧格式记录与旧内置案例不迁移、不自动载入。

### 异步图表

每份非空查询结果调用一次 `ava.visualize({ query, data })`，使用这次分析的模型配置；图表与生成它的查询结果 ID 绑定，步骤、结果和总结的 Chart 视图复用同一配置。图表通常额外调用两次模型（推荐图型、生成配置），同一分析最多同时生成两份，每份 60 秒超时，JSON 配置最多 1 MiB。空结果不发请求；API 判断不适合绘图时保留无图表状态。

分析结论可以先完成，图表继续在后台生成；此时可以开始下一次分析。`Evidence.visualization` 保存状态、图型和配置，不保存 API 返回的 HTML。Chart 按需加载本地 GPT-Vis 并渲染 JSON，组件与 Notebook 的存储和模型配置隔离；不访问图表 CDN。

生成失败仅更新对应图表状态，SQL、数据和结论保留。停止分析会取消未完成图表；删除记录会结束其后台任务。刷新后保留已生成配置，将未完成图表标为中断，不自动重发模型请求。已保存 JSON 的历史记录直接重用；旧记录未保存配置时仍使用原有手动图表视图。

### 事件字段

```ts
const ava = new AVA({ llm, engine: { type: 'duckdb-wasm', bundles } });
ava.on('*', (event) => collect(event));
await ava.analyze(question, {
  strategy: { type: 'loop' }, // 或 direct，由输入区选择
  maxRows: 200,
  maxResultBytes: 1024 * 1024,
});
```

| 用途 | 字段 |
| --- | --- |
| 唯一事件 ID 与配对 | `context.eventId`，同一操作为 `${pairId}:start` / `${pairId}:end` |
| 同一步骤归组，包括查询修正 | `context.stepId` |
| 步骤之间的依赖（可选） | `context.parentStepIds` |
| 步骤开始与结束 | `stepstart` / `stepend`，事件 ID 为 `${stepId}:start` / `${stepId}:end` |
| 步骤编号与最终尝试 | `data.step`、`data.finalAttempt` |
| Loop 动作与模型文本 | `stepend.data.action`、`text`，支持 EXPLORE / REFINE / SQL / CONFIRM |
| 分析问题、重试序号 | `translatestart.data.query`、`attempt` |
| 生成与实际执行的语句 | `translateend.data.dsl`、`querystart.data.dsl` |
| 结果、结构及截断信息 | `queryend.data` |
| 总结引用的查询结果 | `summarizestart.data.queryId`，包含 `:end` 的查询结束事件 ID |
| 查询说明 | `summarizeend.data.queryExplanation` |
| 证据局限（可选） | `summarizeend.data.limitations` |
| 分析结论 | `summarizeend.data.conclusion` |
| 后续计划（可选） | `summarizeend.data.nextStep` |
| Token 用量（可选） | 结束事件的 `data.usage` |
| 失败 | 结束事件的 `data.error` |

事件本身原样保存其 `context`。Notebook 以配对事件的 `pairId` 创建节点，以 `stepId` 归组。步骤事件形成独立步骤节点；Loop 同一步的多条查询分别连接到该步骤，无查询的修正和核验步骤也保留。后续步骤根据 `parentStepIds` 连接前序步骤的所有末端输出。同一步内 Direct 的翻译和查询按执行顺序关联；总结使用 `queryId` 精确连接完整查询结束事件 ID 对应的结果节点。

`analyze()` 返回值用于保存最终结果及完成状态，节点关系和结论文本来自事件。Direct 的结论连接总结节点；Loop 的结论来自最后的 CONFIRM 步骤。若 Loop 在 SQL 步骤后结束，仍展示查询结果并标明未收到核验结论。失败时保留已有 SQL 和数据，不生成完成结论。结构化总结解析失败时，详情保留脱敏响应节选（最多 3000 字符）和结束原因；空响应明确标注。

数据结构、语义和质量信息分别取自 `schema()`、`semantic()`、`profile()` 的返回值。生命周期事件只记录状态。Notebook 不依赖 telemetry、模型 prompt 或控制器来拼接分析记录。

## 数据与运行边界

- CSV：UTF-8、唯一非空表头，最多 10 MB / 100,000 行 / 200 个字段；支持引号、换行和 UTF-8 BOM。CSV 解析及指纹计算在独立 Worker 中进行。
- DuckDB-Wasm：只读 SQL，默认 30 秒查询超时、512 MB 内存限制；结果最多 200 行 / 1 MiB，保留截断标记。Wasm 和 worker 与页面同源托管，首次分析按需下载；单线程版本无需额外的 COOP / COEP 响应头。
- 运行：一个标签页同时执行一个分析。停止会终止分析 Worker；刷新或关闭页面会中断任务。下次打开保留已保存步骤，可重新分析。Wasm 下载及初始化有 60 秒截止时间。
- 持久化：CSV、草稿、分析、图表保存在 `ava-notebook-direct` IndexedDB 版本 1，继续使用原格式。清除浏览器网站数据会清空个人记录。旧服务端 `.ava-notebook/` 数据不会自动迁入浏览器，也不会被删除。
- 多标签页：Web Locks 识别其他页面中的活跃任务，并串行化同一分析的图表保存与删除；BroadcastChannel 分发更新。
- 保存失败：终止任务，页面内存暂留未保存证据供 JSON 导出。导出包含事件、节点和输入输出，可能包含业务数据；密钥不会写入分析记录或导出。

## 销售案例数据

`examples/sales/` 提供 `sales-case.csv`、`sales-semantic.yaml` 和 `sales-question.txt`，包括 1,416 行合成数据、业务口径和问题，供案例生成与回归校验。普通 CSV 上传不会自动套用这份语义。

数据覆盖退款空值、零访问日、月份天数差异、正负贡献抵消，以及广告后经营贡献和净利润的区别。案例文件不预写 SQL 或答案；问题较复杂时，direct 的单次查询可能无法覆盖所有分析要求，应结合返回的证据局限判断结果。

重建案例数据：`node scripts/generate-sales-case.mjs`。会覆盖三个案例文件和测试基准。

### 经典案例回顾

首页预装「销售额高就更赚钱吗」（Direct 快速模式）、「各地区销售额对比」和「2 月业绩下滑归因」（Loop 探索模式）。三个案例均由真实 GLM-5.1 调用与 DuckDB-Wasm 查询执行后录制。`examples/classic/recordings.json` 保存分析响应，以及按请求内容指纹绑定的图表响应；`examples/classic/generated/cases.json` 保存事件、节点、查询结果、结论和图表 JSON。页面打开案例不会调用模型。

离线重新执行 SQL、回放模型响应并核对结论、每次查询的数据和图表：

```sh
node scripts/generate-classic-cases.mjs --check
```

真实重跑三个案例（需要 Node 22、Chrome 和本地 `OPENAI_API_KEY`、`OPENAI_MODEL`、`OPENAI_BASE_URL` 配置）：

```sh
node --env-file-if-exists=.env scripts/generate-classic-cases.mjs --live
```

录制脚本在 Node 进程中认证并使用流式模型传输，浏览器只执行 Wasm 查询；密钥不发送到浏览器或写入记录。临时断连可重试，已经取得的模型响应按输入指纹缓存到终端打印的临时进度文件。中断后可追加 `--resume <进度文件>` 继续；格式不符合 Loop 协议时请求模型重发，而不拼造响应。录制时图表可等待 180 秒，网页交互仍使用 60 秒上限。全部完成后才更新两个正式案例文件。

案例更新后，上一批案例中保存过的个人图表会连同原节点和事件保留到个人历史，首页展示新版本；同批案例已有的修改继续保留。

## 验证

```sh
npm test
npm run test:browser
node scripts/generate-classic-cases.mjs --check
```

默认生产构建、33 项单元测试和 Chrome 33 项浏览器场景已验证。三个内置案例由真实 GLM-5.1 新执行并保存 14 份图表 JSON，离线重放同时核对每次 SQL 数据、结论和图表；交互回归使用本地模拟接口或保存的真实响应。

单元测试覆盖事件配对、步骤依赖、SQL 重试证据、Loop 核验、视图、CSV 校验及浏览器调用边界。原生 DuckDB / HTTP / SQLite 测试已随服务端移除；销售数据与语义会计核对迁到真实 Wasm 浏览器测试。

浏览器测试使用本机 Chrome（Playwright `channel: chrome`），同时验证开发环境中的真实 Wasm 引擎及生产构建的 Notebook。模型由本地模拟服务提供，不消耗真实模型额度。测试覆盖 SQL 只读边界、结果截断与精度、Direct 重试、Loop 核验、图表与图谱、导出、停止、跨标签页保护、刷新恢复、Key 脱敏、跨域失败、查询超时和存储失败。

当前 `npm audit --omit=dev` 仍报告已有的 zod 高危项（[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)，超大受约束集合校验可能耗尽内存），并将其传播标记到固定 AVA 包。此次未升级 zod 主版本；公开上线前需单独评估并处理。

## 浏览器性能与容错验证（2026-10-30）

Chrome 无头浏览器，本地生产预览，CPU 降速 4 倍；模型使用本地模拟接口，不包含真实模型推理和公网延迟。大 CSV 使用真实磁盘文件选择，避免 Playwright 传输大 Buffer 的开销混入页面指标。

| 场景 | 实测 |
| --- | --- |
| 首页可以操作 | 约 0.9–1.4 秒，首页不加载 Wasm 或图表组件 |
| 7.1 MB、100,000 行、10 列 CSV 导入 | 约 0.45–1.1 秒；整段页面最长主线程任务约 71–94 毫秒 |
| 100,000 行分析，连续 5 次 | 多轮采样约 1.1–2.3 秒（点击到完成，包含测试轮询开销及本机负载波动） |
| 5 次分析前后主线程 JS 堆（强制 GC 后） | 4.41 MB → 6.78 MB；不代表 Wasm Worker 的总内存 |
| 300 条历史记录后重新打开 | 约 0.7–0.8 秒 |

CSV 解析移入独立 Worker；分析仍在独立 Worker 内。超宽 CSV 在解析时拒绝，避免数千列预览阻塞页面。Wasm 下载及引擎初始化有 60 秒截止时间；下载失败、缺失 worker 脚本会明确失败，可重新开始。慢网下载中停止不会收到后续完成事件。

Web Locks 将图表保存/删除的完整读改写过程串行化，避免两个标签页互相覆盖；BroadcastChannel 推送跨标签页的分析更新。保存失败仍可导出未保存的页面内证据。异常 run 链接可以回到新建分析，390×844 的页面可以导入文件及配置模型。

复测：`npm run test:browser`。跨浏览器可用 `NOTEBOOK_TEST_BROWSER=webkit` 或 `firefox` 配合 `playwright install`；性能采样用 Chrome CDP。测试不等同于真实低内存手机、公网 CDN 和任意模型服务的性能保证。首次分析仍需下载约 36 MB 的 Wasm 文件（构建统计 gzip 约 8.1 MB）；首次使用的公网等待时间会受网络影响。

跨浏览器限制：本轮 Chrome 完整流程与性能测试通过。匹配测试工具版本的 WebKit 进程在页面打开前被本机系统终止，因此不将 Safari/WebKit 标记为通过。Firefox 的跨域失败通过最小实验定位为 SDK 的自定义 User-Agent 请求头，AVA 已在浏览器请求中移除该多余头；修复后 Direct（含重试、图表、图谱、导出及恢复）、Loop、移动布局和销售语义/会计核对通过。本机复测时曾发生一次创建空白页面阶段的 Firefox 进程崩溃，Loop 单独重跑及最终整轮 4 项测试均通过。仍未覆盖真实手机内存压力。

异步图表追加验证：31 项单元测试和 Chrome 全部 29 项浏览器测试通过，包含逐结果生成、并发排队、分析先结束、继续新分析、跨标签页推送、刷新中断、取消/删除及 JSON 渲染隔离。Firefox 的 Direct 完整流程（包括生成、渲染、导出及恢复）通过；其余 3 项与单独 Loop 复测在打开 Notebook 前受本机 Firefox 子进程启动失败阻断，日志为 `Failed to launch tab subprocess @MachCheckInListener TimedOut`，不将它们计为本轮通过。

三个案例本次刷新结果：地区销售额对比为 3 步 / 2 图，经营下滑归因为 12 步 / 11 图，商品盈利能力为 Direct 1 步 / 1 图。真实模型输出经过源 CSV 的金额/比例/月份分母独立核对；不正确的结论由模型在相同证据上重新确认，保留原始分析过程和最后的更正。
