import {usdBudgetWei,costUsdMicros} from './pricing.mjs';
export async function maximize(probe,cap,first){
  let best=first||await probe(1n),low=BigInt(best.quantity),high=cap,calls=0;
  if(cap<=low)return best;
  let next=cap<low*10n?cap:low*10n;
  for(;;){
    try{best=await probe(next);low=next;if(low===cap)return best;next=next*10n<cap?next*10n:cap;}
    catch{high=next-1n;break;}
    if(++calls>128)throw new Error('QUANTITY_SEARCH_LIMIT');
  }
  while(low<high){
    if(++calls>256)throw new Error('QUANTITY_SEARCH_LIMIT');
    const mid=(low+high+1n)/2n;
    try{best=await probe(mid);low=mid;}catch{high=mid-1n;}
  }
  return best;
}
export async function choosePlan(plan,{simulate,unitPrice,price,config,maxQuantity,spentWei='0'}){
  const cap=plan.quantityIndex<0?1n:BigInt(maxQuantity||config.maxBatchQuantity);
  const spent=BigInt(spentWei);let quote,ceiling;
  async function ensureQuote(){
    if(!quote){quote=await price();ceiling=usdBudgetWei(quote,config.paidMintUsdLimit,config.usdSafetyMarginPercent);}
  }
  let free;
  try{
    const probe=async q=>{
      const inputData=plan.encode(q),budget=await simulate(inputData,'0');
      if(config.maxMint){await ensureQuote();if(spent+BigInt(budget.upperEstimateWei)>ceiling)throw new Error('COLLECTION_USD_BUDGET_EXHAUSTED');}
      return {...plan,inputData,quantity:q.toString(),valueWei:'0',budget};
    };
    const first=await probe(1n);
    free=config.maxMint?await maximize(probe,cap,first):first;
  }catch(e){if(config.maxMint&&/BUDGET_EXHAUSTED|USD_PRICE/.test(e.message))throw e;}
  if(free&&!config.maxMint)return free;
  if(config.maxMint&&free){
    await ensureQuote();
    const total=spent+BigInt(free.budget.upperEstimateWei);
    if(total>ceiling)throw new Error('COLLECTION_USD_BUDGET_EXHAUSTED');
    free.pricing={...quote,spentWei:spent.toString(),estimatedTotalUsdMicros:costUsdMicros(total,quote),usdLimit:config.paidMintUsdLimit,safetyMarginPercent:config.usdSafetyMarginPercent};
  }
  if(!config.paidEnabled||plan.mutability!=='payable'){
    if(free)return free;throw new Error('NO_SIMULATED_FREE_MINT');
  }
  let unit;
  try{unit=await unitPrice();await ensureQuote();}catch(e){if(free)return free;throw e;}
  if(unit<=0n)throw new Error('Invalid unit price');
  const models=[{name:'per-unit',scale:1n}];
  if(config.maxMint&&plan.quantityIndex>=0){
    models.push({name:'per-call',flat:true});
    if(plan.tokenDecimals>0){models.push({name:'per-token-unit',scale:10n**BigInt(plan.tokenDecimals)});models.push({name:'per-token-unit-ceil',scale:10n**BigInt(plan.tokenDecimals),ceil:true});}
  }
  const choices=free?[free]:[];
  for(const model of models){
    const payment=q=>model.flat?unit:(unit*q+(model.ceil?model.scale-1n:0n))/model.scale;
    const probe=async q=>{
      const valueWei=payment(q).toString(),inputData=plan.encode(q);
      const budget=await simulate(inputData,valueWei);
      const total=spent+BigInt(valueWei)+BigInt(budget.upperEstimateWei);
      if(total>ceiling)throw new Error('PAID_USD_BUDGET_EXCEEDED');
      return {...plan,inputData,quantity:q.toString(),valueWei,budget,pricing:{...quote,spentWei:spent.toString(),unitPriceWei:unit.toString(),priceModel:model.name,estimatedTotalUsdMicros:costUsdMicros(total,quote),usdLimit:config.paidMintUsdLimit,safetyMarginPercent:config.usdSafetyMarginPercent}};
    };
    try{
      let first;try{first=await probe(1n);}catch(e){if(model.scale>1n&&model.scale<=cap)first=await probe(model.scale);else throw e;}
      if(plan.quantityIndex<0){choices.push(first);continue;}
      const remaining=ceiling-spent-BigInt(first.budget.upperEstimateWei);
      const bound=model.flat?cap:model.ceil?remaining*model.scale/unit:((remaining+1n)*model.scale-1n)/unit;
      choices.push(await maximize(probe,bound<cap?bound:cap,first));
    }catch(e){if(!config.maxMint&&!free)throw e;}
  }
  if(!choices.length)throw new Error('NO_SUPPORTED_MINT_WITHIN_BUDGET');
  // Within the same method, prefer more quantity and then the smaller payment.
  choices.sort((a,b)=>BigInt(a.quantity)!==BigInt(b.quantity)?(BigInt(a.quantity)>BigInt(b.quantity)?-1:1):(BigInt(a.valueWei)<BigInt(b.valueWei)?-1:BigInt(a.valueWei)>BigInt(b.valueWei)?1:0));
  return choices[0];
}
export async function recheckPlan(plan,{simulate,price,config,spentWei=plan.pricing?.spentWei||'0'}){
  const budget=await simulate(plan.inputData,plan.valueWei||'0');
  if(BigInt(plan.valueWei||'0')>0n||config.maxMint){
    const quote=await price(),total=BigInt(spentWei)+BigInt(plan.valueWei||'0')+BigInt(budget.upperEstimateWei);
    if(total>usdBudgetWei(quote,config.paidMintUsdLimit,config.usdSafetyMarginPercent))throw new Error('PAID_USD_BUDGET_CHANGED');
    return {...budget,pricing:{...quote,spentWei:String(spentWei),estimatedTotalUsdMicros:costUsdMicros(total,quote)}};
  }
  return budget;
}
export function collectionSpentWei(history,contract){
  return history.filter(r=>r.contract===contract).reduce((sum,r)=>{
    const gas=r.receipt?.actualGasWei??r.budget?.upperEstimateWei??r.gasBudget?.upperEstimateWei;
    if(gas===undefined)throw new Error('COLLECTION_SPEND_UNKNOWN');
    return sum+BigInt(r.valueWei||'0')+BigInt(gas);
  },0n).toString();
}
