import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpsTelemetry } from '../src/ops-log.mjs';

test('operational events have bounded fields and no request material', () => {
  let time = 1000;
  const lines = [];
  const ops = createOpsTelemetry({ now: () => time, sink: line => lines.push(JSON.parse(line)) });
  time += 1250;
  ops.request('POST', 403, 12.6);
  ops.request('SENSITIVE\nMETHOD', 503, 3);
  ops.request('GET', 200, 1, false);
  assert.deepEqual(ops.snapshot(), { uptimeSeconds: 1, requests: { success: 1, clientError: 1, serverError: 1 } });
  assert.deepEqual(lines.map(line => [line.event, line.method, line.status]), [['http_request', 'POST', 403], ['http_request', 'OTHER', 503]]);
  assert.equal(JSON.stringify(lines).includes('SENSITIVE'), false);
  assert.throws(() => ops.event('user_input'));
});
