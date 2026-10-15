// Discover and explicitly select retained-fixture suites; never import them here.
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const {entries}=JSON.parse(await readFile(new URL('./suites.json',import.meta.url),'utf8'));
const args=process.argv.slice(2);if(args[0]==='--')args.shift();
if(!args.length||args[0]==='--help'){
 console.log('Internal acceptance suites (explicit retained fixtures; no run-all):\n  pnpm test:internal --list [--suite <area>]\n  pnpm test:internal --run <id> -- <fixture arguments>\n  pnpm test:internal:check\n  pnpm test:internal:audit\nSee tests/internal/README.md before running a mutating workflow.');
}else if(args[0]==='--list'){
 if(args.length!==1&&(args.length!==3||args[1]!=='--suite'))throw Error('Use --list [--suite <area>]');
 const selected=args[2]?entries.filter(e=>e.suite===args[2]):entries;if(!selected.length)throw Error('Unknown suite');
 for(const entry of selected)console.log(`${entry.suite.padEnd(10)} ${entry.id}`);
}else if(args[0]==='--run'){
 const entry=entries.find(e=>e.id===args[1]);if(!entry)throw Error('Unknown suite entry; use --list');
 if(['desktop-fixture-inspector','ownership-client'].includes(entry.id))throw Error('This entry is an imported helper, not a standalone workflow');
 if(args.length>2&&args[2]!=='--')throw Error('Separate fixture arguments with --');
 const child=spawn(process.execPath,[fileURLToPath(new URL('../../'+entry.path,import.meta.url)),...args.slice(3)],{cwd:fileURLToPath(new URL('../../',import.meta.url)),stdio:'inherit',windowsHide:true});
 child.on('error',error=>{console.error(error.message);process.exitCode=1;});child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
}else throw Error('Unknown option; use --help');
