export async function loadRequests(fetcher) {
  const response = await fetcher('/api/access-admin/requests');
  if (!response.ok) throw Error('Requests could not be loaded. Refresh and try again.');
  const data = await response.json();
  await Promise.all(data.requests.filter(row => row.billingStatus).map(async row => {
    const response = await fetcher('/api/access-admin/billing/' + encodeURIComponent(row.id));
    if (response.ok) row.billingMode = (await response.json()).mode;
  }));
  return data;
}
export const billingModeLabel = row => row.billingMode === 'test_mode' ? 'Dodo test mode' : row.billingMode === 'live_mode' ? 'Dodo live mode' : 'Billing mode unverified';
