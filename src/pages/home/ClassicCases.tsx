import { BookOpen, ArrowRight } from 'lucide-react';
import type { Run } from '../../../shared/contracts';

export default function ClassicCases({
  classicCases,
  busy,
  onOpen,
}: {
  classicCases: Run[];
  busy: boolean;
  onOpen: (id: string) => void;
}) {
  return (
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
              <div className="case-meta">
                <span className={`case-mode case-mode-${item.strategy}`}>
                  {item.strategy === 'loop' ? '探索模式' : '快速模式'}
                </span>
                <small>{item.nodeCount ?? item.nodes.length} 项证据</small>
              </div>
              <button
                className="button primary small case-review"
                aria-label={`回顾：${item.caseStudy!.title}`}
                disabled={busy}
                onClick={() => onOpen(item.id)}
              >
                回顾 <ArrowRight size={14} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
