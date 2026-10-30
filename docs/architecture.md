# 目录与依赖边界

[项目介绍](../README.md) · [开发与运行说明](development.md)

Notebook 是单个 Vite / React 项目，只有浏览器 Wasm 运行方式。`npm run build` 输出 `dist/`，开发、预览和 Vercel 部署使用相同代码。

```text
src/
├── main.tsx                  # 浏览器入口和全局样式
├── app/                      # 应用装配、页面切换和全局错误
├── pages/                    # 首页、分析页及实时订阅
├── features/                 # 输入、笔记、图谱、证据、历史和模型配置
├── domain/                   # 证据关系、状态与增量合并的纯函数
├── runtime/                  # 浏览器调用入口、Worker、IndexedDB
├── ui/                       # 数据表、图表、Markdown、SQL、状态
└── styles/                   # 全局变量、布局和转场
shared/
├── contracts.ts              # Source、Run、Evidence、Session 类型
└── evidence.mjs              # AVA 事件到笔记和图谱节点的投影
examples/
├── sales/                    # 合成销售数据、语义和问题
└── classic/                  # 预录响应、输入 CSV 和内置分析记录
tests/
├── frontend/                 # 视图、布局、CSV 和浏览器调用边界
├── domain/                   # 事件投影、内置案例与结果核对
├── browser/                  # 真实 Wasm、生产页面、性能与容错
└── fixtures/                 # 测试事件和数据基准
scripts/                      # 案例生成
vendor/                       # 固定的完整 AVA npm 包
```

`app` 组合页面和业务功能，`pages` 组合 `features`，展示组件使用 `ui`，业务计算使用 `domain`。功能样式仍由 `src/styles/index.css` 统一引入，图谱和内置案例按需加载。

`runtime/client.ts` 提供统一入口；`browser.ts` 实现浏览器操作，`browser-jobs.ts` 调度任务、写入 IndexedDB 并分发更新。操作路径仅用于内部调用，不发送 Notebook HTTP 请求，也不建立 SSE 连接。`csv.worker.ts` 完成 CSV 校验、解析和指纹计算，主页面只接收元信息及 5 行预览。

`analysis.worker.ts` 只导入 `@antv/ava/duckdb-wasm`。保留完整 AVA 依赖，由 Vite 打包实际使用的 Wasm 入口；Notebook 不启动 Node 引擎或后端。同级 AVA 项目自身的其他引擎不受影响。Wasm 和 DuckDB worker 随应用同源发布；每条查询默认 30 秒超时，停止会终止整个分析 Worker。

`shared/evidence.mjs` 消费新版 AVA 事件，同一投影供实际分析、经典案例生成及回归测试使用。导出格式、案例 ID、IndexedDB 名称及版本保持不变。旧服务端数据不自动迁入浏览器，也不会被删除。

Web Locks 标识仍在其他标签页运行的任务，刷新仅将失去锁的任务标为中断。独立锁串行化同一分析的图表保存与删除；BroadcastChannel 推送更新。保存失败时结束任务，页面内存暂留未保存证据供导出。模型配置和 Key 保存在浏览器网站数据中。

日常验证与限制见[开发说明](development.md#验证)。

图表生成从每次成功且非空的 `queryend` 启动，独立 AVA 实例调用 visualize，避免图表事件混入分析步骤。分析完成后释放分析占用状态，Worker 等待图表完成再退出；任务锁仍保护对应记录，防止其他标签页把后台图表误判为中断。生成结果写入原结果节点的 `visualization` 字段，不复制其他步骤的数据。

Chart 视图从 `EvidenceDataset.result` 获取配置，按需加载 `GeneratedChart`。GPT-Vis UMD 资源随页面同源发布，在沙箱 iframe 内只读取 JSON；不使用模型生成的 HTML，iframe 不访问父页面存储或网络服务。旧的手动图表节点保持兼容。

案例录制与交互分析共用 `runtime/visualizations.ts` 的异步生成队列。新版案例通过生成时间区分批次；旧批次的浏览器修改副本用同一个 IndexedDB 事务转存为个人历史，保留原节点、事件与图表，再显示新的内置案例。
