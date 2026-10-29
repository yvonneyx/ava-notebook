import { useState } from 'react';
import type { Session } from '../../../shared/contracts';
import { api, post } from '../../runtime/client';

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState('');
  const [baseURL, setBaseURL] = useState('https://api.openai.com/v1');
  const [key, setKey] = useState('');
  async function load() {
    const info = await api<Session>('/session');
    setSession(info);
    setModel(info.model);
    setBaseURL(info.baseURL);
    return info;
  }
  async function save() {
    const info = await post<Session>('/settings', {
      model,
      baseURL,
      ...(key ? { apiKey: key } : {}),
    });
    setSession((current) => ({ ...current!, ...info }));
    setKey('');
    setOpen(false);
  }
  return {
    session,
    open,
    setOpen,
    model,
    setModel,
    baseURL,
    setBaseURL,
    key,
    setKey,
    load,
    save,
  };
}
