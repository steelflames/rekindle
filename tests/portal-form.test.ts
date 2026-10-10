import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { DEFAULT_SETTINGS } from '../shared/seeds.js';
import { TopicWeightInput } from '../web/fields.js';

test('default topic weights in collapsed advanced settings do not block the Tune form', () => {
  const fields = Object.entries(DEFAULT_SETTINGS.topicWeights).map(([label, value]) =>
    React.createElement(TopicWeightInput, { key: label, label, value, onChange() {} }));
  const markup = renderToStaticMarkup(React.createElement('form', {},
    React.createElement('details', {}, React.createElement('summary', {}, 'Advanced'), ...fields)));
  const dom = new JSDOM(markup);
  const form = dom.window.document.querySelector('form')!;
  const inputs = [...form.querySelectorAll('input')];
  assert.equal(form.querySelector('details')?.open, false);
  assert.equal(inputs.some(input => input.value === '0.75'), true, 'Exercise the actual fractional default that blocked Save appearance');
  assert.equal(inputs.every(input => !input.validity.stepMismatch), true);
  assert.equal(form.checkValidity(), true);
  dom.window.close();
});

test('topic controls allow tuned fractional values while keeping the supported bounds', () => {
  const dom = new JSDOM(renderToStaticMarkup(React.createElement('form', {},
    React.createElement(TopicWeightInput, { label: 'History', value: 1.137, onChange() {} }))));
  const input = dom.window.document.querySelector('input')!;
  assert.equal(input.checkValidity(), true);
  input.value = '0.001';
  assert.equal(input.checkValidity(), true);
  input.value = '3.001';
  assert.equal(input.validity.rangeOverflow, true);
  input.value = '-0.001';
  assert.equal(input.validity.rangeUnderflow, true);
  dom.window.close();
});
