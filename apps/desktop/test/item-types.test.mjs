import test from 'node:test';
import assert from 'node:assert/strict';
import { addSection, itemType, ordinaryFields, primaryFields, removeSection, sections, setItemType } from '../src/item-types.ts';

test('known fields stay in typed sections while user fields stay custom', () => {
  let fields = setItemType([], 'bank');
  assert.equal(itemType(fields), 'bank');
  assert.deepEqual(primaryFields(fields).map(field => field.id), ['bank_name', 'account_number', 'bank_pin']);
  fields = addSection(fields, 'card');
  fields = addSection(fields, 'security');
  assert.deepEqual(sections(fields).map(section => section.type), ['card', 'security']);
  assert.deepEqual(sections(fields)[1].fields.map(field => field.label), ['Security question', 'Answer']);
  fields.push({ id: 'personal-note', label: 'Note', type: 'text', value: 'example' });
  assert.deepEqual(ordinaryFields(fields).map(field => field.id), ['personal-note']);
  fields = removeSection(fields, sections(fields)[0].id);
  assert.deepEqual(sections(fields).map(section => section.type), ['security']);
  fields.find(field => field.id === 'account_number').value = 'fictional-account';
  fields = setItemType(fields, 'card');
  assert.deepEqual(sections(fields).map(section => section.type), ['security', 'bank']);
  assert.equal(sections(fields)[1].fields.find(field => field.label === 'Account number').value, 'fictional-account');
});
