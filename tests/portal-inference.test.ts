import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import type { InferenceAttempt } from '../shared/types.js';
import { InferenceAttemptNote } from '../web/inference-note.js';

function render(patch: Partial<InferenceAttempt> = {}) {
  const attempt: InferenceAttempt = {
    id: 'synthetic-test-attempt', startedAt: '2026-01-01T12:00:00Z', updatedAt: '2026-01-01T12:01:00Z',
    model: 'synthetic-test-model', status: 'rejected', code: 'integrity_rejected', httpStatus: 200,
    submittedComments: 113, usage: { inputTokens: 9000, outputTokens: 1500 }, ...patch,
  };
  return new JSDOM(renderToStaticMarkup(React.createElement(InferenceAttemptNote, { attempt })));
}

test('rejected inference discloses reported usage without claiming accepted analysis', () => {
  const dom = render();
  const text = dom.window.document.body.textContent!;
  assert.match(text, /Rejected by integrity checks/);
  assert.match(text, /Comments submitted113/);
  assert.match(text, /Input tokens9000/);
  assert.match(text, /Output tokens1500/);
  assert.match(text, /Original source material remains intact/);
  assert.match(text, /not proof of completed analysis/);
  assert.match(text, /No dollar estimate/);
  assert.doesNotMatch(text, /Comments in accepted analysis/);
  dom.window.close();
});

test('missing usage stays unreported and provider strings remain plain text', () => {
  const dom = render({ status: 'failed', code: 'http_error', model: '<script>unsafe()</script>', usage: { inputTokens: null, outputTokens: null } });
  const text = dom.window.document.body.textContent!;
  assert.equal((text.match(/Not reported/g) || []).length, 2);
  assert.equal(dom.window.document.querySelector('script'), null);
  assert.match(text, /<script>unsafe\(\)<\/script>/);
  assert.match(text, /No generated result was accepted/);
  dom.window.close();
});
