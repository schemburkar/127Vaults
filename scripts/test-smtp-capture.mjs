import { createServer } from 'node:tls';
import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const tlsDir=process.env.SMTP_FIXTURE_TLS_DIR??'/run/secrets/tls';
const cert=await readFile(`${tlsDir}/server.crt`),key=await readFile(`${tlsDir}/server.key`);
let latest=new Map();
const server=createServer({cert,key,minVersion:'TLSv1.2'},socket=>{
  socket.setEncoding('ascii'); socket.write('220 smtp.127vaults.test ESMTP\r\n');
  let buffer='',data=false,lines=[];
  const reply=(code,text)=>socket.write(`${code} ${text}\r\n`);
  socket.on('data',chunk=>{buffer+=chunk;for(;;){const at=buffer.indexOf('\r\n');if(at<0)return;const line=buffer.slice(0,at);buffer=buffer.slice(at+2);
    if(data){if(line==='.') {data=false;const raw=lines.join('\r\n');const to=/^To:\s*(.+)$/mi.exec(raw)?.[1]?.trim();const code=/verification code is (\d{8})\./.exec(raw)?.[1];if(!to||!code){reply(554,'invalid message');continue;}latest.set(to,code);reply(250,'queued');lines=[];}else lines.push(line);continue;}
    if(/^EHLO /.test(line))socket.write('250-smtp.127vaults.test\r\n250 AUTH PLAIN\r\n');
    else if(line===`AUTH PLAIN ${Buffer.from('\0fixture\0fixture-password').toString('base64')}`)reply(235,'authenticated');
    else if(/^MAIL FROM:/.test(line)||/^RCPT TO:/.test(line))reply(250,'ok');
    else if(line==='DATA'){data=true;reply(354,'end with dot');}
    else if(line==='QUIT'){reply(221,'bye');socket.end();}
    else reply(500,'unsupported');
  }});
});
server.listen(2465,'127.0.0.1',()=>console.log('Disposable SMTP capture ready.'));
const control=createHttpServer((req,res)=>{const url=new URL(req.url,'http://127.0.0.1');if(req.method!=='GET'||url.pathname!=='/latest'){res.writeHead(404).end();return;}const code=latest.get(url.searchParams.get('to'));if(!code){res.writeHead(404).end();return;}res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({code}));});
control.listen(1465,'0.0.0.0');
process.on('SIGTERM',()=>{server.close();control.close();});
