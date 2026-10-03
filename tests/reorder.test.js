import test from 'node:test';
import assert from 'node:assert/strict';
import { moveSelection } from '../public/reorder.js';

test('thumbnail moves preserve relative order for contiguous and scattered selections', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(moveSelection(items,new Set(['b']),'d',true),['a','c','d','b','e']);
  assert.deepEqual(moveSelection(items,new Set(['d','b']),'e',true),['a','c','e','b','d']);
  assert.deepEqual(moveSelection(items,new Set(['c','d']),'a'),['c','d','a','b','e']);
  assert.deepEqual(moveSelection(items,new Set(['b','d']),null),['a','c','e','b','d']);
  assert.deepEqual(items,['a','b','c','d','e']);
});
test('drops on a selected card, invalid targets, empty selections, and select-all are safe', () => {
  const items=['a','b','c'];
  for (const [selected,target] of [[new Set(['b']),'b'],[new Set(['a']),'missing'],[new Set(),'b'],[new Set(items),null]]) {
    assert.deepEqual(moveSelection(items,selected,target),items);
  }
  assert.deepEqual(moveSelection([],new Set(),null),[]);
});
