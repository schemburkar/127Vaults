import { spawn } from 'node:child_process';

export async function execute(command, args, options = {}) {
  if (!options.quiet) console.log(`> ${command} ${args.join(' ')}`);
  const capture = options.capture;
  const environment = { ...(options.env ?? process.env) };
  // Release gates launched by our integration tests must start their own test runner.
  delete environment.NODE_TEST_CONTEXT;
  const child = spawn(command, args, { cwd: options.cwd, env: environment, windowsHide: true,
    stdio: options.input !== undefined ? ['pipe', 'pipe', 'pipe'] : capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
  let stdout = '', stderr = '';
  child.stdout?.on('data', chunk => {
    stdout += chunk;
    if (!capture) process.stdout.write(chunk);
  });
  child.stderr?.on('data', chunk => {
    stderr = (stderr + chunk).slice(-65536);
    if (!capture) process.stderr.write(chunk);
  });
  const done = new Promise((accept, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? accept(stdout.trim()) : reject(Error(`${command} failed (${code}).${capture ? `\n${stderr.trim()}` : ''}`)));
  });
  if (options.input !== undefined) {
    child.stdin.on('error', () => {});
    child.stdin.end(options.input);
  }
  return done;
}
export async function pnpm(args, options = {}) {
  if (process.platform !== 'win32') return execute('pnpm', args, options);
  // Fixed PowerShell code; argument values cross stdin as JSON, including spaces/Unicode.
  const script = '$request = [Console]::In.ReadToEnd() | ConvertFrom-Json; $releaseArguments = @($request.args); & pnpm @releaseArguments; exit $LASTEXITCODE';
  return execute('powershell.exe', ['-NoProfile', '-Command', script], { ...options, input: JSON.stringify({ args }) });
}
