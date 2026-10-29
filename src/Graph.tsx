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
import {
  Database,
  ScanSearch,
  Braces,
  Table2,
  CheckCircle2,
  ChartColumn,
} from 'lucide-react';
import { kindLabels, statusLabels } from './types';
import StatusIcon from './StatusIcon';
import type { Evidence } from './types';
import { layoutGraph } from './graph-layout';
import '@xyflow/react/dist/style.css';
const icons: Record<string, typeof Database> = {
  source: Database,
  context: ScanSearch,
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
    FlowNode<{
      evidence: Evidence;
      onSelect: (id: string) => void;
      stepNumber?: number;
      childCount?: number;
    }>
  >) => {
    const node = data.evidence;
    const Icon = icons[node.kind] || ScanSearch;
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
        ? node.payload.conclusion || '查询已完成，未收到核验结论'
        : node.kind === 'step'
        ? node.payload.text || '等待模型响应'
        : node.kind === 'translate'
        ? node.payload.query
        : node.kind === 'summary'
        ? node.payload.conclusion || '正在解释查询结果'
        : node.kind === 'chart'
        ? `${node.payload.rows?.length || 0} 个分组`
        : node.kind === 'context'
        ? '字段类型与质量统计'
        : '等待模型响应';
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={`${data.stepNumber ? `步骤 ${data.stepNumber}：` : ''}${
          node.title
        }，${statusLabels[node.status]}`}
        onClick={() => data.onSelect(node.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            data.onSelect(node.id);
          }
        }}
        className={`evidence-node kind-${node.kind} ${
          data.stepNumber ? 'step-subgraph' : ''
        } ${selected ? 'selected' : ''} state-${node.status}`}
      >
        <Handle type="target" position={Position.Top} />
        <div className="node-eyebrow">
          <span>
            <Icon size={13} />
            {data.stepNumber && (
              <span className="mono">STEP {data.stepNumber}</span>
            )}
            {kindLabels[node.kind]}
          </span>
          <span>
            {data.childCount !== undefined && `${data.childCount} 个事件`}
            <StatusIcon status={node.status} />
          </span>
        </div>
        <strong>{node.title}</strong>
        <p className={node.kind === 'query' ? 'mono' : ''}>{excerpt}</p>
        {!!data.childCount && (
          <Handle
            type="source"
            id="events"
            position={Position.Bottom}
            className="step-events-handle"
          />
        )}
        <Handle type="source" id="output" position={Position.Bottom} />
      </div>
    );
  },
);
const nodeTypes = { evidence: Card };
export default function Graph({
  nodes,
  selected,
  onSelect,
}: {
  nodes: Evidence[];
  selected?: string;
  onSelect: (id: string) => void;
}) {
  const signature = JSON.stringify(
    nodes.map(({ id, kind, stepId, sequence, parents }) => [
      id, kind, stepId, sequence, parents,
    ]),
  );
  const layout = useMemo(() => layoutGraph(nodes), [signature]);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return (
    <ReactFlow
      nodes={layout.nodes.map(({ stepNumber, childCount, ...node }) => ({
        ...node,
        type: 'evidence',
        extent: node.parentId ? 'parent' : undefined,
        zIndex: stepNumber ? 0 : 2,
        data: { evidence: byId.get(node.id)!, onSelect, stepNumber, childCount },
        selected: selected === node.id,
      }))}
      edges={layout.edges.map((edge) => ({
        ...edge,
        type: 'smoothstep',
        zIndex: 1,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        style: { stroke: '#9db8cb', strokeWidth: 1.3 },
      }))}
      nodeTypes={nodeTypes}
      zIndexMode="manual"
      nodesFocusable={false}
      onPaneClick={() => onSelect('')}
      nodesDraggable={false}
      nodesConnectable={false}
      fitView
      fitViewOptions={{ padding: 0.3, maxZoom: 0.95 }}
      minZoom={0.1}
      maxZoom={1.5}
    >
      <Background color="#d9e7f0" gap={22} size={1} />
      <Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>
  );
}
