export async function loadRequests(fetcher) {
  const response = await fetcher('/api/access-admin/requests');
  if (!response.ok) throw Error('Requests could not be loaded. Refresh and try again.');
  const data = await response.json();
  await Promise.all(data.requests.filter(row => row.billingStatus).map(async row => {
    if (Object.hasOwn(row,'billingMode')) { row.billingDetails={paidThrough:row.billingPaidThrough}; return; }
    const response = await fetcher('/api/access-admin/billing/' + encodeURIComponent(row.id));
    if (response.ok) { row.billingDetails = await response.json(); row.billingMode = row.billingDetails.mode; }
  }));
  return data;
}
export const billingModeLabel = row => row.billingMode === 'test_mode' ? 'Dodo test mode' : row.billingMode === 'live_mode' ? 'Dodo live mode' : 'Billing mode unverified';
