import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { createSource } from '../storage/index.mjs';

export async function loadSalesExample() {
  const [csv, yaml, question] = await Promise.all([
    readFile(new URL('../../examples/sales/sales-case.csv', import.meta.url)),
    readFile(new URL('../../examples/sales/sales-semantic.yaml', import.meta.url), 'utf8'),
    readFile(new URL('../../examples/sales/sales-question.txt', import.meta.url), 'utf8'),
  ]);
  const source = await createSource(csv, 'sales-case.csv', {
    name: 'sales-semantic.yaml',
    definition: parse(yaml),
  });
  return { source, question: question.trim() };
}
