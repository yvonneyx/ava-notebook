# AVA Notebook

**用一句话分析 CSV，在 Notebook 中看清每一步。**

基于 [AVA](https://github.com/antvis/ava) 的数据分析工作台。上传 CSV，用自然语言提问，AVA 自动探索数据、执行 SQL，Notebook 将过程整理成可回看的分析笔记。

[在线体验](https://ava-notebook.vercel.app) · 本地支持 Direct 快速分析和 Loop 深入分析；静态版本支持 CSV 导入和问题草稿，尚未接入查询执行。

## 在笔记中查看分析过程

从分析步骤到 SQL、数据、图表和结论，在一份笔记中查看完整过程。支持查询失败自动修正、证据局限展示、停止执行和 JSON 导出。

首页提供「销售额高就更赚钱吗」快速模式案例，以及「各地区销售额对比」「2 月业绩下滑归因」探索模式案例。案例使用预录或预设回应和实际执行的 SQL 生成新版 AVA 事件，可直接回顾单次查询与多轮分析过程。

![AVA Notebook 分析笔记](https://mdn.alipayobjects.com/huamei_aphk1k/afts/img/A*NypWQongLZkAAAAAU0AAAAgAegfkAQ/original)

## 在图谱中追溯结论的依据

图谱把数据源、分析步骤、SQL、查询结果和结论连接起来，方便检查每个结论来自哪里。

![AVA Notebook 证据图谱](https://mdn.alipayobjects.com/huamei_aphk1k/afts/img/A*JoFyTKR_RKkAAAAATOAAAAgAegfkAQ/original)

两种策略统一消费新版 AVA 事件，展示步骤、查询、结果和依赖。旧格式记录不迁移，不提供暂停与检查点分支。[开发与运行说明](docs/development.md) · [目录与依赖边界](docs/architecture.md)。
