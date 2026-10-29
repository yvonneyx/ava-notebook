import {
  lazy,
  Suspense,
  ViewTransition,
  startTransition,
  addTransitionType,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Plus,
  ArrowUp,
  ArrowDown,
  PanelLeft,
  Database,
  ShieldCheck,
  ArrowRight,
  Paperclip,
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
  NotebookPen,
  Feather,
  Table2,
} from 'lucide-react';
import { api, post } from './api';
import type { Run, Source, Mode, Session, Evidence } from './types';
import { statusLabels, isActive } from './types';
import Notebook from './Notebook';
import Detail from './Detail';
import { DataTable } from './DataViews';
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [drafts, setDrafts] = useState<
    Record<string, { sql?: string; instruction?: string }>
  >({});
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const fileInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  useEffect(() => {
    const width = matchMedia('(max-width: 800px)');
    const close = () => {
      if (!width.matches) setSidebarOpen(false);
    };
    width.addEventListener('change', close);
    return () => width.removeEventListener('change', close);
  }, []);
  useEffect(() => {
    if (sidebarOpen)
      sidebar.current?.querySelector<HTMLAnchorElement>('a')?.focus();
  }, [sidebarOpen]);
  async function refreshRuns() {
    setRuns(await api<Run[]>('/runs'));
  }
  async function openRun(id: string) {
    const next = await api<Run>(`/runs/${id}`);
    startTransition(() => {
      addTransitionType(run ? 'switch-run' : 'nav-forward');
      setRun(next);
      setDrafts({});
      setView('notebook');
      setSidebarOpen(false);
      setSelected('');
      setCollapsed(new Set());
    });
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
    startTransition(() => setSource(uploaded));
  }
  function newAnalysis() {
    startTransition(() => {
      addTransitionType('nav-back');
      setRun(null);
      setSource(null);
      setQuestion('');
      setSelected('');
      setDrafts({});
      setSidebarOpen(false);
      setView('notebook');
      setError('');
      history.replaceState(null, '', '/');
    });
  }
  function editNode(id: string, value: { sql?: string; instruction?: string }) {
    setDrafts((current) => ({
      ...current,
      [id]: { ...current[id], ...value },
    }));
  }
  function decisionFor(
    id: string,
    value: { sql?: string; instruction?: string } = {},
  ) {
    const draft = { ...drafts[id], ...value };
    return {
      ...(draft.sql !== undefined ? { sql: draft.sql } : {}),
      ...(draft.instruction?.trim()
        ? { instruction: draft.instruction.trim() }
        : {}),
    };
  }
  function jumpToStep(id: string) {
    setView('notebook');
    setSelected('');
    requestAnimationFrame(() =>
      document
        .getElementById(`step-${id}`)
        ?.scrollIntoView({ block: 'center' }),
    );
  }
  const active = isActive(run);
  const node = run?.nodes.find((n) => n.id === selected);
  function selectNode(id: string) {
    startTransition(() => setSelected(id));
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
      ...(command === 'continue'
        ? decisionFor(run.activeNodeId || '', decision)
        : decision),
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
      ...decisionFor(nodeId, decision),
    });
    startTransition(() => {
      addTransitionType('switch-run');
      setRun(next);
      setDrafts({});
      setView('notebook');
      setSidebarOpen(false);
      setSelected('');
      setCollapsed(new Set());
    });
    history.replaceState(null, '', `?run=${next.id}`);
    await refreshRuns();
  }
  const filtered = runs.filter((item) =>
    `${item.question} ${item.source.name}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div
      className={`app-shell ${sidebarOpen ? 'sidebar-open' : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setSidebarOpen(false);
      }}
    >
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="关闭侧边栏"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        className="sidebar"
        ref={sidebar}
        style={{ viewTransitionName: 'persistent-sidebar' }}
      >
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            newAnalysis();
          }}
        >
          <span className="brand-symbol">
            <NotebookPen size={20} strokeWidth={1.8} />
          </span>
          <strong>
            ava<span>notebook</span>
          </strong>
        </a>
        <button
          aria-label="新建分析"
          className="new-analysis"
          onClick={() => {
            newAnalysis();
          }}
        >
          <Plus size={16} />
          <span>新建分析</span>
          <ArrowUp size={14} className="new-analysis-arrow" />
        </button>
        <div className="sidebar-label">
          最近分析 <span>{runs.length}</span>
        </div>
        {runs.length > 4 && (
          <label className="search">
            <Search size={13} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索分析"
              aria-label="搜索分析"
            />
          </label>
        )}
        <nav className="history-list" aria-label="分析历史">
          {filtered.map((item) => (
            <button
              key={item.id}
              title={item.question}
              aria-current={run?.id === item.id ? 'page' : undefined}
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
          {!runs.length && <div className="history-empty">暂无分析记录</div>}
        </nav>
        <div className="sidebar-bottom">
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
                {session?.configured ? '模型设置' : '配置模型后开始分析'}
              </span>
            </div>
            <Settings2 size={15} />
          </button>
        </div>
      </aside>
      <main className="main" inert={sidebarOpen}>
        <header
          className="topbar"
          style={{ viewTransitionName: 'persistent-topbar' }}
        >
          <div>
            <button
              className="icon-button sidebar-toggle"
              aria-label="展开侧边栏"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <PanelLeft size={18} />
            </button>
            <BookOpen size={15} className="workspace-icon" />
            <span>我的工作空间</span>
            <ChevronRight size={13} />
            <strong>{run ? '分析记录' : '新建分析'}</strong>
          </div>
          <span className="topbar-note">
            <span className="connection-dot ok" /> 本地运行
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
        <ViewTransition
          key={run?.id || 'home'}
          default="none"
          enter={{
            'nav-forward': 'nav-forward',
            'nav-back': 'nav-back',
            default: 'fade-in',
          }}
          exit={{
            'nav-forward': 'nav-forward',
            'nav-back': 'nav-back',
            default: 'fade-out',
          }}
        >
          {!run ? (
            <div className="home">
              <div className="home-content">
                <div className="home-heading">
                  <div>
                    <span className="page-kicker">
                      <Feather size={14} /> 留一点空间，给新的发现
                    </span>
                    <h1>今天，想探索什么？</h1>
                  </div>
                  <div className="notebook-emblem" aria-hidden="true">
                    <span className="emblem-sheet">
                      <Table2 size={23} strokeWidth={1.4} />
                    </span>
                    <span className="emblem-cover">
                      <NotebookPen size={29} strokeWidth={1.5} />
                    </span>
                    <span className="emblem-check">
                      <Check size={13} strokeWidth={2.5} />
                    </span>
                  </div>
                </div>
                <section
                  className={`compose-card ${dragging ? 'dragging' : ''}`}
                  aria-label="分析输入区"
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes('Files')) return;
                    e.preventDefault();
                    if (!busy) setDragging(true);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node))
                      setDragging(false);
                  }}
                  onDrop={(e) => {
                    const file = e.dataTransfer.files[0];
                    if (!file) return;
                    e.preventDefault();
                    setDragging(false);
                    if (!busy) void act(() => upload(file));
                  }}
                >
                  <textarea
                    className="question-input"
                    aria-label="分析问题"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="例如：销售额为什么下降？主要受哪些产品影响？"
                    maxLength={8000}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter')
                        document.getElementById('start-analysis')?.click();
                    }}
                  />
                  <ViewTransition default="none" update="morph">
                    <div className="composer-attachments">
                      {source && (
                        <>
                          <div className="source-attachment">
                            <div className="file-icon">
                              <FileSpreadsheet size={20} strokeWidth={1.6} />
                            </div>
                            <div className="file-info">
                              <strong title={source.name}>{source.name}</strong>
                              <p>
                                {source.rows.toLocaleString()} 行 ·{' '}
                                {source.headers.length} 个字段 ·{' '}
                                {(source.bytes / 1024).toFixed(1)} KB
                              </p>
                            </div>
                            <button
                              className="icon-button"
                              aria-label={`移除文件 ${source.name}`}
                              title="移除文件"
                              disabled={busy}
                              onClick={() => setSource(null)}
                            >
                              <X size={14} />
                            </button>
                          </div>
                          <details className="source-preview" key={source.id}>
                            <summary>
                              预览数据
                              <span>
                                {source.headers.slice(0, 4).join(' · ')}
                                {source.headers.length > 4 ? ' …' : ''}
                              </span>
                            </summary>
                            <DataTable rows={source.preview} />
                          </details>
                        </>
                      )}
                    </div>
                  </ViewTransition>
                  <div className="compose-footer">
                    <button
                      className="composer-upload"
                      disabled={busy}
                      title="上传 CSV · 最大 10 MB"
                      onClick={() => fileInput.current?.click()}
                    >
                      <Paperclip size={15} />
                      {source ? '更换 CSV' : '上传 CSV'}
                    </button>
                    <input
                      ref={fileInput}
                      type="file"
                      accept=".csv,text/csv"
                      disabled={busy}
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file && !busy) void act(() => upload(file));
                        e.target.value = '';
                      }}
                    />
                    <div className="compose-options">
                      <button
                        className="composer-model"
                        onClick={() => setSettings(true)}
                      >
                        <span
                          className={`connection-dot ${
                            session?.configured ? 'ok' : ''
                          }`}
                        />
                        <span>
                          {session?.configured ? session.model : '配置模型'}
                        </span>
                        <ChevronDown size={12} />
                      </button>
                      <span className="option-divider" />
                      <label className="mode-picker">
                        <select
                          aria-label="执行方式"
                          value={mode}
                          onChange={(e) => setMode(e.target.value as Mode)}
                        >
                          {modeOptions}
                        </select>
                        <ChevronDown size={12} />
                      </label>
                    </div>
                    <button
                      id="start-analysis"
                      aria-label="开始分析"
                      aria-keyshortcuts="Meta+Enter Control+Enter"
                      title="开始分析（⌘ / Ctrl + Enter）"
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
                          startTransition(() => {
                            addTransitionType('nav-forward');
                            setRun(next);
                            setDrafts({});
                            setView('notebook');
                            setSelected('');
                          });
                          history.replaceState(null, '', `?run=${next.id}`);
                          await refreshRuns();
                        });
                      }}
                    >
                      {busy ? (
                        <LoaderCircle size={15} className="spin" />
                      ) : null}
                      <span className="start-label">开始分析</span>
                      {!busy && <ArrowUp size={16} />}
                    </button>
                  </div>

                  {dragging && (
                    <div className="composer-drop-hint" role="status">
                      <FileSpreadsheet size={20} /> 松开以添加 CSV
                    </div>
                  )}
                </section>
                {!source && (
                  <button
                    className="sample-button"
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
                          '对比 2025 年 1 月和 2 月的销售额，找出下降最多的产品。',
                        );
                      })
                    }
                  >
                    <Database size={14} />
                    使用销售示例数据
                    <ArrowRight size={14} />
                  </button>
                )}
                <p className="privacy-note">
                  <ShieldCheck size={13} />
                  记录保存在本机，分析上下文发送至所选模型。
                </p>
                {runs.length > 0 && (
                  <section className="recent-section">
                    <div className="recent-heading">
                      <h2>最近分析</h2>
                      <span>{runs.length} 份记录</span>
                    </div>
                    <div className="recent-grid">
                      {runs.slice(0, 3).map((item) => (
                        <button
                          key={item.id}
                          className="recent-item"
                          onClick={() => void act(() => openRun(item.id))}
                        >
                          <span className="recent-icon">
                            <BookOpen size={17} />
                          </span>
                          <span className="recent-title">
                            <ViewTransition
                              name={`run-title-${item.id}`}
                              share="text-morph"
                              default="none"
                            >
                              <strong>{item.question}</strong>
                            </ViewTransition>
                            <small>{item.source.name}</small>
                          </span>
                          <span className={`status status-${item.status}`}>
                            {statusLabels[item.status]}
                          </span>
                          <ArrowRight size={15} />
                        </button>
                      ))}
                    </div>
                  </section>
                )}
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
                    <span className="task-source">
                      <FileSpreadsheet size={13} />
                      {run.source.name}
                    </span>
                  </div>
                  <ViewTransition
                    name={`run-title-${run.id}`}
                    share="text-morph"
                    default="none"
                  >
                    <h1 title={run.question}>{run.question}</h1>
                  </ViewTransition>
                  <div className="task-meta">
                    <span>{run.nodes.length} 个步骤</span>
                    <span>
                      {run.nodes.filter((n) => n.kind === 'reason').length}{' '}
                      轮分析
                    </span>
                    <span>{run.model}</span>
                    {!connected && (
                      <span className="amber">连接已断开，正在恢复…</span>
                    )}
                  </div>
                </div>
                <a
                  aria-label="导出证据"
                  className="button secondary export-button"
                  href={`/api/runs/${run.id}/export`}
                >
                  <Download size={14} />
                  导出
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
                <div className="segmented" data-view={view}>
                  <span className="segment-indicator" aria-hidden="true" />
                  <button
                    aria-pressed={view === 'notebook'}
                    className={view === 'notebook' ? 'active' : ''}
                    onClick={() => startTransition(() => setView('notebook'))}
                  >
                    <List size={14} />
                    Notebook
                  </button>
                  <button
                    aria-pressed={view === 'graph'}
                    className={view === 'graph' ? 'active' : ''}
                    onClick={() => startTransition(() => setView('graph'))}
                  >
                    <Network size={14} />
                    图谱
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
                          disabled={
                            busy ||
                            drafts[run.activeNodeId || '']?.sql?.trim() === ''
                          }
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
                  {run.nodes.some((n) => n.id === 'conclusion') && !active ? (
                    <button
                      className="text-button jump-button"
                      onClick={() => jumpToStep('conclusion')}
                    >
                      查看结论
                      <ArrowDown size={14} />
                    </button>
                  ) : (
                    run.activeNodeId && (
                      <button
                        className="icon-button"
                        title="定位当前步骤"
                        aria-label="定位当前步骤"
                        onClick={() => jumpToStep(run.activeNodeId!)}
                      >
                        <ArrowDown size={15} />
                      </button>
                    )
                  )}
                </div>
              </div>
              <div className="work-body">
                <div className="work-canvas">
                  <ViewTransition
                    key={view}
                    default="none"
                    enter="fade-in"
                    exit="fade-out"
                  >
                    {view === 'notebook' ? (
                      <Notebook
                        key={run.id}
                        run={run}
                        drafts={drafts}
                        onEdit={editNode}
                        busy={busy}
                        selected={selected}
                        onSelect={selectNode}
                        onContinue={(sql) =>
                          void act(() =>
                            control('continue', sql ? { sql } : {}),
                          )
                        }
                        onFork={(id) => void act(() => forkRun(id))}
                      />
                    ) : (
                      <ViewTransition default="none" update="morph">
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
                          {node?.kind === 'reason' &&
                            node.step !== undefined && (
                              <button
                                className="graph-collapse button secondary"
                                onClick={() =>
                                  setCollapsed((current) => {
                                    const next = new Set(current);
                                    if (next.has(node.step!))
                                      next.delete(node.step!);
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
                      </ViewTransition>
                    )}
                  </ViewTransition>
                </div>
                {node && (
                  <ViewTransition
                    default="none"
                    enter="slide-from-right"
                    exit="slide-to-right"
                  >
                    <Detail
                      key={`${run.id}-${node.id}`}
                      node={node}
                      draft={drafts[node.id] || {}}
                      onEdit={(value) => editNode(node.id, value)}
                      run={run}
                      busy={busy}
                      onClose={() => startTransition(() => setSelected(''))}
                      onSelect={selectNode}
                      onContinue={(decision, nextMode) =>
                        void act(() => control('continue', decision, nextMode))
                      }
                      onFork={(id, decision) =>
                        void act(() => forkRun(id, decision))
                      }
                      onChart={(nodeId, x, y) =>
                        void act(async () => {
                          const next = await post<Run>(
                            `/runs/${run.id}/charts`,
                            {
                              nodeId,
                              x,
                              y,
                            },
                          );
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
                  </ViewTransition>
                )}
              </div>
            </div>
          )}
        </ViewTransition>
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
              <h2>模型设置</h2>
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
          <div className="notice">本次配置仅在当前服务运行期间生效。</div>
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
