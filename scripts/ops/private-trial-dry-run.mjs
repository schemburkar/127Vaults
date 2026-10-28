// Compatibility launcher: separate local sites replace the combined preview.
// Prepared catalogues and legacy JSONL records are preserved, never silently migrated.
import { runLocalSites } from '../sites/local.mjs';
console.log('The combined preview is retired. This preview uses sample packages; prepared installers and previous trial records are not imported.');
await runLocalSites();
