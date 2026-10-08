import { spawnSync } from 'node:child_process';

// Run the same development gate locally and on both desktop CI hosts.
// No server, real credentials, signing, or release bundles are needed.
if (!['win32', 'linux'].includes(process.platform)) {
  throw new Error('The desktop development gate currently covers Windows and Linux.');
}

function run(command, args) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    // pnpm is a .cmd shim on Windows. Arguments here are fixed, never user input.
    shell: process.platform === 'win32' && command === 'pnpm',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.platform === 'linux') {
  console.log('Checking Linux native development dependencies. See apps/desktop/README.md for setup.');
  run('pkg-config', ['--print-errors', '--exists', 'gtk+-3.0', 'webkit2gtk-4.1', 'javascriptcoregtk-4.1', 'libsoup-3.0', 'openssl', 'libsecret-1', 'dbus-1']);
}

run('pnpm', ['--filter', '@127vaults/desktop', 'check']);
run('pnpm', ['--filter', '@127vaults/desktop', 'test']);
run('cargo', ['test', '--locked', '-p', 'vaults-cli', '--lib']);
run('pnpm', ['--filter', '@127vaults/desktop', 'exec', 'tauri', 'build', '--no-bundle', '--', '--locked']);
