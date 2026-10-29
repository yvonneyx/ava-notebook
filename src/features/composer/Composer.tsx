import { useRef, useState, ViewTransition } from 'react';
import {
  Paperclip,
  FileSpreadsheet,
  X,
  ChevronDown,
  LoaderCircle,
  ArrowRight,
} from 'lucide-react';
import type { Run, Session } from '../../../shared/contracts';
import type { useComposer } from './useComposer';
import { browserMode } from '../../runtime/client';
import { DataTable } from '../../ui/DataTable';

export default function Composer({
  composer,
  session,
  busy,
  onUpload,
  onStart,
  onSettings,
}: {
  composer: ReturnType<typeof useComposer>;
  session: Session | null;
  busy: boolean;
  onUpload: (file: File) => void;
  onStart: () => void;
  onSettings: () => void;
}) {
  const { source, setSource, question, setQuestion, strategy, setStrategy } =
    composer;
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  return (
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
        if (!busy) onUpload(file);
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
                    {source.rows.toLocaleString()} 行 · {source.headers.length}{' '}
                    个字段 · {(source.bytes / 1024).toFixed(1)} KB
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
            if (file && !busy) onUpload(file);
            e.target.value = '';
          }}
        />
        <div className="compose-options">
          <button className="composer-model" onClick={() => onSettings()}>
            <span
              className={`connection-dot ${session?.configured ? 'ok' : ''}`}
            />
            <span>{session?.configured ? session.model : '配置模型'}</span>
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
          disabled={browserMode || busy || !source || !question.trim()}
          onClick={onStart}
        >
          {busy ? <LoaderCircle size={15} className="spin" /> : null}
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
  );
}
