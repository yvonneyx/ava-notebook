import type { ReactNode } from 'react';
import { Database, ArrowRight } from 'lucide-react';
import type { Run } from '../../../shared/contracts';
import HomeBackdrop from './HomeBackdrop';
import ClassicCases from './ClassicCases';

export default function HomePage({
  composer,
  runs,
  hasSource,
  busy,
  onExplore,
  onOpen,
}: {
  composer: ReactNode;
  runs: Run[];
  hasSource: boolean;
  busy: boolean;
  onExplore: () => void;
  onOpen: (id: string) => void;
}) {
  const classicCases = runs.filter(
    (item) => item.caseStudy && item.status === 'completed',
  );
  return (
    <div className="home">
      <HomeBackdrop />
      <div className="home-content">
        <div className="home-heading">
          <h1>
            <span>一句话分析 CSV，</span>
            <span>在 Notebook 中看清每一步</span>
          </h1>
        </div>
        {composer}
        {!hasSource && (
          <button className="sample-button" disabled={busy} onClick={onExplore}>
            <Database size={14} />
            探索销售经营案例
            <ArrowRight size={14} />
          </button>
        )}
        {classicCases.length > 0 && (
          <ClassicCases
            classicCases={classicCases}
            busy={busy}
            onOpen={onOpen}
          />
        )}
      </div>
    </div>
  );
}
