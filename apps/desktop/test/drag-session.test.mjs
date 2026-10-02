import assert from "node:assert/strict";
import test from "node:test";
import { createDragSession, LOCKED_MESSAGE } from "../src/drag-session.mjs";

test("locked sessions refuse a drag", () => {
  const session = createDragSession();
  assert.throws(() => session.begin("username", "fake"), { message: LOCKED_MESSAGE });
});

test("ending or locking clears the transient payload", () => {
  const session = createDragSession();
  session.unlock();
  assert.equal(session.begin("password", "fake"), "fake");
  assert.equal(session.hasActivePayload(), true);
  session.end();
  assert.equal(session.hasActivePayload(), false);
  session.begin("username", "fake");
  session.lock();
  assert.equal(session.hasActivePayload(), false);
});

test("inactivity locks before a drag can begin", () => {
  let clock = 0;
  const session = createDragSession({ now: () => clock, timeoutMs: 100 });
  session.unlock();
  clock = 101;
  assert.throws(() => session.begin("password", "fake"), { message: LOCKED_MESSAGE });
  assert.equal(session.isUnlocked(), false);
});
