// A manual exception preserves uncertainty and reserves spend; it never declares a failed transaction.
export function isQuarantined(record) {
  const q=record.quarantine;
  return q?.scope==='collection'&&q.acceptedUnknownOutcome===true&&q.wallet===record.wallet&&q.contract===record.contract&&q.requestId===record.requestId&&Number.isFinite(Date.parse(q.at));
}

export function quarantineUnknown(record,{wallet,accepted=false,pendingTransactions,latestNonce,pendingNonce,now=Date.now()}) {
  if(accepted!==true)throw new Error('Explicit acceptance of the unknown outcome is required');
  if(!record||record.wallet!==wallet||record.status!=='UNKNOWN_SUBMISSION'||record.txHash||record.orderId)throw new Error('Only this wallet\'s unknown submission without a hash or order ID can be quarantined');
  if(isQuarantined(record))throw new Error('Record is already quarantined');
  if(!record.requestId||!Number.isFinite(record.expiresAt)||record.expiresAt>=now)throw new Error('Wait until the original preview has expired');
  if(!Array.isArray(pendingTransactions)||pendingTransactions.length!==0)throw new Error('Pending wallet transactions present or unknown');
  if(!Number.isSafeInteger(latestNonce)||latestNonce<0||!Number.isSafeInteger(pendingNonce)||latestNonce!==pendingNonce)throw new Error('RPC pending nonce differs or is unknown');
  return {...record,quarantine:{scope:'collection',acceptedUnknownOutcome:true,at:new Date(now).toISOString(),wallet:record.wallet,contract:record.contract,requestId:record.requestId,reason:'User accepted unknown outcome; block this collection and allow unrelated collections',checks:{previewExpired:true,walletPendingCount:0,latestNonce,pendingNonce}}};
}
