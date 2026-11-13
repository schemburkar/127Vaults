import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runtimeNamespace } from './runtime-namespace.mjs';
import { prepareExtensionAssets } from './extension-assets.mjs';

const namespace=runtimeNamespace(process.env,{launcher:true});
const root=resolve(import.meta.dirname,'..'), destination=join(root,'.tools/namespaces',namespace.id,'extension');
await mkdir(destination,{recursive:true});
for(const name of ['manifest.json','popup.html','src'])await cp(join(root,'apps/extension',name),join(destination,name),{recursive:true});
await prepareExtensionAssets(root,destination);
const manifestPath=join(destination,'manifest.json'),manifest=JSON.parse(await readFile(manifestPath,'utf8'));
manifest.name=namespace.displayName;manifest.action.default_title=namespace.displayName;delete manifest.key;
await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
const background=join(destination,'src/background.mjs');
await writeFile(background,(await readFile(background,'utf8')).replaceAll('com.127vaults.connector',namespace.nativeHost));
console.log(`Load ${destination} as an unpacked extension in a separate development browser profile. Register its ID with the namespace-matched native host.`);
