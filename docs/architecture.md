# 目录与依赖边界

[项目介绍](../README.md) · [开发与运行说明](development.md)

保持一个 npm 项目和两种运行模式，按页面、业务功能和运行环境划分职责。

```text
src/
├── main.tsx                  # 浏览器入口和全局样式
├── app/                      # 应用装配、页面切换、外壳和全局错误
├── pages/
│   ├── home/                 # 首页、经典案例、背景动效
│   └── analysis/             # 分析页、工具栏、记录状态和实时订阅
├── features/
│   ├── composer/             # CSV 输入、问题、策略和草稿
│   ├── notebook/             # 分析笔记、步骤归组
│   ├── graph/                # 证据图谱和布局
│   ├── evidence/             # 证据详情、数据和图表视图
│   ├── history/              # 历史列表、搜索和删除
│   └── settings/             # 模型配置和会话状态
├── domain/                   # 证据关系、状态和增量合并的纯函数
├── runtime/                  # 统一调用入口、本地 HTTP/SSE、静态模式、IndexedDB
├── ui/                       # 数据表、柱状图、Markdown、SQL、状态标签
└── styles/                   # 全局变量、基础样式、布局和转场
shared/
└── contracts.ts              # Source、Run、Evidence、Session 数据类型
server/
├── index.mjs                 # 端口、启动和退出信号
├── app.mjs                   # Fastify 装配及资源生命周期
├── http/                     # 安全边界、路由、SSE 和前端托管
├── analysis/                 # 任务调度、worker 和 AVA 事件投影
├── storage/                  # 文件工具、CSV 快照、SQLite 记录
└── examples/                 # 经典案例初始化和销售案例导入
examples/
├── sales/                    # 销售 CSV、业务语义和问题
└── classic/
    ├── recordings.json       # 预录响应和数据入口
    ├── datasets/             # 案例输入 CSV
    ├── generated/cases.json  # 由当前 AVA 生成的内置分析记录
    └── snapshots/            # 保留的历史素材，不参与运行时加载
tests/
├── frontend/                # 视图、布局、CSV 解析和运行环境边界
├── server/                  # 事件、任务、存储、案例
├── integration/             # HTTP、SSE、真实 AVA / DuckDB 和重启恢复
└── fixtures/                # 测试事件和数据基准
scripts/                     # 案例生成脚本
docs/                        # 架构、开发和素材说明
```

功能样式放在对应页面或功能目录中，由 `src/styles/index.css` 统一引入，保留原有全局类名。图谱组件、静态 CSV 解析器和内置案例数据仍按需加载。

## 调用方向

- `app` 负责组合页面和功能，保存跨页面的输入草稿及会话状态。
- `pages` 组合 `features`；展示组件使用 `ui`，业务计算使用 `domain`。
- 网络、事件流和浏览器存储通过 `runtime/client.ts` 进入；`remote.ts` 管理 HTTP/SSE，`static.ts` 实现静态能力，`indexed-db.ts` 管理本地持久化。
- `domain` 只依赖共享类型，不依赖 React、DOM、网络或服务端模块。
- 服务端由 `app.mjs` 装配：HTTP 层负责请求校验和协议，analysis 层负责执行与事件，storage 层负责持久化。浏览器不导入服务端模块。
- `shared/contracts.ts` 描述现有数据格式；服务端仍使用 JavaScript 和现有请求校验，不引入新的运行时 schema。

## 保持兼容的边界

这次重组不改变 API 路径、SSE 事件、证据导出结构或分析策略。完整版本仍执行 Direct / Loop；静态版本仍提供 CSV 导入、草稿、案例、图表保存与导出，不执行模型查询。

持久化位置保持 `.ava-notebook/`，SQLite 仍使用 `direct_runs` 表。浏览器继续使用 `ava-notebook-direct` 数据库及版本 1，不清空用户草稿或图表。案例 ID 和生成内容保持不变，服务启动仍只导入缺失案例。

日常验证命令见[开发说明](development.md#验证)。迁移目录时同时更新生成脚本、案例数据入口和测试路径；不通过重新生成案例来掩盖文件移动造成的差异。
