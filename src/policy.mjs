export const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
export const MAX_MINT_WEI = 0n;

export function isAddress(value) { return typeof value === 'string' && ADDRESS.test(value); }
export function isFreeRow(text) {
  return /\bFREE\s*\+\s*gas\b/i.test(text) || /\btwo-phase\b[\s\S]*?\bfree pool\b/i.test(text);
}
export function getListedStandard(text) {
  if (/\b1155\b/.test(text)) return 'ERC-1155';
  if (/\b721\b/.test(text)) return 'ERC-721';
  return null;
}
export function candidateFromRow({ text, hrefs = [] }) {
  if (!isFreeRow(text)) return null;
  const standard = getListedStandard(text);
  if (!standard) return null;
  const found = hrefs.map(h => (h.match(/(?:\/address\/|\/token\/|[?&]detay=)(0x[a-fA-F0-9]{40})(?:\b|$)/i) || [])[1]).find(Boolean);
  if (!found) return null;
  return { address: found.toLowerCase(), standardOnSite: standard, title: text.slice(0, 180), source: 'agenticmint.ai', detectedAt: new Date().toISOString() };
}
export function gasBudget(estimatedGas, gasPrice, maxWei, paddingPercent = 20) {
  const gas = BigInt(estimatedGas), price = BigInt(gasPrice), ceiling = BigInt(maxWei);
  if (gas <= 0n || price <= 0n || ceiling <= 0n) throw new Error('No reliable positive gas estimate/price');
  if (!Number.isInteger(paddingPercent) || paddingPercent < 0 || paddingPercent > 100) throw new Error('Bad padding');
  const factor = BigInt(100 + paddingPercent);
  const paddedGas = (gas * factor + 99n) / 100n;
  const paddedPrice = (price * factor + 99n) / 100n;
  const upperEstimate = paddedGas * paddedPrice;
  return { estimatedGas: gas.toString(), gasPriceWei: price.toString(), upperEstimateWei: upperEstimate.toString(), maxWei: ceiling.toString(), ok: upperEstimate <= ceiling };
}
export function todayTR(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export const SPEND_STATES = new Set(['SUBMITTING', 'BROADCASTED', 'PENDING_CONFIRMATION', 'CONFIRMED', 'UNKNOWN_SUBMISSION', 'FAILED']);
export function committedToday(items, date = new Date()) {
  const day = todayTR(date);
  return items.filter(x => x.day === day && SPEND_STATES.has(x.status)).length;
}
export function checkPreview(response) {
  if (response?.success !== true || !response?.data?.requestId) throw new Error('BAW preview missing successful requestId');
  const d = response.data;
  if(typeof d.requireConfirmation!=='boolean')throw new Error('BAW confirmation requirement unknown');
  const simulation = d.simulationResult;
  if (!simulation || simulation.simulationCode !== '000000000') throw new Error('BAW simulation not clearly successful');
  if (!Array.isArray(simulation.allowanceChanges) || simulation.allowanceChanges.length) throw new Error('Allowance changes present/unknown');
  if (!Array.isArray(simulation.authorityChanges) || simulation.authorityChanges.length) throw new Error('Authority changes present/unknown');
  const risks = d.risks;
  if (!risks || !Array.isArray(risks.riskDetails) || risks.riskDetails.length) throw new Error('Risk details present/unknown');
  if (!Array.isArray(risks.riskBehaviors) || risks.riskBehaviors.length) throw new Error('Risk behavior present/unknown');
  if (!risks.addresses || typeof risks.addresses !== 'object') throw new Error('Risk addresses missing');
  if (Object.values(risks.addresses).some(x => ![0,'0'].includes(x?.riskLevel) || !Array.isArray(x?.riskDetails) || x.riskDetails.length)) throw new Error('Risky/unknown address');
  if (!Array.isArray(simulation.balanceChanges)) throw new Error('Balance changes unknown');
  return { requestId: d.requestId, expiresAt: d.expiresAt ?? null, requireAppConfirmation: d.requireConfirmation === true, balanceChanges: simulation.balanceChanges, parsedTx: d.parsedTx };
}
