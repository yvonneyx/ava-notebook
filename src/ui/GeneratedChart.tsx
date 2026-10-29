import { useEffect, useMemo, useRef, useState } from 'react';
import script from '@antv/gpt-vis/dist/umd/index.min.js?url';
import { chartDocument } from './chart-document';

export default function GeneratedChart({
  config,
}: {
  config: { type: string; [key: string]: unknown };
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState('');
  const document = useMemo(() => {
    const nonce = crypto.randomUUID();
    return {
      nonce,
      html: chartDocument(config, new URL(script, location.href).href, nonce),
    };
  }, [config]);
  useEffect(() => {
    setError('');
    const timeout = setTimeout(
      () => setError('图表组件加载超时，请重新打开 Chart 视图'),
      15000,
    );
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.chart !== document.nonce
      )
        return;
      clearTimeout(timeout);
      if (event.data.error) setError(event.data.error);
    };
    window.addEventListener('message', receive);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('message', receive);
    };
  }, [document]);
  return error ? (
    <p className="view-empty" role="alert">
      {error}
    </p>
  ) : (
    <iframe
      ref={frame}
      className="generated-chart"
      title="自动生成的图表"
      sandbox="allow-scripts"
      srcDoc={document.html}
    />
  );
}
