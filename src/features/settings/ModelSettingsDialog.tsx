import { useEffect, useRef } from 'react';
import { X, LoaderCircle, Check } from 'lucide-react';
import type { useSession } from './useSession';

export default function ModelSettingsDialog({
  state,
  error,
  busy,
  onSave,
}: {
  state: ReturnType<typeof useSession>;
  error: string;
  busy: boolean;
  onSave: () => void;
}) {
  const {
    session,
    model,
    setModel,
    baseURL,
    setBaseURL,
    key,
    setKey,
    open: settings,
    setOpen: setSettings,
  } = state;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (settings) dialog.current?.showModal();
    else dialog.current?.close();
  }, [settings]);
  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      onCancel={() => setSettings(false)}
      onClick={(e) => {
        if (e.target === dialog.current) setSettings(false);
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <div className="modal-header">
          <div>
            <h2>模型设置</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭模型设置"
            onClick={() => setSettings(false)}
          >
            <X size={17} />
          </button>
        </div>
        <p className="muted">支持 OpenAI 兼容的 Chat Completions 接口。</p>
        {error && <div className="notice error-notice">{error}</div>}
        <label className="field">
          API 地址
          <input
            required
            type="url"
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
          />
        </label>
        <label className="field">
          模型名称
          <input
            required
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="填写服务商提供的模型名称"
          />
        </label>
        <label className="field">
          API Key
          <input
            type="password"
            autoComplete="off"
            required={!session?.configured}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={
              session?.configured ? '已配置，留空保持当前密钥' : '输入 API Key'
            }
          />
        </label>
        <div className="notice">
          本次配置仅在当前页面打开期间生效。
        </div>
        <button className="button primary full" disabled={busy} type="submit">
          {busy ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Check size={15} />
          )}
          保存配置
        </button>
      </form>
    </dialog>
  );
}
