import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import SqlCode from './SqlCode';

const plugins = [remarkGfm];
const components: Components = {
  img: () => null,
  code: ({ node, className, children, ...props }) =>
    /\blanguage-sql\b/i.test(className || '') ? (
      <SqlCode sql={String(children)} />
    ) : (
      <code className={className} {...props}>{children}</code>
    ),
};
export default function AnalysisText({ text }: { text: string }) {
  return (
    <div className="prose">
      <Markdown remarkPlugins={plugins} components={components}>
        {text}
      </Markdown>
    </div>
  );
}
