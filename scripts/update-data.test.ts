/// <reference types="bun" />
// Offline tests with small inline samples; no network requests are made here.
// Groups (same names in every ETF repo): controls, parsing, metrics, pipeline, network.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONTROL_NAMES, PARAMETRIC_FUND_SLUGS, PARAMETRIC_PRODUCT_IDS, annualizedToTotal, batchSelection, chartUrl, cleanHoldingTicker,
  configureProxyGate, createRequestGate, cursorScope, deriveCatalogMetrics, eftsSearchUrl, fetchSecJson, fetchSecText, fetchWithRetry,
  fundFilterReasons, holdingsDownloadUrl, indicatedYield, inferDistributionFrequency, installSystemCa, isCertError, isParametricFundUrl,
  isoFromEdgar, issuerFrequency, issuerFundUrl, lastCompletedQuarterEnd, loadIssuerApi, mergeHistory, nextCursor,
  normalizeHoldingName, normalizeHoldingNameCore, normalizeSource, nportBelongsToFund, nportUrlFor, officialReturnsFor, parseAumRange,
  parseChart, parseCompanyTickerMap, parseEdgarAtomFilings, parseFundTickerMap, parseHoldingsCsv, parseIssuerApi, parseIssuerCatalog,
  parseIssuerDistributions, parseIssuerProduct, parseIssuerReturnsTable, parseKeyFacts, parseNport, parseNportAccessions, parseRange,
  parseTopHoldings, pickEftsCik, priceReturns, proxyPayload, readConfig, resolveControls, runPool, runtimeControls, totalToAnnualized,
  edgarSeriesFilingsUrl, filingDocumentUrl, nportQuarterReturns, parseProspectusFacts, parseSubmissionDocuments, resetRunState, runFailed, runHealth,
  sourceGate, withRequestLane, ISSUER_UA, indexRowFromMeta, retainIssuerSections,
} from './update-data';

const ROOT = new URL('../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, ROOT), 'utf8');
const SCRIPT = new URL('./update-data.ts', import.meta.url).pathname;
const configFile = (): Record<string, string> => JSON.parse(read('scripts/update-data.config.json'));

// Every test starts from the same process state: fixed time zone, real fetch, default proxy gate, untouched exit code.
const realFetch = globalThis.fetch;
const realTz = process.env.TZ;
const realExitCode = process.exitCode;
beforeEach(() => { process.env.TZ = 'UTC'; });
afterEach(() => {
  globalThis.fetch = realFetch;
  process.exitCode = realExitCode;
  configureProxyGate(3200);
  resetRunState();
  if (realTz === undefined) delete process.env.TZ; else process.env.TZ = realTz;
});
const mockFetch = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void => {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => handler(String(input), init)) as unknown as typeof fetch;
};

// ---------------------------------------------------------------------------
// Small inline samples shaped like the live providers' payloads
// ---------------------------------------------------------------------------

const CATALOG = [
  '| Fund Name | Price <br> As of Date | Market <br>Price ($) | NAV ($) | Premium/ <br>Discount ($) | Yield <br> As of Date | 30-Day <br>Yield (%) | Dist. <br>Frequency |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  '| CVIE<br> [Calvert International Responsible Index ETF](https://www.eatonvance.com/products/etfs/international-equity/calvert-international-responsible-index-etf.html) | 09/30/2026 | 83.13 | 83.28 | -0.15 | 08/31/2026 | 1.91 | Quarterly |',
  '| PEPS<br> [Parametric Equity Plus ETF](https://www.eatonvance.com/products/etfs/us-equity/parametric-equity-plus-etf.html) | 09/30/2026 | 32.91 | 32.84 | 0.07 | 08/31/2026 | 0.97 | Quarterly |',
  '| PAPI<br> [Parametric Equity Premium Income ETF](https://www.eatonvance.com/products/etfs/us-equity/parametric-equity-premium-income-etf.html) | 09/30/2026 | 26.28 | 26.22 | 0.06 | 08/31/2026 | 2.63 | Monthly |',
  '| PHEQ<br> [Parametric Hedged Equity ETF](https://www.eatonvance.com/products/etfs/us-equity/parametric-hedged-equity-etf.html) | 09/30/2026 | 30.10 | 30.05 | 0.05 | 08/31/2026 | 1.10 | Quarterly |',
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
</invstOrSecs><monthlyTotReturns><monthlyTotReturn classId="C000245536" rtn1="-1.37" rtn2="-1.02" rtn3="1.79"/></monthlyTotReturns></formData></edgarSubmission>`;
// The previous quarter's filing: January, February and March 2026.
const NPORT_Q1 = NPORT.replace('<repPdDate>2026-06-30', '<repPdDate>2026-03-31').replace('rtn1="-1.37" rtn2="-1.02" rtn3="1.79"', 'rtn1="2.00" rtn2="1.00" rtn3="-1.50"');

// Summary prospectus (497K): flattened text of the fee table, with and without a fee waiver, as HTML.
const PROSPECTUS = (fees: string) => `<html><body><p>Parametric Equity Premium Income ETF &#8202; Summary Prospectus&nbsp;&nbsp;|&nbsp; January 28, 2026</p>
<p>Ticker Symbol and Exchange Parametric Equity Premium Income ETF PAPI NYSE Arca</p>
<table><tr><td>Annual Fund Operating Expenses 1 (expenses that you pay each year)</td></tr>${fees}</table>
<p>3 Since Inception reflects the inception date of the Fund (commenced operations on 10/16/23).</p></body></html>`;
const FEES_PLAIN = '<tr><td>Management Fee 1</td><td>0.29%</td></tr><tr><td>Total Annual Fund Operating Expenses</td><td>0.29%</td></tr>';
const FEES_WAIVER = '<tr><td>Total Annual Fund Operating Expenses 2</td><td>0.40%</td></tr><tr><td>Fee Waiver 2</td><td>0.15%</td></tr><tr><td>Total Annual Fund Operating Expenses After Fee Waiver 2</td><td>0.25%</td></tr>';
const ATOM_NPORT = `<feed><entry><content><accession-number>0002071691-26-018745</accession-number><filing-date>2026-08-21</filing-date><filing-type>NPORT-P</filing-type></content></entry>
<entry><content><accession-number>0002071691-26-011935</accession-number><filing-date>2026-05-27</filing-date><filing-type>NPORT-P</filing-type></content></entry></feed>`;
const ATOM_497K = `<feed><entry><content><accession-number>0001133228-26-001031</accession-number><filing-date>2026-01-29</filing-date><filing-type>497K</filing-type></content></entry>
<entry><content><accession-number>0001133228-26-000002</accession-number><filing-date>2026-01-02</filing-date><filing-type>497</filing-type></content></entry></feed>`;
const SUBMISSIONS = { cik: '1676326', filings: { recent: {
  form: ['NPORT-P', '497K', '497K'], accessionNumber: ['0002071691-26-018745', '0001133228-26-001031', '0001104659-26-112235'],
  primaryDocument: ['xslFormNPORT-P_X01/primary_doc.xml', 'pepietf-efp22532_497k.htm', 'tm2626540d1_497k.htm'],
} } };

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
const API_PERF = (timeFrame: string, asOf: string, o: Record<string, string>) => ({ timeFrame, perfAsOfDate: asOf, perfType: 'NET', ...o });
const API_FILES = {
  detail: { en: { name: 'Parametric Equity Premium Income ETF', inceptionDate: '10-16-2023', exchange: 'NYSE Arca', assetClassName: 'US Equity', distFrequency: 'Monthly', shareClasses: [{
    identifiers: { ticker: 'PAPI', cusip: '61774R866 ', isin: 'US61774R8667' },
    fees: { grossExpenseRatio: ' 0.35 ', netExpenseRatio: ' 0.29 ' },
    benchmarks: [{ name: 'Russell 1000 Value Index', benchmarkSubType: 'P' }, { name: 'ICE BofA 3-Month U.S. Treasury Bill Index', benchmarkSubType: 'S' }],
  }] } },
  pricing: { en: { shareClasses: [{ currencies: [{ pricings: { nav: ' 26.43 ', nav4f: ' 26.4276 ', marketPrice: ' 26.48 ', premiumDiscount: ' 0.05 ', premiumDiscountPercentage: ' 0.20 ', medianBid: ' 0.22 ', outstandingShares: ' 18,400,000 ', navAsOfDate: '10/01/2026' } }] }] } },
  returns: { en: { shareClasses: [{ currencies: [{ performances: [
    API_PERF('DAILY', '10/01/2026', { oneMonth: ' -4.08 ', ytd: ' 8.49 ', oneYr: ' 9.92 ', threeYr: '-- ', fiveYr: '-- ', tenYr: '-- ', si: ' 9.68 ', qtd: ' 0.80 ', threeMonths: ' 0.62 ' }),
    API_PERF('MONTHLY', '09/30/2026', { oneMonth: ' -5.08 ', ytd: ' 7.63 ', oneYr: ' 9.00 ', threeYr: '-- ', fiveYr: '-- ', tenYr: '-- ', si: ' 9.40 ', qtd: ' 0.20 ', threeMonths: ' 0.20 ' }),
    { ...API_PERF('MONTHLY', '09/30/2026', { ytd: ' 7.86 ' }), perfType: 'GRS' },
    API_PERF('QUARTERLY', '09/30/2026', { oneMonth: ' -5.08 ', ytd: ' 7.63 ', oneYr: ' 9.00 ', threeYr: '-- ', fiveYr: '-- ', tenYr: '-- ', si: ' 9.40 ', qtd: ' 0.20 ', threeMonths: ' 0.20 ' }),
  ] }] }] } },
  yields: { en: { shareClasses: [{ currencies: [{ yield: { dailySec30Yield: ' 2.79 ', dailyAsofDate: '10/01/2026', sec30Yield: ' 2.63 ', thirtyDayAsofDate: '08/31/2026' } }] }] } },
  distribution: { en: { shareClasses: [{ distributions: [
    { exDistributionDate: '09/30/2026', recordDate: '09/30/2026', payableDate: '10/06/2026', dividendPerShare: ' 0.176725 ', totalCapitalGainPerShare: ' 0.000000 ' },
    { exDistributionDate: '11/30/2023', recordDate: '12/01/2023', payableDate: '12/06/2023', dividendPerShare: ' 0.166059 ', totalCapitalGainPerShare: ' 0.000000 ' },
  ] }] } },
};
const EMPTY_API = { detail: {}, pricing: {}, returns: {}, yields: {}, distribution: {} };
const NO_RETURNS = { ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null };
const NO_DERIVED = { asOfDate: '', ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null, mo1: null, qtd: null };

// ---------------------------------------------------------------------------
// controls: resolver, validation, ranges, filters, CLI, config/README/workflow parity
// ---------------------------------------------------------------------------

function runScript(args: string[], env: Record<string, string> = {}) {
  return Bun.spawnSync([SCRIPT, ...args], { env: { PATH: process.env.PATH ?? '', TZ: 'UTC', ...env }, stdout: 'pipe', stderr: 'pipe' });
}
const workflowText = (): string => read('.github/workflows/update-data.yml');
const workflowInputs = (): string[] => Object.keys((Bun as any).YAML.parse(workflowText()).on.workflow_dispatch.inputs).filter((name) => name !== 'advanced');

describe('controls', () => {
  test('precedence is file < advanced < nonblank input < env (brand alias first) < protected variable', () => {
    expect(resolveControls(
      { CONCURRENCY: 2, TICKERS: 'PAPI', MAX_FETCHES: 1 }, { CONCURRENCY: 3, TICKERS: 'PHEQ' }, { CONCURRENCY: '4', TICKERS: '' },
      { PARAMETRIC_CONCURRENCY: '5', CONCURRENCY: '6' },
    )).toEqual({ CONCURRENCY: '5', TICKERS: 'PHEQ', MAX_FETCHES: '1' });
    // an explicitly set empty env var clears the control, unset ones do not; advanced may blank, a blank input inherits
    expect(resolveControls({ TICKERS: 'PAPI', AUM: 'small' }, {}, {}, { TICKERS: '' })).toEqual({ TICKERS: '', AUM: 'small' });
    expect(resolveControls({ TICKERS: 'PAPI' }, {}, {}, { OTHER: 'x' })).toEqual({ TICKERS: 'PAPI' });
    expect(resolveControls({ TICKERS: 'PAPI' }, { TICKERS: '' }).TICKERS).toBe('');
    expect(resolveControls({ TICKERS: 'PAPI' }, {}, { TICKERS: '' }).TICKERS).toBe('PAPI');
    // the protected repository variable is the env layer of the same resolver and wins over everything
    expect(resolveControls(configFile(), { SEC_UA: 'advanced' }, { SEC_UA: 'input' }, { SEC_UA: 'protected contact' }).SEC_UA).toBe('protected contact');
  });

  test('brand and legacy env aliases keep working', () => {
    expect(resolveControls({}, {}, {}, { PARAMETRIC_LIMIT: '4' }).MAX_FETCHES).toBe('4');
    expect(resolveControls({}, {}, {}, { HISTORICAL_PAGE_SIZE: '50' }).HISTORY_PAGE_SIZE).toBe('50');
    expect(resolveControls({}, {}, {}, { MAX_FETCHES: '2', PARAMETRIC_LIMIT: '4' }).MAX_FETCHES).toBe('2');
    expect(resolveControls({}, {}, {}, { PARAMETRIC_TICKERS: 'PAPI', TICKERS: 'PEPS' }).TICKERS).toBe('PAPI');
  });

  test('a scheduled run equals the config defaults, which resolve to this provider\'s settings', async () => {
    const file = configFile();
    expect(resolveControls(file, {}, {}, {})).toEqual(file);
    expect(await runtimeControls({})).toEqual(file);
    const blanks = Object.fromEntries(workflowInputs().map((name) => [name.toUpperCase(), '']));
    expect(resolveControls(file, {}, blanks, {})).toEqual(file);
    const config = readConfig(resolveControls(file));
    expect(config).toMatchObject({
      tickers: [], maxFetches: 0, requestSleep: 3, concurrency: 1, maxRetries: 2, holdingsPageSize: 250, historyPageSize: 1000,
      historyRange: 'max', skipIssuer: false, skipYahoo: false, edgarFallback: true, storeRawDownloads: false,
      catalogUrl: 'https://www.eatonvance.com/products/etfs.html', secUa: 'daggerok ETF feed daggerok@gmail.com',
    });
    expect(config.aumRange).toBeUndefined();
    expect(file.SEC_UA).toBe(readConfig({}).secUa);
  });

  test('every layer rejects invalid values: bad numbers, ranges, booleans, URLs, CR/LF/NUL, unknown keys and non-objects', () => {
    const invalid: unknown[] = [
      { UNKNOWN: 1 }, { SEC_UA: 'x\nEVIL=yes' }, { SEC_UA: 'x\rfoo' }, { SEC_UA: 'x\0bad' }, { CONCURRENCY: 0 }, { MAX_RETRIES: 0 },
      { MAX_RETRIES: -1 }, { MAX_RETRIES: '1.5' }, { MAX_FETCHES: 1.5 }, { HOLDINGS_PAGE_SIZE: 0 }, { HISTORY_PAGE_SIZE: 'x' },
      { REQUEST_SLEEP: -1 }, { HISTORY_RANGE: 'oops' }, { HISTORY_RANGE: '0y' }, { VERBOSE: 'maybe' }, { SKIP_YAHOO: 'sometimes' },
      { TICKERS: ['PAPI'] }, { CATALOG_URL: 'ftp://example.com' }, { AUM: '42' }, { TER: '0.5' }, { PERFORMANCE_1Y: '9:1' },
      { TOTAL_RETURN_5Y: 'a:b' }, { AUM: 'a:b' }, { TER: '1:2:3' }, { USE_SYSTEM_CA: 'maybe' }, null, [],
    ];
    for (const bad of invalid) {
      const label = JSON.stringify(bad);
      expect(() => resolveControls(bad), label).toThrow();
      expect(() => resolveControls({}, bad), label).toThrow();
      expect(() => resolveControls({}, {}, bad), label).toThrow();
      if (bad && !Array.isArray(bad) && !('UNKNOWN' in bad)) {
        const env = Object.fromEntries(Object.entries(bad).map(([key, value]) => [`PARAMETRIC_${key}`, value as string]));
        expect(() => resolveControls({}, {}, {}, env), label).toThrow();
      }
    }
  });

  test('valid values of every control type resolve to strings; MAX_RETRIES is an integer >= 1 everywhere', () => {
    const controls = resolveControls({}, {
      MAX_RETRIES: 1, REQUEST_SLEEP: 0.5, HISTORY_RANGE: '5y', SKIP_ISSUER: true, AUM: 'large', TER: ':0.5', TOTAL_RETURN_3Y: '10:',
      STORE_RAW_DOWNLOADS: 'off', USE_SYSTEM_CA: 'AUTO',
    });
    expect(Object.values(controls).every((value) => typeof value === 'string')).toBe(true);
    expect(controls.USE_SYSTEM_CA).toBe('auto');
    const config = readConfig(controls);
    expect(config).toMatchObject({ maxRetries: 1, requestSleep: 0.5, historyRange: '5y', skipIssuer: true, storeRawDownloads: false });
    expect(config.aumRange).toEqual({ min: 10_000_000_000, max: undefined });
    expect(config.totalReturnRanges['3Y']).toEqual({ min: 10, max: undefined });
    expect(() => resolveControls({}, {}, {}, { MAX_RETRIES: '0' })).toThrow(/MAX_RETRIES: expected integer >= 1/);
    expect(() => readConfig({ MAX_RETRIES: '0' })).toThrow(/MAX_RETRIES/);
  });

  test('ranges: empty means no restriction, bounds are inclusive, presets and suffixes work, bad input is rejected', () => {
    expect(parseRange('', 'X')).toBeUndefined();
    expect(parseRange(':', 'X')).toBeUndefined();
    expect(parseAumRange(':')).toBeUndefined();
    expect(parseRange('1:5', 'X')).toEqual({ min: 1, max: 5 });
    expect(parseRange('2:', 'X')).toEqual({ min: 2, max: undefined });
    expect(parseRange('0.1%:0.5%', 'X')).toEqual({ min: 0.1, max: 0.5 });
    expect(parseAumRange('10M:2B')).toEqual({ min: 10_000_000, max: 2_000_000_000 });
    expect(parseAumRange('mid')).toEqual({ min: 2_000_000_000, max: 10_000_000_000 });
    expect(parseAumRange('nano')).toEqual({ min: 0, max: 10_000_000 });
    expect(() => parseRange('15', 'X')).toThrow(/colon is required/);
    expect(() => parseRange('5:1', 'X')).toThrow(/must not exceed/);
    expect(() => parseRange('1:2:3', 'TER')).toThrow();
    for (const bad of ['42', 'a:b', '1:2:3', '1.2.3M:', '5m:abc']) expect(() => parseAumRange(bad)).toThrow();
  });

  test('filters name every failing constraint, and missing data never passes an active range', () => {
    const config = readConfig(resolveControls({ TICKERS: 'PAPI', AUM: '100M:1B', TER: ':0.3', DIVIDEND_YIELD: '1:20', PERFORMANCE_YTD: '5:', TOTAL_RETURN_1Y: ':15', SEC_YIELD: '1:3', PERFORMANCE_3Y: '10:', TOTAL_RETURN_3Y: '50:' }));
    const fund = { ticker: 'PAPI', aumValue: 479_910_000, terValue: 0.29, metrics: { dividendYield: 8.07, secYield: 2.63, ytd: 7.63, tr1y: 9.0, cagr3y: 12, tr3y: 60 } };
    expect(fundFilterReasons(fund, config)).toEqual([]);
    const reasons = (patch: Record<string, unknown>, metrics: Record<string, unknown> = {}) => fundFilterReasons({ ...fund, ...patch, metrics: { ...fund.metrics, ...metrics } }, config);
    expect(reasons({ ticker: 'PEPS' })).toEqual(['TICKERS']);
    expect(reasons({ aumValue: 20_000_000 })).toEqual(['AUM']);
    expect(reasons({ terValue: 0.75 })).toEqual(['TER']);
    expect(reasons({}, { dividendYield: null })).toEqual(['DIVIDEND_YIELD']);
    expect(reasons({}, { secYield: null })).toEqual(['SEC_YIELD']);
    expect(reasons({}, { ytd: 3 })).toEqual(['PERFORMANCE_YTD']);
    expect(reasons({}, { tr1y: 30 })).toEqual(['TOTAL_RETURN_1Y']);
    expect(reasons({}, { cagr3y: 5 })).toEqual(['PERFORMANCE_3Y']);
    expect(reasons({}, { tr3y: null })).toEqual(['TOTAL_RETURN_3Y']);
  });

  test('MAX_FETCHES batches rotate after the saved cursor, the cursor is scoped to its filters', () => {
    const funds = ['PAPI', 'PEPS', 'PHEQ'].map((ticker) => ({ ticker })) as any[];
    const picked = (env: Record<string, string>, cursor: string | null) => batchSelection(funds, readConfig(env), cursor).map((fund) => fund.ticker);
    expect(picked({}, null)).toEqual(['PAPI', 'PEPS', 'PHEQ']);
    expect(picked({ MAX_FETCHES: '2' }, null)).toEqual(['PAPI', 'PEPS']);
    expect(picked({ MAX_FETCHES: '2' }, 'PEPS')).toEqual(['PHEQ', 'PAPI']);
    expect(picked({ MAX_FETCHES: '1', TICKERS: 'PHEQ PEPS' }, 'PEPS')).toEqual(['PHEQ']);
    const batch = [{ ticker: 'PAPI' }, { ticker: 'PEPS' }, { ticker: 'PHEQ' }];
    expect(nextCursor(batch, new Set(['PHEQ', 'PAPI']), 'X')).toBe('PHEQ');
    expect(nextCursor(batch, new Set(), 'X')).toBe('X');
    expect(cursorScope(readConfig({ TICKERS: 'PAPI' }))).not.toBe(cursorScope(readConfig({ TICKERS: 'PEPS' })));
    expect(cursorScope(readConfig({ TICKERS: 'PAPI' }))).toBe(cursorScope(readConfig({ TICKERS: 'PAPI' })));
  });

  test('USE_SYSTEM_CA: certificate errors are recognized, the script restarts once, other errors pass through', async () => {
    const certError = Object.assign(new Error('unable to get local issuer certificate'), { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' });
    expect(isCertError(certError)).toBe(true);
    expect(isCertError(new Error('fetch failed', { cause: certError }))).toBe(true);
    expect(isCertError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe(false);
    expect(isCertError(null)).toBe(false);
    const noRestart = (): never => { throw new Error('unexpected restart'); };
    for (const [mode, active] of [['false', false], ['auto', true], ['true', true]] as const) {
      installSystemCa(mode, noRestart, active);
      expect(globalThis.fetch).toBe(realFetch);
    }
    let restarts = 0;
    const restart = (() => { restarts++; return undefined as never; });
    installSystemCa('true', restart, false);
    expect(restarts).toBe(1);
    let failure: unknown = certError;
    globalThis.fetch = (async () => { if (failure) throw failure; return new Response('ok'); }) as unknown as typeof fetch;
    installSystemCa('auto', restart, false);
    await fetch('https://example.test/');
    expect(restarts).toBe(2);
    failure = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    await expect(fetch('https://example.test/')).rejects.toThrow('ECONNRESET');
    failure = null;
    expect(await (await fetch('https://example.test/')).text()).toBe('ok');
    expect(restarts).toBe(2);
  });

  test('command line: executable, --help redacts the SEC contact, lists every control and uses the same resolver', () => {
    const run = runScript(['--help']);
    expect(run.exitCode).toBe(0);
    const out = run.stdout.toString();
    expect(out).toContain('SEC_UA=<redacted>');
    expect(out).not.toContain('daggerok@gmail.com');
    for (const name of CONTROL_NAMES) expect(out).toContain(name);
    const custom = runScript(['--help'], { TICKERS: 'PAPI', MAX_RETRIES: '4' }).stdout.toString();
    expect(custom).toContain('TICKERS=PAPI');
    expect(custom).toContain('MAX_RETRIES=4');
    expect(runScript(['--help'], { MAX_RETRIES: '0' }).exitCode).not.toBe(0);
  });

  test('config file, CONTROL_NAMES, README table and workflow inputs agree; the output dir is fixed', () => {
    expect(Object.keys(configFile()).sort()).toEqual([...CONTROL_NAMES].sort());
    const readme = read('README.md');
    const controls = (readme.match(/^#{2,3} Update controls[^\n]*\n([\s\S]*?)(?=\n#{2,3} |(?![\s\S]))/m) ?? [])[1] ?? '';
    const documented = controls.split('\n').filter((line) => line.startsWith('| `')).flatMap((row) => [...row.split('|')[1].matchAll(/`([A-Z0-9_]+)`/g)].map((match) => match[1]));
    expect([...documented].sort()).toEqual([...CONTROL_NAMES].sort());
    const text = workflowText();
    const inputs = (Bun as any).YAML.parse(text).on.workflow_dispatch.inputs;
    expect(Object.keys(inputs).length).toBeLessThanOrEqual(25);
    expect(inputs.advanced).toMatchObject({ default: '{}', type: 'string', required: false });
    for (const name of workflowInputs()) {
      expect(CONTROL_NAMES as readonly string[]).toContain(name.toUpperCase());
      expect(inputs[name].default).toBe('');
    }
    expect(text).toContain('git add api/parametric');
    expect(text.match(/git add /g)).toHaveLength(1);
    expect(text).not.toMatch(/\$\{\{\s*(inputs|github\.event\.inputs)\./);
    expect(CONTROL_NAMES.some((name) => /OUT/.test(name))).toBe(false);
    const lines = read('scripts/update-data.ts').split('\n');
    expect(lines[0]).toBe('#!/usr/bin/env bun');
    expect(lines[1]).toBe('/// <reference types="bun" />');
    expect(statSync(SCRIPT).mode & 0o111).not.toBe(0);
    expect(readdirSync(new URL('scripts/', ROOT)).sort()).toEqual(['update-data.config.json', 'update-data.test.ts', 'update-data.ts']);
    expect(existsSync(new URL('tsconfig.json', ROOT))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parsing: one tiny sample per provider payload; missing values become null, never 0
// ---------------------------------------------------------------------------

describe('parsing', () => {
  test('catalog: keeps exactly the Parametric funds with canonical pages and header-mapped figures, in both layouts', () => {
    const funds = parseIssuerCatalog(CATALOG);
    expect(funds.map((fund) => fund.ticker)).toEqual(['PAPI', 'PEPS', 'PHEQ']);
    for (const fund of funds) expect(fund.fundPage).toMatch(/^https:\/\/www\.eatonvance\.com\/products\/etfs\/us-equity\/parametric-.*\.html$/);
    expect(funds[0]).toMatchObject({ name: 'Parametric Equity Premium Income ETF', nav: 26.22, marketPrice: 26.28, asOfDate: '2026-09-30', secYield: 2.63, secYieldDate: '2026-08-31', frequency: 'Monthly' });
    const cards = 'EVSM\n\n[Eaton Vance Short Duration Municipal Income ETF](https://www.eatonvance.com/products/etfs/municipals/eaton-vance-short-duration-municipal-income-etf.html)\n\nMarket Price as of 10/01/2026\n\n$49.22\n\nPAPI\n\n[Parametric Equity Premium Income ETF](https://www.eatonvance.com/products/etfs/us-equity/parametric-equity-premium-income-etf.html)\n\nMarket Price as of 10/01/2026\n\n![Up](https://x/a.svg)\n\n$26.48\n';
    expect(parseIssuerCatalog(cards).map((fund) => [fund.ticker, fund.marketPrice])).toEqual([['PAPI', 26.48]]);
    expect(() => parseIssuerCatalog('| CVIE<br> [Calvert](https://www.eatonvance.com/products/etfs/x.html) |')).toThrow(/no Parametric fund links/);
  });

  test('catalog: only the issuer brand pages are accepted', () => {
    expect(isParametricFundUrl(issuerFundUrl('PAPI'))).toBe(true);
    expect(isParametricFundUrl('https://www.eatonvance.com/products/etfs/us-equity/calvert-us-large-cap-core-responsible-index-etf.html')).toBe(false);
    expect(isParametricFundUrl('https://evil.example.com/products/etfs/us-equity/parametric-x.html')).toBe(false);
    expect(PARAMETRIC_FUND_SLUGS.PHEQ).toBe('parametric-hedged-equity-etf');
    expect(() => issuerFundUrl('NOPE')).toThrow();
  });

  test('fund page: headline facts, identifiers and the NAV row of the returns table, "-" is null', () => {
    const product = parseIssuerProduct(PAPI, 'PAPI');
    expect(product).toMatchObject({
      ticker: 'PAPI', cusip: '61774R866', assetClass: 'US Equity', exchange: 'NYSE Arca', benchmark: 'Russell 1000 Value Index', inception: '2023-10-16',
      nav: 26.22, marketPrice: 26.28, navDate: '2026-09-30', premiumDiscountAmount: 0.06, bidAskSpread: 0.22, grossExpense: 0.29, netExpense: 0.29,
      netAssets: 479_910_000, netAssetsDate: '2026-09-30', frequencyCode: 'M',
    });
    expect(product.monthEnd).toMatchObject({ asOfDate: '2026-09-30', mo1: -5.08, mo3: 0.2, ytd: 7.63, yr1: 9.0, yr3: null, yr5: null, yr10: null, sinceInception: 9.4 });
    const { monthEnd, monthMarket } = parseIssuerReturnsTable(PAPI, 'PAPI');
    expect(monthMarket).toMatchObject({ mo1: -5.07, ytd: 8.04 });
    expect(monthEnd).toMatchObject({ mo1: -5.08, ytd: 7.63 });
    expect(parseIssuerProduct(PEPS, 'PEPS')).toMatchObject({ cusip: '61774R775', exchange: 'NASDAQ', netExpense: 0.1, grossExpense: 0.29, netAssets: 29_560_000, inception: '2024-11-07', frequencyCode: 'Q', benchmark: 'S&P 500 Index' });
  });

  test('fund page: the returns date comes from the Returns table, not the price date', () => {
    const shifted = parseIssuerProduct(PAPI.replace('As of 09/30/2026 (updated daily upon availability)\n\n|  | 1 Month', 'As of 08/31/2026 (updated daily upon availability)\n\n|  | 1 Month'), 'PAPI');
    expect(shifted.navDate).toBe('2026-09-30');
    expect(shifted.monthEnd.asOfDate).toBe('2026-08-31');
  });

  test('fund page: distributions sum income and capital gains, top-10 keeps weight and identifier, labels map to cadence codes', () => {
    const payments = parseIssuerDistributions(PAPI);
    expect(payments.map((payment) => payment.exDate)).toEqual(['2023-12-21', '2026-08-31', '2026-09-30']);
    expect(payments[2]).toMatchObject({ payDate: '2026-10-06', recordDate: '2026-09-30' });
    expect(payments[0].amount).toBeCloseTo(0.218278, 6);
    const rows = parseTopHoldings(PAPI);
    expect(rows[0]).toEqual({ Name: 'MSILF GOVERNMENT', Ticker: '', Identifier: '61747C707', Weight: '1.65', 'Market Value': '7982325.78', 'Shares Held': '7982326', 'Asset Category': 'Money Market' });
    expect(rows[1]).toMatchObject({ Ticker: 'VLO', Weight: '0.81' });
    expect(issuerFrequency('Monthly')).toEqual({ frequency: 'Monthly', paymentsPerYear: 12, code: 'M' });
    expect(issuerFrequency('Semi-annually').paymentsPerYear).toBe(2);
    expect(issuerFrequency('Unrecognized')).toEqual({ frequency: 'Unknown', paymentsPerYear: null, code: '' });
  });

  test('fund page: HTML tables become pipe rows and proxy banners and images are stripped', () => {
    const text = normalizeSource('<table><tr><td>Asset Class</td><td>US Equity</td></tr></table>');
    expect(parseKeyFacts(text).get('Asset Class')).toBe('US Equity');
    const banner = normalizeSource('Title: Parametric\nMarkdown Content:\n![Download icon](https://x/y.svg)Gross\n0.29%');
    expect(banner).toContain('Gross');
    expect(banner).not.toContain('Title:');
    expect(banner).not.toContain('Download icon');
  });

  test('issuer JSON service: identity, NAV, month-end NAV returns, daily SEC yield, ascending distributions', () => {
    const product = parseIssuerApi(API_FILES, 'PAPI');
    expect(product).toMatchObject({
      isin: 'US61774R8667', cusip: '61774R866', netExpense: 0.29, grossExpense: 0.35, inception: '2023-10-16', benchmark: 'Russell 1000 Value Index',
      nav: 26.4276, marketPrice: 26.48, premiumDiscountPercent: 0.2, netAssets: 486_267_840, netAssetsDate: '2026-10-01', secYield: 2.79, secYieldDate: '2026-10-01', frequencyCode: 'M',
    });
    expect(product.netAssetsKind).toContain('derived');
    // month-end NAV row, not the daily one and not gross; absent tenors stay null
    expect(product.monthEnd).toMatchObject({ asOfDate: '2026-09-30', ytd: 7.63, mo1: -5.08, qtd: 0.2, yr1: 9, yr3: null, yr10: null, sinceInception: 9.4 });
    expect(product.dividends.map((payment) => payment.exDate)).toEqual(['2023-11-30', '2026-09-30']);
    expect(product.latestDividend?.amount).toBe(0.176725);
  });

  test('issuer JSON service: missing values are null, never 0, and a young fund has no annualized since-inception', () => {
    const empty = parseIssuerApi(EMPTY_API, 'X');
    for (const value of [empty.nav, empty.marketPrice, empty.netExpense, empty.grossExpense, empty.netAssets, empty.secYield, empty.monthEnd.ytd, empty.monthEnd.sinceInception]) expect(value).toBeNull();
    const young = JSON.parse(JSON.stringify(API_FILES));
    young.detail.en.inceptionDate = '06-01-2026';
    expect(parseIssuerApi(young, 'PAPI').monthEnd.sinceInception).toBeNull();
  });

  test('holdings: the full-holdings CSV link is recognized and its sheet parses into the shared schema', () => {
    expect(holdingsDownloadUrl('<a href="/content/dam/parametric-PAPI-holdings.csv">Download Full Holdings</a>', 'PAPI')).toBe('https://www.eatonvance.com/content/dam/parametric-PAPI-holdings.csv');
    expect(holdingsDownloadUrl('<a href="/x.pdf">Download Full Holdings</a>', 'PAPI')).toBeNull();
    expect(holdingsDownloadUrl(PAPI, 'PAPI')).toBeNull();
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
    expect(parseHoldingsCsv('nothing here')).toBeNull();
  });

  test('holdings: names and tickers normalize without merging share classes', () => {
    expect(normalizeHoldingName('Apple Inc.')).toBe('APPLE');
    expect(normalizeHoldingName('THE BOEING CO')).toBe('BOEING');
    expect(normalizeHoldingName('Alphabet Inc. Class C Capital Stock')).toBe('ALPHABET CL C');
    expect(normalizeHoldingName('Alphabet Inc Cl A')).toBe('ALPHABET CL A');
    expect(normalizeHoldingNameCore('Apple Inc.')).toBe('APPLE');
    expect(normalizeHoldingName('')).toBe('');
    expect(cleanHoldingTicker('brk-b')).toBe('BRK-B');
    expect(cleanHoldingTicker('N/A')).toBe('');
  });

  test('SEC: ticker table, Atom feed and submissions resolve N-PORT-P filings newest first and skip other forms', () => {
    const map = parseFundTickerMap(MF_TICKERS);
    expect(map.get('PAPI')).toEqual({ cik: '0001676326', seriesId: 'S000082252', classId: 'C000245536' });
    const filings = parseEdgarAtomFilings(ATOM);
    expect(filings.map((filing) => filing.accession)).toEqual(['0002071691-26-018745', '0002071691-26-018700']);
    expect(filings[0].url).toBe(nportUrlFor('1676326', filings[0].accession));
    expect(filings[0].url).toBe('https://www.sec.gov/Archives/edgar/data/1676326/000207169126018745/primary_doc.xml');
    const accessions = parseNportAccessions({ cik: '1676326', filings: { recent: {
      form: ['NPORT-P', 'N-CSR', 'NPORT-P'], accessionNumber: ['0002071691-26-018745', '0002071691-26-018700', '0002071691-26-018741'],
      filingDate: ['2026-08-28', '2026-08-01', '2026-08-28'], reportDate: ['2026-06-30', '2026-06-30', '2026-06-30'],
    } } });
    expect(accessions.map((entry) => entry.accession)).toEqual(['0002071691-26-018745', '0002071691-26-018741']);
  });

  test('SEC: an N-PORT-P document parses positions and net assets, also in the lowercase the proxy returns', () => {
    const parsed = parseNport(NPORT);
    expect(parsed).toMatchObject({ regName: 'Morgan Stanley ETF Trust', regCik: '0001676326', seriesId: 'S000082252', repPdDate: '2026-06-30', netAssets: 399_844_102.98, designatedIndex: 'Russell 1000 Value' });
    expect(parsed.holdings[0]).toMatchObject({ Name: 'Kraft Heinz Co. (The)', Ticker: '-', Identifier: '500754106', Weight: '0.5521378266', 'Market Value': '2207690.54', 'Shares Held': '93467', 'Asset Category': 'EC' });
    expect(parsed.holdings[1].Identifier).toBe('US7496071074'); // the N/A CUSIP falls back to the ISIN
    const lower = parseNport(NPORT.toLowerCase());
    expect(lower.seriesId).toBe(parsed.seriesId.toUpperCase());
    expect(lower.holdings).toHaveLength(parsed.holdings.length);
  });

  test('SEC: a filing from another series is rejected, tickers come from the company table, search picks the matching registrant', () => {
    const fund = { name: 'Parametric Equity Premium Income ETF' };
    expect(nportBelongsToFund({ seriesId: 'S000082252', seriesName: fund.name }, { seriesId: 'S000082252' }, fund)).toBe(true);
    expect(nportBelongsToFund({ seriesId: 'S000082250', seriesName: 'Parametric Hedged Equity ETF' }, { seriesId: 'S000082252' }, fund)).toBe(false);
    expect(nportBelongsToFund({ seriesId: '', seriesName: fund.name }, { seriesId: '' }, fund)).toBe(true);
    expect(nportBelongsToFund({ seriesId: '', seriesName: 'Calvert US Large-Cap Core Responsible Index ETF' }, { seriesId: '' }, fund)).toBe(false);
    const companies = parseCompanyTickerMap({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, 1: { cik_str: 789019, ticker: 'MSFT', title: 'MICROSOFT CORP' } });
    expect(companies.get(normalizeHoldingName('Apple Inc.'))).toBe('AAPL');
    expect(companies.get(normalizeHoldingNameCore('Microsoft Corp'))).toBe('MSFT');
    const payload = { hits: [
      { _source: { display_names: { cik: 12345, names: ['Some Other Trust'] } } },
      { _source: { display_names: { cik: 1676326, names: ['Parametric Equity Premium Income ETF', 'MORGAN STANLEY ETF TRUST'] } } },
    ] };
    expect(pickEftsCik(payload, 'Parametric Equity Premium Income ETF')).toBe('0001676326');
    expect(pickEftsCik(payload, 'Unrelated Fund')).toBeNull();
    expect(eftsSearchUrl('PAPI')).toContain('forms=NPORT-P');
  });

  test('SEC: the N-PORT-P monthly NAV returns of a quarter parse per share class, a missing figure is null', () => {
    expect(parseNport(NPORT).monthlyReturns).toEqual([{ classId: 'C000245536', months: [-1.37, -1.02, 1.79] }]);
    expect(parseNport(NPORT.replace('rtn2="-1.02"', 'rtn2="N/A"')).monthlyReturns[0].months).toEqual([-1.37, null, 1.79]);
    expect(parseNport(NPORT.replace(/<monthlyTotReturns>.*<\/monthlyTotReturns>/, '')).monthlyReturns).toEqual([]);
  });

  test('SEC: the 497K summary prospectus gives gross and net fees, the inception date and the document date', () => {
    expect(parseProspectusFacts(PROSPECTUS(FEES_PLAIN), 'PAPI')).toEqual({ documentDate: '2026-01-28', grossExpense: 0.29, netExpense: 0.29, inception: '2023-10-16' });
    expect(parseProspectusFacts(PROSPECTUS(FEES_WAIVER), 'PAPI')).toMatchObject({ grossExpense: 0.4, netExpense: 0.25 }); // footnote digits are not figures
    expect(parseProspectusFacts(PROSPECTUS(FEES_PLAIN).replace(/<[^>]+>/g, ' | '), 'PAPI')?.grossExpense).toBe(0.29); // markdown-like pipes (proxy text)
    expect(parseProspectusFacts(PROSPECTUS(FEES_PLAIN), 'PEPS')).toBeNull(); // another fund's document
    expect(parseProspectusFacts('<p>PAPI supplement, no fee table</p>', 'PAPI')).toBeNull();
  });

  test('SEC: the series Atom feed lists 497K filings and the submissions JSON names their primary documents', () => {
    expect(edgarSeriesFilingsUrl('S000082252', 6, '497K')).toContain('type=497K');
    expect(edgarSeriesFilingsUrl('S000082252')).toContain('type=NPORT-P');
    expect(parseEdgarAtomFilings(ATOM_497K, '497K').map((filing) => filing.accession)).toEqual(['0001133228-26-001031']);
    const documents = parseSubmissionDocuments(SUBMISSIONS, '497K');
    expect([...documents.keys()]).toEqual(['0001133228-26-001031', '0001104659-26-112235']);
    expect(filingDocumentUrl('0001676326', '0001133228-26-001031', documents.get('0001133228-26-001031')!)).toBe('https://www.sec.gov/Archives/edgar/data/1676326/000113322826001031/pepietf-efp22532_497k.htm');
  });

  test('SEC proxy: the preamble and wrapper are stripped from json, xml and text', () => {
    expect(proxyPayload('Title: company_tickers_mf.json\n\nMarkdown Content:\n{"a":1}\n', 'json')).toBe('{"a":1}');
    expect(proxyPayload('  {"a":1}  ', 'json')).toBe('{"a":1}');
    expect(proxyPayload('Markdown Content:\n<?xml version="1.0"?><feed><a/></feed>', 'xml')).toBe('<?xml version="1.0"?><feed><a/></feed>');
    expect(proxyPayload('Markdown Content:\nplain body', 'text')).toBe('plain body');
  });

  test('Yahoo: chart skips null closes, rounds adjusted closes, reads dividends; an empty result is an error', () => {
    const chart = parseChart(YAHOO);
    expect(chart).toMatchObject({ exchangeName: 'NYSEArca', longName: 'Parametric Equity Premium Income ETF', regularMarketPrice: 26.48, firstTradeDate: 1697722200 });
    expect(chart.days.map((day) => day.date)).toEqual(['2026-08-03', '2026-08-17']);
    expect(chart.days[0].adjClose).toBe(27.33);
    expect(chart.dividends.map((dividend) => dividend.amount)).toEqual([0.166, 0.208]);
    expect(() => parseChart({ chart: { result: [] } })).toThrow(/empty result/);
  });

  test('Yahoo: history merges in date order, a published cent survives jitter, a real restatement wins', () => {
    const day = (date: string, adjClose: number) => ({ date, close: 26.28, adjClose, volume: 85084 });
    const previous = [{ Date: 'Sep 30 2026', Close: '26.28', 'Adj Close': '25.19', Volume: '85084' }];
    expect(mergeHistory(previous, [day('2026-09-30', 25.2)])[0]['Adj Close']).toBe('25.19');
    expect(mergeHistory(previous, [day('2026-09-30', 25.42)])[0]['Adj Close']).toBe('25.42');
    const merged = mergeHistory([{ Date: 'Oct 16 2023', Close: '25.00', 'Adj Close': '24.00', Volume: '1' }], [day('2026-09-29', 25.1), day('2026-09-30', 25.2)]);
    expect(merged.map((row) => row.Date)).toEqual(['Oct 16 2023', 'Sep 29 2026', 'Sep 30 2026']);
  });
});

// ---------------------------------------------------------------------------
// metrics: null for young horizons, one key set, returnsBasis + performanceAsOf, official over derived
// ---------------------------------------------------------------------------

describe('metrics', () => {
  const official = { ytd: 7.63, yr1: 9.0, yr3: null, yr5: null, yr10: null, sinceInception: 9.4 };
  const derived = { asOfDate: '2026-09-30', ytd: 7.1, yr1: 8.2, cagr3y: 9.9, cagr5y: null, cagr10y: null, siAnn: 10.5, mo1: -5.2, qtd: 0.1 };

  test('horizons the fund is too young for are null, never 0', () => {
    const days = Array.from({ length: 200 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), close: 10 + i / 100, adjClose: 10 + i / 100, volume: 1 }));
    const young = priceReturns(days, new Date('2026-07-20T00:00:00Z'));
    expect(young.ytd).not.toBeNull();
    for (const value of [young.yr1, young.cagr3y, young.cagr5y, young.cagr10y, young.siAnn]) expect(value).toBeNull();
    const metrics = deriveCatalogMetrics(NO_RETURNS, young, null, null, null, null, 26.28);
    for (const key of ['tr3y', 'tr5y', 'tr10y', 'cagr3y', 'cagr5y', 'cagr10y', 'siAnn', 'dividendYield', 'secYield']) expect((metrics as any)[key]).toBeNull();
  });

  test('every metrics object has the same keys and ends with returnsBasis then performanceAsOf', () => {
    const variants = [
      deriveCatalogMetrics(official, derived, null, null, 0.176725, 12, 26.28, null, '2026-09-30'),
      deriveCatalogMetrics(NO_RETURNS, derived, null, null, null, null, 26.28),
      deriveCatalogMetrics(NO_RETURNS, NO_DERIVED, null, null, null, null, null),
    ];
    const keys = Object.keys(variants[0]).sort();
    for (const metrics of variants) {
      expect(Object.keys(metrics).sort()).toEqual(keys);
      expect(Object.keys(metrics).slice(-2)).toEqual(['returnsBasis', 'performanceAsOf']);
      expect(metrics.returnsBasis).not.toBe('');
    }
  });

  test('dividendYieldBasis is the code of the yield source and null exactly when the yield is null', () => {
    const indicated = deriveCatalogMetrics(official, derived, null, null, 0.176725, 12, 26.28, null, '2026-09-30');
    expect(indicated).toMatchObject({ dividendYieldBasis: 'indicated' });
    const published = deriveCatalogMetrics(official, derived, 8.5, null, 0.176725, 12, 26.28, null, '2026-09-30');
    expect(published).toMatchObject({ dividendYield: 8.5, dividendYieldBasis: 'official-other' });
    const none = deriveCatalogMetrics(NO_RETURNS, NO_DERIVED, null, null, null, null, null);
    expect(none).toMatchObject({ dividendYield: null, dividendYieldBasis: null });
    // rebuilt from meta: the stored code wins, legacy kind text maps to a code, and no yield means no code
    const rebuild = (yields: any) => indexRowFromMeta({ ticker: 'T', yields }).metrics as any;
    expect(rebuild({ dividendYield: 8.07, dividendYieldBasis: 'official-trailing-12m' }).dividendYieldBasis).toBe('official-trailing-12m');
    expect(rebuild({ dividendYield: 8.07, dividendYieldKind: 'indicated (latest distribution x payments per year / market price)' }).dividendYieldBasis).toBe('indicated');
    expect(rebuild({ dividendYield: 8.07, dividendYieldKind: 'Something the issuer says' }).dividendYieldBasis).toBe('official-other');
    expect(rebuild({ dividendYield: null, dividendYieldBasis: 'indicated' }).dividendYieldBasis).toBeNull();
    // fresh, rebuilt and bare (no meta data) rows carry the same metrics key set
    const keys = Object.keys(indicated).sort();
    for (const metrics of [published, none, rebuild({}), rebuild({ dividendYield: 1 }), indexRowFromMeta({ ticker: 'BARE' }).metrics]) expect(Object.keys(metrics).sort()).toEqual(keys);
    expect(keys).toContain('dividendYieldBasis');
  });

  test('official returns win, derived ones only fill gaps, and the basis says which', () => {
    const metrics = deriveCatalogMetrics(official, derived, null, null, 0.176725, 12, 26.28, null, '2026-09-30');
    expect(metrics).toMatchObject({ ytd: 7.63, tr1y: 9.0, cagr3y: 9.9, siAnn: 9.4, performanceAsOf: '2026-09-30' });
    expect(metrics.dividendYield).toBeCloseTo(8.07, 2);
    expect(metrics.returnsBasis).toContain('mixed: official Eaton Vance / MSIM');
    const allOfficial = deriveCatalogMetrics(official, { ...derived, asOfDate: '2026-10-01', cagr3y: null, siAnn: null }, null, null, null, null, 26.28, null, '2026-09-30');
    expect(allOfficial.returnsBasis).toBe('official Eaton Vance / MSIM month-end NAV returns (fund detail page)');
    expect(allOfficial.performanceAsOf).toBe('2026-09-30'); // the returns-table date, never the Yahoo date
    expect(deriveCatalogMetrics(official, derived, null, null, null, null, 26.28).performanceAsOf).toBeNull(); // official but undated
  });

  test('a fund without published returns falls back to the derived basis and its own date', () => {
    const metrics = deriveCatalogMetrics(NO_RETURNS, derived, null, null, null, null, 26.28);
    expect(metrics).toMatchObject({ ytd: 7.1, dividendYield: null, performanceAsOf: '2026-09-30' });
    expect(metrics.returnsBasis).toContain('not official NAV returns');
    expect(deriveCatalogMetrics(NO_RETURNS, NO_DERIVED, null, null, null, null, null).performanceAsOf).toBeNull();
  });

  test('no derived value is relabelled official: a published fund is kept when this run read no official source at all', () => {
    expect(sourceGate(false, true, true)).toBe('fail');
    expect(sourceGate(false, true, false)).toBe('skip');
    expect(sourceGate(false, false, true)).toBe('proceed');
    expect(sourceGate(true, true, true)).toBe('proceed'); // the issuer OR a SEC filing is enough
    expect(officialReturnsFor(null)).toEqual(NO_RETURNS);
    expect(officialReturnsFor(parseIssuerApi(API_FILES, 'PAPI')).ytd).toBe(7.63);
  });

  test('quarter-end returns from SEC months: compounded, dated by the newest filing, null unless every month is filed', () => {
    const q1 = parseNport(NPORT_Q1);
    const q2 = parseNport(NPORT);
    const both = nportQuarterReturns([q2, q1], 'C000245536')!;
    expect(both).toMatchObject({ asOfDate: '2026-06-30', mo1: 1.79, qtd: -0.63, ytd: 0.84, yr1: null }); // April to June, and January to June
    expect(nportQuarterReturns([q2])).toMatchObject({ asOfDate: '2026-06-30', qtd: -0.63, ytd: null }); // January to March missing
    expect(nportQuarterReturns([q1, q2], 'C999')!.ytd).toBe(0.84); // an unknown class falls back to the first one
    expect(nportQuarterReturns([{ repPdDate: '', monthlyReturns: [] }])).toBeNull();
    const year = ['2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30'].map((repPdDate) => ({ repPdDate, monthlyReturns: [{ classId: 'C1', months: [1, 1, 1] as Array<number | null> }] }));
    expect(nportQuarterReturns(year, 'C1')!.yr1).toBe(12.68); // twelve months at 1 percent
  });

  test('annualization, indicated yield and distribution cadence', () => {
    expect(annualizedToTotal(20.15, 3)).toBeCloseTo(73.45, 2);
    expect(annualizedToTotal(null, 3)).toBeNull();
    expect(totalToAnnualized(annualizedToTotal(12.5, 5), 5)).toBeCloseTo(12.5, 1);
    expect(indicatedYield(0.176725, 12, 26.28)).toBeCloseTo(8.07, 2);
    for (const bad of [indicatedYield(null, 4, 10), indicatedYield(0.5, 0, 10), indicatedYield(0.5, 4, 0)]) expect(bad).toBeNull();
    const monthly = Array.from({ length: 6 }, (_, i) => ({ epoch: Date.UTC(2026, i, 15) / 1000, amount: 0.17 }));
    expect(inferDistributionFrequency(monthly)).toEqual({ frequency: 'Monthly', paymentsPerYear: 12 });
    expect(inferDistributionFrequency([0, 1, 2, 3].map((i) => ({ epoch: Date.UTC(2026, i * 3, 21) / 1000, amount: 0.05 }))).frequency).toBe('Quarterly');
    expect(inferDistributionFrequency([]).paymentsPerYear).toBeNull();
  });

  test('dates: Edgar labels convert to ISO and the quarter anchor is the last completed quarter (UTC)', () => {
    expect(isoFromEdgar('Oct 01 2026')).toBe('2026-10-01');
    expect(isoFromEdgar('—')).toBeNull();
    expect(isoFromEdgar(undefined)).toBeNull();
    const quarter = (y: number, m: number, d: number) => lastCompletedQuarterEnd(new Date(Date.UTC(y, m, d))).toISOString().slice(0, 10);
    expect(quarter(2026, 8, 30)).toBe('2026-06-30');
    expect(quarter(2026, 9, 1)).toBe('2026-09-30');
    expect(quarter(2026, 0, 15)).toBe('2025-12-31');
  });
});

// ---------------------------------------------------------------------------
// pipeline: the real updater in a temp copy with a mocked fetch (preload), a 3-fund catalog
// ---------------------------------------------------------------------------

const PRELOAD = `
import { readFileSync } from 'node:fs';
const fixtures = JSON.parse(readFileSync(process.env.MOCK_FIXTURES, 'utf8'));
const failing = JSON.parse(process.env.MOCK_FAIL || '[]');
globalThis.fetch = async (input) => {
  const url = String(input);
  if (failing.some((part) => url.includes(part))) return new Response('boom', { status: 500 });
  if (url.startsWith('https://query1.finance.yahoo.com/')) return new Response(JSON.stringify(fixtures.yahoo));
  if (process.env.MOCK_ISSUER_DENIED === '1' && /eatonvance\\.com/.test(url)) return new Response('Access Denied', { status: 403 });
  for (const [part, body] of fixtures.sec) if (url.includes(part)) return new Response(body);
  const api = /\\/EF\\/\\d+\\/detail\\/(en-[a-z-]+)\\.json/.exec(url);
  const override = JSON.parse(process.env.MOCK_API || '{}');
  if (api && api[1] in override) return new Response(typeof override[api[1]] === 'string' ? override[api[1]] : JSON.stringify(override[api[1]]));
  if (api) return new Response(JSON.stringify(fixtures.api[api[1]]));
  if (url === fixtures.catalogUrl) return new Response(fixtures.catalog);
  return new Response('not mocked: ' + url, { status: 404 });
};
`;

type Sandbox = {
  dir: string;
  run: (env?: Record<string, string>, fail?: string[]) => { exitCode: number; stderr: string; stdout: string };
  files: () => Record<string, string>;
  freeze: () => void; // backdates every published file so that any later write shows up in rewritten()
  rewritten: () => string[];
};

function withSandbox(body: (box: Sandbox) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'parametric-test-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    const script = join(dir, 'scripts/update-data.ts');
    copyFileSync(SCRIPT, script);
    copyFileSync(new URL('./update-data.config.json', import.meta.url).pathname, join(dir, 'scripts/update-data.config.json'));
    writeFileSync(join(dir, 'preload.ts'), PRELOAD);
    writeFileSync(join(dir, 'fixtures.json'), JSON.stringify({
      catalogUrl: configFile().CATALOG_URL, catalog: CATALOG, yahoo: YAHOO,
      sec: [
        ['company_tickers_mf.json', JSON.stringify(MF_TICKERS)], ['company_tickers.json', '{}'],
        ['type=497K', ATOM_497K], ['type=NPORT-P', ATOM_NPORT],
        ['/submissions/CIK0001676326.json', JSON.stringify(SUBMISSIONS)],
        ['000113322826001031/pepietf-efp22532_497k.htm', PROSPECTUS(FEES_WAIVER)],
        ['000207169126018745/primary_doc.xml', NPORT], ['000207169126011935/primary_doc.xml', NPORT_Q1],
      ],
      api: { 'en-us-financial-advisor': API_FILES.detail, 'en-pricing': API_FILES.pricing, 'en-returns': API_FILES.returns, 'en-yield': API_FILES.yields, 'en-distribution': API_FILES.distribution },
    }));
    const files = (): Record<string, string> => {
      const found: Record<string, string> = {};
      const walk = (sub: string): void => {
        const path = join(dir, 'api/parametric', sub);
        if (!existsSync(path)) return;
        for (const name of readdirSync(path, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
          if (name.isDirectory()) walk(join(sub, name.name)); else found[join(sub, name.name)] = readFileSync(join(path, name.name), 'utf8');
        }
      };
      walk('');
      return found;
    };
    const OLD = new Date('2001-01-01T00:00:00Z');
    const eachFile = (visit: (path: string) => void): void => {
      const walk = (path: string): void => {
        if (!existsSync(path)) return;
        for (const entry of readdirSync(path, { withFileTypes: true })) (entry.isDirectory() ? walk : visit)(join(path, entry.name));
      };
      walk(join(dir, 'api/parametric'));
    };
    const freeze = (): void => eachFile((path) => utimesSync(path, OLD, OLD));
    const rewritten = (): string[] => {
      const touched: string[] = [];
      eachFile((path) => { if (statSync(path).mtimeMs !== OLD.getTime()) touched.push(path.slice(join(dir, 'api/parametric/').length)); });
      return touched.sort();
    };
    const run: Sandbox['run'] = (env = {}, fail = []) => {
      const result = Bun.spawnSync([process.execPath, '--preload', join(dir, 'preload.ts'), script], {
        cwd: dir, stdout: 'pipe', stderr: 'pipe',
        env: {
          PATH: process.env.PATH ?? '', TZ: 'UTC', MOCK_FIXTURES: join(dir, 'fixtures.json'), MOCK_FAIL: JSON.stringify(fail),
          REQUEST_SLEEP: '0', MAX_RETRIES: '1', CONCURRENCY: '2', EDGAR_FALLBACK: 'false', USE_SYSTEM_CA: 'false', ...env,
        },
      });
      return { exitCode: result.exitCode ?? -1, stderr: result.stderr.toString(), stdout: result.stdout.toString() };
    };
    body({ dir, run, files, freeze, rewritten });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const indexRows = (files: Record<string, string>): any[] => JSON.parse(files['index.json']).funds;
const issuerFailure = (ticker: string): string[] => [`/EF/${PARAMETRIC_PRODUCT_IDS[ticker]}/`, issuerFundUrl(ticker)];

describe('pipeline', () => {
  test('a full run publishes every fund with one metrics key set, null for missing horizons and a TER net/gross mapping', () => {
    withSandbox(({ run, files }) => {
      expect(run().exitCode).toBe(0);
      const published = files();
      const rows = indexRows(published);
      expect(rows.map((row) => row.ticker)).toEqual(['PAPI', 'PEPS', 'PHEQ']);
      for (const row of rows) {
        expect(row.dataFile).toBe(`./funds/${row.ticker}/meta.json`);
        expect(published[`funds/${row.ticker}/meta.json`]).toBeDefined();
        expect(Object.keys(row.metrics).sort()).toEqual(Object.keys(rows[0].metrics).sort());
        for (const key of ['tr3y', 'tr5y', 'tr10y', 'cagr3y', 'cagr5y', 'cagr10y']) expect(row.metrics[key]).toBeNull();
        expect(row.metrics.returnsBasis).toContain('official');
        expect(row.metrics.performanceAsOf).toBe('2026-09-30');
        expect(row.terValue).toBe(0.29);
        expect(row.terGrossValue).toBe(0.35);
      }
      expect(JSON.parse(published['funds/PAPI/meta.json']).expense).toMatchObject({ net: 0.29, gross: 0.35 });
    });
  });

  test('a second identical run writes nothing', () => {
    withSandbox(({ run, files, freeze, rewritten }) => {
      expect(run().exitCode).toBe(0);
      const first = files();
      freeze();
      expect(run().exitCode).toBe(0);
      expect(files()).toEqual(first);
      expect(rewritten()).toEqual([]);
    });
  });

  test('a one-ticker run keeps every published row and file', () => {
    withSandbox(({ run, files, freeze, rewritten }) => {
      run();
      const first = files();
      freeze();
      expect(run({ TICKERS: 'PEPS' }).exitCode).toBe(0);
      const second = files();
      expect(indexRows(second).map((row) => row.ticker)).toEqual(['PAPI', 'PEPS', 'PHEQ']);
      expect(Object.keys(second)).toEqual(Object.keys(first));
      expect(rewritten().filter((name) => !name.startsWith('funds/PEPS/'))).toEqual([]);
    });
  });

  test('an unknown ticker fails the run before anything is written', () => {
    withSandbox(({ run, files }) => {
      const result = run({ TICKERS: 'NOPE' });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('absent from catalog');
      expect(Object.keys(files()).filter((name) => name.startsWith('funds/'))).toEqual([]);
    });
  });

  test('a failed issuer with no SEC answer keeps the published fund as it was; red only when nothing answered at all', () => {
    withSandbox(({ run, files, freeze, rewritten }) => {
      run();
      const published = files();
      freeze();
      expect(run({}, issuerFailure('PAPI')).exitCode).toBe(0); // Yahoo answered and every other fund refreshed
      expect(files()).toEqual(published);
      expect(run({ TICKERS: 'PAPI' }, issuerFailure('PAPI')).exitCode).toBe(0); // kept, but Yahoo still answered: a partial outage stays green
      expect(run({ TICKERS: 'PAPI' }, [...issuerFailure('PAPI'), 'finance.yahoo.com', 'products/etfs.html']).exitCode).toBe(1); // nothing answered at all
      expect(files()).toEqual(published);
      expect(rewritten()).toEqual([]);
    });
  });

  test('the issuer blocked and SEC EDGAR answering: official SEC fees and months, null NAV, derived returns labelled as such', () => {
    withSandbox(({ dir, run, files }) => {
      run();
      rmSync(join(dir, 'api/parametric/funds/PAPI/meta.json')); // nothing official published for PAPI: nothing to keep
      expect(run({ TICKERS: 'PAPI', EDGAR_FALLBACK: 'true', MOCK_ISSUER_DENIED: '1' }).exitCode).toBe(0);
      const published = files();
      const row = indexRows(published).find((item) => item.ticker === 'PAPI');
      expect(row).toMatchObject({ terValue: 0.25, terGrossValue: 0.4, navValue: null, premiumDiscountValue: null, inceptionDate: 'Oct 16 2023', aumValue: 399_844_102.98, aumAsOfDate: 'Jun 30 2026' });
      expect(row.metrics.secYield).toBeNull();
      expect(row.metrics.returnsBasis).toContain('derived from the Yahoo');
      expect(row.metrics.performanceAsOf).toBe('2026-08-17'); // the last Yahoo day, never the SEC quarter-end
      const meta = JSON.parse(published['funds/PAPI/meta.json']);
      expect(meta.expense.source).toContain('SEC Form 497K');
      expect(meta.returns.quarterEnd).toMatchObject({ asOfDate: 'Jun 30 2026', ytd: 0.84, yr1: null });
      expect(meta.returns.quarterEndBasis).toContain('N-PORT-P');
      expect(meta.nav.value).toBeNull();
      expect(meta.holdings.source).toContain('N-PORT-P');
      expect(indexRows(published).map((item) => item.ticker)).toEqual(['PAPI', 'PEPS', 'PHEQ']);
    });
  });

  test('a partial, empty or error-page issuer answer keeps the published official sections byte for byte; a full answer lacking a field is an honest null', () => {
    withSandbox(({ run, files, freeze, rewritten }) => {
      expect(run().exitCode).toBe(0);
      const published = files();
      freeze();
      // run 2: pricing is an HTML error page, returns an empty object, yields an empty container, distribution is cut
      const partial = {
        'en-pricing': '<html><body>Access Denied</body></html>', 'en-returns': {}, 'en-yield': { en: {} }, 'en-distribution': { en: { shareClasses: [{}] } },
      };
      const second = run({ MOCK_API: JSON.stringify(partial) });
      expect(second.exitCode).toBe(0);
      expect(second.stdout.split('\n').filter((line) => line.startsWith('[ kept'))).toHaveLength(3); // one notice per fund
      expect(second.stdout).toContain('kept the published pricing, returns, yields, distribution');
      expect(files()).toEqual(published); // pricing with its date, SEC yield, returns with basis and performanceAsOf, distributions: unchanged
      expect(rewritten()).toEqual([]);
      // run 3: every file loads fully, the fields are genuinely absent -> null, nothing is refilled from the previous run
      const absent = {
        'en-pricing': { en: { shareClasses: [{ currencies: [{ pricings: { nav: '26.43', navAsOfDate: '10/01/2026', marketPrice: '26.48' } }] }] } },
        'en-returns': { en: { shareClasses: [{ currencies: [{ performances: [API_PERF('MONTHLY', '09/30/2026', { ytd: '7.63' })] }] }] } },
        'en-yield': { en: { shareClasses: [{ currencies: [{ yield: {} }] }] } },
      };
      const third = run({ TICKERS: 'PAPI', MOCK_API: JSON.stringify(absent) });
      expect(third.exitCode).toBe(0);
      expect(third.stdout).not.toContain('[ kept');
      const row = indexRows(files()).find((item) => item.ticker === 'PAPI');
      expect(row.metrics).toMatchObject({ secYield: null, ytd: 7.63, tr1y: null, returnsBasis: expect.stringContaining('official'), performanceAsOf: '2026-09-30' });
      expect(JSON.parse(files()['funds/PAPI/meta.json']).premiumDiscount.amount).toBeNull();
    });
  });

  test('a fund with a meta.json but neither an index row nor a catalog entry stays in the index', () => {
    withSandbox(({ dir, run, files }) => {
      run();
      const published = files();
      const meta = JSON.parse(published['funds/PAPI/meta.json']);
      const ghost = { ...meta, ticker: 'GHST', name: 'Ghost ETF' };
      mkdirSync(join(dir, 'api/parametric/funds/GHST'), { recursive: true });
      writeFileSync(join(dir, 'api/parametric/funds/GHST/meta.json'), JSON.stringify(ghost));
      expect(run({ TICKERS: 'PEPS' }).exitCode).toBe(0);
      const rows = indexRows(files());
      expect(rows.map((row) => row.ticker)).toEqual(['GHST', 'PAPI', 'PEPS', 'PHEQ']);
      const rebuilt = rows.find((row) => row.ticker === 'GHST');
      expect(rebuilt).toMatchObject({ name: 'Ghost ETF', dataFile: './funds/GHST/meta.json', terValue: 0.29, terGrossValue: 0.35, navValue: meta.nav.value });
      expect(Object.keys(rebuilt.metrics)).toEqual(Object.keys(rows[1].metrics));
      expect(indexRowFromMeta(ghost).metrics.returnsBasis).toContain('official');
      expect(indexRowFromMeta({ ticker: 'BARE' }).metrics).toMatchObject({ ytd: null, returnsBasis: expect.any(String), performanceAsOf: null });
    });
  });

  test('a failed Yahoo chart keeps the published history', () => {
    withSandbox(({ run, files }) => {
      run();
      const published = files();
      expect(run({ TICKERS: 'PAPI' }, ['finance.yahoo.com']).exitCode).toBe(0);
      const after = files();
      const history = Object.keys(published).filter((name) => name.startsWith('funds/PAPI/history/'));
      expect(history.length).toBeGreaterThan(0);
      for (const name of history) expect(after[name]).toBe(published[name]);
      expect(indexRows(after).map((row) => row.ticker)).toEqual(['PAPI', 'PEPS', 'PHEQ']);
    });
  });
});

// ---------------------------------------------------------------------------
// network: timeout, bounded retries, proxy gate, parallelism, HISTORY_RANGE request window
// ---------------------------------------------------------------------------

describe('network', () => {
  test('every request carries a timeout signal that also covers reading the body', async () => {
    let signal: AbortSignal | null | undefined;
    mockFetch((_url, init) => { signal = init?.signal; return new Response('{}'); });
    await withRequestLane(0, () => fetchWithRetry('https://example.test/x', '[ test ]', {}, 0));
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal!.aborted).toBe(false);
  });

  test('retries are bounded: a 404 stops at once, a 500 retries as configured, the proxy at most once', async () => {
    const calls: string[] = [];
    mockFetch((url) => { calls.push(url); return url.endsWith('/missing') ? new Response('', { status: 404 }) : new Response('', { status: url.startsWith('https://r.jina.ai/') ? 429 : 500 }); });
    configureProxyGate(0);
    await expect(withRequestLane(0, () => fetchWithRetry('https://example.test/missing', '[ test ]', {}, 3))).rejects.toThrow(/HTTP 404/);
    expect(calls).toHaveLength(1);
    calls.length = 0;
    await expect(withRequestLane(0, () => fetchWithRetry('https://example.test/boom', '[ test ]', {}, 1))).rejects.toThrow(/HTTP 500/);
    expect(calls).toHaveLength(2);
    calls.length = 0;
    await expect(withRequestLane(0, () => fetchWithRetry('https://r.jina.ai/https://example.test/boom', '[ test ]', {}, 5))).rejects.toThrow(/429/);
    expect(calls).toHaveLength(2);
  });

  test('the proxy gate spaces starts globally while per-worker lanes stay independent (fake clock)', async () => {
    let now = 0;
    const clock = { now: () => now, sleep: async (ms: number) => { now += ms; } };
    const gate = createRequestGate(3200, clock);
    const starts: number[] = [];
    await Promise.all([0, 1, 2].map(() => gate().then(() => { starts.push(now); })));
    expect(starts).toEqual([0, 3200, 6400]);
    const lanes = [createRequestGate(3200, { now: () => 0, sleep: async () => { throw new Error('a fresh lane must not wait'); } }), createRequestGate(3200, { now: () => 0, sleep: async () => { throw new Error('a fresh lane must not wait'); } })];
    await Promise.all(lanes.map((lane) => lane()));
  });

  test('CONCURRENCY workers fetch in parallel: peak 1 at one worker, N at N workers', async () => {
    const peakWith = async (workers: number): Promise<number> => {
      let inFlight = 0;
      let peak = 0;
      mockFetch(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Bun.sleep(40);
        inFlight -= 1;
        return new Response('{}');
      });
      await runPool(Array.from({ length: 6 }, (_, i) => i), workers, 25, async (i) => { await fetchWithRetry(`https://example.test/${i}`, '[ test ]', {}, 1); });
      return peak;
    };
    expect(await peakWith(1)).toBe(1);
    expect(await peakWith(3)).toBe(3);
    expect(await peakWith(15)).toBe(6);
  });

  test('a worker pool handles every item exactly once and tolerates an empty queue', async () => {
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5], 3, 0, async (item) => { await Bun.sleep(item); seen.push(item); });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
    await runPool([], 4, 0, async () => { throw new Error('unreachable'); });
  });

  test('the first SEC denial switches the rest of the run to the proxy; XML asks the proxy for the raw document', async () => {
    const calls: string[] = [];
    const headers: Array<Record<string, string>> = [];
    const body = 'Title: company_tickers_mf.json\n\nMarkdown Content:\n{"fields":["cik","seriesId","classId","symbol"],"data":[[1676326,"S000082252","C000245536","PAPI"]]}';
    mockFetch((url, init) => {
      calls.push(url);
      headers.push((init?.headers ?? {}) as Record<string, string>);
      return url.startsWith('https://r.jina.ai/') ? new Response(body) : new Response('blocked', { status: 403, statusText: 'Forbidden' });
    });
    configureProxyGate(0);
    const config = { maxRetries: 1, secUa: 'test ua' } as any;
    const payload = await withRequestLane(0, () => fetchSecJson('https://www.sec.gov/files/company_tickers_mf.json', '[edgar   ] test table', config));
    expect(payload).toEqual({ fields: ['cik', 'seriesId', 'classId', 'symbol'], data: [[1676326, 'S000082252', 'C000245536', 'PAPI']] });
    expect(calls).toEqual(['https://www.sec.gov/files/company_tickers_mf.json', 'https://r.jina.ai/https://www.sec.gov/files/company_tickers_mf.json']);
    expect(headers[1]['X-Return-Format']).toBeUndefined();
    calls.length = 0;
    headers.length = 0;
    await withRequestLane(0, () => fetchSecText('https://www.sec.gov/Archives/edgar/data/1676326/x/primary_doc.xml', '[edgar   ] test nport', config, 'xml'));
    expect(calls).toEqual(['https://r.jina.ai/https://www.sec.gov/Archives/edgar/data/1676326/x/primary_doc.xml']);
    expect(headers[0]['X-Return-Format']).toBe('html');
  });

  test('the issuer JSON service is read through the proxy envelope; nothing loadable fails the read', async () => {
    const bodies = [API_FILES.detail, API_FILES.pricing, API_FILES.returns, API_FILES.yields, API_FILES.distribution];
    const urls: string[] = [];
    mockFetch((url) => {
      urls.push(url);
      if (!url.startsWith('https://r.jina.ai/')) return new Response('Access Denied', { status: 403 });
      const index = urls.filter((item) => item.startsWith('https://r.jina.ai/')).length - 1;
      return new Response(`Title: \n\nURL Source: x\n\nMarkdown Content:\n${JSON.stringify(bodies[index])}`);
    });
    configureProxyGate(0);
    const config = readConfig({ MAX_RETRIES: '1', REQUEST_SLEEP: '0' });
    expect((await loadIssuerApi('100637', 'PAPI', config)).nav).toBe(26.4276);
    expect(urls.some((url) => url.includes('/EF/100637/detail/en-pricing.json'))).toBe(true);
    mockFetch(() => new Response('{"broken'));
    await expect(loadIssuerApi('100637', 'PAPI', config)).rejects.toThrow();
  });

  test('a denied issuer is asked once through the proxy (one retry), then skipped; the run counts answered requests', async () => {
    const urls: string[] = [];
    mockFetch((url) => { urls.push(url); return url.includes('eatonvance.com') ? new Response('denied', { status: 403 }) : new Response('{}'); });
    configureProxyGate(0);
    const config = readConfig({ MAX_RETRIES: '2', REQUEST_SLEEP: '0' });
    await expect(withRequestLane(0, () => loadIssuerApi('100637', 'PAPI', config))).rejects.toThrow();
    expect(urls.filter((url) => url.startsWith('https://r.jina.ai/'))).toHaveLength(2); // the proxy is retried at most once
    expect(runHealth()).toEqual({ answered: 0, issuerUnreachable: true });
    const before = urls.length;
    await expect(withRequestLane(0, () => loadIssuerApi('100638', 'PHEQ', config))).rejects.toThrow('unreachable');
    expect(urls).toHaveLength(before); // no further request to the blocked issuer
    await withRequestLane(0, () => fetchWithRetry('https://data.sec.gov/x', '[ test ]', {}, 0));
    expect(runHealth().answered).toBe(1);
    expect([runFailed(3, 3, 0), runFailed(3, 3, 1), runFailed(3, 1, 0), runFailed(0, 0, 0)]).toEqual([true, false, false, false]);
  });

  test('issuer reads send the curl client string, SEC reads the contact agent; a 403 on the first issuer attempt falls back to one proxy retry, then the issuer is skipped', async () => {
    const seen: Array<{ url: string; ua: string }> = [];
    mockFetch((url, init) => {
      seen.push({ url, ua: String((init?.headers as Record<string, string>)['User-Agent']) });
      if (url.startsWith('https://www.eatonvance.com/')) return new Response('Access Denied', { status: 403 });
      if (url.startsWith('https://r.jina.ai/')) return new Response(`Markdown Content:\n${JSON.stringify(url.includes('en-pricing') ? API_FILES.pricing : url.includes('en-returns') ? API_FILES.returns : url.includes('en-yield') ? API_FILES.yields : url.includes('en-distribution') ? API_FILES.distribution : API_FILES.detail)}`);
      return new Response('{}');
    });
    configureProxyGate(0);
    const config = readConfig({ MAX_RETRIES: '2', REQUEST_SLEEP: '0' });
    expect(ISSUER_UA).toBe('curl/8.7.1');
    const product = await withRequestLane(0, () => loadIssuerApi('100637', 'PAPI', config));
    expect(product.nav).toBe(26.4276);
    expect(product.sections).toEqual({ detail: true, pricing: true, returns: true, yields: true, distribution: true });
    const issuerCalls = seen.filter((item) => !item.url.startsWith('https://r.jina.ai/'));
    expect(issuerCalls).toHaveLength(1); // one direct attempt, the rest of the run goes through the proxy
    expect(issuerCalls[0].ua).toBe('curl/8.7.1');
    expect(seen.filter((item) => item.url.startsWith('https://r.jina.ai/'))).toHaveLength(5);
    await withRequestLane(0, () => fetchSecJson('https://data.sec.gov/submissions/CIK0001676326.json', '[ test ]', config));
    expect(seen[seen.length - 1].ua).toBe(config.secUa);
    expect(config.secUa).not.toBe(ISSUER_UA);
  });

  test('a section that did not load is kept from the published meta as one unit; fully loaded files and unpublished sections are not touched', () => {
    const previous = {
      nav: { value: 26.43, asOfDate: '2026-10-01', source: 'official Eaton Vance / MSIM product data (pricing)' },
      marketPrice: { value: 26.48, asOfDate: '2026-10-01', source: 'official Eaton Vance / MSIM product data (market price)' },
      premiumDiscount: { amount: 0.05 }, aum: { value: 1e8, source: 'derived: shares outstanding x NAV' },
      returns: { returnsBasis: 'official Eaton Vance / MSIM month-end NAV returns (fund detail page)', performanceAsOf: '2026-09-30', monthEnd: { ytd: 7.63, yr1: 9 } },
    };
    const full = parseIssuerApi(API_FILES, 'PAPI');
    expect(retainIssuerSections(full, 'PAPI', previous)).toEqual({ product: full, kept: [] });
    const partial = parseIssuerApi({ ...API_FILES, pricing: {}, returns: {} }, 'PAPI');
    const result = retainIssuerSections(partial, 'PAPI', previous);
    expect(result.kept).toEqual(['pricing', 'returns']);
    expect(result.product).toMatchObject({ nav: 26.43, navDate: '2026-10-01', marketPrice: 26.48, premiumDiscountAmount: 0.05, monthEnd: { asOfDate: '2026-09-30', ytd: 7.63, yr1: 9 }, secYield: 2.79 });
    expect(retainIssuerSections(partial, 'PAPI', { ...previous, nav: { ...previous.nav, source: 'not available' }, returns: { ...previous.returns, returnsBasis: 'derived from the Yahoo Finance adjusted daily series' } }).kept).toEqual([]);
    expect(retainIssuerSections(null, 'PAPI', null)).toEqual({ product: null, kept: [] });
  });

  test('HISTORY_RANGE sets an explicit Yahoo window: period1 = 0 for max, N years back otherwise', () => {
    const full = new URL(chartUrl('PAPI', readConfig({ HISTORY_RANGE: 'max' })));
    const short = new URL(chartUrl('PAPI', readConfig({ HISTORY_RANGE: '2y' })));
    expect(full.searchParams.get('period1')).toBe('0');
    expect(full.pathname.endsWith('/PAPI')).toBe(true);
    expect(Number(short.searchParams.get('period1'))).toBeGreaterThan(0);
    const span = Number(short.searchParams.get('period2')) - Number(short.searchParams.get('period1'));
    expect(Math.round(span / 86_400 / 365.25)).toBe(2);
  });
});
