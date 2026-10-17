import { isIP } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
export function tailscaleIPv4(value) {
  const [a, b] = String(value).split('.').map(Number);
  return isIP(value) === 4 && a === 100 && b >= 64 && b <= 127;
}
export function tailscaleSelf(source) {
  const value = JSON.parse(source);
  const addresses = value.Self?.TailscaleIPs?.filter(tailscaleIPv4) ?? [];
  if (value.BackendState !== 'Running' || value.Self?.Online !== true || addresses.length !== 1) {
    throw Error('Sign in to Tailscale on the server and verify that this device is online.');
  }
  return addresses[0];
}
export async function discoverTailscale(run = execute) {
  const { stdout } = await run('tailscale', ['status', '--json'], { windowsHide: true, timeout: 10000, maxBuffer: 1048576 });
  return tailscaleSelf(stdout);
}
export async function enableTailnetForward(endpoint, run = execute) {
  if (!tailscaleIPv4(endpoint) || await discoverTailscale(run) !== endpoint) throw Error('Tailscale identity differs from the configured installation.');
  // Refuse to replace an operator's other routes, or to share a node configured
  // for public Funnel. Never run reset, funnel, or change tailnet policy.
  const { stdout } = await run('tailscale', ['serve', 'status', '--json'], { windowsHide: true, timeout: 10000, maxBuffer: 1048576 });
  const status = JSON.parse(stdout);
  if (Object.values(status.AllowFunnel ?? {}).some(Boolean)) throw Error('Public Funnel is enabled on this device; private setup refused.');
  const existing = status.TCP?.['12780'];
  if (existing && (existing.TCPForward !== '127.0.0.1:12780' || existing.TerminateTLS)) throw Error('Tailscale port 12780 is already used by another route.');
  await run('tailscale', ['serve', '--bg', '--tcp=12780', 'tcp://127.0.0.1:12780'], { windowsHide: true, timeout: 15000, maxBuffer: 1048576 });
}
