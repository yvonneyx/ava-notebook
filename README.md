# AVA Notebook

本地运行的 CSV 分析工作台。输入一个问题，AVA 的 `loop` 自动探索数据、执行 SQL、修正计划并验证答案。Notebook 监听 AVA telemetry 事件，将真实过程呈现为分析笔记和证据图谱。

用户无需创建或编排单元格。可在生成的步骤上暂停、编辑 SQL、逐步执行，或从历史检查点创建分支。

## 启动

需要 Node.js 22.13+，以及包含本项目控制与 telemetry 扩展的本地 AVA 构建。两个仓库放在同级目录：

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

打开终端显示的地址，默认是 `http://127.0.0.1:4317`。

在左下角「连接分析模型」填写 OpenAI 兼容的 Chat Completions 地址、模型名称和 API Key。界面提交的密钥仅存于本地服务进程，重启后失效。也可以创建本项目的 `.env`：

```sh
cp .env.example .env
```

填写 `OPENAI_API_KEY`、`OPENAI_MODEL`、`OPENAI_BASE_URL`。不要提交此文件。

生产方式：

```sh
npm run build
npm start
```

`@antv/ava` 是 `file:../AVA` 符号链接。修改 AVA 后重新构建并重启 Notebook；旧构建或不同模型配置的检查点会拒绝恢复，可使用原 CSV 发起新分析。

## 一期能力

- **CSV 导入**：UTF-8、含唯一非空表头，最多 10 MB / 100,000 行。支持带引号的字段、换行和 UTF-8 BOM。导入时校验并保存数据快照。
- **真实 loop**：复用 AVA 的 EXPLORE / REFINE / SQL / CONFIRM 策略，不在 Notebook 重写分析算法。
- **事件取证**：AVA 的 `schemaend`、`profileend`、`loopstep`、`reasonstart/end`、`querystart/end` 驱动证据记录。控制回调仅用于等待、介入和保存恢复状态。
- **Notebook 交互**：自动生成步骤、SQL、表格、结论；详细输入、Token 用量（若可用）和来源按需展开。证据图谱是同一记录的辅助视图。
- **三种证据视图**：步骤和节点详情可切换 SQL / Data / Chart，沿记录中的来源关系关联查询和结果。一轮多查询或结论的多份依据可分别选择；无 SQL、尚未执行、空结果和无数值列都有明确提示。CSV 图表只使用标记过的预览数据。切换视图不执行查询，也不丢失 SQL 编辑草稿。
- **执行控制**：连续分析、查询前暂停、逐步检查、暂停和停止。暂停等待当前操作结束；停止先取消，必要时结束执行进程。
- **SQL 修改**：原稿与人工修改保留在记录中。修改后的实际 SQL 经 AVA 校验执行，并写入后续模型上下文。
- **历史分支**：从具体模型轮次或查询前的检查点重跑，继承此前证据，不混入旧分支的后续结果。
- **恢复与去重**：页面刷新通过 SSE 快照恢复；服务重启将活动任务标为中断，可从节点创建分支继续。执行命令具备请求 ID 去重与目标节点校验。
- **结果图表**：对保存的结果选择分类列和数值列生成柱状图，保留来源引用。展示前 20 行，部分结果有明确标记。
- **证据导出**：导出 JSON，包括事件、节点、输入输出和介入记录；不含 API Key。导出可能包含业务数据和模型上下文，请按其实际内容分享。

示例 `public/sales.csv` 来自 AVA 的测试数据，可以在首页直接载入。

## Telemetry 与控制边界

AVA 扩展为可选能力，默认调用保持原有事件行为：

```ts
const ava = new AVA({ llm, telemetry: true });
ava.on('*', event => collect(event));
await ava.analyze(question, { strategy: { type: 'loop' } });
```

单独开启 telemetry 即可观察 loop，不需要控制器。`loopstep` 提供稳定的步骤标识、阶段和待执行查询；模型开始事件提供实际输入上下文。模型说明属于模型输出，不是独立核验的事实。

节点控制使用 loop 的可选 `control`：

```ts
strategy: {
  type: 'loop',
  control: {
    resumeFrom: savedCheckpoint,
    signal,
    onCheckpoint: persistCheckpoint,
    beforeStep: awaitUserDecision,
  },
}
```

`onCheckpoint` 等待持久化；`beforeStep` 可以等待用户，返回修改的 `sql` 或补充的 `instruction`。控制器不会通过事件监听器拦截或改写 AVA 方法。完成阶段的补充要求应从前面的模型或查询节点分支。

达到轮次上限或最终尝试返回的结果会标记「验证尚未完成」，不会当作经过 CONFIRM 的答案。

## 存储与运行边界

运行数据保存在本项目 `.ava-notebook/`，已加入 Git 忽略。使用任务 JSON、独立检查点和 CSV 快照，原子替换文件；保存失败会停止执行。密钥通过环境或进程内配置提供。分析时数据上下文会发往配置的模型服务。

仅监听本机回环地址，并校验 Host、Origin 与会话 Cookie。首版同时执行一个分析；可以浏览所有历史任务。DuckDB 查询为只读，默认 30 秒查询超时、512 MB 内存限制；单步进程等待上限为 120 秒，暂停期间不计时。

查询结果最多返回 200 行 / 1 MiB，截断标记在记录中保留。需要整体统计时请使用聚合查询。重跑可能因模型或非确定性 SQL 得到不同结果；历史回放使用已保存产物。

当前不支持 Python、远程数据库、多人协作或任意代码内核。图表是基于执行结果的手工映射柱状图，尚未接入自动图表推荐。

## 验证

```sh
npm run build
npm test
```

测试包含 CSV 边界校验、纯事件证据投影，以及真实 AVA / DuckDB 的端到端流程。端到端测试使用临时本地模型服务，覆盖查询修改、单轮多查询断点、命令去重、SSE 更新、历史分支、服务重启恢复和密钥不进入导出。

AVA 仓库另有 loop 控制、telemetry 及既有策略的回归测试。
