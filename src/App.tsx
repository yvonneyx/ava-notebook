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
  ArrowRight,
  Paperclip,
  FileSpreadsheet,
  Settings2,
  ChevronDown,
  LoaderCircle,
  Square,
  Download,
  Network,
  X,
  Check,
  BookOpen,
  Search,
  ChevronRight,
  NotebookPen,
  Trash2,
} from 'lucide-react';
import { api, post, browserMode } from './api';
import { readLocal, writeLocal } from './browser-store';
import type { Run, Source, Session, Evidence } from './types';
import { isActive } from './types';
import StatusIcon from './StatusIcon';
import Notebook from './Notebook';
import Detail from './Detail';
import { DataTable } from './DataViews';
const Graph = lazy(() => import('./Graph'));
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [question, setQuestion] = useState('');
  const [strategy, setStrategy] = useState<Run['strategy']>('direct');
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
  const [composerReady, setComposerReady] = useState(false);
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
      setView('notebook');
      setSidebarOpen(false);
      setSelected('');
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
      if (browserMode) {
        const composer = await readLocal<{
          source: Source | null;
          question: string;
          strategy: Run['strategy'];
        }>('drafts', 'composer');
        if (composer) {
          setSource(composer.source);
          setQuestion(composer.question);
          if (composer.strategy) setStrategy(composer.strategy);
        }
        setComposerReady(true);
      }
      const id =
        new URLSearchParams(location.search).get('run') || info.activeRunId;
      if (id) await openRun(id);
    });
  }, []);
  useEffect(() => {
    if (browserMode && composerReady)
      void writeLocal('drafts', 'composer', {
        source,
        question,
        strategy,
      }).catch((error) => setError(error.message));
  }, [source, question, strategy, composerReady]);
  useEffect(() => {
    if (settings) dialog.current?.showModal();
    else dialog.current?.close();
  }, [settings]);
  useEffect(() => {
    if (browserMode || !run?.id) return;
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
      setSidebarOpen(false);
      setView('notebook');
      setError('');
      history.replaceState(null, '', '/');
    });
  }
  async function deleteRun(id: string) {
    await api(`/runs/${id}`, { method: 'DELETE' });
    setRuns((current) => current.filter((item) => item.id !== id));
    if (new URLSearchParams(location.search).get('run') === id) newAnalysis();
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
  async function stopRun() {
    if (!run) return;
    const updated = await post<Run>(`/runs/${run.id}/control`, {
      command: 'stop',
      requestId: crypto.randomUUID(),
    });
    setRun((current) =>
      current?.id === updated.id && current.revision > updated.revision
        ? current
        : updated,
    );
  }
  const classicCases = runs.filter(
    (item) => item.caseStudy && item.status === 'completed',
  );
  const historyRuns = runs.filter((item) => !item.caseStudy);
  const filtered = historyRuns.filter((item) =>
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
          最近分析 <span>{historyRuns.length}</span>
        </div>
        {(historyRuns.length > 4 || search.length > 0) && (
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
            <div
              key={item.id}
              className={`history-item ${run?.id === item.id ? 'current' : ''}`}
            >
              <button
                className="history-open"
                title={item.question}
                aria-current={run?.id === item.id ? 'page' : undefined}
                disabled={busy}
                onClick={() => void act(() => openRun(item.id))}
              >
                <strong>{item.question}</strong>
              </button>
              <button
                className="history-delete"
                title={isActive(item) ? '停止并删除分析' : '删除分析'}
                aria-label={`${isActive(item) ? '停止并删除分析' : '删除分析'}：${item.question}`}
                disabled={busy}
                onClick={() => void act(() => deleteRun(item.id))}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {!historyRuns.length && (
            <div className="history-empty">暂无分析记录</div>
          )}
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
      <main
        className={`main ${run ? 'analysis-page' : 'home-page'}`}
        inert={sidebarOpen}
      >
        <header
          className="topbar"
          style={{ viewTransitionName: 'persistent-topbar' }}
        >
          <div className="header-location">
            <button
              className="icon-button sidebar-toggle"
              aria-label="展开侧边栏"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <PanelLeft size={18} />
            </button>
            <span className="header-context">
              <BookOpen size={15} className="workspace-icon" />
              <span>我的工作空间</span>
              <ChevronRight size={13} />
              {run && (
                <>
                  <span>分析笔记</span>
                  <ChevronRight size={13} />
                </>
              )}
            </span>
            <strong
              className="header-title"
              title={
                run
                  ? `${run.source.name.replace(/\.csv$/i, '')}.notebook`
                  : undefined
              }
            >
              {run
                ? `${run.source.name.replace(/\.csv$/i, '')}.notebook`
                : '新建分析'}
            </strong>
          </div>
          <div className="header-actions">
            {run && (
              <>
                <a
                  aria-label="导出证据"
                  className="text-button"
                  href={`/api/runs/${run.id}/export`}
                  onClick={
                    browserMode
                      ? (event) => {
                          event.preventDefault();
                          const blob = new Blob(
                            [
                              JSON.stringify(
                                {
                                  format: 'ava-notebook-evidence',
                                  version: 1,
                                  exportedAt: new Date().toISOString(),
                                  run,
                                },
                                null,
                                2,
                              ),
                            ],
                            { type: 'application/json' },
                          );
                          const url = URL.createObjectURL(blob);
                          const link = document.createElement('a');
                          link.href = url;
                          link.download = `ava-evidence-${run.id}.json`;
                          link.click();
                          setTimeout(() => URL.revokeObjectURL(url), 1000);
                        }
                      : undefined
                  }
                >
                  <Download size={14} />
                  导出
                </a>
              </>
            )}
          </div>
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
            'nav-forward': 'page-surface nav-forward',
            'nav-back': 'page-surface nav-back',
            default: 'page-surface fade-in',
          }}
          exit={{
            'nav-forward': 'page-surface nav-forward',
            'nav-back': 'page-surface nav-back',
            default: 'page-surface fade-out',
          }}
        >
          {!run ? (
            <div className="home">
              <div className="home-content">
                <div className="home-heading">
                  <h1>
                    <span>用一句话，</span>
                    <span>读懂你的数据。</span>
                  </h1>
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
                    placeholder="输入你想分析的问题…"
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
                                {source.semantic && (
                                  <span
                                    className="semantic-badge"
                                    title={source.semantic.name}
                                  >
                                    已加载业务语义
                                  </span>
                                )}
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
                            <summary>预览数据</summary>
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
                    </div>
                    <select
                      aria-label="分析模式"
                      className="composer-model composer-strategy"
                      value={strategy}
                      disabled={busy}
                      onChange={(event) =>
                        setStrategy(event.target.value as Run['strategy'])
                      }
                    >
                      <option value="direct">快速模式</option>
                      <option value="loop">探索模式</option>
                    </select>
                    <button
                      id="start-analysis"
                      aria-label="开始分析"
                      aria-keyshortcuts="Meta+Enter Control+Enter"
                      title="开始分析（⌘ / Ctrl + Enter）"
                      className="button primary"
                      disabled={
                        browserMode || busy || !source || !question.trim()
                      }
                      onClick={() => {
                        if (!session?.configured) {
                          setSettings(true);
                          return;
                        }
                        void act(async () => {
                          const next = await post<Run>('/runs', {
                            sourceId: source!.id,
                            question,
                            strategy,
                            requestId: crypto.randomUUID(),
                          });
                          startTransition(() => {
                            addTransitionType('nav-forward');
                            setRun(next);
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
                      {!busy && <ArrowRight size={15} />}
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
                        if (browserMode) {
                          await openRun('case-sales-performance');
                          return;
                        }
                        const example = await post<{
                          source: Source;
                          question: string;
                        }>('/examples/sales', {});
                        startTransition(() => {
                          setSource(example.source);
                          setQuestion(example.question);
                        });
                      })
                    }
                  >
                    <Database size={14} />
                    探索销售经营案例
                    <ArrowRight size={14} />
                  </button>
                )}
                {classicCases.length > 0 && (
                  <section className="case-section" aria-label="经典案例">
                    <div className="case-heading">
                      <h2>经典案例</h2>
                    </div>
                    <div className="case-grid">
                      {classicCases.map((item) => (
                        <article key={item.id} className="case-card">
                          <span className="case-icon" aria-hidden="true">
                            <BookOpen size={16} strokeWidth={1.5} />
                          </span>
                          <h3>{item.caseStudy!.title}</h3>
                          <p>{item.caseStudy!.description}</p>
                          <div className="case-footer">
                            <small>
                              {item.strategy === 'loop' ? '探索模式' : '快速模式'}
                              {' · '}{item.nodeCount ?? item.nodes.length} 项证据
                            </small>
                            <button
                              className="button primary small case-review"
                              aria-label={`回顾：${item.caseStudy!.title}`}
                              disabled={busy}
                              onClick={() => void act(() => openRun(item.id))}
                            >
                              回顾 <ArrowRight size={14} />
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </div>
          ) : (
            <div className="workspace">
              {run.error && (
                <div className="run-error notice error-notice">
                  {run.error}
                  <button
                    className="text-button"
                    onClick={() => {
                      setSource(run.source);
                      setQuestion(run.question);
                      setStrategy(run.strategy);
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
                    <BookOpen size={14} />
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
                  <div
                    className="run-summary"
                    role="group"
                    aria-label="分析模式与状态"
                  >
                    <span className="run-mode">
                      {run.strategy === 'loop' ? '探索模式' : '快速模式'}
                    </span>
                    <span className={`status status-${run.status}`} role="status">
                      <StatusIcon status={run.status} />
                    </span>
                    {!connected && <span className="amber">连接恢复中…</span>}
                  </div>
                  {active && (
                    <>
                      <button
                        className="icon-button stop-button"
                        disabled={busy}
                        title="停止分析"
                        aria-label="停止分析"
                        onClick={() => void act(() => stopRun())}
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
                        selected={selected}
                        onSelect={selectNode}
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
                          />
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
                      run={run}
                      busy={busy}
                      onClose={() => startTransition(() => setSelected(''))}
                      onSelect={selectNode}
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
          <div className="notice">
            {browserMode
              ? '本次配置仅在当前页面打开期间生效。'
              : '本次配置仅在当前服务运行期间生效。'}
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
