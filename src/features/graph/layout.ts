import dagre from '@dagrejs/dagre';
import type { Graph } from '@dagrejs/dagre';
import type { Evidence } from '../../../shared/contracts';

const cardWidth = 248;
const cardHeight = 92;
const padding = 24;
const contentTop = 120;

type Placement = {
  id: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  parentId?: string;
  stepNumber?: number;
  childCount?: number;
};

function newGraph() {
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'TB', nodesep: 28, ranksep: 36 });
  return graph;
}

function position(graph: Graph, id: string) {
  const node = graph.node(id);
  return { x: node.x - node.width / 2, y: node.y - node.height / 2 };
}

export function layoutGraph(nodes: Evidence[]) {
  const ordered = [...nodes].sort((a, b) => a.sequence - b.sequence);
  const ids = new Set(ordered.map((node) => node.id));
  const steps = new Map(
    ordered
      .filter((node) => node.kind === 'step' && node.stepId)
      .map((node) => [node.stepId, node]),
  );
  const parentIds = new Map<string, string>();
  const children = new Map<string, Evidence[]>(
    [...steps.values()].map((step) => [step.id, []]),
  );
  for (const node of ordered) {
    const step = steps.get(node.stepId);
    if (step && step.id !== node.id) {
      parentIds.set(node.id, step.id);
      children.get(step.id)!.push(node);
    }
  }
  const edges = ordered.flatMap((node) =>
    [...new Set(node.parents)]
      .filter((parent) => ids.has(parent) && parent !== node.id)
      .map((parent) => ({
        id: JSON.stringify([parent, node.id]),
        source: parent,
        target: node.id,
        sourceHandle: parentIds.get(node.id) === parent ? 'events' : 'output',
      })),
  );
  const outer = newGraph();
  const roots: Placement[] = [];
  const nested: Placement[] = [];
  let stepNumber = 0;
  for (const node of ordered) {
    if (parentIds.has(node.id)) continue;
    const members = children.get(node.id);
    const root: Placement = {
      id: node.id,
      position: { x: 0, y: 0 },
      width: cardWidth,
      height: cardHeight,
    };
    if (members) {
      const inner = newGraph();
      for (const member of members)
        inner.setNode(member.id, { width: cardWidth, height: cardHeight });
      for (const edge of edges)
        if (inner.hasNode(edge.source) && inner.hasNode(edge.target))
          inner.setEdge(edge.source, edge.target);
      if (members.length) dagre.layout(inner);
      root.width = Math.max(cardWidth, inner.graph().width || 0) + padding * 2;
      root.height = members.length
        ? contentTop + inner.graph().height! + padding
        : cardHeight + padding;
      root.stepNumber = ++stepNumber;
      root.childCount = members.length;
      for (const member of members) {
        const point = position(inner, member.id);
        nested.push({
          id: member.id,
          parentId: node.id,
          position: { x: point.x + padding, y: point.y + contentTop },
          width: cardWidth,
          height: cardHeight,
        });
      }
    }
    roots.push(root);
    outer.setNode(root.id, { width: root.width, height: root.height });
  }
  for (const edge of edges) {
    const source = parentIds.get(edge.source) || edge.source;
    const target = parentIds.get(edge.target) || edge.target;
    if (source !== target) outer.setEdge(source, target);
  }
  if (roots.length) dagre.layout(outer);
  for (const root of roots) root.position = position(outer, root.id);
  // React Flow requires each parent to appear before its children.
  return { nodes: [...roots, ...nested], edges };
}
