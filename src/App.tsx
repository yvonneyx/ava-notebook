import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  Plus,
  ArrowUp,
  ArrowRight,
  Upload,
  FileSpreadsheet,
  Settings2,
  ChevronDown,
  LoaderCircle,
  Pause,
  Play,
  Square,
  Download,
  GitBranch,
  List,
  Network,
  X,
  Check,
  BookOpen,
  Search,
  ChevronRight,
} from 'lucide-react';
import { api, post } from './api';
import type { Run, Source, Mode, Session, Evidence } from './types';
import { statusLabels, isActive } from './types';
import Notebook from './Notebook';
import Detail from './Detail';
const Graph = lazy(() => import('./Graph'));
const modeOptions = (
  <>
    <option value="auto">连续分析</option>
    <option value="query">查询前暂停</option>
    <option value="step">逐步检查</option>
  </>
);
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [question, setQuestion] = useState('');
  const [mode, setMode] = useState<Mode>('auto');
  const [view, setView] = useState<'notebook' | 'graph'>('notebook');
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(true);
  const [settings, setSettings] = useState(false);
  const [model, setModel] = useState('');
  const [baseURL, setBaseURL] = useState('https://api.openai.com/v1');
  const [key, setKey] = useState('');
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const fileInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  async function refreshRuns() {
    setRuns(await api<Run[]>('/runs'));
  }
  async function openRun(id: string) {
    const next = await api<Run>(`/runs/${id}`);
    setRun(next);
    setSelected('');
    setCollapsed(new Set());
    history.replaceState(null, '', `?run=${id}`);
  }
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void act(async () => {
      const info = await api<Session>('/session');
      setSession(info);
      setModel(info.model);
      setBaseURL(info.baseURL);
      await refreshRuns();
      const id =
        new URLSearchParams(location.search).get('run') || info.activeRunId;
      if (id) await openRun(id);
    });
  }, []);
  useEffect(() => {
    if (settings) dialog.current?.showModal();
    else dialog.current?.close();
  }, [settings]);
  useEffect(() => {
    if (!run?.id) return;
    const id = run.id;
    const events = new EventSource(`/api/runs/${id}/events`);
    events.onopen = () => setConnected(true);
    events.onerror = () => setConnected(false);
    events.addEventListener('snapshot', (event) => {
      const snapshot = JSON.parse((event as MessageEvent).data) as Run;
      setRun((current) => (current?.id === id ? snapshot : current));
    });
    events.addEventListener('update', (event) => {
      const { metadata, nodes } = JSON.parse((event as MessageEvent).data);
      setRun((current) => {
        if (
          !current ||
          current.id !== id ||
          metadata.revision <= current.revision
        )
          return current;
        const merged = new Map(current.nodes.map((node) => [node.id, node]));
        nodes.forEach((node: Evidence) => merged.set(node.id, node));
        return {
          ...current,
          ...metadata,
          nodes: [...merged.values()].sort((a, b) => a.sequence - b.sequence),
        };
      });
      setRuns((current) =>
        current.map((item) =>
          item.id === id ? { ...item, ...metadata } : item,
        ),
      );
    });
    return () => events.close();
  }, [run?.id]);
  async function upload(file: File) {
    const uploaded = await api<Source>('/sources', {
      method: 'POST',
      body: file,
      headers: {
        'Content-Type': 'text/csv',
        'X-Filename': encodeURIComponent(file.name),
      },
    });
    setSource(uploaded);
  }
  const active = isActive(run);
  const node = run?.nodes.find((n) => n.id === selected);
  function selectNode(id: string) {
    setSelected(id);
  }
  async function control(
    command: string,
    decision: { sql?: string; instruction?: string } = {},
    nextMode?: Mode,
  ) {
    if (!run) return;
    const updated = await post<Run>(`/runs/${run.id}/control`, {
      command,
      requestId: crypto.randomUUID(),
      nodeId: run.activeNodeId,
      ...decision,
      ...(nextMode ? { mode: nextMode } : {}),
    });
    setRun((current) =>
      current?.id === updated.id && current.revision > updated.revision
        ? current
        : updated,
    );
  }
  async function forkRun(
    nodeId: string,
    decision: { sql?: string; instruction?: string } = {},
  ) {
    const next = await post<Run>(`/runs/${run!.id}/fork`, {
      nodeId,
      mode: 'query',
      requestId: crypto.randomUUID(),
      ...decision,
    });
    setRun(next);
    setSelected('');
    setCollapsed(new Set());
    history.replaceState(null, '', `?run=${next.id}`);
    await refreshRuns();
  }
  const filtered = runs.filter((item) =>
    `${item.question} ${item.source.name}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            setRun(null);
            setSelected('');
            history.replaceState(null, '', '/');
          }}
        >
          <span className="brand-symbol">A</span>
          <strong>
            ava<span>notebook</span>
          </strong>
          <span className="beta">LOCAL</span>
        </a>
        <button
          className="new-analysis"
          onClick={() => {
            setRun(null);
            setSelected('');
            setError('');
            history.replaceState(null, '', '/');
          }}
        >
          <Plus size={16} />
          新建分析<span>＋</span>
        </button>
        <div className="sidebar-label">
          工作空间 <span>{runs.length}</span>
        </div>
        {runs.length > 4 && (
          <label className="search">
            <Search size={13} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索分析"
            />
          </label>
        )}
        <nav className="history-list" aria-label="分析历史">
          {filtered.map((item) => (
            <button
              key={item.id}
              className={`history-item ${run?.id === item.id ? 'current' : ''}`}
              onClick={() => void act(() => openRun(item.id))}
            >
              <BookOpen size={15} />
              <div>
                <strong>{item.question}</strong>
                <span>
                  {item.source.name} · {statusLabels[item.status]}
                </span>
              </div>
              {isActive(item) && <i className="live-dot" />}
            </button>
          ))}
          {!runs.length && (
            <div className="history-empty">
              分析记录会保存在这里。
              <br />
              随时回来，继续追溯。
            </div>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="live-dot" />
            本地工作空间<span className="mono">v0.1</span>
          </div>
          <button
            className="model-button"
            aria-label="配置分析模型"
            onClick={() => setSettings(true)}
          >
            <span
              className={`connection-dot ${session?.configured ? 'ok' : ''}`}
            />
            <div>
              <strong>
                {session?.configured ? session.model : '连接分析模型'}
              </strong>
              <span>
                {session?.configured ? '模型已配置' : '设置 API Key 与模型'}
              </span>
            </div>
            <Settings2 size={15} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <BookOpen size={15} />
            <span>工作空间</span>
            <ChevronRight size={13} />
            <strong>{run ? '分析记录' : '新建分析'}</strong>
          </div>
          <span className="topbar-note">
            Powered by AVA <span className="mono">loop</span>
          </span>
        </header>
        {error && (
          <div className="global-error" role="alert">
            <span>{error}</span>
            <button
              aria-label="关闭错误提示"
              className="icon-button"
              onClick={() => setError('')}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {!run ? (
          <div className="home">
            <div className="home-content">
              <div className="home-kicker">
                <span className="tiny-mark" /> EVIDENCE, AT EVERY STEP.
              </div>
              <h1>
                让每一步分析，
                <br />
                <span>都有据可循。</span>
              </h1>
              <p className="home-subtitle">
                从一个问题开始。探索数据，检视过程，在需要时介入。
              </p>
              <div className="compose-card">
                <div
                  className={`upload-area ${source ? 'has-source' : ''}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file) void act(() => upload(file));
                  }}
                >
                  <div className="file-icon">
                    <FileSpreadsheet size={23} />
                  </div>
                  <div>
                    <strong>
                      {source ? source.name : '添加你的 CSV 数据'}
                    </strong>
                    <p>
                      {source
                        ? `${source.rows.toLocaleString()} 行 · ${
                            source.headers.length
                          } 个字段 · 已保存快照`
                        : '拖入文件，或从本地选择 · UTF-8 · 最大 10 MB'}
                    </p>
                  </div>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => fileInput.current?.click()}
                  >
                    {source ? '更换' : '选择文件'}
                    <Upload size={13} />
                  </button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".csv,text/csv"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void act(() => upload(file));
                      e.target.value = '';
                    }}
                  />
                </div>
                <textarea
                  className="question-input"
                  aria-label="分析问题"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="你想从数据中了解什么？"
                  maxLength={8000}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter')
                      document.getElementById('start-analysis')?.click();
                  }}
                />
                <div className="compose-footer">
                  <label className="mode-picker">
                    <span className="mode-icon">↳</span>
                    <select
                      aria-label="执行方式"
                      value={mode}
                      onChange={(e) => setMode(e.target.value as Mode)}
                    >
                      {modeOptions}
                    </select>
                    <ChevronDown size={12} />
                  </label>
                  <button
                    id="start-analysis"
                    className="button primary"
                    disabled={busy || !source || !question.trim()}
                    onClick={() => {
                      if (!session?.configured) {
                        setSettings(true);
                        return;
                      }
                      void act(async () => {
                        const next = await post<Run>('/runs', {
                          sourceId: source!.id,
                          question,
                          mode,
                          requestId: crypto.randomUUID(),
                        });
                        setRun(next);
                        setSelected('');
                        history.replaceState(null, '', `?run=${next.id}`);
                        await refreshRuns();
                      });
                    }}
                  >
                    {busy ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : (
                      <ArrowUp size={16} />
                    )}
                    开始分析
                  </button>
                </div>
              </div>
              <div className="sample-row">
                <span>想先试一试？</span>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const response = await fetch('/sales.csv');
                      if (!response.ok) throw new Error('示例文件加载失败');
                      await upload(
                        new File([await response.blob()], 'sales.csv', {
                          type: 'text/csv',
                        }),
                      );
                      setQuestion(
                        '对比 2025 年 1 月和 2 月的销售额，找出对下降贡献最大的产品，并验证结论。',
                      );
                    })
                  }
                >
                  <span className="sample-symbol">↘</span>探索一份销售数据
                  <ArrowRight size={14} />
                </button>
              </div>
              <div className="principles">
                <div>
                  <span>01</span>
                  <strong>自然提问</strong>
                  <p>AVA loop 自动探索与验证</p>
                </div>
                <div>
                  <span>02</span>
                  <strong>过程可见</strong>
                  <p>每条查询都有真实执行依据</p>
                </div>
                <div>
                  <span>03</span>
                  <strong>随时介入</strong>
                  <p>暂停、修改，再继续分析</p>
                </div>
              </div>
              <p className="privacy-note">
                记录保存在本机。分析时，必要的数据上下文会发送给你配置的模型服务。
              </p>
            </div>
          </div>
        ) : (
          <div className="workspace">
            <div className="task-header">
              <div>
                <div className="task-eyebrow">
                  <span className={`status status-${run.status}`}>
                    {statusLabels[run.status]}
                  </span>
                  {run.parentId && (
                    <button
                      className="text-button"
                      onClick={() => void act(() => openRun(run.parentId!))}
                    >
                      <GitBranch size={12} />
                      查看原分支
                    </button>
                  )}
                  <span>{run.source.name}</span>
                </div>
                <h1 title={run.question}>{run.question}</h1>
                <div className="task-meta">
                  <span>{run.nodes.length} 个证据节点</span>
                  <span>
                    {run.nodes.filter((n) => n.kind === 'reason').length} 轮分析
                  </span>
                  <span>{run.model}</span>
                  {!connected && (
                    <span className="amber">连接已断开，正在恢复…</span>
                  )}
                </div>
              </div>
              <a
                className="button secondary export-button"
                href={`/api/runs/${run.id}/export`}
              >
                <Download size={14} />
                导出证据
              </a>
            </div>
            {run.error && (
              <div className="run-error notice error-notice">
                {run.error}
                <button
                  className="text-button"
                  onClick={() => {
                    setSource(run.source);
                    setQuestion(run.question);
                    setRun(null);
                    history.replaceState(null, '', '/');
                  }}
                >
                  使用此数据重新分析 ↗
                </button>
              </div>
            )}
            <div className="workspace-toolbar">
              <div className="segmented">
                <button
                  className={view === 'notebook' ? 'active' : ''}
                  onClick={() => setView('notebook')}
                >
                  <List size={14} />
                  分析笔记
                </button>
                <button
                  className={view === 'graph' ? 'active' : ''}
                  onClick={() => setView('graph')}
                >
                  <Network size={14} />
                  证据图谱
                </button>
              </div>
              <div className="run-controls">
                {active && (
                  <>
                    <select
                      aria-label="运行控制模式"
                      value={run.mode}
                      disabled={busy}
                      onChange={(e) =>
                        void act(() =>
                          control('mode', {}, e.target.value as Mode),
                        )
                      }
                    >
                      {modeOptions}
                    </select>
                    {run.status === 'paused' ? (
                      <button
                        className="button primary small"
                        disabled={busy}
                        onClick={() => void act(() => control('continue'))}
                      >
                        <Play size={13} />
                        继续
                      </button>
                    ) : (
                      <button
                        className="button secondary small"
                        disabled={busy || run.status === 'pausing'}
                        onClick={() => void act(() => control('pause'))}
                      >
                        <Pause size={13} />
                        暂停
                      </button>
                    )}
                    <button
                      className="icon-button stop-button"
                      disabled={busy}
                      title="停止分析"
                      aria-label="停止分析"
                      onClick={() => void act(() => control('stop'))}
                    >
                      <Square size={13} />
                    </button>
                  </>
                )}
                {!active && <span className="muted">执行历史已保存</span>}
              </div>
            </div>
            <div className="work-body">
              <div className="work-canvas">
                {view === 'notebook' ? (
                  <Notebook
                    run={run}
                    busy={busy}
                    selected={selected}
                    onSelect={selectNode}
                    onContinue={(sql) =>
                      void act(() => control('continue', sql ? { sql } : {}))
                    }
                    onFork={(id) => void act(() => forkRun(id))}
                  />
                ) : (
                  <Suspense
                    fallback={
                      <div className="loading">
                        <LoaderCircle className="spin" />
                        加载证据图谱…
                      </div>
                    }
                  >
                    <Graph
                      key={run.id}
                      nodes={run.nodes}
                      selected={selected}
                      onSelect={selectNode}
                      collapsed={collapsed}
                    />
                    {node?.kind === 'reason' && node.step !== undefined && (
                      <button
                        className="graph-collapse button secondary"
                        onClick={() =>
                          setCollapsed((current) => {
                            const next = new Set(current);
                            if (next.has(node.step!)) next.delete(node.step!);
                            else next.add(node.step!);
                            return next;
                          })
                        }
                      >
                        {collapsed.has(node.step)
                          ? '展开本轮查询'
                          : '折叠本轮查询'}
                      </button>
                    )}
                  </Suspense>
                )}
              </div>
              {node && (
                <Detail
                  key={`${run.id}-${node.id}`}
                  node={node}
                  run={run}
                  busy={busy}
                  onClose={() => setSelected('')}
                  onSelect={selectNode}
                  onContinue={(decision, nextMode) =>
                    void act(() => control('continue', decision, nextMode))
                  }
                  onFork={(id, decision) =>
                    void act(() => forkRun(id, decision))
                  }
                  onChart={(nodeId, x, y) =>
                    void act(async () => {
                      const next = await post<Run>(`/runs/${run.id}/charts`, {
                        nodeId,
                        x,
                        y,
                      });
                      setRun((current) =>
                        current?.id === next.id &&
                        current.revision > next.revision
                          ? current
                          : next,
                      );
                      setSelected(next.nodes.at(-1)!.id);
                    })
                  }
                />
              )}
            </div>
          </div>
        )}
      </main>
      <dialog
        ref={dialog}
        className="settings-dialog"
        onCancel={() => setSettings(false)}
        onClick={(e) => {
          if (e.target === dialog.current) setSettings(false);
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              const info = await post<Session>('/settings', {
                model,
                baseURL,
                ...(key ? { apiKey: key } : {}),
              });
              setSession((current) => ({ ...current!, ...info }));
              setKey('');
              setSettings(false);
            });
          }}
        >
          <div className="modal-header">
            <div>
              <span className="eyebrow">MODEL CONNECTION</span>
              <h2>连接分析模型</h2>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="关闭模型设置"
              onClick={() => setSettings(false)}
            >
              <X size={17} />
            </button>
          </div>
          <p className="muted">支持 OpenAI 兼容的 Chat Completions 接口。</p>
          {error && <div className="notice error-notice">{error}</div>}
          <label className="field">
            API 地址
            <input
              required
              type="url"
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
            />
          </label>
          <label className="field">
            模型名称
            <input
              required
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="填写服务商提供的模型名称"
            />
          </label>
          <label className="field">
            API Key
            <input
              type="password"
              autoComplete="off"
              required={!session?.configured}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={
                session?.configured
                  ? '已配置，留空保持当前密钥'
                  : '输入 API Key'
              }
            />
          </label>
          <div className="notice">
            密钥仅保存在本地服务进程中，重启后需重新输入。也可通过项目的 .env
            文件配置。
          </div>
          <button className="button primary full" disabled={busy} type="submit">
            {busy ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Check size={15} />
            )}
            保存配置
          </button>
        </form>
      </dialog>
    </div>
  );
}
