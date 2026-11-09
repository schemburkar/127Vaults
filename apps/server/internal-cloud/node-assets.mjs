import { readFile } from 'node:fs/promises';
import { createCloudLanding } from './landing.mjs';
import { createCloudWebAssets } from './web-assets.mjs';

export const serveCloudLanding = createCloudLanding(file => readFile(new URL(file, import.meta.url)));
export const cloudWebAssets = createCloudWebAssets(file => readFile(new URL(`../../web/dist/${file}`, import.meta.url)));
