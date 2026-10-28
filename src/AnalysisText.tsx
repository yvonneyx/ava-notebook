import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const plugins = [remarkGfm];
export default function AnalysisText({ text }: { text: string }) {
  return (
    <div className="prose">
      <Markdown remarkPlugins={plugins} components={{ img: () => null }}>
        {text}
      </Markdown>
    </div>
  );
}
