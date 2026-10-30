import { PanelLeft, BookOpen, Download } from 'lucide-react';
import type { Run } from '../../../shared/contracts';
import { api } from '../../runtime/client';

export default function RunHeader({
  run,
  sidebarOpen,
  onToggleSidebar,
  onHome,
}: {
  run: Run;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onHome: () => void;
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
        <button className="icon-button" aria-label="返回首页" onClick={onHome}>
          <BookOpen size={15} />
        </button>
        <strong
          className="header-title"
          title={`${run.source.name.replace(/\.csv$/i, '')}.notebook`}
        >
          {`${run.source.name.replace(/\.csv$/i, '')}.notebook`}
        </strong>
      </div>
      <div className="header-actions">
        <button
          aria-label="导出证据"
          className="text-button"
          onClick={async () => {
            const blob = new Blob(
              [JSON.stringify(await api(`/runs/${run.id}/export`), null, 2)],
              { type: 'application/json' },
            );
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `ava-evidence-${run.id}.json`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          <Download size={14} />
          导出
        </button>
      </div>
    </header>
  );
}
