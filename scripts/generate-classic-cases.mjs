import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { inspectCSV, digest, atomicJSON } from '../server/store.mjs';
import {
  putNode,
  applyEvent,
  completeRun,
  eventNodeId,
} from '../server/evidence.mjs';
const require = createRequire(import.meta.url);
const { AVA } = require('@antv/ava');
const { MockLanguageModelV4 } = createRequire(require.resolve('@antv/ava'))(
  'ai/test',
);
const recordings = JSON.parse(
  await readFile(
    new URL('../data/classic-cases/recordings.json', import.meta.url),
    'utf8',
  ),
);
const cases = [];
for (const recording of recordings) {
  const path = fileURLToPath(new URL(recording.csv, import.meta.url));
  const bytes = await readFile(path);
  const source = {
    id: randomUUID(),
    name: recording.name,
    bytes: bytes.length,
    hash: digest(bytes),
    ...inspectCSV(bytes, recording.name),
    ...(recording.semantic ? { semantic: recording.semantic } : {}),
  };
  const run = {
    id: recording.id,
    strategy: recording.strategy,
    question: recording.question,
    source,
    model: recording.model,
    caseStudy: recording.caseStudy,
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 1,
    nodes: [],
    events: [],
  };
  let index = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      const text = recording.responses[index++];
      if (text === undefined)
        throw new Error('Recorded model responses exhausted');
      return {
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } },
        warnings: [],
      };
    },
  });
  const ava = new AVA({
    llm: { model, maxRetries: 0 },
    engine: { type: 'duckdb' },
  });
  putNode(run, 'source', {
    kind: 'source',
    title: source.name,
    status: 'running',
    payload: source,
    parents: [],
  });
  ava.on('*', (raw) => {
    const event = {
      ...structuredClone(raw),
      sequence: run.events.length,
      at: new Date().toISOString(),
      nodeId: eventNodeId(raw),
    };
    run.events.push(event);
    applyEvent(run, event);
  });
  try {
    await ava.source({ type: 'csv-file', options: { path } });
    const schema = await ava.schema();
    const semantic = recording.semantic
      ? await ava.semantic(undefined, () => recording.semantic.definition)
      : undefined;
    const profile = await ava.profile({ metrics: ['row_count', 'null_count'] });
    putNode(run, 'context', {
      kind: 'context',
      title: '结构与数据质量',
      status: 'succeeded',
      parents: ['source'],
      payload: { schema, ...(semantic ? { semantic } : {}), profile },
    });
    const result = await ava.analyze(run.question, {
      strategy:
        run.strategy === 'loop'
          ? { type: 'loop', maxSteps: recording.responses.length }
          : { type: 'direct' },
      maxRows: 200,
      maxResultBytes: 1024 * 1024,
    });
    completeRun(run, result);
    if (index !== recording.responses.length)
      throw new Error('Recording ended before all responses were consumed');
    run.updatedAt = new Date().toISOString();
    cases.push(run);
    console.log(
      `${run.id}: ${run.nodes.length} nodes, ${run.events.length} events`,
    );
  } finally {
    await ava.dispose();
  }
}
await atomicJSON(
  fileURLToPath(new URL('../src/data/cases.json', import.meta.url)),
  cases,
);
