import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const spec = JSON.parse(read('packages/api-contract/openapi-v1.json'));

test('published operations match the canonical route inventory', () => {
  const section = read('docs/architecture/api-v1-contract.md').split('## Canonical HTTP routes')[1].split('## Ceremony request boundaries')[0];
  const documented = [...section.matchAll(/^\| `(GET|POST|PUT|DELETE)` \| `([^`]+)` \|/gm)].map(([, method, path]) => `${method} ${path}`).sort();
  const published = Object.entries(spec.paths).flatMap(([path, operations]) => Object.keys(operations).map(method => `${method.toUpperCase()} ${path}`)).sort();
  assert.deepEqual(published, documented);
  assert.equal(new Set(published).size, published.length);
  for (const operations of Object.values(spec.paths)) for (const [method, operation] of Object.entries(operations)) {
    assert.ok(operation.responses['200']);
    assert.ok(operation.responses.default);
    if (method === 'post' || method === 'put') {
      const schema = operation.requestBody?.content?.['application/json']?.schema;
      for (const variant of schema.oneOf ?? [schema]) {
        assert.equal(variant?.type, 'object');
        assert.equal(variant.additionalProperties, false);
        assert.deepEqual([...variant.required].sort(), Object.keys(variant.properties).sort());
      }
    }
  }
});

test('server and supported clients no longer contain experimental HTTP paths', () => {
  for (const path of ['apps/server/src/auth-handler.mjs', 'apps/server/src/onboarding-handler.mjs', 'apps/server/src/device-enrollment-handler.mjs', 'apps/server/src/device-lifecycle-handler.mjs', 'apps/server/src/private-vault-handler.mjs', 'apps/server/src/sync-handler.mjs', 'apps/web/mvp-client.mjs', 'apps/cli/src/client.rs', 'apps/cli/src/lib.rs']) {
    assert.equal(read(path).includes(['/api', '/experimental/'].join('')), false, path);
  }
});

test('credential rotation schemas describe the authenticated preparation and completion boundaries', () => {
  for (const kind of ['password', 'account-secret']) {
    const schema = suffix => spec.paths[`/api/v1/devices/rotate-${kind}${suffix}`].post.requestBody.content['application/json'].schema;
    assert.deepEqual(schema('/start').required, ['request', 'deviceId', 'nonce', 'issuedAt', 'authorizationSignature']);
    assert.equal(schema('/start').properties.issuedAt.type, 'integer');
    assert.deepEqual(schema('').required, ['candidate', 'authorizationSignature', 'settings']);
    assert.equal(schema('').properties.candidate.additionalProperties, false);
    assert.deepEqual(schema('').properties.candidate.required.sort(), ['accountId', 'deviceId', 'signingPublicKey', 'opaqueUpload', 'wrappedRootDescriptor', 'wrappedRootEnvelope', 'registrationArtifact', 'activationSignature'].sort());
    assert.equal(schema('').properties.settings.oneOf[0].type, 'null');
  }
});
