import test from 'node:test';
import assert from 'node:assert/strict';
import { RELATED_TYPES, addRelatedSection, addSection, addSectionField, itemType, ordinaryFields, primaryFields, removeSection, renameSection, replaceItemType, sections, setItemType } from '../src/item-types.ts';

test('passkey reserved fields are hidden and survive attempted type conversion', () => {
  const fields = setItemType([{ id: '__127vaults_passkey', label: 'Passkey', type: 'metadata', value: '{}' }, { id: '__127vaults_passkey_key', label: 'Private key', type: 'password', value: 'secret' }], 'passkey');
  assert.equal(itemType(fields), 'passkey');
  assert.deepEqual(ordinaryFields(fields), []);
  assert.deepEqual(replaceItemType(fields, 'login'), fields);
});

test('favorites and authenticator metadata survive type changes without appearing as ordinary fields', () => {
  const favorite = { id: '__127vaults_favorite', label: 'Favorite', type: 'metadata', value: 'true' };
  const otp = { id: '__127vaults_totp', label: 'Authenticator secret', type: 'password', value: 'JBSWY3DPEHPK3PXP' };
  const fields = replaceItemType(setItemType([favorite, otp], 'login'), 'bank');
  assert.deepEqual(fields.find(f => f.id === favorite.id), favorite);
  assert.deepEqual(fields.find(f => f.id === otp.id), otp);
  assert.deepEqual(ordinaryFields(fields), []);
});

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


test('legacy raw imported JSON stays out of displayed and editable fields', () => {
  const raw = {id:'migration-source',label:'Original imported record (JSON)',type:'password',value:'{"private":"legacy"}'};
  const notes = {id:'migration-notes',label:'Notes',type:'note',value:'Readable note'};
  assert.deepEqual(ordinaryFields([raw,notes]), [notes]);
});

test('backup codes are masked recovery details separate from TOTP metadata', () => {
  const option = RELATED_TYPES.login.find(option => option.type === 'backup');
  assert.equal(option.label, 'Backup code');
  const fields = addRelatedSection([{ id: '__127vaults_totp', label: 'Authenticator secret', type: 'password', value: 'JBSWY3DPEHPK3PXP' }], option.type, option.label);
  const [section] = sections(fields);
  assert.equal(section.type, 'backup');
  assert.deepEqual(section.fields.map(({label, type}) => ({label, type})), [{label: 'Backup code', type: 'password'}]);
  assert.equal(fields.find(field => field.id === '__127vaults_totp').value, 'JBSWY3DPEHPK3PXP');
  const legacy = sections(addRelatedSection([], 'password', 'Authenticator or backup code'));
  assert.equal(legacy[0].fields[0].type, 'password');
});
