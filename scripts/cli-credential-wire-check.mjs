// Local test-only cross-language verification. Input contains public/encrypted ceremony data.
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { credentialPreparationBytes, credentialRotationBytes } from '../apps/server/src/credential-rotation.mjs';
import { createRegistrationCompletion } from '../apps/server/src/opaque-adapter.mjs';
let source = '';
for await (const chunk of process.stdin) {
  source += chunk;
  if (source.length > 100000) throw Error('Fixture exceeds test boundary');
}
const { auth, origin, kind, preparation, candidate, settings, authorizationSignature, artifact, record, currentPublicKey } = JSON.parse(source);
const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(currentPublicKey, 'base64url')]), format: 'der', type: 'spki' });
assert.ok(verify(null, credentialPreparationBytes({ auth, origin, kind, ...preparation }), key, Buffer.from(preparation.authorizationSignature, 'base64url')));
const completed = await createRegistrationCompletion({ serverRegistrationFinish: async () => Buffer.from(record, 'base64url') }, {
  verifyArtifact: () => artifact,
})(candidate);
assert.ok(verify(null, credentialRotationBytes({ auth, kind, epoch: auth.credentialEpoch + 1, candidate: completed, artifact, settings }), key, Buffer.from(authorizationSignature, 'base64url')));
