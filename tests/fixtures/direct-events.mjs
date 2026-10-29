import { applyEvent, completeRun } from '../../shared/evidence.mjs';

export function emit(
  run,
  type,
  pairId,
  data = {},
  stepId = 'step-a',
  parentStepIds,
) {
  return applyEvent(run, {
    type,
    context: {
      eventId: `${pairId}:${type.endsWith('start') ? 'start' : 'end'}`,
      stepId,
      ...(parentStepIds ? { parentStepIds } : {}),
    },
    data,
  });
}
export function directRun({
  retry = true,
  summaryError = false,
  complete = true,
} = {}) {
  const run = {
    strategy: 'direct',
    question: '销售总额是多少？',
    status: 'running',
    nodes: [],
  };
  emit(run, 'stepstart', 'step-a', { step: 0 });
  if (retry) {
    emit(run, 'translatestart', 'translation-failed', {
      query: run.question,
      attempt: 0,
    });
    emit(run, 'translateend', 'translation-failed', {
      dsl: 'SELECT missing FROM data',
    });
    emit(run, 'querystart', 'query-failed', {
      dsl: 'SELECT missing FROM data',
    });
    emit(run, 'queryend', 'query-failed', {
      error: { message: 'Column missing not found' },
    });
  }
  emit(run, 'translatestart', 'translation-ok', {
    query: run.question,
    attempt: retry ? 1 : 0,
  });
  emit(run, 'translateend', 'translation-ok', {
    dsl: 'SELECT SUM(sales) AS total FROM data',
    usage: { totalTokens: 20 },
  });
  emit(run, 'querystart', 'query-ok', {
    dsl: 'SELECT SUM(sales) AS total FROM data',
  });
  emit(run, 'queryend', 'query-ok', {
    data: [{ total: 10 }],
    schema: [{ name: 'total' }],
    rowCount: 1,
    truncated: true,
    truncatedBy: 'maxRows',
  });
  emit(run, 'summarizestart', 'summary', { queryId: 'query-ok:end' });
  const report = {
    queryExplanation: '对全部记录的销售额求和，未筛选地区。',
    limitations: '仅包含当前数据，无法判断变化原因。',
    conclusion: '销售总额为 10。',
    nextStep: '比较各地区销售额。',
    usage: { totalTokens: 40 },
  };
  emit(
    run,
    'summarizeend',
    'summary',
    summaryError ? { error: { message: 'Invalid summary' } } : report,
  );
  emit(run, 'stepend', 'step-a', {
    step: 0,
    ...(summaryError
      ? { error: { message: 'Invalid summary' } }
      : { action: 'SQL', text: report.conclusion }),
  });
  if (summaryError) run.status = 'failed';
  else if (complete)
    completeRun(run, {
      query: run.question,
      ...report,
      sql: 'SELECT SUM(sales) AS total FROM data',
      data: [{ total: 10 }],
    });
  return run;
}
