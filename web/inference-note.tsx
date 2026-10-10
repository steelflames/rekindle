import React from 'react';
import type { InferenceAttempt } from '../shared/types';

export function InferenceAttemptNote({ attempt }: { attempt: InferenceAttempt }) {
  const labels: Record<InferenceAttempt['status'], string> = {
    started: 'Request started', received: 'Response received', accepted: 'Accepted',
    rejected: 'Rejected by integrity checks', failed: 'Failed', cancelled: 'Cancelled',
  };
  const notAccepted = ['rejected', 'failed', 'cancelled'].includes(attempt.status);
  return <details className="coverage inference-attempt">
    <summary>Latest inference attempt</summary>
    <div className="coverage-body">
      <dl>
        <div><dt>Status</dt><dd>{labels[attempt.status]}</dd></div>
        <div><dt>Model</dt><dd>{attempt.model}</dd></div>
        <div><dt>Started</dt><dd>{new Date(attempt.startedAt).toLocaleString()}</dd></div>
        <div><dt>Comments submitted</dt><dd>{attempt.submittedComments}</dd></div>
        <div><dt>Input tokens</dt><dd>{attempt.usage.inputTokens ?? 'Not reported'}</dd></div>
        <div><dt>Output tokens</dt><dd>{attempt.usage.outputTokens ?? 'Not reported'}</dd></div>
      </dl>
      {notAccepted && <p>No generated result was accepted from this attempt. Original source material remains intact.</p>}
      <p>Submitted comments were selected for the request, not proof of completed analysis. Token counts are provider-reported; a rejected result can still use tokens. No dollar estimate is shown.</p>
    </div>
  </details>;
}
