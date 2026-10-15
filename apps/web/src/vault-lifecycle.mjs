const b64 = value => { let text='';for(const byte of value)text+=String.fromCharCode(byte);return btoa(text).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''); };
const un = value => Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const ids = value => Uint8Array.from(value.replaceAll('-','').match(/../g),x=>parseInt(x,16));
const uuid = value => {const h=[...value].map(x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
const revision = value => uuid(un(value).slice(44,60));
const canonical = value => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
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
  constructor({core,root,send,readJournal,writeJournal,signItem,verifyCopy=async()=>{},check=()=>{}}) {Object.assign(this,{core,root,send,readJournal,writeJournal,signItem,verifyCopy,check});}
  async remove(source,choice,destination=null) {
    if(!['archive','move'].includes(choice)||choice==='move'&&(!destination||destination===source))throw Error('INVALID_REMOVAL');
    let journal=await this.readJournal(), validatedDestinationRevision=null;
    if(journal&&(journal.source!==source||journal.choice!==choice||journal.destination!==destination))throw Error('PENDING_REMOVAL');
    if(journal?.request) {
      const data=await this.send('/api/v1/vaults');
      if(!data.vaultEnvelopes.find(row=>row.vaultId===source)?.retired) {
        if(choice==='move') {
          const listed=await this.send(`/api/v1/vaults/${source}/items`),target=await this.send(`/api/v1/vaults/${destination}/items`);
          if(revision(listed.catalogue)!==journal.request.sourceCatalogueRevision)throw Error('REMOVAL_SOURCE_CHANGED');
          if(revision(target.catalogue)!==journal.request.destinationCatalogueRevision)throw Error('REMOVAL_DESTINATION_CHANGED');
          await this.verifyDestinationCopies({data,source,destination,listed,target,sourceRevision:journal.request.sourceCatalogueRevision,mappings:journal.request.itemMappings});
        }
        for(const vaultId of [source,...destination?[destination]:[]])await this.send(`/api/v1/vaults/${vaultId}/checkpoint`,{method:'POST',body:{}});
      }
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
        const verifyDestination = (item, destinationItemId, target, required) => this.verifyDestinationCopies({data,source,destination,listed,target,sourceRevision:journal.sourceRevision,mappings:[{sourceItemId:item.itemId,destinationItemId}],required});
        for(const item of listed.indices) {
          this.check();
          const mapped=journal.mappings.find(row=>row.sourceItemId===item.itemId);
          if(mapped) { await verifyDestination(item,mapped.destinationItemId,await this.send(listPath(destination)),true);continue; }
          if(!journal.pendingCopy) {
            const target=await this.send(listPath(destination)),body=await this.send(`${listPath(source)}/${item.itemId}?catalogueRevision=${journal.sourceRevision}`);
            let indexBytes,bodyBytes,made;
            try {
              indexBytes=this.core.decrypt_private_part(sourceVault,un(listed.catalogue),ids(item.itemId),un(item.envelope),4);
              bodyBytes=this.core.decrypt_private_part(sourceVault,un(listed.catalogue),ids(item.itemId),un(body.envelope),3);
              made=this.core.upsert_private_item(destinationVault,un(target.catalogue),undefined,indexBytes,bodyBytes);const itemId=uuid(made.item());
              const payload={requestId:crypto.randomUUID(),baseCatalogueRevision:revision(target.catalogue),catalogue:b64(made.catalogue()),index:b64(made.index()),body:b64(made.body()),itemId,
                signedOperation:await this.signItem(destination,itemId,made.catalogue(),made.index(),made.body())};
              journal.pendingCopy={sourceItemId:item.itemId,destinationItemId:itemId,payload};
            } finally {indexBytes?.fill(0);bodyBytes?.fill(0);made?.free?.();}
            await this.writeJournal(journal);
          }
          await this.verifyCopy(journal.pendingCopy.payload,destination);this.check();
          // An accepted request may have lost its reply. Compare its current
          // copy before replaying or advancing the journal, so peer edits stay
          // available for explicit review instead of retiring their source.
          await verifyDestination(item,journal.pendingCopy.destinationItemId,await this.send(listPath(destination)),false);
          await this.send(listPath(destination),{method:'POST',body:journal.pendingCopy.payload});this.check();
          journal.mappings.push({sourceItemId:journal.pendingCopy.sourceItemId,destinationItemId:journal.pendingCopy.destinationItemId});journal.pendingCopy=null;await this.writeJournal(journal);
        }
        const target=await this.send(listPath(destination));
        for(const mapping of journal.mappings) {
          const item=listed.indices.find(row=>row.itemId===mapping.sourceItemId);
          if(!item)throw Error('REMOVAL_SOURCE_CHANGED');
          await verifyDestination(item,mapping.destinationItemId,target,true);
        }
        // Finalization must use the exact catalogue that was compared above.
        // A later destination write then produces BASE_CHANGED on the server.
        validatedDestinationRevision=revision(target.catalogue);
      } finally {try{this.core.release_vault(sourceVault);this.core.release_vault(destinationVault)}catch{}sourceVault.free?.();destinationVault.free?.();}
    }
    if(!journal.request) {
      const current=await this.send('/api/v1/vault-settings');
      const settings=current.envelope?JSON.parse(new TextDecoder().decode(this.core.decrypt_account_settings(this.root,un(current.envelope)))):{version:1,names:{},collections:[],default_view:null,removal_preference:null};
      const encrypted=this.core.encrypt_account_settings(this.root,new TextEncoder().encode(JSON.stringify(settingsAfterRemoval(settings,source,destination))));
      journal.request={requestId:crypto.randomUUID(),choice,destinationVaultId:destination,sourceCatalogueRevision:journal.sourceRevision,
        destinationCatalogueRevision:destination?validatedDestinationRevision:null,itemMappings:journal.mappings,
        settings:{baseRevision:current.revision,revision:uuid(encrypted.slice(76,92)),envelope:b64(encrypted)}};
      await this.writeJournal(journal);
    }
    for(const vaultId of [source,...destination?[destination]:[]])await this.send(`/api/v1/vaults/${vaultId}/checkpoint`,{method:'POST',body:{}});
    const receipt=await this.send(`/api/v1/vaults/${source}/removal`,{method:'POST',body:journal.request});this.check();await this.writeJournal(null);return receipt;
  }
  async verifyDestinationCopies({data,source,destination,listed,target,sourceRevision,mappings,required=true}) {
    const sourceRow=data.vaultEnvelopes.find(row=>row.vaultId===source),destinationRow=data.vaultEnvelopes.find(row=>row.vaultId===destination);
    if(!sourceRow||!destinationRow||sourceRow.retired||destinationRow.retired)throw Error('VAULT_RETIRED');
    const handles={};
    try {
      handles.source=this.core.open_private_vault(this.root,un(data.directory),ids(source),un(sourceRow.envelope));
      handles.destination=this.core.open_private_vault(this.root,un(data.directory),ids(destination),un(destinationRow.envelope));
      for(const mapping of mappings) {
        const item=listed.indices.find(row=>row.itemId===mapping.sourceItemId),destinationItemId=mapping.destinationItemId;
        if(!item)throw Error('REMOVAL_SOURCE_CHANGED');
        const copied=target.indices.find(row=>row.itemId===destinationItemId);
        if(!copied) { if(required)throw Error('REMOVAL_DESTINATION_CHANGED');continue; }
        const sourceBody=await this.send(`/api/v1/vaults/${source}/items/${item.itemId}?catalogueRevision=${sourceRevision}`);
        const destinationBody=await this.send(`/api/v1/vaults/${destination}/items/${destinationItemId}?catalogueRevision=${revision(target.catalogue)}`);
        this.check();
        const parts=[];
        try {
          parts.push(this.core.decrypt_private_part(handles.source,un(listed.catalogue),ids(item.itemId),un(item.envelope),4));
          parts.push(this.core.decrypt_private_part(handles.destination,un(target.catalogue),ids(destinationItemId),un(copied.envelope),4));
          parts.push(this.core.decrypt_private_part(handles.source,un(listed.catalogue),ids(item.itemId),un(sourceBody.envelope),3));
          parts.push(this.core.decrypt_private_part(handles.destination,un(target.catalogue),ids(destinationItemId),un(destinationBody.envelope),3));
          const decoded=parts.map(bytes=>canonical(JSON.parse(new TextDecoder().decode(bytes))));
          if(decoded[0]!==decoded[1]||decoded[2]!==decoded[3])throw Error('REMOVAL_DESTINATION_CHANGED');
        } finally { for(const bytes of parts)bytes.fill(0); }
      }
    } finally { for(const handle of Object.values(handles)) { this.core.release_vault(handle);handle.free?.(); } }
  }
  async restore(vaultId) {
    let journal=await this.readJournal();
    if(journal&&!(journal.choice==='restore'&&journal.source===vaultId))throw Error('PENDING_REMOVAL');
    if(!journal){const listed=await this.send(`/api/v1/vaults/${vaultId}/items`);journal={version:1,choice:'restore',source:vaultId,request:{requestId:crypto.randomUUID(),sourceCatalogueRevision:revision(listed.catalogue)}};await this.writeJournal(journal);}
    const receipt=await this.send(`/api/v1/vaults/${vaultId}/restore`,{method:'POST',body:journal.request});this.check();await this.writeJournal(null);return receipt;
  }
}
