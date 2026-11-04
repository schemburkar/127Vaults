import { resolve } from 'node:path';
import { loadConfig } from './config.mjs';
import { execute, runWrangler } from './deploy.mjs';
const config = await loadConfig(resolve(process.argv[2]));
await execute('backup', config, { run: (args, settings) => runWrangler(args, settings, { capture: true }) });
