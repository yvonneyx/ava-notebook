export function Bars({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: number }[];
}) {
  const scale = Math.max(...rows.map((row) => Math.abs(row.value)), 1);
  const min = Math.min(0, ...rows.map((row) => row.value / scale));
  const max = Math.max(0, ...rows.map((row) => row.value / scale));
  const range = max - min || 1;
  return (
    <div
      className="bars"
      role="img"
      aria-label={`${title}柱状图，${rows
        .map((row) => `${row.label}：${row.value}`)
        .join('；')}`}
    >
      {rows.map((row, i) => (
        <div className="bar-row" key={i}>
          <span title={row.label}>{row.label}</span>
          <div className="bar-track">
            <span
              className="bar-baseline"
              style={{ left: `${(-min / range) * 100}%` }}
            />
            <i
              className={row.value < 0 ? 'negative' : ''}
              style={{
                left: `${
                  ((Math.min(0, row.value / scale) - min) / range) * 100
                }%`,
                width: `${(Math.abs(row.value / scale) / range) * 100}%`,
              }}
            />
          </div>
          <b>{row.value.toLocaleString()}</b>
        </div>
      ))}
    </div>
  );
}
