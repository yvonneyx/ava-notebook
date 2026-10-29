import { statusLabels } from '../domain/status';

export default function StatusLabel({
  status,
  label = statusLabels[status] || status,
}: {
  status: string;
  label?: string;
}) {
  return <span>{label}</span>;
}
