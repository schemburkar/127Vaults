import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("switching apps does not clear login material or lock the vault", async () => {
  const source = await readFile(new URL("../src/app.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /addEventListener\(["']blur["']/);
  assert.doesNotMatch(source, /addEventListener\(["']visibilitychange["']/);
  assert.match(source, /onClick=\{\(\)\s*=>\s*void lock\(\)\}/);
});

test("desktop registration enrolls a device instead of reopening account signup", async () => {
  const [app, rust] = await Promise.all([
    readFile(new URL("../src/app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/src/main.rs", import.meta.url), "utf8"),
  ]);
  assert.match(app, /Register this desktop/);
  assert.match(app, /begin_device_enrollment/);
  assert.match(app, /device_enrollment_status/);
  assert.match(rust, /enroll_device_with_status/);
  assert.match(rust, /device\.conf\.before-enrollment/);
  assert.match(app, /Desktop registered/);
  assert.match(app, /Continue to unlock/);
});

test("desktop item details include custom fields and field actions", async () => {
  const [app, rust, client] = await Promise.all([
    readFile(new URL("../src/app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/src/main.rs", import.meta.url), "utf8"),
    readFile(new URL("../../cli/src/client.rs", import.meta.url), "utf8"),
  ]);
  assert.match(app, /customFields: CustomField\[\]/);
  assert.match(app, /"Hide"\s*:\s*"Reveal"/);
  assert.match(app, /<span>Copy<\/span>/);
  assert.match(app, /<span>Drag<\/span>/);
  assert.match(app, /Add field/);
  assert.match(rust, /fn item_secret/);
  assert.match(rust, /custom_fields: Vec<Value>/);
  assert.match(rust, /error\.contains\("409"\)/);
  assert.match(app, /event\.key\.toLowerCase\(\) !== "r"/);
  assert.match(app, /event\.preventDefault\(\)/);
  assert.match(app, /LoaderCircle className="animate-spin"/);
  assert.doesNotMatch(app, /Checking encrypted replica/);
  assert.match(app, /const cancelEditing/);
  assert.match(app, /setSelected\(editOriginal\)/);
  assert.match(client, /vault_handles/);
  assert.match(client, /\.release\(handle\)/);
});
