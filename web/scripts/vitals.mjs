import { createRequire } from 'node:module';
const require = createRequire('D:/vive_codding/furnixa/web/package.json');
const { chromium } = require('playwright');

const base = process.env.BASE ?? 'http://localhost:3199';
const runs = Number(process.env.RUNS ?? 5);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function measure(browser, url, mobile) {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'no-preference' }
      : { viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' },
  );
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (mobile) {
    // Lighthouse-like "slow 4G + 4x CPU" for mobile
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  await page.addInitScript(() => {
    window.__lcp = 0;
    window.__cls = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(3500); // let the load animation and late shifts settle
  const r = await page.evaluate(() => ({ lcp: window.__lcp, cls: window.__cls, bytes: performance.getEntriesByType('resource').reduce((n, e) => n + (e.transferSize || 0), 0) }));
  await ctx.close();
  return r;
}

const browser = await chromium.launch();
const out = {};
for (const locale of ['en', 'ar']) {
  for (const mobile of [true, false]) {
    const rs = [];
    for (let i = 0; i < runs; i++) rs.push(await measure(browser, `${base}/${locale}`, mobile));
    out[`${locale}-${mobile ? '390' : '1440'}`] = {
      lcp_ms: Math.round(median(rs.map((r) => r.lcp))),
      cls: Number(median(rs.map((r) => r.cls)).toFixed(4)),
      transfer_kb: Math.round(median(rs.map((r) => r.bytes)) / 1024),
      lcp_runs: rs.map((r) => Math.round(r.lcp)),
    };
  }
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
