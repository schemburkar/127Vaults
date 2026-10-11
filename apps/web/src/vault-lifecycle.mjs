const b64 = value => { let text='';for(const byte of value)text+=String.fromCharCode(byte);return btoa(text).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''); };
const un = value => Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const ids = value => Uint8Array.from(value.replaceAll('-','').match(/../g),x=>parseInt(x,16));
const uuid = value => {const h=[...value].map(x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
const revision = value => uuid(un(value).slice(44,60));
export function settingsAfterRemoval(settings,source,destination=null) {
  const next=structuredClone(settings);
  next.collections=(next.collections||[]).map(row=>({...row,vault_ids:[...new Set(row.vault_ids.flatMap(id=>id===source?destination?[destination]:[]:[id]))].sort()})).filter(row=>row.vault_ids.length);
  if(next.default_view?.kind==='vault'&&next.default_view.id===source)next.default_view=destination?{kind:'vault',id:destination}:null;
  if(next.default_view?.kind==='collection'&&!next.collections.some(row=>row.id===next.default_view.id))next.default_view=null;
  return next;
}

// Removal has the same online requirement as the desktop client. A durable,
// encrypted journal makes copies and finalization resumable after lost replies.
export class VaultLifecycleClient {
  constructor({core,root,send,readJournal,writeJournal,signItem,check=()=>{}}) {Object.assign(this,{core,root,send,readJournal,writeJournal,signItem,check});}
  async remove(source,choice,destination=null) {
    if(!['archive','move'].includes(choice)||choice==='move'&&(!destination||destination===source))throw Error('INVALID_REMOVAL');
    let journal=await this.readJournal();
    if(journal&&(journal.source!==source||journal.choice!==choice||journal.destination!==destination))throw Error('PENDING_REMOVAL');
    if(journal?.request) {
      const data=await this.send('/api/v1/vaults');
      if(!data.vaultEnvelopes.find(row=>row.vaultId===source)?.retired)for(const vaultId of [source,...destination?[destination]:[]])await this.send(`/api/v1/vaults/${vaultId}/checkpoint`,{method:'POST',body:{}});
      const receipt=await this.send(`/api/v1/vaults/${source}/removal`,{method:'POST',body:journal.request});this.check();await this.writeJournal(null);return receipt;
    }
    const listPath=id=>`/api/v1/vaults/${id}/items`;
    const data=await this.send('/api/v1/vaults'),sourceRow=data.vaultEnvelopes.find(row=>row.vaultId===source&&!row.retired);
    if(!sourceRow)throw Error('VAULT_RETIRED');
    const listed=await this.send(listPath(source));
    if(!journal){journal={version:1,source,choice,destination,sourceRevision:revision(listed.catalogue),mappings:[],pendingCopy:null,request:null};await this.writeJournal(journal);}
    if(!journal.request&&journal.sourceRevision!==revision(listed.catalogue))throw Error('REMOVAL_SOURCE_CHANGED');
    if(choice==='move'&&!journal.request) {
      const destinationRow=data.vaultEnvelopes.find(row=>row.vaultId===destination&&!row.retired);if(!destinationRow)throw Error('VAULT_RETIRED');
      const sourceVault=this.core.open_private_vault(this.root,un(data.directory),ids(source),un(sourceRow.envelope)),destinationVault=this.core.open_private_vault(this.root,un(data.directory),ids(destination),un(destinationRow.envelope));
      try {
        for(const item of listed.indices) {
          this.check();if(journal.mappings.some(row=>row.sourceItemId===item.itemId))continue;
          if(!journal.pendingCopy) {
            const target=await this.send(listPath(destination)),body=await this.send(`${listPath(source)}/${item.itemId}?catalogueRevision=${journal.sourceRevision}`);
            const indexBytes=this.core.decrypt_private_part(sourceVault,un(listed.catalogue),ids(item.itemId),un(item.envelope),4),bodyBytes=this.core.decrypt_private_part(sourceVault,un(listed.catalogue),ids(item.itemId),un(body.envelope),3);
            const made=this.core.upsert_private_item(destinationVault,un(target.catalogue),undefined,indexBytes,bodyBytes),itemId=uuid(made.item());
            const payload={requestId:crypto.randomUUID(),baseCatalogueRevision:revision(target.catalogue),catalogue:b64(made.catalogue()),index:b64(made.index()),body:b64(made.body()),itemId,
              signedOperation:await this.signItem(destination,itemId,made.catalogue(),made.index(),made.body())};
            indexBytes.fill(0);bodyBytes.fill(0);
            journal.pendingCopy={sourceItemId:item.itemId,destinationItemId:itemId,payload};made.free?.();await this.writeJournal(journal);
          }
          await this.send(listPath(destination),{method:'POST',body:journal.pendingCopy.payload});this.check();
          journal.mappings.push({sourceItemId:journal.pendingCopy.sourceItemId,destinationItemId:journal.pendingCopy.destinationItemId});journal.pendingCopy=null;await this.writeJournal(journal);
        }
      } finally {try{this.core.release_vault(sourceVault);this.core.release_vault(destinationVault)}catch{}sourceVault.free?.();destinationVault.free?.();}
    }
    if(!journal.request) {
      const current=await this.send('/api/v1/vault-settings');
      const settings=current.envelope?JSON.parse(new TextDecoder().decode(this.core.decrypt_account_settings(this.root,un(current.envelope)))):{version:1,names:{},collections:[],default_view:null,removal_preference:null};
      const encrypted=this.core.encrypt_account_settings(this.root,new TextEncoder().encode(JSON.stringify(settingsAfterRemoval(settings,source,destination))));
      journal.request={requestId:crypto.randomUUID(),choice,destinationVaultId:destination,sourceCatalogueRevision:journal.sourceRevision,
        destinationCatalogueRevision:destination?revision((await this.send(listPath(destination))).catalogue):null,itemMappings:journal.mappings,
        settings:{baseRevision:current.revision,revision:uuid(encrypted.slice(76,92)),envelope:b64(encrypted)}};
      await this.writeJournal(journal);
    }
    for(const vaultId of [source,...destination?[destination]:[]])await this.send(`/api/v1/vaults/${vaultId}/checkpoint`,{method:'POST',body:{}});
    const receipt=await this.send(`/api/v1/vaults/${source}/removal`,{method:'POST',body:journal.request});this.check();await this.writeJournal(null);return receipt;
  }
  async restore(vaultId) {
    let journal=await this.readJournal();
    if(journal&&!(journal.choice==='restore'&&journal.source===vaultId))throw Error('PENDING_REMOVAL');
    if(!journal){const listed=await this.send(`/api/v1/vaults/${vaultId}/items`);journal={version:1,choice:'restore',source:vaultId,request:{requestId:crypto.randomUUID(),sourceCatalogueRevision:revision(listed.catalogue)}};await this.writeJournal(journal);}
    const receipt=await this.send(`/api/v1/vaults/${vaultId}/restore`,{method:'POST',body:journal.request});this.check();await this.writeJournal(null);return receipt;
  }
}
