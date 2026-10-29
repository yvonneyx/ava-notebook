import { PanelLeft, BookOpen, ChevronRight, Download } from 'lucide-react';
import type { Run } from '../../../shared/contracts';
import { browserMode } from '../../runtime/client';

export default function RunHeader({
  run,
  sidebarOpen,
  onToggleSidebar,
}: {
  run: Run;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  return (
    <header
      className="topbar"
      style={{ viewTransitionName: 'persistent-topbar' }}
    >
      <div className="header-location">
        <button
          className="icon-button sidebar-toggle"
          aria-label="展开侧边栏"
          aria-expanded={sidebarOpen}
          onClick={onToggleSidebar}
        >
          <PanelLeft size={18} />
        </button>
        <span className="header-context">
          <BookOpen size={15} className="workspace-icon" />
          <span>我的工作空间</span>
          <ChevronRight size={13} />
          <span>分析笔记</span>
          <ChevronRight size={13} />
        </span>
        <strong
          className="header-title"
          title={`${run.source.name.replace(/\.csv$/i, '')}.notebook`}
        >
          {`${run.source.name.replace(/\.csv$/i, '')}.notebook`}
        </strong>
      </div>
      <div className="header-actions">
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
      </div>
    </header>
  );
}
