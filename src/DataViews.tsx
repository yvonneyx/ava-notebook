import { useState } from 'react';
export function DataTable({
  rows,
  columns,
}: {
  rows: Record<string, unknown>[];
  columns?: string[];
}) {
  const [page, setPage] = useState(0);
  const names = columns || Object.keys(rows[0] || {});
  const numeric = new Set(
    names.filter((name) => rows.some((row) => typeof row[name] === 'number')),
  );
  return (
    <>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {names.map((name) => (
                <th
                  key={name}
                  className={numeric.has(name) ? 'numeric' : undefined}
                >
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!rows.length && (
              <tr>
                <td colSpan={names.length || 1} className="table-empty">
                  无匹配结果
                </td>
              </tr>
            )}
            {rows.slice(page * 20, page * 20 + 20).map((row, index) => (
              <tr key={index}>
                {names.map((name) => (
                  <td
                    key={name}
                    className={numeric.has(name) ? 'numeric' : undefined}
                  >
                    {row[name] === null ? (
                      <span className="muted">null</span>
                    ) : (
                      String(row[name] ?? '')
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 20 && (
        <div className="pagination">
          <button disabled={!page} onClick={() => setPage(page - 1)}>
            上一页
          </button>
          <span>
            {page + 1} / {Math.ceil(rows.length / 20)}
          </span>
          <button
            disabled={(page + 1) * 20 >= rows.length}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </>
  );
}
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
