import { completeRun } from '../../shared/evidence.mjs';
import { emit } from './direct-events.mjs';

export function loopRun({
  confirmed = true,
  running = false,
  failed = false,
} = {}) {
  const run = {
    strategy: 'loop',
    question: '销售总额是多少？',
    status: 'running',
    nodes: [],
  };
  const send = (step, type, id, data) =>
    emit(
      run,
      type,
      id,
      data,
      step,
      step === 'explore'
        ? []
        : [{ refine: 'explore', answer: 'refine', confirm: 'answer' }[step]],
    );
  send('explore', 'stepstart', 'explore', { step: 0 });
  send('explore', 'querystart', 'bad', { dsl: 'SELECT missing FROM data' });
  send('explore', 'queryend', 'bad', { error: { message: 'Unknown column' } });
  send('explore', 'querystart', 'sample', {
    dsl: 'SELECT sales FROM data LIMIT 2',
  });
  send('explore', 'queryend', 'sample', {
    data: [{ sales: 3 }, { sales: 7 }],
    rowCount: 2,
  });
  send('explore', 'stepend', 'explore', {
    step: 0,
    action: 'EXPLORE',
    text: '[EXPLORE] 检查销售额字段。',
  });
  send('refine', 'stepstart', 'refine', { step: 1 });
  send('refine', 'stepend', 'refine', {
    step: 1,
    action: 'REFINE',
    text: '[REFINE] 使用 sales 字段求和。',
  });
  send('answer', 'stepstart', 'answer', {
    step: 2,
    ...(!confirmed && { finalAttempt: true }),
  });
  if (failed) {
    send('answer', 'stepend', 'answer', {
      step: 2,
      error: { message: 'Model unavailable' },
    });
    run.status = 'failed';
    return run;
  }
  send('answer', 'querystart', 'total', {
    dsl: 'SELECT SUM(sales) AS total FROM data',
  });
  if (running) return run;
  const result = {
    data: [{ total: 10 }],
    rowCount: 1,
    schema: [{ name: 'total' }],
  };
  send('answer', 'queryend', 'total', result);
  send('answer', 'stepend', 'answer', {
    step: 2,
    action: 'SQL',
    text: '[SQL] 查询销售总额。',
    ...(!confirmed && { finalAttempt: true }),
  });
  if (confirmed) {
    send('confirm', 'stepstart', 'confirm', { step: 3 });
    send('confirm', 'stepend', 'confirm', {
      step: 3,
      action: 'CONFIRM',
      text: '[CONFIRM] 已检查两行数据，销售总额为 10。',
    });
  }
  completeRun(run, {
    ...result,
    sql: 'SELECT SUM(sales) AS total FROM data',
    text: confirmed ? '已检查两行数据，销售总额为 10。' : '[{"total":10}]',
  });
  return run;
}
