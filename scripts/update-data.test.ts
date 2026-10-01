/// <reference types="bun" />
// Offline tests: literal fixtures captured from the live providers on
// 2026-10-01 (see .worklog.txt); no network requests are made here.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  CONTROL_NAMES, HISTORY_HEADERS, YAHOO_HISTORY_HEADERS, annualizedToTotal, cleanHoldingTicker,
  deriveCatalogMetrics, eftsSearchUrl, fundFilterReasons, parseKeyFacts,
  indicatedYield, inferDistributionFrequency, issuerFundUrl, issuerFrequency,
  lastCompletedQuarterEnd, mergeHistory, nportBelongsToFund, nportUrlFor, normalizeHoldingName,
  normalizeHoldingNameCore, normalizeSource, parseAumRange, parseChart, parseCompanyTickerMap,
  parseEdgarAtomFilings, parseFundTickerMap, parseHoldingsCsv, parseIssuerCatalog,
  parseIssuerDistributions, parseIssuerProduct, parseIssuerReturnsTable, parseNport,
  parseNportAccessions, parseRange, parseTopHoldings, pickEftsCik, readConfig, resolveControls,
  totalToAnnualized, holdingsDownloadUrl, isParametricFundUrl, PARAMETRIC_FUND_SLUGS,
} from './update-data';

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const fixtureJson = (name: string): any => JSON.parse(fixture(name));

const catalog = fixture('ev-catalog.md');
const papi = fixture('papi-page.md');
const pheq = fixture('pheq-page.md');
const peps = fixture('peps-page.md');
const nportPapi = fixture('nport-PAPI-sample.xml');
const atomPapi = fixture('sec-atom-PAPI.xml');
const mfTickers = fixtureJson('sec-mf-tickers.json');
const yahooPapi = fixtureJson('yahoo-PAPI-sample.json');

// ---------------------------------------------------------------------------
// Catalog discovery (Eaton Vance / MSIM product table)
// ---------------------------------------------------------------------------

describe('parseIssuerCatalog', () => {
  test('keeps exactly the Parametric funds with canonical product pages', () => {
    const funds = parseIssuerCatalog(catalog);
    expect(funds.map((fund) => fund.ticker)).toEqual(['PAPI', 'PEPS', 'PHEQ']);
    expect(funds.map((fund) => fund.name)).toEqual([
      'Parametric Equity Premium Income ETF',
      'Parametric Equity Plus ETF',
      'Parametric Hedged Equity ETF',
    ]);
    for (const fund of funds) {
      expect(fund.fundPage.startsWith('https://www.eatonvance.com/products/etfs/us-equity/parametric-')).toBe(true);
      expect(fund.fundPage.endsWith('.html')).toBe(true);
    }
    // Non-Parametric rows of the same shared catalog must never leak in.
    expect(funds.map((fund) => fund.ticker)).not.toContain('CVIE');
    expect(funds.map((fund) => fund.ticker)).not.toContain('EVTR');
  });

  test('a catalog without Parametric rows is an error, not an empty catalog', () => {
    expect(() => parseIssuerCatalog('| CVIE<br> [Calvert](https://www.eatonvance.com/products/etfs/x.html) |'))
      .toThrow(/no Parametric fund links/);
  });

  test('isParametricFundUrl only accepts the issuer brand pages', () => {
    expect(isParametricFundUrl(`${issuerFundUrl('PAPI')}`)).toBe(true);
    expect(isParametricFundUrl('https://www.eatonvance.com/products/etfs/us-equity/calvert-us-large-cap-core-responsible-index-etf.html')).toBe(false);
    expect(isParametricFundUrl('https://evil.example.com/products/etfs/us-equity/parametric-x.html')).toBe(false);
    expect(PARAMETRIC_FUND_SLUGS.PHEQ).toBe('parametric-hedged-equity-etf');
    expect(() => issuerFundUrl('NOPE')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Product page parsing
// ---------------------------------------------------------------------------

describe('parseIssuerProduct (live page fixtures)', () => {
  test('PAPI headline facts, identifiers and returns match the published page', () => {
    const product = parseIssuerProduct(papi, 'PAPI');
    expect(product.ticker).toBe('PAPI');
    expect(product.name).toBe('Parametric Equity Premium Income ETF');
    expect(product.cusip).toBe('61774R866');
    expect(product.assetClass).toBe('US Equity');
    expect(product.exchange).toBe('NYSE Arca');
    expect(product.benchmark).toBe('Russell 1000 Value Index');
    expect(product.inception).toBe('2023-10-16');
    expect(product.nav).toBe(26.22);
    expect(product.marketPrice).toBe(26.28);
    expect(product.navDate).toBe('2026-09-30');
    expect(product.premiumDiscount).toBe(0.06);
    expect(product.bidAskSpread).toBe(0.22);
    expect(product.grossExpense).toBe(0.29);
    expect(product.netExpense).toBe(0.29);
    expect(product.netAssets).toBe(479_910_000);
    expect(product.netAssetsDate).toBe('2026-09-30');
    expect(product.frequencyCode).toBe('M');
    // monthEnd is the official NAV series (the sibling convention); the market
    // price row is parsed separately and asserted in its own test.
    expect(product.monthEnd).toMatchObject({
      asOfDate: '2026-09-30', mo1: -5.08, mo3: 0.2, ytd: 7.63, yr1: 9.0,
      yr3: null, yr5: null, yr10: null, sinceInception: 9.4,
    });
  });

  test('PHEQ and PEPS parse with their own cadence and expense ratios', () => {
    const hedged = parseIssuerProduct(pheq, 'PHEQ');
    expect(hedged.cusip).toBe('61774R874');
    expect(hedged.nav).toBe(35.2);
    expect(hedged.marketPrice).toBe(35.4);
    expect(hedged.premiumDiscount).toBe(0.2);
    expect(hedged.netAssets).toBe(153_100_000);
    expect(hedged.frequencyCode).toBe('Q');
    expect(hedged.benchmark).toBe('S&P 500 Index');
    expect(hedged.monthEnd.ytd).toBe(8.51);
    expect(hedged.monthEnd.yr1).toBe(10.72);
    expect(hedged.monthEnd.sinceInception).toBe(14.08);

    const plus = parseIssuerProduct(peps, 'PEPS');
    expect(plus.cusip).toBe('61774R775');
    expect(plus.exchange).toBe('NASDAQ');
    expect(plus.netExpense).toBe(0.1);
    expect(plus.grossExpense).toBe(0.29);
    expect(plus.netAssets).toBe(29_560_000);
    expect(plus.inception).toBe('2024-11-07');
    expect(plus.monthEnd.sinceInception).toBe(16.67);
  });

  test('the NAV row is not mistaken for the market-price row', () => {
    const { monthEnd, monthMarket } = parseIssuerReturnsTable(papi, 'PAPI');
    expect(monthMarket.mo1).toBe(-5.07);
    expect(monthMarket.ytd).toBe(8.04);
    expect(monthEnd.mo1).toBe(-5.08);
    expect(monthEnd.ytd).toBe(7.63);
    // Unknown tenors stay null instead of borrowing a neighbouring column.
    expect(monthEnd.yr3).toBeNull();
    expect(monthEnd.yr10).toBeNull();
  });
});

describe('distributions and top holdings', () => {
  test('the published schedule sums income and capital gains, oldest last', () => {
    const payments = parseIssuerDistributions(papi);
    expect(payments.length).toBe(35);
    const latest = payments[payments.length - 1];
    expect(latest.exDate).toBe('2026-09-30');
    expect(latest.payDate).toBe('2026-10-06');
    expect(latest.amount).toBeCloseTo(0.176725, 6);
    const oldest = payments[0];
    expect(oldest.exDate).toBe('2023-11-30');
    expect(oldest.amount).toBeCloseTo(0.166059, 6);
    // The distribution table itself must never be read as returns.
    expect(parseIssuerDistributions(pheq).length).toBe(12);
    expect(parseIssuerDistributions(peps).length).toBe(8);
  });

  test('top-10 holdings keep the published weight, shares and identifier', () => {
    const rows = parseTopHoldings(papi);
    expect(rows.length).toBe(10);
    expect(rows[0]).toEqual({
      Name: 'MSILF GOVERNMENT', Ticker: '', Identifier: '61747C707', Weight: '1.65',
      'Market Value': '7982325.78', 'Shares Held': '7982326', 'Asset Category': 'Money Market',
    });
    expect(rows.find((row) => row.Ticker === 'VLO')!.Weight).toBe('0.81');
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
});

// ---------------------------------------------------------------------------
// SEC EDGAR N-PORT-P layer
// ---------------------------------------------------------------------------

describe('SEC EDGAR layer', () => {
  test('the fund ticker table resolves CIK and series ids for the Parametric suite', () => {
    expect(mfTickers.fields).toEqual(['cik', 'seriesId', 'classId', 'symbol']);
    const map = parseFundTickerMap({ fields: mfTickers.fields, data: mfTickers.data });
    expect(map.get('PAPI')).toEqual({ cik: '0001676326', seriesId: 'S000082252', classId: 'C000245536' });
    expect(map.get('PHEQ')).toEqual({ cik: '0001676326', seriesId: 'S000082250', classId: 'C000245534' });
    expect(map.get('PEPS')).toEqual({ cik: '0001676326', seriesId: 'S000088098', classId: 'C000254149' });
    expect(map.get('CVIE')!.seriesId).toBe('S000077958');
  });

  test('the series Atom feed yields the newest N-PORT-P accession and archive URL', () => {
    const filings = parseEdgarAtomFilings(atomPapi);
    expect(filings.length).toBeGreaterThan(0);
    const newest = filings[0];
    expect(newest.accession).toMatch(/^\d{10}-\d{2}-\d{6}$/);
    expect(newest.url).toBe(nportUrlFor('1676326', newest.accession));
    expect(newest.url).toContain('/Archives/edgar/data/1676326/');
    expect(newest.url.endsWith('/primary_doc.xml')).toBe(true);
  });

  test('submissions parser keeps only NPORT filings and builds archive URLs', () => {
    const accessions = parseNportAccessions({
      cik: '1676326',
      filings: {
        recent: {
          form: ['NPORT-P', 'N-CSR', 'NPORT-P'],
          accessionNumber: ['0002071691-26-018745', '0002071691-26-018700', '0002071691-26-018741'],
          filingDate: ['2026-08-28', '2026-08-01', '2026-08-28'],
          reportDate: ['2026-06-30', '2026-06-30', '2026-06-30'],
        },
      },
    });
    expect(accessions.map((entry) => entry.accession)).toEqual(['0002071691-26-018745', '0002071691-26-018741']);
    expect(accessions[0].url).toContain('/Archives/edgar/data/1676326/000207169126018745/primary_doc.xml');
  });

  test('the live N-PORT-P payload parses positions, net assets and the designated index', () => {
    const parsed = parseNport(nportPapi);
    expect(parsed.regName).toBe('Morgan Stanley ETF Trust');
    expect(parsed.regCik).toBe('0001676326');
    expect(parsed.seriesName).toBe('Parametric Equity Premium Income ETF');
    expect(parsed.seriesId).toBe('S000082252');
    expect(parsed.repPdDate).toBe('2026-06-30');
    expect(parsed.netAssets).toBe(399_844_102.98);
    expect(parsed.designatedIndex).toBe('Russell 1000 Value');
    expect(parsed.holdings.length).toBe(5);
    expect(parsed.holdings[0]).toMatchObject({
      Name: 'Kraft Heinz Co. (The)', Ticker: '-', Identifier: '500754106',
      // normalizeNumberText keeps 10 decimal places, enough for a filed weight.
      Weight: '0.5521378266', 'Market Value': '2207690.54', 'Shares Held': '93467', 'Asset Category': 'EC',
    });
    expect(parsed.holdings.map((row) => row.Ticker)).toEqual(['-', '-', '-', '-', '-']);
    expect(parsed.holdings.every((row) => row.Identifier !== '-')).toBe(true);
  });

  test('a filing from another series is rejected for the requested fund', () => {
    const fund = { name: 'Parametric Equity Premium Income ETF' };
    expect(nportBelongsToFund({ seriesId: 'S000082252', seriesName: 'Parametric Equity Premium Income ETF' }, { seriesId: 'S000082252' }, fund)).toBe(true);
    expect(nportBelongsToFund({ seriesId: 'S000082250', seriesName: 'Parametric Hedged Equity ETF' }, { seriesId: 'S000082252' }, fund)).toBe(false);
    // Without a known series id only the filed series name may match.
    expect(nportBelongsToFund({ seriesId: '', seriesName: 'Parametric Equity Premium Income ETF' }, { seriesId: '' }, fund)).toBe(true);
    expect(nportBelongsToFund({ seriesId: '', seriesName: 'Calvert US Large-Cap Core Responsible Index ETF' }, { seriesId: '' }, fund)).toBe(false);
  });

  test('company ticker table fills N-PORT positions that carry no ticker', () => {
    const map = parseCompanyTickerMap({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, 1: { cik_str: 789019, ticker: 'MSFT', title: 'MICROSOFT CORP' } });
    expect(map.get(normalizeHoldingName('Apple Inc.'))).toBe('AAPL');
    expect(map.get(normalizeHoldingNameCore('Microsoft Corp'))).toBe('MSFT');
  });

  test('full-text search picks the registrant whose name matches the fund', () => {
    const payload = {
      hits: [
        { _source: { display_names: { cik: 12345, names: ['Some Other Trust'] } } },
        { _source: { display_names: { cik: 1676326, names: ['Parametric Equity Premium Income ETF', 'MORGAN STANLEY ETF TRUST'] } } },
      ],
    };
    expect(pickEftsCik(payload, 'Parametric Equity Premium Income ETF')).toBe('0001676326');
    expect(pickEftsCik(payload, 'Unrelated Fund')).toBeNull();
    expect(eftsSearchUrl('PAPI')).toContain('forms=NPORT-P');
  });
});

// ---------------------------------------------------------------------------
// Yahoo chart layer, history merging and derived metrics
// ---------------------------------------------------------------------------

describe('parseChart', () => {
  const chart = parseChart(yahooPapi);
  test('reads meta, adjusted closes and dividends from the live payload', () => {
    expect(chart.exchangeName).toBe('NYSEArca');
    expect(chart.longName).toBe('Parametric Equity Premium Income ETF');
    expect(chart.regularMarketPrice).toBe(26.48);
    expect(chart.firstTradeDate).toBe(1697722200);
    expect(chart.days.length).toBeGreaterThan(0);
    for (const day of chart.days) {
      expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isFinite(day.close)).toBe(true);
      // Rounded to two decimals so Yahoo's last-digit jitter cannot churn the feed.
      expect(day.adjClose).toBe(Math.round(day.adjClose * 100) / 100);
    }
    expect(chart.dividends.length).toBeGreaterThan(0);
    expect(chart.dividends[0].epoch).toBeLessThan(chart.dividends.at(-1)!.epoch);
  });

  test('throws on an empty result', () => {
    expect(() => parseChart({ chart: { result: [] } })).toThrow(/empty result/);
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
    const merged = mergeHistory(previous, [day('2026-09-30', 25.42)]);
    expect(merged[0]['Adj Close']).toBe('25.42');
  });

  test('new days merge in date order and older published rows survive a short range', () => {
    const merged = mergeHistory(
      [{ Date: 'Oct 16 2023', Close: '25.00', 'Adj Close': '24.00', Volume: '1' }],
      [day('2026-09-29', 25.1), day('2026-09-30', 25.2)],
    );
    expect(merged.map((row) => row.Date)).toEqual(['Oct 16 2023', 'Sep 29 2026', 'Sep 30 2026']);
  });

  test('the published Yahoo header set is kept for every page', () => {
    expect(YAHOO_HISTORY_HEADERS).toEqual(['Date', 'Close', 'Adj Close', 'Volume']);
    // NAV-based sheets are not published by this issuer; the constant documents
    // the sibling schema without being written anywhere.
    expect(HISTORY_HEADERS).toEqual(['Date', 'NAV', 'Market Price', 'Premium/Discount']);
  });
});

describe('derived metrics', () => {
  test('annualizedToTotal inverts annualization exactly and round-trips', () => {
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

  test('the official published returns win; derived ones only fill the gaps', () => {
    const derived = { asOfDate: '2026-09-30', ytd: 7.1, yr1: 8.2, cagr3y: 9.9, cagr5y: null, cagr10y: null, siAnn: 10.5, mo1: -5.2, qtd: 0.1 };
    const metrics = deriveCatalogMetrics(
      { ytd: 7.63, yr1: 9.0, yr3: null, yr5: null, yr10: null, sinceInception: 9.4 },
      derived, null, null, 0.176725, 12, 26.28,
    );
    expect(metrics.ytd).toBe(7.63);
    expect(metrics.tr1y).toBe(9.0);
    expect(metrics.cagr3y).toBe(9.9);
    expect(metrics.siAnn).toBe(9.4);
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
// Configuration and filters
// ---------------------------------------------------------------------------

describe('parseRange / parseAumRange', () => {
  test('empty and ":" mean no restriction', () => {
    expect(parseRange('', 'X')).toBeUndefined();
    expect(parseRange(':', 'X')).toBeUndefined();
    expect(parseAumRange('')).toBeUndefined();
    expect(parseAumRange(':')).toBeUndefined();
  });

  test('inclusive bounds, percent and $ signs are optional', () => {
    expect(parseRange('1:5', 'X')).toEqual({ min: 1, max: 5 });
    expect(parseRange('2:', 'X')).toEqual({ min: 2, max: undefined });
    expect(parseRange(':3', 'X')).toEqual({ min: undefined, max: 3 });
    expect(parseRange('0.1%:0.5%', 'X')).toEqual({ min: 0.1, max: 0.5 });
    expect(parseAumRange('10M:2B')).toEqual({ min: 10_000_000, max: 2_000_000_000 });
    expect(parseAumRange('mid')).toEqual({ min: 2_000_000_000, max: 10_000_000_000 });
  });

  test('colonless and inverted values are rejected', () => {
    expect(() => parseRange('15', 'X')).toThrow(/colon is required/);
    expect(() => parseRange('5:1', 'X')).toThrow(/must not exceed/);
    expect(() => parseAumRange('42')).toThrow(/colon is required/);
  });
});

describe('filters', () => {
  const config = readConfig(resolveControls({
    TICKERS: 'PAPI', AUM: '100M:1B', TER: ':0.3', DIVIDEND_YIELD: '1:20',
    PERFORMANCE_YTD: '5:', TOTAL_RETURN_1Y: ':15',
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
});

describe('repository configuration / Actions override precedence', () => {
  test('file < advanced JSON < explicit input < environment (brand alias wins)', () => {
    const controls = resolveControls(
      { CONCURRENCY: 2, TICKERS: 'PAPI' },
      { CONCURRENCY: 3, TICKERS: 'PHEQ' },
      { CONCURRENCY: '4', TICKERS: '' },
      { PARAMETRIC_CONCURRENCY: '5' },
    );
    expect(controls).toEqual({ CONCURRENCY: '5', TICKERS: 'PHEQ' });
  });

  test('an empty dispatch inherits the file and every canonical control is present', () => {
    const file = JSON.parse(readFileSync(new URL('./update-data.config.json', import.meta.url), 'utf8')) as Record<string, string>;
    expect(Object.keys(file).sort()).toEqual([...CONTROL_NAMES].sort());
    const config = readConfig(resolveControls(file));
    expect(config.tickers).toEqual([]);
    expect(config.maxFetches).toBe(0);
    expect(config.requestSleep).toBe(3);
    expect(config.concurrency).toBe(1);
    expect(config.skipIssuer).toBe(false);
    expect(config.skipYahoo).toBe(false);
    expect(config.edgarFallback).toBe(true);
    expect(config.catalogUrl).toBe('https://www.eatonvance.com/products/etfs.html');
  });

  test('unknown keys, multiline injection and invalid values are rejected', () => {
    for (const value of [
      { UNKNOWN: 1 }, { SEC_UA: 'x\nEVIL=yes' }, { CONCURRENCY: 0 }, { MAX_RETRIES: -1 },
      { MAX_FETCHES: 1.5 }, { HISTORY_RANGE: 'oops' }, { VERBOSE: 'maybe' }, { TICKERS: ['PAPI'] },
      { CATALOG_URL: 'ftp://example.com' }, null, [],
    ]) {
      expect(() => resolveControls(value)).toThrow();
    }
    expect(() => resolveControls({}, { SEC_UA: 'x\rfoo' })).toThrow();
    expect(() => resolveControls({}, {}, {}, { PARAMETRIC_SEC_UA: 'x\0bad' })).toThrow();
  });

  test('the advanced JSON reaches controls that do not fit the 25 dispatch inputs', () => {
    const controls = resolveControls({}, { SKIP_ISSUER: 'true', VERBOSE: 'true', SEC_UA: 'ops contact' });
    expect(controls.SKIP_ISSUER).toBe('true');
    expect(controls.VERBOSE).toBe('true');
    expect(controls.SEC_UA).toBe('ops contact');
  });

  test('the update workflow stays within the 25-input dispatch cap', () => {
    const text = readFileSync(new URL('../.github/workflows/update-data.yml', import.meta.url), 'utf8');
    const inputs = text.split('    inputs:')[1].split('\npermissions:')[0];
    const names = [...inputs.matchAll(/^      ([a-z0-9_]+):$/gm)].map((match) => match[1]);
    expect(names.length).toBe(25);
    expect(names).toContain('advanced');
    expect(names).toContain('concurrency');
    expect(names).toContain('tickers');
    expect(new Set(names).size).toBe(25);
    for (const name of names.filter((entry) => entry !== 'advanced')) expect(CONTROL_NAMES).toContain(name.toUpperCase());
    // Schedule + manual only; the sibling rule forbids a push-triggered refresh.
    expect(text).toContain("cron: '0 0 * * 0'");
    expect(text).not.toMatch(/^  push:/m);
    expect(text).not.toContain('bunx tsc');
    expect(text).toContain('toJSON(inputs)');
  });

  test('every canonical control is documented in the README', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    for (const name of CONTROL_NAMES) {
      const tenor = name.match(/^(PERFORMANCE|TOTAL_RETURN)_(1Y|3Y|5Y|10Y)$/);
      expect(readme).toContain(tenor ? '`_' + tenor[2] + '`' : '`' + name + '`');
      if (tenor) expect(readme).toContain('`' + tenor[1] + '_YTD`');
    }
    expect(readme).toContain('scripts/update-data.config.json');
  });
});

// ---------------------------------------------------------------------------
// Source normalization and holding helpers
// ---------------------------------------------------------------------------

describe('normalizeSource / key facts', () => {
  test('markdown passes through; HTML tables become pipe rows', () => {
    expect(normalizeSource('| a | b |\n| --- | --- |\n| 1 | 2 |')).toContain('| a | b |');
    const html = '<table><tr><td>Asset Class</td><td>US Equity</td></tr></table>';
    const text = normalizeSource(html);
    expect(text).toContain('| Asset Class | US Equity |');
    expect(parseKeyFacts(text).get('Asset Class')).toBe('US Equity');
  });

  test('rendering-proxy banners and images are stripped', () => {
    const text = normalizeSource('Title: Parametric\nMarkdown Content:\n![Download icon](https://x/y.svg)Gross\n0.29%');
    expect(text).not.toContain('Title:');
    expect(text).not.toContain('Download icon');
    expect(text).toContain('Gross');
  });
});

describe('holding identifiers', () => {
  test('normalizeHoldingName strips legal forms and keeps share classes apart', () => {
    expect(normalizeHoldingName('Apple Inc.')).toBe('APPLE');
    expect(normalizeHoldingName('Microsoft Corp Common Stock')).toBe('MICROSOFT');
    expect(normalizeHoldingName('THE BOEING CO')).toBe('BOEING');
    expect(normalizeHoldingName('Alphabet Inc. Class C Capital Stock')).toBe('ALPHABET CL C');
    expect(normalizeHoldingName('Alphabet Inc Cl A')).toBe('ALPHABET CL A');
    expect(normalizeHoldingNameCore('Apple Inc.')).toBe('APPLE');
    expect(normalizeHoldingName('')).toBe('');
  });

  test('cleanHoldingTicker keeps class markers and rejects placeholders', () => {
    expect(cleanHoldingTicker('brk-b')).toBe('BRK-B');
    expect(cleanHoldingTicker('SCE^L')).toBe('SCE^L');
    expect(cleanHoldingTicker('N/A')).toBe('');
    expect(cleanHoldingTicker('see file')).toBe('');
  });
});

describe('official holdings downloads', () => {
  test('a full-holdings CSV link is recognized, the top-10 table is not', () => {
    const page = '<a href="/content/dam/parametric-PAPI-holdings.csv">Download Full Holdings</a>';
    expect(holdingsDownloadUrl(page, 'PAPI')).toBe('https://www.eatonvance.com/content/dam/parametric-PAPI-holdings.csv');
    expect(holdingsDownloadUrl('<a href="/x.pdf">Download Full Holdings</a>', 'PAPI')).toBeNull();
    expect(holdingsDownloadUrl(papi, 'PAPI')).toBeNull();
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
    // Rows are published heaviest-first, exactly like the sibling sheets.
    expect(parsed.rows.map((row) => row.Ticker)).toEqual(['', 'MSFT', '']);
    expect(parsed.rows.find((row) => row.Ticker === 'MSFT')).toMatchObject({
      Identifier: '594918104', Weight: '0.72', 'Shares Held': '6775', 'Market Value': '3474897.5',
    });
    expect(parsed.rows[0]).toMatchObject({ Name: 'MSILF GOVERNMENT', Identifier: '61747C707', Weight: '1.65' });
    expect(parsed.rows[2]).toMatchObject({ Name: 'US TREASURY 4.125% 05/15/2028', Ticker: '', Identifier: '912810H80' });
    expect(parseHoldingsCsv('nothing here')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Published feed integrity (offline)
// ---------------------------------------------------------------------------

describe('published api/parametric feed', () => {
  test('index.json, meta.json and the paginated sheets agree', () => {
    const index = JSON.parse(readFileSync(new URL('../api/parametric/index.json', import.meta.url), 'utf8'));
    expect(index.counts.funds).toBe(index.funds.length);
    expect(index.funds.length).toBeGreaterThanOrEqual(3);
    for (const fund of index.funds) {
      expect(fund.dataFile).toBe(`./funds/${fund.ticker}/meta.json`);
      const meta = JSON.parse(readFileSync(new URL(`../api/parametric/funds/${fund.ticker}/meta.json`, import.meta.url), 'utf8'));
      for (const kind of ['holdings', 'history'] as const) {
        expect(meta[kind].pages.length).toBe(Math.ceil(meta[kind].totalRows / meta[kind].pageSize));
        const total = meta[kind].pages.reduce((sum: number, path: string) => {
          const page = JSON.parse(readFileSync(new URL(`../api/parametric/funds/${fund.ticker}/${path}`, import.meta.url), 'utf8'));
          expect(Array.isArray(page.headers)).toBe(true);
          expect(page.headers.length).toBeGreaterThan(0);
          expect(page.rows.length).toBeLessThanOrEqual(page.pageSize);
          return sum + page.rows.length;
        }, 0);
        expect(total).toBe(meta[kind].totalRows);
        expect(total).toBe(fund[kind]);
      }
      expect(meta.history.pages.length ? JSON.parse(readFileSync(new URL(`../api/parametric/funds/${fund.ticker}/history/001.json`, import.meta.url), 'utf8')).headers : []).toEqual(YAHOO_HISTORY_HEADERS);
      expect(Array.isArray(meta.distributions.rows)).toBe(true);
      expect(meta.ticker).toBe(fund.ticker);
      expect(meta.identifiers.cusip).toMatch(/^[A-Z0-9]{9}$/);
    }
  });
});
