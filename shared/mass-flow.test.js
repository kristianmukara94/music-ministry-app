// Tests for the 31-step Mass flow. Run with: node --test shared/mass-flow.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MASS_FLOW, stepFor, stepSourceId } from './mass-flow.js';

const count = (block) => MASS_FLOW.filter((step) => step.block === block).length;

test('the flow has 31 steps in the five sections, in order', () => {
  assert.equal(MASS_FLOW.length, 31);
  assert.equal(count('introductory'), 6);
  assert.equal(count('word'), 8);
  assert.equal(count('eucharist'), 7);
  assert.equal(count('communion'), 6);
  assert.equal(count('concluding'), 4);
  const order = ['introductory', 'word', 'eucharist', 'communion', 'concluding'];
  const blocks = MASS_FLOW.map((step) => step.block);
  assert.deepEqual(blocks, [...blocks].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
});

test('step ids are unique and every step has a kind the planner understands', () => {
  const ids = MASS_FLOW.map((step) => step.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const step of MASS_FLOW) assert.ok(['song', 'reading', 'note'].includes(step.kind), step.id);
});

test('the three readings are reading steps, and the songs in the spec are song steps', () => {
  const kinds = Object.fromEntries(MASS_FLOW.map((step) => [step.id, step.kind]));
  assert.equal(kinds['first-reading'], 'reading');
  assert.equal(kinds['second-reading'], 'reading');
  assert.equal(kinds.gospel, 'reading');
  for (const id of ['entrance', 'kyrie', 'gloria', 'psalm', 'gospel-acclamation', 'offertory', 'sanctus', 'memorial-acclamation', 'great-amen', 'our-father', 'agnus-dei', 'communion-procession', 'thanksgiving', 'recessional']) {
    assert.equal(kinds[id], 'song', id);
  }
});

test('a placeholder sourceId maps back to its step; other sourceIds map to nothing', () => {
  const step = MASS_FLOW.find((s) => s.id === 'psalm');
  assert.equal(stepFor(stepSourceId(step)), step);
  assert.equal(stepFor('gloria'), null);
  assert.equal(stepFor('step:unknown'), null);
  assert.equal(stepFor(undefined), null);
});
