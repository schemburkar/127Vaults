// Cloudflare Email Sending REST API; credentials stay in the intake process.
export function createCloudflareTrialMailer({ accountId, apiToken, from, fetchImpl = fetch }) {
  const email = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/;
  if (!/^[a-f0-9]{32}$/.test(accountId ?? '') || typeof apiToken !== 'string'
    || !/^[\x21-\x7e]{20,512}$/.test(apiToken) || !email.test(from ?? '')) throw Error('Invalid Cloudflare email configuration.');
  return {
    async sendInvitation({ to, subject, text }) {
      if (!email.test(to ?? '') || typeof subject !== 'string' || /[\r\n]/.test(subject)
        || typeof text !== 'string' || text.length > 12000) throw Error('Invalid invitation.');
      const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`, {
        method: 'POST', headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, from, subject, text }), redirect: 'manual', signal: AbortSignal.timeout(15000),
      });
      // Workers supports manual/follow, but not redirect:error. Never follow a provider redirect with credentials.
      if (response.status >= 300 && response.status < 400) throw Error('Email submission was not confirmed.');
      const value = await response.json();
      if (!response.ok || value.success !== true) throw Error('Email submission was not confirmed.');
      const result = value.result;
      if (result?.permanent_bounces?.includes(to)) return { state: 'bounced' };
      if (result?.delivered?.includes(to)) return { state: 'accepted' };
      if (result?.queued?.includes(to)) return { state: 'queued' };
      throw Error('Email submission was not confirmed.');
    },
  };
}
