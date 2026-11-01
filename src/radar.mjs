import { chromium } from 'playwright';
import { candidateFromRow } from './policy.mjs';

export async function scrapeRadar(url) {
  if (!['https://agenticmint.ai/','https://agenticmint.ai/?f=bedava'].includes(url)) throw new Error('Radar URL not allowlisted');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.locator('table tbody tr').first().waitFor({ state: 'attached', timeout: 25000 });
    // Table shells can arrive before token labels/links. Wait for hydrated rows,
    // including when there really are no supported NFTs on the page.
    let rows=[],last='',stable=0;
    for(let attempt=0;attempt<6;attempt++) {
      rows=await page.locator('table tbody tr').evaluateAll(nodes=>nodes.map(row=>({
        text:row.innerText,hrefs:[...row.querySelectorAll('a[href]')].map(a=>a.href)
      })));
      const fingerprint=JSON.stringify(rows.map(r=>[r.text,r.hrefs]));
      stable=fingerprint===last?stable+1:0;last=fingerprint;
      if(attempt>=2&&stable>=2&&rows.some(r=>candidateFromRow(r)))break;
      if(attempt<5)await page.waitForTimeout(1000);
    }
    if (!rows.length) throw new Error('No radar rows; inspect site markup (no results saved)');
    const seen = new Set();
    const candidates = rows.map(candidateFromRow).filter(row => {
      if (!row || seen.has(row.address)) return false;
      seen.add(row.address); return true;
    });
    return { scannedAt: new Date().toISOString(), url, totalTableRows: rows.length, candidates };
  } finally { await browser.close(); }
}
