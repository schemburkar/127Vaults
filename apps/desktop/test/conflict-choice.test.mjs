import test from "node:test";
import assert from "node:assert/strict";
import { choicesForConflict } from "../src/conflict-choice.mjs";

test("engine change metadata preserves remote-only fields in a reviewed merge", () => {
  const choices = choicesForConflict({
    localFields: ["title", "password"],
    remoteFields: ["website", "password"],
  });
  assert.equal(choices.title, "local");
  assert.equal(choices.website, "server");
  assert.equal(choices.password, "server");
  assert.equal(choices.username, "server");
});
