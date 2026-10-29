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
