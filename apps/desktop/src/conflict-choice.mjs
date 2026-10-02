export const conflictFields = ["title", "website", "username", "password", "customFields"];

export function choicesForConflict(conflict) {
  return Object.fromEntries(conflictFields.map((field) => [
    field,
    conflict.localFields?.includes(field) && !conflict.remoteFields?.includes(field) ? "local" : "server",
  ]));
}
