export type ConflictChoices = Record<"title" | "website" | "username" | "password" | "customFields", "local" | "server">;
export declare const conflictFields: readonly (keyof ConflictChoices)[];
export declare function choicesForConflict(conflict: { localFields?: string[]; remoteFields?: string[] }): ConflictChoices;
