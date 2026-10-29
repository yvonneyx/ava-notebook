import { useEffect, useRef, useState } from 'react';
import {
  Plus,
  ArrowUp,
  NotebookPen,
  Search,
  Trash2,
  Settings2,
} from 'lucide-react';
import type { Run, Session } from '../../../shared/contracts';
import { isActive } from '../../domain/status';

export default function HistorySidebar({
  runs,
  run,
  session,
  busy,
  sidebarOpen,
  newAnalysis,
  onOpen,
  onDelete,
  onSettings,
}: {
  runs: Run[];
  run: Run | null;
  session: Session | null;
  busy: boolean;
  sidebarOpen: boolean;
  newAnalysis: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onSettings: () => void;
}) {
  const [search, setSearch] = useState('');
  const sidebar = useRef<HTMLElement>(null);
  useEffect(() => {
    if (sidebarOpen)
      sidebar.current?.querySelector<HTMLAnchorElement>('a')?.focus();
  }, [sidebarOpen]);
  const historyRuns = runs.filter((item) => !item.caseStudy);
  const filtered = historyRuns.filter((item) =>
    `${item.question} ${item.source.name}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
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
              onClick={() => onOpen(item.id)}
            >
              <strong>{item.question}</strong>
            </button>
            <button
              className="history-delete"
              title={isActive(item) ? '停止并删除分析' : '删除分析'}
              aria-label={`${isActive(item) ? '停止并删除分析' : '删除分析'}：${
                item.question
              }`}
              disabled={busy}
              onClick={() => onDelete(item.id)}
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
          onClick={() => onSettings()}
        >
          <span
            className={`connection-dot ${session?.configured ? 'ok' : ''}`}
          />
          <div>
            <strong>
              {session?.configured ? session.model : '连接分析模型'}
            </strong>
          </div>
          <Settings2 size={15} />
        </button>
      </div>
    </aside>
  );
}
