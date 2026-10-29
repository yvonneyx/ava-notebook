# 开发与运行说明

[返回项目介绍](../README.md)

## 本地完整版本

需要 Node.js 22.13+，以及同级目录中已构建的 AVA：

```text
Documents/
├── AVA/
└── ava-notebook/
```

```sh
cd ~/Documents/AVA
nvm use 22
npm install
npm run build

cd ../ava-notebook
nvm use
npm install
npm run dev
```

默认地址为 `http://127.0.0.1:4317`。`@antv/ava` 链接到 `../AVA`；修改 AVA 后重新构建并重启 Notebook。

左下角「连接分析模型」支持 OpenAI 兼容的 Chat Completions 地址、模型名称和 API Key。界面提交的密钥只保存在服务进程内，重启后失效。也可以复制 `.env.example` 为 `.env`，填写 `OPENAI_API_KEY`、`OPENAI_MODEL`、`OPENAI_BASE_URL`。不要提交 `.env`。

生产运行：

```sh
npm run build
npm start
```

## 分析策略

输入区可选择 Direct 快速分析或 Loop 深入分析。Direct 按「生成查询 → 执行 → 总结」运行，SQL 失败时自动修正。Loop 按模型返回的动作探索数据、修正方案、执行查询并核验结果，默认最多 12 轮，必要时由 AVA 执行最终查询。两种策略都支持停止；SQL、错误、结果和步骤文本实时保存。

界面按「分析问题 → 查询说明 → SQL 与结果 → 证据局限 → 分析结论 → 后续计划」组织笔记。查询完成后 SQL 默认折叠；运行中或失败的查询展开。每条查询都有独立结果，可切换 Data / Chart，并从详情保存柱状图。图谱展示同一份记录的来源关系。

只接受新版 `context.eventId`、`stepId` 和 `parentStepIds` 事件结构，不解析旧 `context.operationId`、顶层 `id` 或 `parentIds`。步骤编号取自新版 `stepstart/stepend.data.step`，不作为身份标识。不提供暂停、单步、SQL 修改或检查点分支。旧格式记录与旧内置案例不迁移、不自动载入。

### 事件字段

```ts
const ava = new AVA({ llm });
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

- CSV：UTF-8、唯一非空表头，最多 10 MB / 100,000 行；支持引号、换行和 UTF-8 BOM。保存独立快照及指纹。
- DuckDB：只读查询，默认 30 秒查询超时、512 MB 内存限制；结果最多 200 行 / 1 MiB，保留截断标记。
- 运行：同一时间执行一个分析。模型调用不额外设置 Notebook 超时；停止会结束 worker。服务重启将未完成记录标为中断，可用同一 CSV 重新分析。
- 持久化：`.ava-notebook/notebook.sqlite` 的 `direct_runs` 表保存新格式记录，使用事务与 WAL。CSV 和语义快照在同一数据目录中；备份时保留整个目录。旧 `runs` 表、旧 JSON 和检查点不参与加载。
- 刷新恢复：SSE 提供快照和节点更新；创建与停止支持请求 ID 去重。保存失败会结束 worker。
- 访问：仅监听回环地址，校验 Host、Origin 和会话 Cookie。密钥不写入证据导出。
- 导出：JSON 包含事件、节点和输入输出，可能包含业务数据。分析上下文会发往配置的模型服务。

## 销售案例数据

首页「探索销售经营案例」导入 `sales-case.csv`、`sales-semantic.yaml` 和 `sales-question.txt`，提供 1,416 行合成销售数据、业务口径和分析问题。worker 在加载 CSV、结构、语义和质量统计后执行所选策略。普通 CSV 不会自动套用这份语义。

数据覆盖退款空值、零访问日、月份天数差异、正负贡献抵消，以及广告后经营贡献和净利润的区别。案例文件不预写 SQL 或答案；问题较复杂时，direct 的单次查询可能无法覆盖所有分析要求，应结合返回的证据局限判断结果。

重建案例数据：`node scripts/generate-sales-case.mjs`。会覆盖三个案例文件和测试基准。

### 经典案例回顾

首页预装「销售额高就更赚钱吗」（Direct 快速模式）、「各地区销售额对比」和「2 月业绩下滑归因」（Loop 探索模式）。快速案例用一次商品汇总查询比较销售额、利润、利润率及利润占比，SQL 与总结是基于查询结果编写的预设示例，不冒充真实模型调用；其余案例沿用预录模型回应。`data/classic-cases/recordings.json` 保存各案例的策略、回应、输入数据和说明；生成脚本让当前 AVA 实际执行 SQL，`src/data/cases.json` 保存完整新事件、节点和结论。服务首次启动导入尚不存在的案例及其 CSV 快照，重复启动不会覆盖已保存图表；案例与个人历史分开展示。

重新生成案例：`node scripts/generate-classic-cases.mjs`，无需模型密钥。脚本按各案例声明的 Direct 或 Loop 策略执行，全部完成后才更新内置记录。它不读取旧事件或检查点，也不会在用户打开页面时调用模型。

## 静态浏览器版本

```sh
npm run build:static
npm run preview:static -- --host 127.0.0.1 --port 4318
```

产物位于 `dist-static/`，开发使用 `npm run dev:static`。静态版本没有查询引擎，支持 CSV 导入、问题草稿及同一份新版经典案例回顾；不请求 `/api` 或调用模型。浏览器保存的图表覆盖记录保留在 `ava-notebook-direct` IndexedDB，内置案例按需加载。模型设置与密钥只保留在页面内存。

现有线上地址为 https://ava-notebook.vercel.app 。本地构建不会自动发布。发布命令：

```sh
vercel link --cwd dist-static --yes --project ava-notebook --scope yuxins-projects-e2c1f66b
vercel deploy --cwd dist-static --prod --yes --scope yuxins-projects-e2c1f66b
```

## 验证

```sh
npm run build
npm run build:static
npm test
```

测试覆盖新事件配对、步骤依赖、多查询探索、无查询修正、独立步骤状态、SQL 重试、总结引用、Loop 核验与最终尝试、失败、停止、图表和 SQLite 保存。端到端测试运行真实 AVA / DuckDB，使用临时本地模型服务，验证两种策略、SSE、导出、服务重启、语义快照和凭证脱敏，不访问真实模型服务。
