/** @type {Array<[string, RegExp, string, string, string]>} */
const cases=[
 ['identity',/fingerprint.*match|identity.*chang|trust profile.*different|checkpoint.*(differ|chang)|SERVER_IDENTITY_CHANGED/i,'Server identity changed','Keep the existing trust and local data. Ask your administrator to verify the original server identity before reconnecting.','Contact administrator'],
 ['tailscale',/tailscale|tailnet peer/i,'Private network disconnected','Connect this computer to the correct Tailscale network, then retry.','Check network'],
 ['certificate',/certificate|pinned HTTPS.*untrusted|TLS/i,'Server certificate needs attention','Confirm the public certificate with your administrator. Desktop trust and browser trust are separate; do not bypass certificate validation.','Check certificate'],
 ['approval',/awaiting.*approval|pending.*approval|not enrolled|needs.*enrollment|device.*unavailable/i,'Device approval required','Register this device and approve its code from an already trusted vault session.','Approve device'],
 ['revoked',/device.*revoked|DEVICE_REVOKED|device.*replaced/i,'Device access revoked','Ask your administrator to review this device. Re-enrollment requires approval; local data is preserved.','Review device'],
 ['license',/license|entitlement/i,'License needs attention','Ask the server operator to check license status and renew or replace it through Manage. Existing encrypted data is preserved.','Contact server operator'],
 ['keyring',/credential stor|keyring|secret service/i,'OS credential storage unavailable','Unlock the operating system credential store and retry. Credentials will not be saved to a plaintext file.','Unlock credential store'],
 ['network',/unreachable|connect.*fail|server connection failed|timed out|SERVER_TIMEOUT|SERVER_UNREACHABLE/i,'Cannot reach the server','Check that the server is running and this computer is on its private network. Retry after connectivity is restored.','Retry connection'],
 ['authentication',/authentication failed|sign.in.*refused|server rejected request \(401\)/i,'Sign-in was not accepted','Check your credentials. If they are correct, ask your administrator to review account and device access.','Review sign-in'],
];
export function connectionHelp(error) {
 const text=String(error?.message??error??'');
 const row=cases.find(([,pattern])=>pattern.test(text));
 return row?{category:row[0],title:row[2],message:row[3],action:row[4]}:null;
}
export function diagnosticReport(surface,observations={}) {
 const allowedSurface=['desktop','web','extension','installer','server-admin'].includes(surface)?surface:'unknown';
 const report={schemaVersion:1,surface:allowedSurface,category:connectionHelp(observations.error)?.category??'unknown'};
 for(const key of ['trustConfigured','deviceEnrolled','networkReachable','connectorAvailable','unlocked'])if(typeof observations[key]==='boolean')report[key]=observations[key];
 if(['desktop','cli','web'].includes(observations.source))report.source=observations.source;
 return report;
}
