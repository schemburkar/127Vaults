import assert from "node:assert/strict";
import test from "node:test";

import { assertSyncCursor } from "../src/index.mjs";

test("accepts non-negative safe integer cursors", () => {
  assert.equal(assertSyncCursor(0), 0);
  assert.equal(assertSyncCursor(42), 42);
});

test("rejects invalid cursors", () => {
  assert.throws(() => assertSyncCursor(-1), TypeError);
  assert.throws(() => assertSyncCursor(1.5), TypeError);
});
