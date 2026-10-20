import test from 'node:test';
import assert from 'node:assert/strict';
import { tailscaleSelf, enableTailnetForward, tailscaleProgram } from './private-network.mjs';

const self = JSON.stringify({BackendState:'Running',Self:{Online:true,TailscaleIPs:['100.64.0.10','fd7a:115c:a1e0::1']}});
test('Tailscale discovery uses the online native node identity, never a visitor-supplied address', () => {
  assert.equal(tailscaleSelf(self),'100.64.0.10');
  for (const source of ['{}','{',JSON.stringify({BackendState:'Stopped',Self:{Online:true,TailscaleIPs:['100.64.0.10']}}),
    JSON.stringify({BackendState:'Running',Self:{Online:true,TailscaleIPs:['8.8.8.8']}})]) assert.throws(()=>tailscaleSelf(source));
});
test('tailnet forwarding refuses Funnel and conflicting routes without mutating them', async () => {
  for (const config of [{AllowFunnel:{'server:443':true}},{TCP:{12780:{TCPForward:'127.0.0.1:9999'}}}]) {
    const calls=[];
    await assert.rejects(enableTailnetForward('100.64.0.10',async(_p,args)=>{
      calls.push(args);return {stdout:args[0]==='status'?self:JSON.stringify(config)};
    }));
    assert.equal(calls.length,2);
  }
});
test('tailnet forwarding preserves TLS and publishes only through Serve', async () => {
  const calls=[];
  await enableTailnetForward('100.64.0.10',async(_p,args)=>{calls.push(args);return {stdout:args[0]==='status'?self:JSON.stringify({TCP:{12780:{TCPForward:'127.0.0.1:12780'}}})};});
  assert.deepEqual(calls.at(-2),['serve','--bg','--tcp=12780','tcp://127.0.0.1:12780']);
});

test('Windows setup finds the installed Tailscale executable before PATH refresh', () => {
  assert.match(tailscaleProgram({ platform: 'win32', programFiles: 'C:/Program Files', exists: () => true }), /Tailscale[\\/]tailscale.exe$/);
  assert.equal(tailscaleProgram({ platform: 'linux' }), 'tailscale');
});
test('successful command without the correct private route never reports setup success', async () => {
  for (const after of [{}, {TCP:{12780:{TCPForward:'127.0.0.1:9999'}}}, {TCP:{12780:{TCPForward:'127.0.0.1:12780',HTTPS:true}}}, {AllowFunnel:{'node:12780':true}}]) {
    let statusReads = 0;
    await assert.rejects(enableTailnetForward('100.64.0.10', async (_program, args) => {
      if (args[0] === 'status') return {stdout:self};
      if (args[1] === 'status') return {stdout:JSON.stringify(++statusReads === 1 ? {} : after)};
      return {stdout:''};
    }), /did not confirm/);
  }
});
