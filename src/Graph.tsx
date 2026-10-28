import { memo, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
} from '@xyflow/react';
import type { NodeProps, Node as FlowNode } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import {
  Database,
  ScanSearch,
  Braces,
  Table2,
  CheckCircle2,
  ChartColumn,
  LoaderCircle,
  CirclePause,
  CircleAlert,
} from 'lucide-react';
import { kindLabels, statusLabels } from './types';
import type { Evidence } from './types';
import '@xyflow/react/dist/style.css';
const icons: Record<string, typeof Database> = {
  source: Database,
  context: ScanSearch,
  reason: ScanSearch,
  query: Braces,
  result: Table2,
  conclusion: CheckCircle2,
  chart: ChartColumn,
};
const Card = memo(
  ({
    data,
    selected,
  }: NodeProps<
    FlowNode<{ evidence: Evidence; onSelect: (id: string) => void }>
  >) => {
    const node = data.evidence;
    const Icon = icons[node.kind] || ScanSearch;
    const Status =
      node.status === 'running'
        ? LoaderCircle
        : node.status === 'paused'
        ? CirclePause
        : node.status === 'failed'
        ? CircleAlert
        : CheckCircle2;
    const excerpt =
      node.kind === 'query'
        ? node.payload.sql
        : node.kind === 'source'
        ? `${node.payload.rows?.toLocaleString()} 行 · ${
            node.payload.headers?.length
          } 列`
        : node.kind === 'result'
        ? node.payload.schema?.map((c: any) => c.name).join(' · ')
        : node.kind === 'conclusion'
        ? node.payload.completionReason === 'confirmed'
          ? '已完成模型检查，点击查看依据'
          : '已执行，验证尚未完成'
        : node.payload.action
        ? node.payload.text?.replace(/^\[.*?\]\s*/, '')
        : '查看输入、结果与执行记录';
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={`${node.title}，${statusLabels[node.status]}`}
        onClick={() => data.onSelect(node.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            data.onSelect(node.id);
          }
        }}
        className={`evidence-node ${selected ? 'selected' : ''} state-${
          node.status
        }`}
      >
        <Handle type="target" position={Position.Top} />
        <div className="node-eyebrow">
          <span>
            <Icon size={13} />
            {kindLabels[node.kind]}
          </span>
          <Status
            size={13}
            className={node.status === 'running' ? 'spin' : ''}
          />
        </div>
        <strong>{node.title}</strong>
        <p className={node.kind === 'query' ? 'mono' : ''}>{excerpt}</p>
        <Handle type="source" position={Position.Bottom} />
      </div>
    );
  },
);
const nodeTypes = { evidence: Card };
export default function Graph({
  nodes,
  selected,
  onSelect,
  collapsed,
}: {
  nodes: Evidence[];
  selected?: string;
  onSelect: (id: string) => void;
  collapsed: Set<number>;
}) {
  const visible = nodes.filter(
    (n) =>
      !(
        n.step !== undefined &&
        collapsed.has(n.step) &&
        ['query', 'result'].includes(n.kind)
      ),
  );
  const signature = visible
    .map((n) => `${n.id}:${n.parents.join(',')}`)
    .join('|');
  const positions = useMemo(() => {
    const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
    graph.setGraph({
      rankdir: 'TB',
      nodesep: 28,
      ranksep: 46,
      marginx: 32,
      marginy: 32,
    });
    const ids = new Set(visible.map((n) => n.id));
    visible.forEach((n) => graph.setNode(n.id, { width: 248, height: 108 }));
    visible.forEach((n) =>
      n.parents.forEach((parent) => {
        const original = nodes.find((candidate) => candidate.id === parent);
        const actual = ids.has(parent)
          ? parent
          : original?.step !== undefined
          ? `m-${original.step}`
          : '';
        if (actual && ids.has(actual) && actual !== n.id)
          graph.setEdge(actual, n.id);
      }),
    );
    dagre.layout(graph);
    return new Map(
      visible.map((n) => [
        n.id,
        { x: graph.node(n.id).x - 124, y: graph.node(n.id).y - 54 },
      ]),
    );
  }, [signature]);
  const ids = new Set(visible.map((n) => n.id));
  const edges = visible.flatMap((n) =>
    [
      ...new Set(
        n.parents.map((parent) => {
          const original = nodes.find((candidate) => candidate.id === parent);
          return ids.has(parent)
            ? parent
            : original?.step !== undefined
            ? `m-${original.step}`
            : '';
        }),
      ),
    ]
      .filter((id) => id && ids.has(id) && id !== n.id)
      .map((parent) => ({
        id: `${parent}-${n.id}`,
        source: parent,
        target: n.id,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        style: { stroke: '#b7bcc5', strokeWidth: 1.3 },
      })),
  );
  return (
    <ReactFlow
      nodes={visible.map((node) => ({
        id: node.id,
        type: 'evidence',
        width: 248,
        height: 108,
        position: positions.get(node.id) || { x: 0, y: 0 },
        data: { evidence: node, onSelect },
        selected: selected === node.id,
      }))}
      edges={edges}
      nodeTypes={nodeTypes}
      nodesFocusable={false}
      onPaneClick={() => onSelect('')}
      nodesDraggable={false}
      nodesConnectable={false}
      fitView
      fitViewOptions={{ padding: 0.3, maxZoom: 0.95 }}
      minZoom={0.2}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#d8dce2" gap={22} size={1} />
      <Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>
  );
}
