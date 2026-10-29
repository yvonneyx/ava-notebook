import { statusLabels } from './types';

export default function StatusLabel({
  status,
  label = statusLabels[status] || status,
}: {
  status: string;
  label?: string;
}) {
  return <span>{label}</span>;
}
