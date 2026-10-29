import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { createSource } from './store.mjs';

export async function loadSalesExample() {
  const [csv, yaml, question] = await Promise.all([
    readFile(new URL('../sales-case.csv', import.meta.url)),
    readFile(new URL('../sales-semantic.yaml', import.meta.url), 'utf8'),
    readFile(new URL('../sales-question.txt', import.meta.url), 'utf8'),
  ]);
  const source = await createSource(csv, 'sales-case.csv', {
    name: 'sales-semantic.yaml',
    definition: parse(yaml),
  });
  return { source, question: question.trim() };
}
