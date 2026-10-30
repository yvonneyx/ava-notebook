import {
  useEffect,
  useState,
  startTransition,
  addTransitionType,
  ViewTransition,
} from 'react';
import { X } from 'lucide-react';
import type { Run } from '../../shared/contracts';
import { api, post } from '../runtime/client';
import { useSession } from '../features/settings/useSession';
import ModelSettingsDialog from '../features/settings/ModelSettingsDialog';
import { useRunHistory } from '../features/history/useRunHistory';
import HistorySidebar from '../features/history/HistorySidebar';
import { useComposer } from '../features/composer/useComposer';
import Composer from '../features/composer/Composer';
import { useRun } from '../pages/analysis/useRun';
import AnalysisPage from '../pages/analysis/AnalysisPage';
import RunHeader from '../pages/analysis/RunHeader';
import HomePage from '../pages/home/HomePage';
import AppShell from './AppShell';
import { currentRunId, updateRunUrl } from './navigation';

export default function App() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const session = useSession();
  const history = useRunHistory();
  const composer = useComposer(setError);
  const analysis = useRun(history.update);
  const { run, setRun, setView, setSelected } = analysis;

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
  async function openRun(id: string) {
    const next = await api<Run>(`/runs/${id}`);
    startTransition(() => {
      addTransitionType(run ? 'switch-run' : 'nav-forward');
      setRun(next);
      setView('notebook');
      setSidebarOpen(false);
      setSelected('');
    });
    updateRunUrl(id);
  }
  useEffect(() => {
    void act(async () => {
      const info = await session.load();
      await history.refresh();
      await composer.restore();
      const id = currentRunId() || info.activeRunId;
      if (id) await openRun(id);
    });
  }, []);
  function newAnalysis() {
    startTransition(() => {
      addTransitionType('nav-back');
      setRun(null);
      composer.setSource(null);
      composer.setQuestion('');
      setSelected('');
      setSidebarOpen(false);
      setView('notebook');
      setError('');
      updateRunUrl();
    });
  }
  async function deleteRun(id: string) {
    await history.remove(id);
    if (currentRunId() === id) newAnalysis();
  }
  function startAnalysis() {
    if (!session.session?.configured) {
      session.setOpen(true);
      return;
    }
    void act(async () => {
      const next = await post<Run>('/runs', {
        sourceId: composer.source!.id,
        question: composer.question,
        strategy: composer.strategy,
        requestId: crypto.randomUUID(),
      });
      startTransition(() => {
        addTransitionType('nav-forward');
        setRun(next);
        setView('notebook');
        setSelected('');
      });
      updateRunUrl(next.id);
      await history.refresh();
    });
  }
  async function exploreSales() {
    const [{ default: csv }, { default: question }] = await Promise.all([
      import('../../examples/sales/sales-case.csv?raw'),
      import('../../examples/sales/sales-question.txt?raw'),
    ]);
    await composer.upload(new File([csv], 'sales-case.csv', { type: 'text/csv' }));
    composer.setQuestion(question.trim());
  }
  return (
    <AppShell
      hasRun={!!run}
      sidebarOpen={sidebarOpen}
      setSidebarOpen={setSidebarOpen}
      sidebar={
        <HistorySidebar
          runs={history.runs}
          run={run}
          session={session.session}
          busy={busy}
          sidebarOpen={sidebarOpen}
          newAnalysis={newAnalysis}
          onOpen={(id) => void act(() => openRun(id))}
          onDelete={(id) => void act(() => deleteRun(id))}
          onSettings={() => session.setOpen(true)}
        />
      }
      settings={
        <ModelSettingsDialog
          state={session}
          error={error}
          busy={busy}
          onSave={() => void act(session.save)}
        />
      }
    >
      {run && (
        <RunHeader
          run={run}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onHome={newAnalysis}
        />
      )}
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
          <HomePage
            runs={history.runs}
            hasSource={!!composer.source}
            busy={busy}
            onExplore={() => void act(exploreSales)}
            onOpen={(id) => void act(() => openRun(id))}
            composer={
              <Composer
                composer={composer}
                session={session.session}
                busy={busy}
                onUpload={(file) => void act(() => composer.upload(file))}
                onStart={startAnalysis}
                onSettings={() => session.setOpen(true)}
              />
            }
          />
        ) : (
          <AnalysisPage
            run={run}
            analysis={analysis}
            busy={busy}
            onStop={() => void act(analysis.stop)}
            onChart={(nodeId, x, y) =>
              void act(() => analysis.saveChart(nodeId, x, y))
            }
            onRetry={() => {
              composer.setSource(run.source);
              composer.setQuestion(run.question);
              composer.setStrategy(run.strategy);
              setRun(null);
              updateRunUrl();
            }}
          />
        )}
      </ViewTransition>
    </AppShell>
  );
}
