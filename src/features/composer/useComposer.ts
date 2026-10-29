import { useEffect, useState, startTransition } from 'react';
import type { Run, Source } from '../../../shared/contracts';
import { api, readDraft, saveDraft } from '../../runtime/client';

type Draft = {
  source: Source | null;
  question: string;
  strategy: Run['strategy'];
};

export function useComposer(onError: (message: string) => void) {
  const [source, setSource] = useState<Source | null>(null);
  const [question, setQuestion] = useState('');
  const [strategy, setStrategy] = useState<Run['strategy']>('direct');
  const [ready, setReady] = useState(false);
  async function restore() {
    const draft = await readDraft<Draft>();
    if (draft) {
      setSource(draft.source);
      setQuestion(draft.question);
      if (draft.strategy) setStrategy(draft.strategy);
    }
    setReady(true);
  }
  useEffect(() => {
    if (ready)
      void saveDraft({ source, question, strategy }).catch((error) =>
        onError(error.message),
      );
  }, [source, question, strategy, ready, onError]);
  async function upload(file: File) {
    const uploaded = await api<Source>('/sources', {
      method: 'POST',
      body: file,
      headers: {
        'Content-Type': 'text/csv',
        'X-Filename': encodeURIComponent(file.name),
      },
    });
    startTransition(() => setSource(uploaded));
  }
  return {
    source,
    setSource,
    question,
    setQuestion,
    strategy,
    setStrategy,
    restore,
    upload,
  };
}
