import { useEffect } from 'react';
import type { ReactNode } from 'react';

export default function AppShell({
  hasRun,
  sidebarOpen,
  setSidebarOpen,
  sidebar,
  settings,
  children,
}: {
  hasRun: boolean;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  sidebar: ReactNode;
  settings: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    const width = matchMedia('(max-width: 800px)');
    const close = () => {
      if (!width.matches) setSidebarOpen(false);
    };
    width.addEventListener('change', close);
    return () => width.removeEventListener('change', close);
  }, [setSidebarOpen]);
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
      {sidebar}
      <main
        className={`main ${hasRun ? 'analysis-page' : 'home-page'}`}
        inert={sidebarOpen}
      >
        {children}
      </main>
      {settings}
    </div>
  );
}
