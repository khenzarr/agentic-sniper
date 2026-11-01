// Run this file from the root of agenticmint-free-mint-hunter:
//   node .\diagnose-agenticmint-radar.mjs
// This tool only reads a public webpage and prints diagnostic counts. It does not use BAW or send transactions.
import { chromium } from 'playwright';
import { candidateFromRow, isFreeRow, getListedStandard } from './src/policy.mjs';

const URL = 'https://agenticmint.ai/?f=bedava';
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const browser = await chromium.launch({headless: true});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  await page.goto(URL, {waitUntil: 'domcontentloaded', timeout: 35000});
  await page.locator('table tbody tr').first().waitFor({state:'attached', timeout: 25000});
  async function snapshot() {
    return await page.locator('table tbody tr').evaluateAll(nodes => nodes.map(r => ({
      text: r.innerText,
      hrefs: [...r.querySelectorAll('a[href]')].map(a => a.href)
    })));
  }
  const initial = await snapshot();
  await delay(2000); // observe client-side changes without altering the page
  const rows = await snapshot();
  let free = 0, nft = 0, freeNft = 0, parsed = 0, missingContractLink = 0;
  const potential = [], freeButNotNft = [], nftButNotFree = [];
  for (const row of rows) {
    const isFree = isFreeRow(row.text);
    const std = getListedStandard(row.text);
    const candidate = candidateFromRow(row);
    if (isFree) free++;
    if (std) nft++;
    if (isFree && std) freeNft++;
    if (candidate) parsed++;
    if (isFree && std && !candidate) missingContractLink++;
    const sample = {standard:std, free:isFree, candidateAddress:candidate?.address ?? null,
      text:row.text.replace(/\s+/g, ' ').slice(0,260),
      hrefs:row.hrefs.slice(0,3)};
    if (isFree && std && potential.length<12) potential.push(sample);
    if (isFree && !std && freeButNotNft.length<3) freeButNotNft.push(sample);
    if (!isFree && std && nftButNotFree.length<5) nftButNotFree.push(sample);
  }
  console.log(JSON.stringify({
    url:URL,
    checkedAt:new Date().toISOString(),
    rowCountBeforeWait:initial.length,
    rowCountAfterWait:rows.length,
    freeMatches:free,
    nftLabelMatches:nft,
    freeNftIntersections:freeNft,
    candidateRowsWithContractLink:parsed,
    missingAddressLink:missingContractLink,
    possibleFreeNftRows:potential,
    samplesFreeButNotNft:freeButNotNft,
    samplesNftButNotFree:nftButNotFree,
    note:'Read-only browser diagnostics. These counts do not establish NFT safety or mint eligibility.'
  },null,2));
} catch (error) {
  console.error(`Diagnostic failed: ${error.message}`);
  process.exitCode=1;
} finally { await browser.close(); }
