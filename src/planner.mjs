import {usdBudgetWei,costUsdMicros} from './pricing.mjs';
export async function choosePlan(plan,{simulate,unitPrice,price,config}){
  // Free mints take precedence and remain one invocation/one quantity unit.
  try{return {...plan,quantity:'1',valueWei:'0',budget:await simulate(plan.inputData,'0')};}catch{}
  if(!config.paidEnabled||plan.mutability!=='payable')throw new Error('NO_SIMULATED_FREE_MINT');
  const unit=await unitPrice(),quote=await price();
  if(unit<=0n)throw new Error('Invalid unit price');
  const ceiling=usdBudgetWei(quote,config.paidMintUsdLimit,config.usdSafetyMarginPercent);
  async function probe(q){
    const valueWei=(unit*q).toString(),inputData=plan.encode(q);
    const budget=await simulate(inputData,valueWei);
    const total=BigInt(valueWei)+BigInt(budget.upperEstimateWei);
    if(total>ceiling)throw new Error('PAID_USD_BUDGET_EXCEEDED');
    return {...plan,inputData,quantity:q.toString(),valueWei,budget,pricing:{...quote,unitPriceWei:unit.toString(),estimatedTotalUsdMicros:costUsdMicros(total,quote),usdLimit:config.paidMintUsdLimit,safetyMarginPercent:config.usdSafetyMarginPercent}};
  }
  let best=await probe(1n);
  if(plan.quantityIndex<0)return best;
  const priceBound=(ceiling-BigInt(best.budget.upperEstimateWei))/unit;
  let low=1n,high=priceBound<BigInt(config.maxBatchQuantity)?priceBound:BigInt(config.maxBatchQuantity);
  // Monotonic per-unit public mints: simulation enforces remaining wallet,
  // per-tx and supply limits. Never invent a wallet limit from a radar label.
  while(low<high){
    const mid=(low+high+1n)/2n;
    try{best=await probe(mid);low=mid;}catch{high=mid-1n;}
  }
  return best;
}
export async function recheckPlan(plan,{simulate,price,config}){
  const budget=await simulate(plan.inputData,plan.valueWei||'0');
  if(BigInt(plan.valueWei||'0')>0n){
    const quote=await price(),total=BigInt(plan.valueWei)+BigInt(budget.upperEstimateWei);
    if(total>usdBudgetWei(quote,config.paidMintUsdLimit,config.usdSafetyMarginPercent))throw new Error('PAID_USD_BUDGET_CHANGED');
    return {...budget,pricing:{...quote,estimatedTotalUsdMicros:costUsdMicros(total,quote)}};
  }
  return budget;
}
