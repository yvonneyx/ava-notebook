import { statusLabels } from './types';

const statusEmoji: Record<string, string> = {
  ready: '⏳',
  running: '🔄',
  succeeded: '✅',
  completed: '✅',
  failed: '❌',
  cancelled: '⏹️',
  interrupted: '⚠️',
};

export default function StatusIcon({
  status,
  label = statusLabels[status] || status,
}: {
  status: string;
  label?: string;
}) {
  return (
    <span className="status-icon" role="img" aria-label={label} title={label}>
      {statusEmoji[status] || label}
    </span>
  );
}
