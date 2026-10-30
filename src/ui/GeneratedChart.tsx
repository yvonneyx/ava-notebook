import { useEffect, useMemo, useRef, useState } from 'react';
import script from '@antv/gpt-vis/dist/umd/index.min.js?url';
import { chartDocument } from './chart-document';

export default function GeneratedChart({
  config,
}: {
  config: { type: string; [key: string]: unknown };
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<{
    nonce: string;
    error?: string;
    ready?: boolean;
  }>();
  const document = useMemo(() => {
    const nonce = crypto.randomUUID();
    return {
      nonce,
      html: chartDocument(config, new URL(script, location.href).href, nonce),
    };
  }, [config]);
  useEffect(() => {
    const timeout = setTimeout(
      () =>
        setStatus({ nonce: document.nonce, error: '图表组件加载超时，请重新打开 Chart 视图' }),
      15000,
    );
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.chart !== document.nonce
      )
        return;
      if (event.data.error) {
        clearTimeout(timeout);
        setStatus({ nonce: document.nonce, error: event.data.error });
      } else if (event.data.ready) {
        setStatus({ nonce: document.nonce, ready: true });
      } else {
        clearTimeout(timeout);
      }
    };
    window.addEventListener('message', receive);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('message', receive);
    };
  }, [document]);
  const current = status?.nonce === document.nonce ? status : undefined;
  return current?.error ? (
    <p className="view-empty" role="alert">
      {current.error}
    </p>
  ) : (
    <div className="generated-chart-container">
      {!current?.ready && (
        <p className="generated-chart-loading" role="status">
          正在加载图表…
        </p>
      )}
      <iframe
        ref={frame}
        className="generated-chart"
        title="自动生成的图表"
        sandbox="allow-scripts"
        srcDoc={document.html}
      />
    </div>
  );
}
