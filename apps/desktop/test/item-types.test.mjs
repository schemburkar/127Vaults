import test from 'node:test';
import assert from 'node:assert/strict';
import { RELATED_TYPES, addRelatedSection, addSection, addSectionField, itemType, ordinaryFields, primaryFields, removeSection, renameSection, replaceItemType, sections, setItemType } from '../src/item-types.ts';

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

test('related details can repeat, be named, and include credential fields', () => {
  let fields = setItemType([], 'bank');
  fields = addRelatedSection(fields, 'card', 'Daily spending card');
  fields = addRelatedSection(fields, 'card', 'Travel backup card');
  assert.deepEqual(sections(fields).map(section => section.label), ['Daily spending card', 'Travel backup card']);
  fields = renameSection(fields, sections(fields)[1].id, 'Travel card');
  assert.equal(sections(fields)[1].label, 'Travel card');
  fields = addRelatedSection(fields, 'login', 'Mobile banking');
  assert.deepEqual(sections(fields)[2].fields.map(field => field.label), ['Website', 'Username', 'Password']);
  fields = addRelatedSection(fields, 'custom', 'Extra notes');
  fields = addSectionField(fields, sections(fields)[3].id);
  assert.equal(sections(fields)[3].fields.length, 1);
  assert.ok(RELATED_TYPES.bank.some(option => option.type === 'card'));
  assert.ok(!RELATED_TYPES.bank.some(option => option.type === 'ssh'));
});

test('replacing the parent type does not create an unrelated archived section', () => {
  let fields = setItemType([], 'bank');
  fields.find(field => field.id === 'account_number').value = 'fictional-account';
  fields = addRelatedSection(fields, 'card', 'Debit card');
  fields = replaceItemType(fields, 'wifi');
  assert.equal(itemType(fields), 'wifi');
  assert.deepEqual(sections(fields), []);
  assert.ok(!fields.some(field => field.id === 'account_number'));
});
