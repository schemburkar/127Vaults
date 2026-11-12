// Account capabilities may open only the exact pinned server/tenant setup path.
export function accountInvitation(value, registrationUrl) {
  const invitation=new URL(value),server=new URL(registrationUrl);
  if(invitation.protocol!=='https:' || invitation.origin!==server.origin || invitation.pathname!==server.pathname ||
    invitation.username || invitation.password || invitation.search || !/^#memberInvite=127V-I1-[A-Za-z0-9_-]{43}$/.test(invitation.hash))
    throw Error('Use the account invitation from this server’s administrator.');
  return invitation.href;
}
