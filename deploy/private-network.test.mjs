import test from 'node:test';
import assert from 'node:assert/strict';
import { tailscaleSelf, enableTailnetForward } from './private-network.mjs';

const self = JSON.stringify({BackendState:'Running',Self:{Online:true,TailscaleIPs:['100.99.146.58','fd7a:115c:a1e0::1']}});
test('Tailscale discovery uses the online native node identity, never a visitor-supplied address', () => {
  assert.equal(tailscaleSelf(self),'100.99.146.58');
  for (const source of ['{}','{',JSON.stringify({BackendState:'Stopped',Self:{Online:true,TailscaleIPs:['100.99.146.58']}}),
    JSON.stringify({BackendState:'Running',Self:{Online:true,TailscaleIPs:['8.8.8.8']}})]) assert.throws(()=>tailscaleSelf(source));
});
test('tailnet forwarding refuses Funnel and conflicting routes without mutating them', async () => {
  for (const config of [{AllowFunnel:{'server:443':true}},{TCP:{12780:{TCPForward:'127.0.0.1:9999'}}}]) {
    const calls=[];
    await assert.rejects(enableTailnetForward('100.99.146.58',async(_p,args)=>{
      calls.push(args);return {stdout:args[0]==='status'?self:JSON.stringify(config)};
    }));
    assert.equal(calls.length,2);
  }
});
test('tailnet forwarding preserves TLS and publishes only through Serve', async () => {
  const calls=[];
  await enableTailnetForward('100.99.146.58',async(_p,args)=>{calls.push(args);return {stdout:args[0]==='status'?self:'{}'};});
  assert.deepEqual(calls.at(-1),['serve','--bg','--tcp=12780','tcp://127.0.0.1:12780']);
});
