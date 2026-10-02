import { connect } from 'node:tls';

const clean = value => typeof value === 'string' && /^[\x21-\x7e]+$/.test(value) && !/[\r\n]/.test(value);
export class SmtpMailer {
  constructor({ host, port = 465, username, password, from, installationLabel, timeoutMs = 5000 }) {
    if (!clean(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !clean(username) || !clean(password) || !clean(from) || !clean(installationLabel)) throw new Error('Invalid SMTP configuration.');
    Object.assign(this,{host,port,username,password,from,installationLabel,timeoutMs});
  }
  async sendCode({ to, code, expiresMinutes }) {
    const socket=connect({host:this.host,port:this.port,servername:this.host,rejectUnauthorized:true,minVersion:'TLSv1.2'});
    socket.setTimeout(this.timeoutMs,()=>socket.destroy(new Error('SMTP timeout.')));
    let buffer=''; const wait=expected=>new Promise((resolve,reject)=>{ const onData=chunk=>{ buffer+=chunk.toString('ascii'); const lines=buffer.split('\r\n'); if (lines.length<2) return; const last=lines[lines.length-2]; if (/^\d{3}-/.test(last)) return; cleanup(); const code=Number(last.slice(0,3)); expected.includes(code)?resolve():reject(new Error('SMTP rejected request.')); }; const onError=e=>{cleanup();reject(e)}; const cleanup=()=>{socket.off('data',onData);socket.off('error',onError)}; socket.on('data',onData);socket.on('error',onError); });
    const send=async(line,codes)=>{buffer='';socket.write(`${line}\r\n`,'ascii');await wait(codes)};
    try {
      await wait([220]); await send(`EHLO ${this.installationLabel}`,[250]);
      await send(`AUTH PLAIN ${Buffer.from(`\0${this.username}\0${this.password}`).toString('base64')}`,[235]);
      await send(`MAIL FROM:<${this.from}>`,[250]); await send(`RCPT TO:<${to}>`,[250,251]); await send('DATA',[354]);
      const body=`From: ${this.from}\r\nTo: ${to}\r\nSubject: 127Vaults verification code\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nYour ${this.installationLabel} verification code is ${code}. It expires in ${expiresMinutes} minutes.\r\n.`;
      await send(body,[250]); await send('QUIT',[221]);
    } finally { socket.destroy(); }
  }
}
