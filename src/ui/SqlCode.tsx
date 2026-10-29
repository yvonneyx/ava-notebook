const keywords = new Set(
  `ALL AND ANY AS ASC BETWEEN BY CASE CAST CROSS CURRENT_DATE CURRENT_TIMESTAMP
   DESC DISTINCT ELSE END EXCEPT EXISTS FALSE FILTER FIRST FOLLOWING FROM FULL
   GROUP HAVING ILIKE IN INNER INTERSECT INTERVAL IS JOIN LAST LEFT LIKE LIMIT
   NATURAL NOT NULL NULLS OFFSET ON OR ORDER OUTER OVER PARTITION PRECEDING
   QUALIFY RANGE RECURSIVE RIGHT ROW ROWS SELECT THEN TRUE TRY_CAST UNBOUNDED
   UNION USING VALUES WHEN WHERE WINDOW WITH`.split(/\s+/),
);

// shortcut: Common SQL tokens only; use a dialect grammar if nested comments or dollar-quoted strings are needed.
const tokens = /(?<comment>--[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$))|(?<string>'(?:''|[^'])*(?:'|$))|(?<identifier>"(?:""|[^"])*(?:"|$)|`(?:``|[^`])*(?:`|$))|(?<number>(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)|(?<function>[\p{L}_][\p{L}\p{N}_$]*(?=\s*\())|(?<word>[\p{L}_][\p{L}\p{N}_$]*)|(?<operator>::|[-+*/%=<>!|&^~]+)|\s+|./giu;

export default function SqlCode({ sql = '' }: { sql?: string }) {
  return (
    <code className="language-sql">
      {Array.from(sql.matchAll(tokens), (match) => {
        const value = match[0];
        const kind = Object.keys(match.groups!).find(
          (name) => match.groups![name] !== undefined,
        );
        const type =
          (kind === 'word' || kind === 'function') && keywords.has(value.toUpperCase())
            ? 'keyword'
            : kind;
        return type && type !== 'word' ? (
          <span key={match.index} className={`sql-${type}`}>
            {value}
          </span>
        ) : value;
      })}
    </code>
  );
}
