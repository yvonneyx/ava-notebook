import { useEffect, useRef, useState } from 'react';
import { Check, FileUp, LoaderCircle, Trash2, X } from 'lucide-react';
import type { Source } from '../../../shared/contracts';
import {
  MAX_SEMANTIC_BYTES,
  parseSemantic,
  type SemanticFormat,
} from '../../domain/semantic';

export default function SemanticSettingsDialog({
  source,
  onApply,
  onClose,
}: {
  source: Source;
  onApply: (semantic: Source['semantic']) => void;
  onClose: () => void;
}) {
  const definition = source.semantic?.definition;
  const plain =
    !definition ||
    Object.keys(definition).every((key) => key === 'description');
  const [format, setFormat] = useState<SemanticFormat>(
    plain ? 'text' : 'structured',
  );
  const [text, setText] = useState(() =>
    plain
      ? String(definition?.description || '')
      : JSON.stringify(definition, null, 2),
  );
  const [name, setName] = useState(source.semantic?.name || '业务口径');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  async function apply() {
    setBusy(true);
    setError('');
    try {
      onApply(await parseSemantic(text, format, name));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function importFile(file: File) {
    setError('');
    setBusy(true);
    try {
      if (!/\.(json|ya?ml)$/i.test(file.name))
        throw new Error('请选择 JSON 或 YAML 语义文件');
      if (file.size > MAX_SEMANTIC_BYTES)
        throw new Error('语义口径不能超过 64 KB');
      const content = await file.text();
      await parseSemantic(content, 'structured', file.name);
      setText(content);
      setName(file.name);
      setFormat('structured');
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="settings-dialog semantic-dialog"
      aria-labelledby="semantic-settings-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void apply();
        }}
      >
        <div className="modal-header">
          <h2 id="semantic-settings-title">语义口径</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭语义口径"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
        <p className="muted">
          补充指标定义、统计周期与业务背景，让分析采用你的业务口径。
        </p>
        <p className="semantic-source">当前数据：{source.name}</p>
        {error && (
          <div className="notice error-notice" role="alert">
            {error}
          </div>
        )}
        <div className="semantic-options">
          <label className="field">
            填写方式
            <select
              aria-label="口径填写方式"
              value={format}
              disabled={busy}
              onChange={(event) => {
                setFormat(event.target.value as SemanticFormat);
                setError('');
              }}
            >
              <option value="text">文字说明</option>
              <option value="structured">AVA JSON / YAML</option>
            </select>
          </label>
          <button
            className="text-button"
            type="button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <FileUp size={15} />
            导入口径文件
          </button>
          <input
            ref={fileInput}
            aria-label="导入语义口径文件"
            type="file"
            accept=".json,.yaml,.yml"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void importFile(file);
            }}
          />
        </div>
        <label className="field">
          {format === 'text' ? '业务口径与背景' : 'AVA 语义定义'}
          <textarea
            aria-label="语义口径内容"
            value={text}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
            rows={11}
            spellCheck={false}
            placeholder={
              format === 'text'
                ? '例如：净销售额 = 标价销售额 − 优惠 − 退款。比较各月时，同时报告总量和自然日日均；没有增量实验时，不把相关性当作投放效果。'
                : 'description: 销售分析口径\nproperties:\n  accounting: 净销售额 = 标价销售额 - 优惠 - 退款'
            }
          />
        </label>
        <div className="notice">
          口径随当前数据保存在浏览器中，并作为分析上下文发送给你配置的模型。应用到下一次分析，历史记录保留原口径。
        </div>
        <div className="semantic-actions">
          {source.semantic && (
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => onApply(undefined)}
            >
              <Trash2 size={15} />
              移除口径
            </button>
          )}
          <button
            className="button primary"
            type="submit"
            disabled={busy || !text.trim()}
          >
            {busy ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Check size={15} />
            )}
            应用口径
          </button>
        </div>
      </form>
    </dialog>
  );
}
