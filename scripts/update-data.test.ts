/// <reference types="bun" />
// Offline tests with small inline samples; no network requests are made here.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import {
  CONTROL_NAMES, HISTORY_HEADERS, YAHOO_HISTORY_HEADERS, annualizedToTotal, batchSelection, chartUrl,
  cleanHoldingTicker, deriveCatalogMetrics, eftsSearchUrl, fetchSecJson, fetchSecText, fetchWithRetry,
  fundFilterReasons, holdingsDownloadUrl, indicatedYield, inferDistributionFrequency, isParametricFundUrl,
  issuerFrequency, issuerFundUrl, lastCompletedQuarterEnd, mergeHistory, nextCursor, normalizeHoldingName,
  normalizeHoldingNameCore, normalizeSource, nportBelongsToFund, nportUrlFor, parseAumRange, parseChart,
  parseCompanyTickerMap, parseEdgarAtomFilings, parseFundTickerMap, parseHoldingsCsv, parseIssuerCatalog,
  parseIssuerDistributions, parseIssuerProduct, parseIssuerReturnsTable, parseKeyFacts, parseNport,
  parseNportAccessions, parseRange, parseTopHoldings, pickEftsCik, proxyPayload, readConfig, resolveControls,
  runPool, runtimeControls, totalToAnnualized, withRequestLane, PARAMETRIC_FUND_SLUGS,
} from './update-data';

const ROOT = new URL('../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, ROOT), 'utf8');
const SCRIPT = new URL('./update-data.ts', import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Small inline samples shaped like the live providers' payloads
// ---------------------------------------------------------------------------

const CATALOG = [
  '| Fund Name | Price <br> As of Date | Market <br>Price ($) | NAV ($) | Premium/ <br>Discount ($) | Yield <br> As of Date | 30-Day <br>Yield (%) | Dist. <br>Frequency |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  '| CVIE<br> [Calvert International Responsible Index ETF](https://www.eatonvance.com/products/etfs/international-equity/calvert-international-responsible-index-etf.html) | 09/30/2026 | 83.13 | 83.28 | -0.15 | 08/31/2026 | 1.91 | Quarterly |',
  '| PEPS<br> [Parametric Equity Plus ETF](https://www.eatonvance.com/products/etfs/us-equity/parametric-equity-plus-etf.html) | 09/30/2026 | 32.91 | 32.84 | 0.07 | 08/31/2026 | 0.97 | Quarterly |',
  '| PAPI<br> [Parametric Equity Premium Income ETF](https://www.eatonvance.com/products/etfs/us-equity/parametric-equity-premium-income-etf.html) | 09/30/2026 | 26.28 | 26.22 | 0.06 | 08/31/2026 | 2.63 | Monthly |',
].join('\n');

type PageSample = { ticker: string; name: string; cusip: string; price: string; nav: string; premium: string; net: string; exchange: string; frequency: string; benchmark: string; inception: string; assets: string };
function page(o: PageSample): string {
  return `${o.name}ETFUS Equity template noise
# ${o.name}

${o.ticker}

CUSIP

${o.cusip}

Market Price

$${o.price}

as of 09/30/2026

NAV

$${o.nav}

as of 09/30/2026

Pricing & Expenses

Market Price

as of 09/30/2026

$${o.price}

NAV

as of 09/30/2026

$${o.nav}

Premium/Discount

as of 09/30/2026

$${o.premium}

30 Day Median

Bid/Ask Spread

as of 09/30/2026

0.22%

Expense Ratio [1](https://www.eatonvance.com/x.html#pd-bottom-disc)

Gross

0.29%

Expense Ratio [1](https://www.eatonvance.com/x.html#pd-bottom-disc)

Net

${o.net}%

Returns

As of 09/30/2026 (updated daily upon availability)

|  | 1 Month | 3 Months | YTD | 1 YR | 3 YR | 5 YR | 10 YR | Since Inception |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ${o.ticker} Market Price (%) | -5.07 | 0.27 | 8.04 | 8.91 | - | - | - | 9.47 |
| ${o.ticker} NAV (%) | -5.08 | 0.20 | 7.63 | 9.00 | - | - | - | 9.40 |
| Russell 1000 Value Index [2](https://www.eatonvance.com/x.html#pd-bottom-disc) | -3.13 | 2.61 | 19.27 | 23.81 | - | - | - | 20.42 |

Distributions

As of 09/30/2026 (updated as distributions are paid)

| Record Date | Ex-Date | Payable Date | Net Investment Income ($ per share) | Short-Term Capital Gains ($ per share) | Long-Term Capital Gains ($ per share) | Total Capital Gains ($ per share) |
| --- | --- | --- | --- | --- | --- | --- |
| 09/30/2026 | 09/30/2026 | 10/06/2026 | 0.176725 | 0.000000 | 0.000000 | 0.000000 |
| 08/31/2026 | 08/31/2026 | 09/04/2026 | 0.163133 | 0.000000 | 0.000000 | 0.000000 |
| 12/22/2023 | 12/21/2023 | 12/28/2023 | 0.208278 | 0.010000 | 0.000000 | 0.000000 |
| 11/01/2023 | 11/01/2023 | 11/07/2023 | 0.000000 | 0.000000 | 0.000000 | 0.000000 |

Key Facts & Characteristics

|     |     |
| --- | --- |
| Asset Class | US Equity |
| CUSIP | ${o.cusip} |
| Ticker | ${o.ticker} |
| Inception Date | ${o.inception} |
| Exchange | ${o.exchange} |
| Benchmarks | ${o.benchmark} [2](https://www.eatonvance.com/x.html#pd-bottom-disc) |
| Distribution Frequency | ${o.frequency} |
| Total Net Assets ($MM)<br> as of 09/30/2026 | ${o.assets} |

Top 10 Holdings

As of
09/30/2026 (updated daily upon availability)

| Ticker | Holdings | Type | Security Identifier | % of Funds | Shares/Par | Market Value |
| --- | --- | --- | --- | --- | --- | --- |
| - | MSILF GOVERNMENT | CUSIP | 61747C707 | 1.65 | 7,982,326 | 7,982,325.78 |
| VLO | VALERO ENERGY CORP COMMON | CUSIP | 91913Y100 | 0.81 | 10,141 | 3,930,753.01 |
`;
}
const PAPI = page({ ticker: 'PAPI', name: 'Parametric Equity Premium Income ETF', cusip: '61774R866', price: '26.28', nav: '26.22', premium: '0.06', net: '0.29', exchange: 'NYSE Arca', frequency: 'Monthly', benchmark: 'Russell 1000 Value Index', inception: '10/16/2023', assets: '479.91' });
const PEPS = page({ ticker: 'PEPS', name: 'Parametric Equity Plus ETF', cusip: '61774R775', price: '32.91', nav: '32.84', premium: '0.07', net: '0.10', exchange: 'NASDAQ', frequency: 'Quarterly', benchmark: 'S&P 500 Index', inception: '11/07/2024', assets: '29.56' });

const NPORT = `<?xml version="1.0" encoding="UTF-8"?><edgarSubmission><formData>
<genInfo><regName>Morgan Stanley ETF Trust</regName><regCik>0001676326</regCik>
<seriesName>Parametric Equity Premium Income ETF</seriesName><seriesId>S000082252</seriesId>
<repPdEnd>2026-09-30</repPdEnd><repPdDate>2026-06-30</repPdDate></genInfo>
<fundInfo><netAssets>399844102.98</netAssets><indexInfo><nameDesignatedIndex>Russell 1000 Value</nameDesignatedIndex></indexInfo></fundInfo>
<invstOrSecs>
<invstOrSec><name>Kraft Heinz Co. (The)</name><title>Kraft Heinz Co. (The)</title><cusip>500754106</cusip>
<identifiers><isin value="US5007541064"/></identifiers><balance>93467.00000000</balance><valUSD>2207690.54000000</valUSD>
<pctVal>0.552137826604</pctVal><assetCat>EC</assetCat></invstOrSec>
<invstOrSec><name>RLI Corp.</name><title>RLI Corp.</title><cusip>N/A</cusip>
<identifiers><isin value="US7496071074"/></identifiers><balance>35281.00000000</balance><valUSD>2084048.67000000</valUSD>
<pctVal>0.521215307282</pctVal><assetCat>EC</assetCat></invstOrSec>
</invstOrSecs></formData></edgarSubmission>`;

const ATOM = `<?xml version="1.0" encoding="ISO-8859-1" ?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><content type="text/xml"><accession-number>0002071691-26-018745</accession-number>
<filing-date>2026-08-21</filing-date>
<filing-href>https://www.sec.gov/Archives/edgar/data/1676326/000207169126018745/0002071691-26-018745-index.htm</filing-href>
<filing-type>NPORT-P</filing-type></content></entry>
<entry><content type="text/xml"><accession-number>0002071691-26-018700</accession-number>
<filing-date>2026-07-21</filing-date>
<filing-href>https://www.sec.gov/Archives/edgar/data/1676326/000207169126018700/0002071691-26-018700-index.htm</filing-href>
<filing-type>NPORT-P</filing-type></content></entry>
<entry><content type="text/xml"><accession-number>0002071691-26-000001</accession-number>
<filing-type>N-CSR</filing-type></content></entry></feed>`;

const MF_TICKERS = {
  fields: ['cik', 'seriesId', 'classId', 'symbol'],
  data: [
    [1676326, 'S000077958', 'C000238675', 'CVIE'],
    [1676326, 'S000082252', 'C000245536', 'PAPI'],
    [1676326, 'S000082250', 'C000245534', 'PHEQ'],
  ],
};

const YAHOO = {
  chart: {
    result: [{
      meta: { fullExchangeName: 'NYSEArca', longName: 'Parametric Equity Premium Income ETF', regularMarketPrice: 26.48, regularMarketTime: 1790884800, firstTradeDate: 1697722200 },
      timestamp: [1785729600, 1786334400, 1786939200],
      indicators: {
        quote: [{ close: [27.670000076293945, null, 28.239999771118164], volume: [463400, 1, 374900] }],
        adjclose: [{ adjclose: [27.327024459838867, null, 27.88995933532715] }],
      },
      events: { dividends: { 1701061200: { amount: 0.166, date: 1701354600 }, 1702875600: { amount: 0.208, date: 1703169000 }, 1: { amount: 0, date: 1 } } },
    }],
  },
};

// ---------------------------------------------------------------------------
// Catalog and issuer product page
// ---------------------------------------------------------------------------

describe('parseIssuerCatalog', () => {
  test('keeps exactly the Parametric funds with canonical product pages and header-mapped figures', () => {
    const funds = parseIssuerCatalog(CATALOG);
    expect(funds.map((fund) => fund.ticker)).toEqual(['PAPI', 'PEPS']);
    for (const fund of funds) {
      expect(fund.fundPage.startsWith('https://www.eatonvance.com/products/etfs/us-equity/parametric-')).toBe(true);
      expect(fund.fundPage.endsWith('.html')).toBe(true);
    }
    expect(funds[0]).toMatchObject({
      name: 'Parametric Equity Premium Income ETF', nav: 26.22, marketPrice: 26.28, asOfDate: '2026-09-30',
      secYield: 2.63, secYieldDate: '2026-08-31', frequency: 'Monthly',
    });
    expect(funds[1].secYield).toBe(0.97);
  });

  test('a catalog without Parametric rows is an error, not an empty catalog', () => {
    expect(() => parseIssuerCatalog('| CVIE<br> [Calvert](https://www.eatonvance.com/products/etfs/x.html) |')).toThrow(/no Parametric fund links/);
  });

  test('isParametricFundUrl only accepts the issuer brand pages', () => {
    expect(isParametricFundUrl(issuerFundUrl('PAPI'))).toBe(true);
    expect(isParametricFundUrl('https://www.eatonvance.com/products/etfs/us-equity/calvert-us-large-cap-core-responsible-index-etf.html')).toBe(false);
    expect(isParametricFundUrl('https://evil.example.com/products/etfs/us-equity/parametric-x.html')).toBe(false);
    expect(PARAMETRIC_FUND_SLUGS.PHEQ).toBe('parametric-hedged-equity-etf');
    expect(() => issuerFundUrl('NOPE')).toThrow();
  });
});

describe('parseIssuerProduct', () => {
  test('headline facts, identifiers and published returns', () => {
    const product = parseIssuerProduct(PAPI, 'PAPI');
    expect(product).toMatchObject({
      ticker: 'PAPI', name: 'Parametric Equity Premium Income ETF', cusip: '61774R866', assetClass: 'US Equity',
      exchange: 'NYSE Arca', benchmark: 'Russell 1000 Value Index', inception: '2023-10-16', nav: 26.22,
      marketPrice: 26.28, navDate: '2026-09-30', premiumDiscountAmount: 0.06, bidAskSpread: 0.22,
      grossExpense: 0.29, netExpense: 0.29, netAssets: 479_910_000, netAssetsDate: '2026-09-30', frequencyCode: 'M',
    });
    // monthEnd is the official NAV series; the market-price row is separate.
    expect(product.monthEnd).toMatchObject({
      asOfDate: '2026-09-30', mo1: -5.08, mo3: 0.2, ytd: 7.63, yr1: 9.0, yr3: null, yr5: null, yr10: null, sinceInception: 9.4,
    });
  });

  test('another fund parses with its own cadence, exchange and expense ratios', () => {
    const plus = parseIssuerProduct(PEPS, 'PEPS');
    expect(plus).toMatchObject({ cusip: '61774R775', exchange: 'NASDAQ', netExpense: 0.1, grossExpense: 0.29, netAssets: 29_560_000, inception: '2024-11-07', frequencyCode: 'Q', benchmark: 'S&P 500 Index' });
  });

  test('the NAV row is not mistaken for the market-price row', () => {
    const { monthEnd, monthMarket } = parseIssuerReturnsTable(PAPI, 'PAPI');
    expect(monthMarket).toMatchObject({ mo1: -5.07, ytd: 8.04 });
    expect(monthEnd).toMatchObject({ mo1: -5.08, ytd: 7.63, yr3: null, yr10: null });
  });

  test('distributions sum income and capital gains and skip placeholder rows', () => {
    const payments = parseIssuerDistributions(PAPI);
    expect(payments.map((payment) => payment.exDate)).toEqual(['2023-12-21', '2026-08-31', '2026-09-30']);
    expect(payments[2]).toMatchObject({ payDate: '2026-10-06', recordDate: '2026-09-30' });
    expect(payments[2].amount).toBeCloseTo(0.176725, 6);
    expect(payments[0].amount).toBeCloseTo(0.218278, 6);
  });

  test('top-10 holdings keep the published weight, shares and identifier', () => {
    const rows = parseTopHoldings(PAPI);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      Name: 'MSILF GOVERNMENT', Ticker: '', Identifier: '61747C707', Weight: '1.65',
      'Market Value': '7982325.78', 'Shares Held': '7982326', 'Asset Category': 'Money Market',
    });
    expect(rows[1]).toMatchObject({ Ticker: 'VLO', Weight: '0.81' });
  });

  test('issuer frequency labels map to the shared cadence codes', () => {
    expect(issuerFrequency('Monthly')).toEqual({ frequency: 'Monthly', paymentsPerYear: 12, code: 'M' });
    expect(issuerFrequency('Quarterly')).toEqual({ frequency: 'Quarterly', paymentsPerYear: 4, code: 'Q' });
    expect(issuerFrequency('Bi-Monthly').paymentsPerYear).toBe(6);
    expect(issuerFrequency('Semi-annually').paymentsPerYear).toBe(2);
    expect(issuerFrequency('Annually').paymentsPerYear).toBe(1);
    expect(issuerFrequency('Unrecognized')).toEqual({ frequency: 'Unknown', paymentsPerYear: null, code: '' });
    expect(issuerFrequency('').frequency).toBe('—');
  });

  test('markdown passes through, HTML tables become pipe rows, proxy banners and images are stripped', () => {
    expect(normalizeSource('| a | b |\n| --- | --- |\n| 1 | 2 |')).toContain('| a | b |');
    const text = normalizeSource('<table><tr><td>Asset Class</td><td>US Equity</td></tr></table>');
    expect(text).toContain('| Asset Class | US Equity |');
    expect(parseKeyFacts(text).get('Asset Class')).toBe('US Equity');
    const banner = normalizeSource('Title: Parametric\nMarkdown Content:\n![Download icon](https://x/y.svg)Gross\n0.29%');
    expect(banner).not.toContain('Title:');
    expect(banner).not.toContain('Download icon');
    expect(banner).toContain('Gross');
  });
});

describe('official holdings downloads', () => {
  test('a full-holdings CSV link is recognized, the top-10 table is not', () => {
    const link = '<a href="/content/dam/parametric-PAPI-holdings.csv">Download Full Holdings</a>';
    expect(holdingsDownloadUrl(link, 'PAPI')).toBe('https://www.eatonvance.com/content/dam/parametric-PAPI-holdings.csv');
    expect(holdingsDownloadUrl('<a href="/x.pdf">Download Full Holdings</a>', 'PAPI')).toBeNull();
    expect(holdingsDownloadUrl(PAPI, 'PAPI')).toBeNull();
  });

  test('a published CSV sheet parses into the shared holdings schema', () => {
    const csv = [
      'Parametric Equity Premium Income ETF (PAPI) as of 09/30/2026',
      'Security Name,Ticker,Asset Type,CUSIP,ISIN,Percent of Net Assets,Shares or Principal Amount,Market Value',
      'MICROSOFT CORP COMMON,MSFT,Common Stock,594918104,US5949181045,0.72,"6,775","3,474,897.50"',
      'MSILF GOVERNMENT,,Money Market,61747C707,,1.65,"7,982,326","7,982,325.78"',
      'US TREASURY 4.125% 05/15/2028,,Bond,912810H80,,0.20,"5,000,000","5,100,000.00"',
    ].join('\n');
    const parsed = parseHoldingsCsv(csv)!;
    expect(parsed.asOfDate).toBe('2026-09-30');
    expect(parsed.headers).toEqual(['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'Asset Category']);
    expect(parsed.rows.map((row) => row.Ticker)).toEqual(['', 'MSFT', '']);
    expect(parsed.rows.find((row) => row.Ticker === 'MSFT')).toMatchObject({ Identifier: '594918104', Weight: '0.72', 'Shares Held': '6775', 'Market Value': '3474897.5' });
    expect(parsed.rows[0]).toMatchObject({ Name: 'MSILF GOVERNMENT', Identifier: '61747C707', Weight: '1.65' });
    expect(parsed.rows[2]).toMatchObject({ Name: 'US TREASURY 4.125% 05/15/2028', Ticker: '', Identifier: '912810H80' });
    expect(parseHoldingsCsv('nothing here')).toBeNull();
  });

  test('holding names and tickers normalize without merging share classes', () => {
    expect(normalizeHoldingName('Apple Inc.')).toBe('APPLE');
    expect(normalizeHoldingName('Microsoft Corp Common Stock')).toBe('MICROSOFT');
    expect(normalizeHoldingName('THE BOEING CO')).toBe('BOEING');
    expect(normalizeHoldingName('Alphabet Inc. Class C Capital Stock')).toBe('ALPHABET CL C');
    expect(normalizeHoldingName('Alphabet Inc Cl A')).toBe('ALPHABET CL A');
    expect(normalizeHoldingNameCore('Apple Inc.')).toBe('APPLE');
    expect(normalizeHoldingName('')).toBe('');
    expect(cleanHoldingTicker('brk-b')).toBe('BRK-B');
    expect(cleanHoldingTicker('SCE^L')).toBe('SCE^L');
    expect(cleanHoldingTicker('N/A')).toBe('');
    expect(cleanHoldingTicker('see file')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// SEC EDGAR layer
// ---------------------------------------------------------------------------

describe('SEC EDGAR layer', () => {
  test('the fund ticker table resolves CIK and series ids', () => {
    const map = parseFundTickerMap(MF_TICKERS);
    expect(map.get('PAPI')).toEqual({ cik: '0001676326', seriesId: 'S000082252', classId: 'C000245536' });
    expect(map.get('PHEQ')!.seriesId).toBe('S000082250');
    expect(map.get('CVIE')!.seriesId).toBe('S000077958');
  });

  test('the series Atom feed yields N-PORT-P accessions newest first and skips other forms', () => {
    const filings = parseEdgarAtomFilings(ATOM);
    expect(filings.map((filing) => filing.accession)).toEqual(['0002071691-26-018745', '0002071691-26-018700']);
    expect(filings[0].url).toBe(nportUrlFor('1676326', filings[0].accession));
    expect(filings[0].url).toBe('https://www.sec.gov/Archives/edgar/data/1676326/000207169126018745/primary_doc.xml');
  });

  test('submissions parser keeps only NPORT filings and builds archive URLs', () => {
    const accessions = parseNportAccessions({
      cik: '1676326',
      filings: { recent: {
        form: ['NPORT-P', 'N-CSR', 'NPORT-P'],
        accessionNumber: ['0002071691-26-018745', '0002071691-26-018700', '0002071691-26-018741'],
        filingDate: ['2026-08-28', '2026-08-01', '2026-08-28'],
        reportDate: ['2026-06-30', '2026-06-30', '2026-06-30'],
      } },
    });
    expect(accessions.map((entry) => entry.accession)).toEqual(['0002071691-26-018745', '0002071691-26-018741']);
    expect(accessions[0].url).toContain('/Archives/edgar/data/1676326/000207169126018745/primary_doc.xml');
  });

  test('an N-PORT-P document parses positions, net assets and the designated index', () => {
    const parsed = parseNport(NPORT);
    expect(parsed).toMatchObject({
      regName: 'Morgan Stanley ETF Trust', regCik: '0001676326', seriesName: 'Parametric Equity Premium Income ETF',
      seriesId: 'S000082252', repPdDate: '2026-06-30', netAssets: 399_844_102.98, designatedIndex: 'Russell 1000 Value',
    });
    expect(parsed.holdings).toHaveLength(2);
    expect(parsed.holdings[0]).toMatchObject({
      Name: 'Kraft Heinz Co. (The)', Ticker: '-', Identifier: '500754106',
      Weight: '0.5521378266', 'Market Value': '2207690.54', 'Shares Held': '93467', 'Asset Category': 'EC',
    });
    // The N/A CUSIP falls back to the ISIN.
    expect(parsed.holdings[1].Identifier).toBe('US7496071074');
  });

  test('the N-PORT reader tolerates the lowercase tags the proxy HTML mode returns', () => {
    const parsed = parseNport(NPORT);
    const lower = parseNport(NPORT.toLowerCase());
    expect(lower.seriesId).toBe(parsed.seriesId.toUpperCase());
    expect(lower.seriesName).toBe(parsed.seriesName.toLowerCase());
    expect(lower.holdings).toHaveLength(parsed.holdings.length);
  });

  test('a filing from another series is rejected for the requested fund', () => {
    const fund = { name: 'Parametric Equity Premium Income ETF' };
    expect(nportBelongsToFund({ seriesId: 'S000082252', seriesName: fund.name }, { seriesId: 'S000082252' }, fund)).toBe(true);
    expect(nportBelongsToFund({ seriesId: 'S000082250', seriesName: 'Parametric Hedged Equity ETF' }, { seriesId: 'S000082252' }, fund)).toBe(false);
    expect(nportBelongsToFund({ seriesId: '', seriesName: fund.name }, { seriesId: '' }, fund)).toBe(true);
    expect(nportBelongsToFund({ seriesId: '', seriesName: 'Calvert US Large-Cap Core Responsible Index ETF' }, { seriesId: '' }, fund)).toBe(false);
  });

  test('company ticker table fills N-PORT positions that carry no ticker', () => {
    const map = parseCompanyTickerMap({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, 1: { cik_str: 789019, ticker: 'MSFT', title: 'MICROSOFT CORP' } });
    expect(map.get(normalizeHoldingName('Apple Inc.'))).toBe('AAPL');
    expect(map.get(normalizeHoldingNameCore('Microsoft Corp'))).toBe('MSFT');
  });

  test('full-text search picks the registrant whose name matches the fund', () => {
    const payload = { hits: [
      { _source: { display_names: { cik: 12345, names: ['Some Other Trust'] } } },
      { _source: { display_names: { cik: 1676326, names: ['Parametric Equity Premium Income ETF', 'MORGAN STANLEY ETF TRUST'] } } },
    ] };
    expect(pickEftsCik(payload, 'Parametric Equity Premium Income ETF')).toBe('0001676326');
    expect(pickEftsCik(payload, 'Unrelated Fund')).toBeNull();
    expect(eftsSearchUrl('PAPI')).toContain('forms=NPORT-P');
  });
});

describe('SEC rendering-proxy fallback', () => {
  test('the proxy preamble and wrapper are stripped from json, xml and text', () => {
    expect(proxyPayload('Title: company_tickers_mf.json\n\nMarkdown Content:\n{"a":1}\n', 'json')).toBe('{"a":1}');
    expect(proxyPayload('[{"a":1}]', 'json')).toBe('[{"a":1}]');
    expect(proxyPayload('Markdown Content:\n<?xml version="1.0"?><feed><a/></feed>', 'xml')).toBe('<?xml version="1.0"?><feed><a/></feed>');
    expect(proxyPayload('Markdown Content:\nplain body', 'text')).toBe('plain body');
    expect(proxyPayload('  {"a":1}  ', 'json')).toBe('{"a":1}');
  });

  test('the first SEC denial switches the rest of the run to the proxy', async () => {
    const calls: string[] = [];
    const headers: Array<Record<string, string>> = [];
    const original = globalThis.fetch;
    const body = 'Title: company_tickers_mf.json\n\nMarkdown Content:\n{"fields":["cik","seriesId","classId","symbol"],"data":[[1676326,"S000082252","C000245536","PAPI"]]}';
    globalThis.fetch = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
      const url = String(input);
      calls.push(url);
      headers.push(init?.headers || {});
      if (url.startsWith('https://r.jina.ai/')) return new Response(body, { status: 200 });
      return new Response('blocked', { status: 403, statusText: 'Forbidden' });
    }) as typeof fetch;
    try {
      const config = { maxRetries: 1, secUa: 'test ua' } as any;
      const payload = await withRequestLane(0, () => fetchSecJson('https://www.sec.gov/files/company_tickers_mf.json', '[edgar   ] test table', config));
      expect(payload).toEqual({ fields: ['cik', 'seriesId', 'classId', 'symbol'], data: [[1676326, 'S000082252', 'C000245536', 'PAPI']] });
      expect(calls[0]).toBe('https://www.sec.gov/files/company_tickers_mf.json');
      expect(calls[1]).toBe('https://r.jina.ai/https://www.sec.gov/files/company_tickers_mf.json');
      expect(headers[1]['X-Return-Format']).toBeUndefined();
      // One-way for the rest of the run: the next request does not retry direct.
      calls.length = 0;
      await withRequestLane(0, () => fetchSecJson('https://www.sec.gov/submissions/CIK0001676326.json', '[edgar   ] test submissions', config));
      expect(calls).toEqual(['https://r.jina.ai/https://www.sec.gov/submissions/CIK0001676326.json']);
      // XML asks the proxy for the raw document: its default mode renders XML as markdown.
      calls.length = 0;
      headers.length = 0;
      await withRequestLane(0, () => fetchSecText('https://www.sec.gov/Archives/edgar/data/1676326/000207169126018753/primary_doc.xml', '[edgar   ] test nport', config, 'xml'));
      expect(calls).toEqual(['https://r.jina.ai/https://www.sec.gov/Archives/edgar/data/1676326/000207169126018753/primary_doc.xml']);
      expect(headers[0]['X-Return-Format']).toBe('html');
    } finally {
      globalThis.fetch = original;
    }
  });

  test('a non-retryable HTTP error fails after one request', async () => {
    let calls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => { calls += 1; return new Response('missing', { status: 404, statusText: 'Not Found' }); }) as typeof fetch;
    try {
      await expect(withRequestLane(0, () => fetchWithRetry('https://example.test/x', '[ test ]', {}, 3))).rejects.toThrow(/HTTP 404/);
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});

// ---------------------------------------------------------------------------
// Yahoo chart layer, history merging and derived metrics
// ---------------------------------------------------------------------------

describe('parseChart / chartUrl', () => {
  test('reads meta, adjusted closes and dividends', () => {
    const chart = parseChart(YAHOO);
    expect(chart).toMatchObject({ exchangeName: 'NYSEArca', longName: 'Parametric Equity Premium Income ETF', regularMarketPrice: 26.48, firstTradeDate: 1697722200 });
    // The null close is skipped; adjusted closes are rounded to two decimals.
    expect(chart.days.map((day) => day.date)).toEqual(['2026-08-03', '2026-08-17']);
    expect(chart.days[0].adjClose).toBe(27.33);
    expect(chart.dividends.map((dividend) => dividend.amount)).toEqual([0.166, 0.208]);
  });

  test('throws on an empty result', () => {
    expect(() => parseChart({ chart: { result: [] } })).toThrow(/empty result/);
  });

  test('HISTORY_RANGE limits the Yahoo request window', () => {
    const full = new URL(chartUrl('PAPI', readConfig({ HISTORY_RANGE: 'max' })));
    const short = new URL(chartUrl('PAPI', readConfig({ HISTORY_RANGE: '2y' })));
    expect(full.searchParams.get('period1')).toBe('0');
    const span = Number(short.searchParams.get('period2')) - Number(short.searchParams.get('period1'));
    expect(Math.round(span / 86_400 / 365.25)).toBe(2);
    expect(full.pathname.endsWith('/PAPI')).toBe(true);
  });
});

describe('mergeHistory', () => {
  const day = (date: string, adjClose: number) => ({ date, close: 26.28, adjClose, volume: 85084 });
  const previous = [{ Date: 'Sep 30 2026', Close: '26.28', 'Adj Close': '25.19', Volume: '85084' }];

  test('a published adjusted close keeps its cent when Yahoo jitters a rounding boundary', () => {
    const merged = mergeHistory(previous, [day('2026-09-30', 25.2)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]['Adj Close']).toBe('25.19');
  });

  test('a genuine restatement still replaces the published row', () => {
    expect(mergeHistory(previous, [day('2026-09-30', 25.42)])[0]['Adj Close']).toBe('25.42');
  });

  test('new days merge in date order and older published rows survive a short range', () => {
    const merged = mergeHistory([{ Date: 'Oct 16 2023', Close: '25.00', 'Adj Close': '24.00', Volume: '1' }], [day('2026-09-29', 25.1), day('2026-09-30', 25.2)]);
    expect(merged.map((row) => row.Date)).toEqual(['Oct 16 2023', 'Sep 29 2026', 'Sep 30 2026']);
  });

  test('history header sets stay stable', () => {
    expect(YAHOO_HISTORY_HEADERS).toEqual(['Date', 'Close', 'Adj Close', 'Volume']);
    expect(HISTORY_HEADERS).toEqual(['Date', 'NAV', 'Market Price', 'Premium/Discount']);
  });
});

describe('derived metrics', () => {
  test('annualizedToTotal inverts annualization and round-trips', () => {
    expect(annualizedToTotal(20.15, 3)).toBeCloseTo(73.45, 2);
    expect(annualizedToTotal(null, 3)).toBeNull();
    expect(annualizedToTotal(10, 0)).toBeNull();
    expect(totalToAnnualized(annualizedToTotal(12.5, 5), 5)).toBeCloseTo(12.5, 1);
    expect(totalToAnnualized('n/a' as any, 5)).toBeNull();
  });

  test('indicatedYield uses the latest distribution and cadence', () => {
    expect(indicatedYield(0.7, 4, 706.32)).toBeCloseTo(0.4, 1);
    expect(indicatedYield(0.176725, 12, 26.28)).toBeCloseTo(8.07, 2);
    expect(indicatedYield(null, 4, 10)).toBeNull();
    expect(indicatedYield(0.5, 0, 10)).toBeNull();
    expect(indicatedYield(0.5, 4, 0)).toBeNull();
  });

  test('inferDistributionFrequency detects monthly, quarterly and annual cadences', () => {
    const monthly = Array.from({ length: 6 }, (_, i) => ({ epoch: Date.UTC(2026, i, 15) / 1000, amount: 0.17 }));
    expect(inferDistributionFrequency(monthly)).toEqual({ frequency: 'Monthly', paymentsPerYear: 12 });
    const quarterly = [0, 1, 2, 3].map((i) => ({ epoch: Date.UTC(2026, i * 3, 21) / 1000, amount: 0.05 }));
    expect(inferDistributionFrequency(quarterly).frequency).toBe('Quarterly');
    const annual = [{ epoch: Date.UTC(2024, 11, 18) / 1000, amount: 1.3 }, { epoch: Date.UTC(2025, 11, 18) / 1000, amount: 1.4 }];
    expect(inferDistributionFrequency(annual)).toEqual({ frequency: 'Annually', paymentsPerYear: 1 });
    expect(inferDistributionFrequency([])).toEqual({ frequency: 'None', paymentsPerYear: null });
    expect(inferDistributionFrequency([{ epoch: 1, amount: 1 }])).toEqual({ frequency: 'Unknown', paymentsPerYear: null });
  });

  test('official published returns win; derived ones only fill the gaps', () => {
    const derived = { asOfDate: '2026-09-30', ytd: 7.1, yr1: 8.2, cagr3y: 9.9, cagr5y: null, cagr10y: null, siAnn: 10.5, mo1: -5.2, qtd: 0.1 };
    const metrics = deriveCatalogMetrics({ ytd: 7.63, yr1: 9.0, yr3: null, yr5: null, yr10: null, sinceInception: 9.4 }, derived, null, null, 0.176725, 12, 26.28);
    expect(metrics).toMatchObject({ ytd: 7.63, tr1y: 9.0, cagr3y: 9.9, siAnn: 9.4 });
    expect(metrics.dividendYield).toBeCloseTo(8.07, 2);
    expect(metrics.returnsBasis).toContain('official Eaton Vance / MSIM');
  });

  test('a fund with no published returns falls back to the derived basis', () => {
    const metrics = deriveCatalogMetrics(
      { ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null },
      { asOfDate: '2026-09-30', ytd: 7.1, yr1: 8.2, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null, mo1: null, qtd: null },
      null, null, null, null, 26.28,
    );
    expect(metrics.ytd).toBe(7.1);
    expect(metrics.dividendYield).toBeNull();
    expect(metrics.returnsBasis).toContain('not official NAV returns');
  });

  test('lastCompletedQuarterEnd anchors to the last completed quarter', () => {
    expect(lastCompletedQuarterEnd(new Date(Date.UTC(2026, 8, 30))).toISOString().slice(0, 10)).toBe('2026-06-30');
    expect(lastCompletedQuarterEnd(new Date(Date.UTC(2026, 9, 1))).toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(lastCompletedQuarterEnd(new Date(Date.UTC(2026, 0, 15))).toISOString().slice(0, 10)).toBe('2025-12-31');
  });
});

// ---------------------------------------------------------------------------
// Ranges, filters and batch selection
// ---------------------------------------------------------------------------

describe('parseRange / parseAumRange', () => {
  test('empty and ":" mean no restriction', () => {
    expect(parseRange('', 'X')).toBeUndefined();
    expect(parseRange(':', 'X')).toBeUndefined();
    expect(parseAumRange('')).toBeUndefined();
    expect(parseAumRange(':')).toBeUndefined();
  });

  test('inclusive bounds, percent signs, K/M/B/T suffixes and AUM presets', () => {
    expect(parseRange('1:5', 'X')).toEqual({ min: 1, max: 5 });
    expect(parseRange('2:', 'X')).toEqual({ min: 2, max: undefined });
    expect(parseRange(':3', 'X')).toEqual({ min: undefined, max: 3 });
    expect(parseRange('0.1%:0.5%', 'X')).toEqual({ min: 0.1, max: 0.5 });
    expect(parseAumRange('10M:2B')).toEqual({ min: 10_000_000, max: 2_000_000_000 });
    expect(parseAumRange('mid')).toEqual({ min: 2_000_000_000, max: 10_000_000_000 });
    expect(parseAumRange('nano')).toEqual({ min: 0, max: 10_000_000 });
  });

  test('colonless and inverted values are rejected', () => {
    expect(() => parseRange('15', 'X')).toThrow(/colon is required/);
    expect(() => parseRange('5:1', 'X')).toThrow(/must not exceed/);
    expect(() => parseAumRange('42')).toThrow(/colon is required/);
  });
});

describe('filters and batches', () => {
  const config = readConfig(resolveControls({
    TICKERS: 'PAPI', AUM: '100M:1B', TER: ':0.3', DIVIDEND_YIELD: '1:20', PERFORMANCE_YTD: '5:', TOTAL_RETURN_1Y: ':15',
  }));
  const candidate = {
    ticker: 'PAPI', aumValue: 479_910_000, terValue: 0.29,
    metrics: { dividendYield: 8.07, ytd: 7.63, tr1y: 9.0, cagr3y: 9.9 },
  };

  test('a fund inside every range passes', () => {
    expect(fundFilterReasons(candidate, config)).toEqual([]);
  });

  test('each failing constraint is named, and missing data never passes an active range', () => {
    expect(fundFilterReasons({ ...candidate, ticker: 'PEPS' }, config)).toEqual(['TICKERS']);
    expect(fundFilterReasons({ ...candidate, aumValue: 20_000_000 }, config)).toEqual(['AUM']);
    expect(fundFilterReasons({ ...candidate, terValue: 0.75 }, config)).toEqual(['TER']);
    expect(fundFilterReasons({ ...candidate, metrics: { ...candidate.metrics, dividendYield: null } }, config)).toEqual(['DIVIDEND_YIELD']);
    expect(fundFilterReasons({ ...candidate, metrics: { ...candidate.metrics, ytd: 3 } }, config)).toEqual(['PERFORMANCE_YTD']);
    expect(fundFilterReasons({ ...candidate, metrics: { ...candidate.metrics, tr1y: 30 } }, config)).toEqual(['TOTAL_RETURN_1Y']);
  });

  test('SEC_YIELD and the 3Y/5Y/10Y tenors filter on the derived metrics', () => {
    const strict = readConfig(resolveControls({ SEC_YIELD: '1:3', PERFORMANCE_3Y: '10:', TOTAL_RETURN_3Y: '50:' }));
    const base = { ticker: 'PAPI', metrics: { secYield: 2.63, cagr3y: 12, tr3y: 60 } };
    expect(fundFilterReasons(base, strict)).toEqual([]);
    expect(fundFilterReasons({ ...base, metrics: { ...base.metrics, secYield: 4 } }, strict)).toEqual(['SEC_YIELD']);
    expect(fundFilterReasons({ ...base, metrics: { ...base.metrics, secYield: null } }, strict)).toEqual(['SEC_YIELD']);
    expect(fundFilterReasons({ ...base, metrics: { ...base.metrics, cagr3y: 5 } }, strict)).toEqual(['PERFORMANCE_3Y']);
    expect(fundFilterReasons({ ...base, metrics: { ...base.metrics, tr3y: 20 } }, strict)).toEqual(['TOTAL_RETURN_3Y']);
  });

  test('MAX_FETCHES batches rotate after the saved cursor and TICKERS applies first', () => {
    const funds = ['PAPI', 'PEPS', 'PHEQ'].map((ticker) => ({ ticker })) as any[];
    const tickers = (config: ReturnType<typeof readConfig>, cursor: string | null) => batchSelection(funds, config, cursor).map((fund) => fund.ticker);
    expect(tickers(readConfig({}), null)).toEqual(['PAPI', 'PEPS', 'PHEQ']);
    expect(tickers(readConfig({ MAX_FETCHES: '2' }), null)).toEqual(['PAPI', 'PEPS']);
    expect(tickers(readConfig({ MAX_FETCHES: '2' }), 'PEPS')).toEqual(['PHEQ', 'PAPI']);
    expect(tickers(readConfig({ MAX_FETCHES: '1', TICKERS: 'PHEQ PEPS' }), 'PEPS')).toEqual(['PHEQ']);
  });

  test('the saved cursor is the last successful fund of the batch, whatever finished first', () => {
    const batch = [{ ticker: 'PAPI' }, { ticker: 'PEPS' }, { ticker: 'PHEQ' }];
    expect(nextCursor(batch, new Set(['PHEQ', 'PAPI']), 'X')).toBe('PHEQ');
    expect(nextCursor(batch, new Set(['PAPI']), 'X')).toBe('PAPI');
    expect(nextCursor(batch, new Set(), 'X')).toBe('X');
  });
});

// ---------------------------------------------------------------------------
// Controls: resolver, precedence, validation, parity
// ---------------------------------------------------------------------------

const configFile = (): Record<string, string> => JSON.parse(read('scripts/update-data.config.json'));

describe('control resolver', () => {
  test('file < advanced JSON < nonblank input < environment, brand alias wins over the plain name', () => {
    const controls = resolveControls(
      { CONCURRENCY: 2, TICKERS: 'PAPI', MAX_FETCHES: 1 },
      { CONCURRENCY: 3, TICKERS: 'PHEQ' },
      { CONCURRENCY: '4', TICKERS: '' },
      { PARAMETRIC_CONCURRENCY: '5', CONCURRENCY: '6' },
    );
    expect(controls).toEqual({ CONCURRENCY: '5', TICKERS: 'PHEQ', MAX_FETCHES: '1' });
  });

  test('an explicitly set empty environment variable clears the control; unset ones do not', () => {
    expect(resolveControls({ TICKERS: 'PAPI', AUM: 'small' }, {}, {}, { TICKERS: '' })).toEqual({ TICKERS: '', AUM: 'small' });
    expect(resolveControls({ TICKERS: 'PAPI' }, {}, {}, { OTHER: 'x' })).toEqual({ TICKERS: 'PAPI' });
    expect(readConfig(resolveControls({ TICKERS: 'PAPI' }, {}, {}, { TICKERS: '' })).tickers).toEqual([]);
  });

  test('advanced can deliberately blank a key; a blank input inherits instead', () => {
    expect(resolveControls({ TICKERS: 'PAPI' }, { TICKERS: '' }).TICKERS).toBe('');
    expect(resolveControls({ TICKERS: 'PAPI' }, {}, { TICKERS: '' }).TICKERS).toBe('PAPI');
  });

  test('legacy aliases keep working', () => {
    expect(resolveControls({}, {}, {}, { PARAMETRIC_LIMIT: '4' }).MAX_FETCHES).toBe('4');
    expect(resolveControls({}, {}, {}, { HISTORICAL_PAGE_SIZE: '50' }).HISTORY_PAGE_SIZE).toBe('50');
    expect(resolveControls({}, {}, {}, { MAX_FETCHES: '2', PARAMETRIC_LIMIT: '4' }).MAX_FETCHES).toBe('2');
  });

  test('a scheduled run (no inputs, no advanced) equals the config defaults', async () => {
    const file = configFile();
    expect(resolveControls(file, {}, {}, {})).toEqual(file);
    expect(await runtimeControls({})).toEqual(file);
    // A manual dispatch with every input left blank is the same thing.
    const blanks = Object.fromEntries(workflowInputs().map((name) => [name.toUpperCase(), '']));
    expect(resolveControls(file, {}, blanks, {})).toEqual(file);
  });

  test('config defaults of this provider', () => {
    const config = readConfig(resolveControls(configFile()));
    expect(config).toMatchObject({
      tickers: [], maxFetches: 0, requestSleep: 3, concurrency: 1, maxRetries: 2, holdingsPageSize: 250, historyPageSize: 1000,
      historyRange: 'max', skipIssuer: false, skipYahoo: false, edgarFallback: true, storeRawDownloads: false,
      catalogUrl: 'https://www.eatonvance.com/products/etfs.html', secUa: 'daggerok ETF feed daggerok@gmail.com',
    });
    expect(config.aumRange).toBeUndefined();
    expect(config.performanceRanges).toEqual({});
  });

  test('unknown keys, non-scalars, newlines and invalid values are rejected', () => {
    for (const value of [
      { UNKNOWN: 1 }, { SEC_UA: 'x\nEVIL=yes' }, { CONCURRENCY: 0 }, { MAX_RETRIES: 0 }, { MAX_RETRIES: -1 }, { MAX_RETRIES: '1.5' },
      { MAX_FETCHES: 1.5 }, { HOLDINGS_PAGE_SIZE: 0 }, { HISTORY_PAGE_SIZE: 'x' }, { REQUEST_SLEEP: -1 }, { HISTORY_RANGE: 'oops' },
      { VERBOSE: 'maybe' }, { SKIP_YAHOO: 'sometimes' }, { TICKERS: ['PAPI'] }, { CATALOG_URL: 'ftp://example.com' },
      { AUM: '42' }, { TER: '0.5' }, { PERFORMANCE_1Y: '9:1' }, { TOTAL_RETURN_5Y: 'a:b' }, null, [],
    ]) {
      expect(() => resolveControls(value)).toThrow();
    }
    expect(() => resolveControls({}, { SEC_UA: 'x\rfoo' })).toThrow();
    expect(() => resolveControls({}, null)).toThrow();
    expect(() => resolveControls({}, {}, { TICKERS: { a: 1 } })).toThrow();
    expect(() => resolveControls({}, {}, {}, { PARAMETRIC_SEC_UA: 'x\0bad' })).toThrow();
    expect(() => resolveControls({}, {}, {}, { MAX_RETRIES: '0' })).toThrow(/MAX_RETRIES: expected integer >= 1/);
    expect(() => readConfig({ MAX_RETRIES: '0' })).toThrow(/MAX_RETRIES/);
  });

  test('valid values of every control type resolve to strings', () => {
    const controls = resolveControls({}, {
      MAX_RETRIES: 1, REQUEST_SLEEP: 0.5, HISTORY_RANGE: '5y', SKIP_ISSUER: true, AUM: 'large', TER: ':0.5',
      TOTAL_RETURN_3Y: '10:', STORE_RAW_DOWNLOADS: 'off', CATALOG_URL: 'https://example.test/etfs.html',
    });
    expect(Object.values(controls).every((value) => typeof value === 'string')).toBe(true);
    const config = readConfig(controls);
    expect(config).toMatchObject({ maxRetries: 1, requestSleep: 0.5, historyRange: '5y', skipIssuer: true, storeRawDownloads: false });
    expect(config.aumRange).toEqual({ min: 10_000_000_000, max: undefined });
    expect(config.totalReturnRanges['3Y']).toEqual({ min: 10, max: undefined });
  });

  test('SEC_UA keeps one declared descriptor in the config file and the code default', () => {
    expect(configFile().SEC_UA).toBe('daggerok ETF feed daggerok@gmail.com');
    expect(readConfig({}).secUa).toBe('daggerok ETF feed daggerok@gmail.com');
    expect(readConfig({ SEC_UA: 'ops contact' }).secUa).toBe('ops contact');
  });
});

function runScript(args: string[], env: Record<string, string> = {}) {
  return Bun.spawnSync([SCRIPT, ...args], { env: { PATH: process.env.PATH ?? '', ...env }, stdout: 'pipe', stderr: 'pipe' });
}

describe('command line', () => {
  test('the script is directly executable and --help redacts the SEC contact', () => {
    const run = runScript(['--help']);
    expect(run.exitCode).toBe(0);
    const out = run.stdout.toString();
    expect(out).toContain('SEC_UA=<redacted>');
    expect(out).not.toContain('daggerok@gmail.com');
    expect(out).toContain('CONCURRENCY=15');
  });

  test('--help and the environment honor the same resolver and reject invalid values', () => {
    const out = runScript(['--help'], { TICKERS: 'PAPI', MAX_RETRIES: '4' }).stdout.toString();
    expect(out).toContain('TICKERS=PAPI');
    expect(out).toContain('MAX_RETRIES=4');
    const bad = runScript(['--help'], { MAX_RETRIES: '0' });
    expect(bad.exitCode).not.toBe(0);
  });

  test('--help documents every control', () => {
    const out = runScript(['--help']).stdout.toString();
    for (const name of CONTROL_NAMES) expect(out).toContain(name);
  });
});

describe('concurrency', () => {
  async function maxInFlight(workers: number): Promise<number> {
    let inFlight = 0;
    let peak = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Bun.sleep(40);
      inFlight -= 1;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    try {
      // Per-worker pacing (25 ms) must not serialize different workers.
      await runPool(Array.from({ length: 6 }, (_, i) => i), workers, 25, async (i) => {
        await fetchWithRetry(`https://example.test/${i}`, '[ test ]', {}, 1);
      });
    } finally {
      globalThis.fetch = original;
    }
    return peak;
  }

  test('CONCURRENCY workers fetch in parallel; one worker stays sequential', async () => {
    expect(await maxInFlight(1)).toBe(1);
    expect(await maxInFlight(3)).toBe(3);
    expect(await maxInFlight(15)).toBe(6);
  });

  test('every item is handled exactly once', async () => {
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5], 3, 0, async (item) => { await Bun.sleep(item); seen.push(item); });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
    await runPool([], 4, 0, async () => { throw new Error('unreachable'); });
  });
});

// ---------------------------------------------------------------------------
// Repository layout, README and workflow
// ---------------------------------------------------------------------------

function workflowInputs(): string[] {
  const workflow = (Bun as any).YAML.parse(read('.github/workflows/update-data.yml'));
  return Object.keys(workflow.on.workflow_dispatch.inputs).filter((name) => name !== 'advanced');
}

describe('repository layout', () => {
  test('scripts/ holds only the three standard files and the root carries no work artifacts', () => {
    expect(readdirSync(new URL('scripts/', ROOT)).sort()).toEqual(['update-data.config.json', 'update-data.test.ts', 'update-data.ts']);
    for (const name of ['.worklog.txt', '.prompt.txt', 'evidence', 'research', '.plans', 'COMPLETION.md', 'tsconfig.json']) {
      expect(existsSync(new URL(name, ROOT))).toBe(false);
    }
    expect(readdirSync(new URL('.github/workflows/', ROOT))).toEqual(['update-data.yml']);
    expect(read('package.json')).not.toContain('"typescript"');
  });

  test('update-data.ts starts with the bun shebang, keeps the types reference and is executable', () => {
    const lines = read('scripts/update-data.ts').split('\n');
    expect(lines[0]).toBe('#!/usr/bin/env bun');
    expect(lines[1]).toBe('/// <reference types="bun" />');
    expect(statSync(SCRIPT).mode & 0o111).not.toBe(0);
  });

  test('dependabot watches bun and github-actions monthly', () => {
    const config = (Bun as any).YAML.parse(read('.github/dependabot.yml'));
    expect(config.version).toBe(2);
    expect(config.updates.map((update: any) => [update['package-ecosystem'], update.directory, update.schedule.interval, update['open-pull-requests-limit']])).toEqual([
      ['bun', '/', 'monthly', 10],
      ['github-actions', '/', 'monthly', 10],
    ]);
  });
});

describe('update workflow', () => {
  const text = read('.github/workflows/update-data.yml');
  const workflow = (Bun as any).YAML.parse(text);
  const inputs = workflow.on.workflow_dispatch.inputs;

  test('inputs: at most 25, every individual input is a control, blank defaults, advanced JSON', () => {
    expect(Object.keys(inputs).length).toBeLessThanOrEqual(25);
    expect(inputs.advanced).toMatchObject({ default: '{}', type: 'string', required: false });
    for (const name of workflowInputs()) {
      expect(CONTROL_NAMES as readonly string[]).toContain(name.toUpperCase());
      expect(inputs[name].default).toBe('');
    }
    expect(workflowInputs().length).toBeLessThanOrEqual(24);
    // Everything not exposed individually stays reachable through advanced and the config file.
    expect(Object.keys(configFile()).sort()).toEqual([...CONTROL_NAMES].sort());
  });

  test('weekly schedule, serialized runs, bounded job, no push trigger, no stray tooling', () => {
    expect(workflow.on.schedule).toEqual([{ cron: '0 0 * * 0' }]);
    expect(workflow.on.push).toBeUndefined();
    expect(workflow.permissions).toEqual({ contents: 'write' });
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
    expect(workflow.jobs['update-data']['timeout-minutes']).toBe(30);
    expect(text).toContain('persist-credentials: false');
    expect(text).not.toContain('bunx tsc');
  });

  test('the output directory is fixed: only api/parametric is staged and no input changes it', () => {
    expect(text).toContain('git add api/parametric');
    expect(text).toContain('git diff --cached --quiet -- api/parametric');
    expect(text.match(/git add /g)).toHaveLength(1);
    expect(text).not.toMatch(/OUTPUT_DIR|OUT_DIR/);
    expect(read('scripts/update-data.ts')).toContain("new URL('../api/parametric/', import.meta.url)");
    expect(CONTROL_NAMES.some((name) => /OUT/.test(name))).toBe(false);
  });

  test('dispatch values never reach a shell: no inputs.* interpolation, JSON through the environment', () => {
    expect(text).not.toMatch(/\$\{\{\s*(inputs|github\.event\.inputs)\./);
    expect(text).toContain('DISPATCH_INPUTS: ${{ toJSON(inputs) }}');
    expect(text).toContain('resolveControls(file, advanced, individual, protectedVars)');
  });

  test('the protected SEC_UA variable is the top-priority override and is never printed', () => {
    expect(text).toContain('PROTECTED_SEC_UA: ${{ vars.SEC_UA }}');
    expect(text).toContain('protectedVars.SEC_UA');
    expect(text).not.toContain('daggerok@gmail.com');
    // The protected map is the env layer of the same resolver.
    expect(resolveControls(configFile(), {}, {}, { SEC_UA: 'protected contact' }).SEC_UA).toBe('protected contact');
  });
});

describe('README', () => {
  const readme = read('README.md');
  const section = (heading: string): string => (readme.match(new RegExp(`^#{2,3} ${heading}[^\\n]*\\n([\\s\\S]*?)(?=\\n#{2,3} |(?![\\s\\S]))`, 'm')) ?? [])[1] ?? '';

  test('standard sections appear in order', () => {
    let last = -1;
    for (const heading of ['Using Bun', 'Updating the static', 'Data sources', 'Metrics and caveats', 'Update controls', 'Examples', 'TypeScript and verification', 'Brands table', 'Sibling applications', 'License']) {
      const at = readme.search(new RegExp(`^#{2,3} .*${heading}`, 'm'));
      expect(at).toBeGreaterThan(last);
      last = at;
    }
  });

  test('config file, CONTROL_NAMES, the controls table and --help list the same controls', () => {
    const rows = section('Update controls').split('\n').filter((line) => line.startsWith('| `'));
    const documented = rows.flatMap((row) => [...row.split('|')[1].matchAll(/`([A-Z0-9_]+)`/g)].map((match) => match[1]));
    expect([...documented].sort()).toEqual([...CONTROL_NAMES].sort());
    expect(Object.keys(configFile()).sort()).toEqual([...CONTROL_NAMES].sort());
    const help = runScript(['--help']).stdout.toString();
    for (const name of CONTROL_NAMES) expect(help).toContain(name);
  });

  test('documents the precedence, the verification commands and nothing about removed artifacts', () => {
    expect(readme).toContain('scripts/update-data.config.json');
    expect(/file defaults < advanced JSON < nonblank inputs < protected Actions variable/i.test(readme)).toBe(true);
    const verification = section('TypeScript and verification');
    for (const command of ['bun install --frozen-lockfile', 'bun test', 'bun build --target=bun scripts/update-data.ts --outfile=/dev/null', 'git diff --check']) {
      expect(verification).toContain(command);
    }
    expect(/worklog|\.prompt|evidence|fixtures|research\/|config-docs|deployment pending/i.test(readme)).toBe(false);
    expect(readme).toContain('./scripts/update-data.ts');
    expect(readme).toContain('daggerok.github.io/Parametric');
  });

  test('the shared brand and sibling tables list every brand once', () => {
    for (const heading of ['Brands table', 'Sibling applications']) {
      const rows = section(heading).split('\n').filter((line) => line.startsWith('|')).slice(2);
      expect(rows.length).toBeGreaterThanOrEqual(29);
      expect(rows.filter((row) => row.includes('/Parametric'))).toHaveLength(1);
    }
  });
});
