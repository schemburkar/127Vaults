export function availableManageViews(value){
 const views=['overview','subscriptions'];
 if(value.cloudTenants?.length||value.cloudUnavailable)views.push('cloud');
 if(value.scope==='email')views.push('security','plans');
 return views;
}
export function accountSummary(value){
 return {access:value.requests.length,activeSubscriptions:value.requests.filter(row=>row.billingStatus==='active'&&row.state==='approved'&&row.billingMode!=='test_mode').length,cloud:value.cloudUnavailable?null:value.cloudTenants?.length??0};
}
export function selectManageView(requested,value){return availableManageViews(value).includes(requested)?requested:'overview';}

export function formatManageDate(value){const date=new Date(value);return value&&Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric'}).format(date):'—';}
