#!/usr/bin/env bun
/// <reference types="bun" />
import { readFile as outputReadFile, readdir as outputReadDir } from 'node:fs/promises';
import { createHash as outputCreateHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { join as outputJoin } from 'node:path';
import { fileURLToPath as outputFileURLToPath } from 'node:url';

// Console presentation; no changes to provider requests or persisted data.
/** Presentation only: no requests, writes, filtering, or changes to updater state. */

const outputClean = (value: unknown): string => String(value ?? 'null').replace(/[\r\n\t]+/g, ' ');
/** Presentation only: per-fund retry and fallback notices are printed when VERBOSE is enabled. */
const outputVerbose = (): boolean => /^(1|true|yes|on)$/i.test((globalThis as any).process?.env?.VERBOSE ?? '');
function outputNote(message: string): void { if (outputVerbose()) console.warn(message); }
/** Names are the canonical environment knobs, not internal parser properties. */
function outputConfigEntries(config: Record<string, any>): [string, string][] {
  const values = new Map<string, string>();
  const aliases: Record<string, string> = {
    requestSleepSeconds: 'REQUEST_SLEEP', categories: 'CATEGORY',
    aumRange: 'AUM', terRange: 'TER', dividendYieldRange: 'DIVIDEND_YIELD', secYieldRange: 'SEC_YIELD',
    performanceRanges: 'PERFORMANCE', totalReturnRanges: 'TOTAL_RETURN',
    skipVanEck: 'SKIP_VANECK', skipProShares: 'SKIP_PROSHARES',
    skipWisdomTree: 'SKIP_WISDOMTREE', skipGoldmanSachs: 'SKIP_GOLDMANSACHS',
    skipGlobalX: 'SKIP_GLOBALX', skipNorthernTrust: 'SKIP_NORTHERNTRUST',
  };
  const range = (v: any): string => typeof v === 'string' ? v : v?.source ?? `${Number.isFinite(v?.min) ? v.min : ''}:${Number.isFinite(v?.max) ? v.max : ''}`;
  for (const [key, value] of Object.entries(config)) {
    if (['proxyGapMs', 'fetchTimeoutMs', 'retryDelayMs'].includes(key)) continue;
    const name = aliases[key] ?? (/^[A-Z0-9_]+$/.test(key) ? key : key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase());
    if (name === 'PERFORMANCE' || name === 'TOTAL_RETURN') {
      for (const period of ['YTD', '1Y', '3Y', '5Y', '10Y']) values.set(`${name}_${period}`, range(value?.[period]));
    } else if (['AUM', 'TER', 'DIVIDEND_YIELD', 'SEC_YIELD'].includes(name)) {
      values.set(name, range(value));
    } else {
      values.set(name, value instanceof Set ? [...value].join(',') || 'all' : Array.isArray(value) ? value.join(',') || 'all' : outputClean(value));
    }
  }
  const first = ['MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY'];
  return [...values].sort(([a], [b]) => {
    const ai = first.indexOf(a), bi = first.indexOf(b);
    return (ai < 0 ? first.length : ai) - (bi < 0 ? first.length : bi) || a.localeCompare(b);
  });
}
function outputConfigValue(key: string, value: string): string {
  if (/TOKEN|PASSWORD|SECRET|COOKIE|SEC_UA/i.test(key)) return '<redacted>';
  if (key === 'TICKERS' && ['', 'null', 'undefined'].includes(value)) return 'all';
  return outputClean(value);
}
function outputPrintConfig(brand: string, config: Record<string, any>): void {
  const entries: [string, string][] = [...outputConfigEntries(config), ['VERBOSE', String(outputVerbose())]];
  console.log(`[ config   ] ${brand} updater:\n${entries.map(([key, value]) => `              ${key}=${outputConfigValue(key, value)}`).join('\n')}`);
}
function outputHasOutputFilters(config: Record<string, any>): boolean {
  return outputConfigEntries(config).some(([name, value]) =>
    /^(CATEGORY|AUM|TER|DIVIDEND_YIELD|SEC_YIELD|PERFORMANCE_|TOTAL_RETURN_)/.test(name) &&
    !['', ':', 'null', 'all'].includes(value));
}
function outputPrintFilter(selected: number, total: number, deferred = false): void {
  console.log(`[ filter   ] ${selected} of ${total} funds ${deferred ? 'selected for evaluation (data-dependent filters applied per fund)' : 'pass filters'}`);
}
function outputStable(value: any): any {
  if (Array.isArray(value)) return value.map(outputStable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => !['generatedAt', 'catalogReadAt'].includes(key)).map(key => [key, outputStable(value[key])]));
  return value;
}
function outputContentKey(value: unknown): string { return JSON.stringify(outputStable(value)) ?? 'null'; }
async function outputInspectFund(root: URL | string, ticker: string): Promise<{ digest: string; meta: any }> {
  const dir = outputJoin(root instanceof URL ? outputFileURLToPath(root) : root, 'funds', ticker);
  const hash = outputCreateHash('sha256');
  async function visit(path: string): Promise<void> {
    const entries = await outputReadDir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) await visit(outputJoin(path, entry.name));
      else if (entry.name.endsWith('.json')) {
        const text = await outputReadFile(outputJoin(path, entry.name), 'utf8').catch(() => '');
        hash.update(outputJoin(path.slice(dir.length), entry.name));
        try { hash.update(outputContentKey(JSON.parse(text))); } catch { hash.update(text); }
      }
    }
  }
  await visit(dir);
  const meta = await outputReadFile(outputJoin(dir, 'meta.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  return { digest: hash.digest('hex'), meta };
}
const outputCount = (value: any): unknown => typeof value === 'number' ? value : Array.isArray(value) ? value.length : value?.totalRows ?? value?.rows?.length ?? null;
const outputScalar = (value: any): any => value && typeof value === 'object' ? value.display ?? value.value ?? null : value;
const outputUnits: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12, THOUSAND: 1e3, MILLION: 1e6, BILLION: 1e9, TRILLION: 1e12 };
function outputMoney(value: any): string {
  const raw = value && typeof value === 'object' && typeof value.value === 'number' && Number.isFinite(value.value) ? value.value : outputScalar(value);
  if (raw === null || raw === undefined || raw === '—' || raw === '--') return 'null';
  const text = String(raw).replace(/[$,\s]/g, '');
  const match = text.match(/^([+-]?[\d.]+)(K|M|B|T|Thousand|Million|Billion|Trillion)?$/i);
  if (!match) return outputClean(raw);
  const number = Number(match[1]) * (outputUnits[match[2]?.toUpperCase() ?? ''] ?? 1);
  if (!Number.isFinite(number)) return 'null';
  for (const [unit, scale] of [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) {
    if (Math.abs(number) >= scale) return `$${(number / scale).toFixed(1)}${unit}`;
  }
  return `$${number.toFixed(2)}`;
}
/** Yields: rounded to 2 decimals without trailing zeros; placeholders are omitted like null. */
function outputPercent(value: any): unknown {
  const raw = outputScalar(value);
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? Number(raw.toFixed(2)) : null;
  const text = String(raw).trim().replace(/%$/, '').trim();
  if (['', '-', '—', '--', 'n/a'].includes(text.toLowerCase())) return null;
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) ? Number(number.toFixed(2)) : outputClean(raw);
}
function outputFundLine(index: number, total: number, ticker: string, status: string, data: any = {}, reason?: unknown): string {
  const width = Math.max(2, String(total).length);
  const metrics = data.metrics ?? {};
  // Presentation only. Keep valid zero/false values; omit unavailable fields.
  // outputMoney returns the string 'null' for an unavailable monetary value.
  const field = (key: string, value: unknown): string =>
    value === null || value === undefined || value === 'null' ? '' : `${key}=${outputClean(value)}`;
  const sources = [
    field('official', data.officialHistoryCount),
    field('yahoo', data.yahooHistoryCount),
  ].filter(part => part !== '').join(' ');
  const detail = [
    field('port', data.portId ?? data.portfolioId),
    field('history', outputCount(data.history ?? data.historyCount)),
    sources ? `(${sources})` : '',
    field('holdings', outputCount(data.holdings ?? data.holdingsCount)),
    field('divs', outputCount(data.worksheets?.Distributions ?? data.distributions)),
    field('netAssets', outputMoney(data.netAssets ?? data.aum)),
    field('total', outputMoney(data.totalFundNetAssets ?? data.totalNetAssets)),
    field('div', outputPercent(data.trailingYield ?? data.yields?.effectiveYield ?? data.yields?.dividendYield ?? data.dividendYield ?? metrics.dividendYield)),
    field('sec', outputPercent(data.secYield ?? data.yields?.secYield ?? metrics.secYield)),
    field('wp', data.workplaceRaw),
  ].filter(part => part !== '').join(' ');
  return `[ ${String(index).padStart(width)}/${String(total).padEnd(width)}  ] ${outputClean(ticker).padEnd(5)} ${status.padEnd(9)}${detail ? ` ${detail}` : ''}${reason ? ` reason=${outputClean(reason)}` : ''}`;
}
function outputCreateReporter(root: URL | string, total: number) {
  let completed = 0;
  const tally = new Map<string, number>();
  return {
    before: (ticker: string) => outputInspectFund(root, ticker),
    async result(ticker: string, before: { digest: string }, status?: string, reason?: unknown, extra: any = {}) {
      const after = await outputInspectFund(root, ticker);
      const final = status ?? (before.digest === after.digest ? 'unchanged' : 'updated');
      tally.set(final, (tally.get(final) ?? 0) + 1);
      console.log(outputFundLine(++completed, total, ticker, final, { ...after.meta, ...extra }, reason));
    },
    /** First [ done ] line: the statuses of every fund line this reporter printed. */
    summary(startedAt: number): string {
      const order = ['updated', 'unchanged', 'kept', 'skipped', 'failed'];
      const statuses = [...order, ...[...tally.keys()].filter(status => !order.includes(status))];
      return `[ done     ] ${completed} fund${completed === 1 ? '' : 's'}: ${statuses.map(status => `${tally.get(status) ?? 0} ${status}`).join(', ')} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
    },
  };
}
/** Second [ done ] line: published totals. */
function outputCounts(funds: number, holdings: number, history: number): string {
  return `[ done     ] counts: ${funds.toLocaleString('en-US')} funds / ${holdings.toLocaleString('en-US')} holdings rows / ${history.toLocaleString('en-US')} history rows`;
}

import { mkdir, readFile, writeFile, readdir, rm, appendFile, rename } from 'node:fs/promises';

type JsonRecord = Record<string, any>;
const ISSUER_SITE = 'https://www.eatonvance.com';
const ISSUER_CATALOG = `${ISSUER_SITE}/products/etfs.html`;
// Parametric funds live under the shared MSIM product detail template
// (https://www.eatonvance.com/products/etfs/us-equity/parametric-*.html).
const ISSUER_PRODUCT_PATH = '/products/etfs/';
const ISSUER_BRAND_SLUG = 'parametric';
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search';
const YAHOO_BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

const SEC_DATA_HOST = 'https://data.sec.gov';
const SEC_EFTS_HOST = 'https://efts.sec.gov/LATEST';
const EDGAR_ARCHIVES = 'https://www.sec.gov/Archives/edgar/data';
const EDGAR_BROWSE_URL = 'https://www.sec.gov/cgi-bin/browse-edgar';
// Official SEC lookup tables (public, no key): ETF/mutual-fund ticker ->
// registrant CIK + series/class ids, and operating company name -> ticker.
const SEC_FUND_TICKERS_URL = 'https://www.sec.gov/files/company_tickers_mf.json';
const SEC_COMPANY_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const SEC_UA_DEFAULT = 'daggerok ETF feed daggerok@gmail.com';
// The issuer sits behind an Akamai bot manager that answered 403 to this updater from GitHub runners (CI run of
// 2026-10-02: catalog, proxy and every product file denied). It is a best-effort source: one denial already sends the
// request through the read-only rendering proxy (the documented sibling workaround), and a denied proxy marks the
// issuer unreachable for the rest of the run. SEC EDGAR and Yahoo carry the feed in that case. The counter resets
// whenever a direct request succeeds, so a single transient 403 does not move the rest of the run.
const ISSUER_DENIAL_LIMIT = 1;
const RENDER_PROXY = 'https://r.jina.ai';
// r.jina.ai anonymous tier allows about 20 requests per minute
const PROXY_SLEEP_SECONDS = 3.2;

const API_ROOT = new URL('../api/parametric/', import.meta.url);
const INDEX_FILE = new URL('index.json', API_ROOT);
const STATE_FILE = new URL('update-state.json', API_ROOT);

const HOLDINGS_PAGE_SIZE_FALLBACK = 250;
const HISTORY_PAGE_SIZE_FALLBACK = 1000;
const CONCURRENCY_FALLBACK = 1;
const REQUEST_SLEEP_FALLBACK = 3;
const MAX_RETRIES_FALLBACK = 2;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad3(value: number): string {
  return String(value).padStart(3, '0');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeTicker(raw: unknown): string {
  return String(raw ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function cleanText(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\u00ae/g, '') // ®
    .replace(/\u2122/g, '') // ™
    .replace(/&#174;|&reg;/gi, '')
    .replace(/&#8482;|&trade;/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// "2.97057744E8" -> "297057744"; keeps non-numeric text untouched (same as SPDR).
export function normalizeNumberText(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (text === '' || text === '-') return text;
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text.replace(/,/g, ''))) return text;
  const number = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(number) || Math.abs(number) >= 1e21) return text;
  return number.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 10 });
}

export function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '' || text === '—' || text === '-' || text === '--' || /^n\/?a$/i.test(text)) return null;
  // Percent first, then plain numbers: "0.40%" -> 0.4, "$1,234.56" -> 1234.56.
  const parsed = Number(text.replace(/[$,\s]/g, '').replace(/%$/i, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// eatonvance.com publishes returns, yields and expense ratios in percent
// already; the N-PORT filings publish fractions (0.5521 = 0.55%).
export function fractionToPercent(value: unknown): number | null {
  const number = numberOrNull(value);
  return number === null ? null : round(number * 100, 6);
}

// "2026-06-30" -> "Jun 30 2026" (the display style shared with the sibling apps).
export function formatEdgarDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!match) return String(iso || '');
  const [, year, month, day] = match;
  return `${MONTHS[Number(month) - 1] ?? month} ${day} ${year}`;
}

// 'Oct 01 2026' (formatEdgarDate output) -> '2026-10-01'; null when not parseable.
export function isoFromEdgar(label: unknown): string | null {
  const match = /^([A-Za-z]{3}) (\d{2}) (\d{4})$/.exec(String(label ?? '').trim());
  const month = match ? MONTHS.indexOf(match[1]) : -1;
  return match && month >= 0 ? `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[2]}` : null;
}

export function epochToIsoDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

export function formatEpochDate(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return `${MONTHS[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2, '0')} ${date.getUTCFullYear()}`;
}

export function formatUsDate(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

// "08/21/2026" / "2026-08-21T00:00:00Z" / "Aug 21, 2026" -> "2026-08-21" as plain calendar text (shared calendar-dates
// block, never the local time zone); anything else passes through untouched so an unexpected source format never
// silently corrupts a date column.
export function toIsoDate(raw: unknown): string {
  const text = String(raw ?? '').trim();
  return calendarIso(text) ?? text;
}

// ISO date -> epoch seconds (UTC midnight), NaN-safe.
export function isoToEpoch(iso: string): number | null {
  const value = Date.parse(`${toIsoDate(iso)}T00:00:00Z`);
  return Number.isFinite(value) ? Math.floor(value / 1000) : null;
}

export function formatAumDisplay(value: number): string {
  return `$${(value / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M`;
}

// ---------------------------------------------------------------------------
// Source normalization: the issuer serves HTML; the rendering proxy (and the
// checked-in fixtures) serve the same page as markdown. Both are turned into
// one pipe-table text so a single parser covers them.
// ---------------------------------------------------------------------------

function stripHtmlTables(html: string): string {
  const rows: string[] = [];
  for (const table of String(html).matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    for (const row of table[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
      const cells = [...row[0].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)]
        .map((cell) => cleanText(cell[1].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')));
      if (cells.length) rows.push(`| ${cells.join(' | ')} |`);
    }
    rows.push('');
  }
  return rows.join('\n');
}

export function normalizeSource(text: string): string {
  let source = String(text ?? '');
  if (/<(table|tr|td|th)\b/i.test(source)) {
    const tables = stripHtmlTables(source);
    source = source
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<table\b[\s\S]*?<\/table>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|section)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
    source = `${source}\n${tables}`;
  }
  return source
    .split('\n')
    // Rendering proxies prefix their payload with a short banner.
    .map((line) => line.replace(/^\s*(Title|URL Source|Markdown Content|Published Time):.*$/i, ''))
    .join('\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\\\|/g, '|');
}

export function sourceLines(text: string): string[] {
  return normalizeSource(text)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '' && line !== '|' && !/^\|\s*\|$/.test(line));
}

function tableCells(line: string): string[] {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cleanText(cell));
}

function isSeparatorRow(line: string): boolean {
  return /^\|(\s*:?-{2,}:?\s*\|)+$/.test(line.replace(/\s+/g, ''));
}

// ---------------------------------------------------------------------------
// Updater configuration (environment variables, sibling-style)
// ---------------------------------------------------------------------------

type Range = { min?: number; max?: number };
type ReturnPeriod = 'YTD' | '1Y' | '3Y' | '5Y' | '10Y';
const RETURN_PERIODS: readonly ReturnPeriod[] = ['YTD', '1Y', '3Y', '5Y', '10Y'];
type RangeMap = Partial<Record<ReturnPeriod, Range>>;

export type UpdaterConfig = {
  concurrency: number;
  requestSleep: number;
  maxFetches: number;
  holdingsPageSize: number;
  historyPageSize: number;
  storeRawDownloads: boolean;
  maxRetries: number;
  tickers: string[];
  historyRange: string;
  catalogUrl: string;
  secUa: string;
  skipYahoo: boolean;
  skipIssuer: boolean;
  edgarFallback: boolean;
  aumRange?: Range & { source?: string };
  terRange?: Range;
  dividendYieldRange?: Range;
  secYieldRange?: Range;
  performanceRanges: RangeMap;
  totalReturnRanges: RangeMap;
};

const AUM_PRESET_BOUNDS = {
  nano: { min: 0, max: 10_000_000 },
  micro: { min: 10_000_000, max: 300_000_000 },
  small: { min: 300_000_000, max: 2_000_000_000 },
  mid: { min: 2_000_000_000, max: 10_000_000_000 },
  large: { min: 10_000_000_000, max: undefined },
} as const;
type AumPreset = keyof typeof AUM_PRESET_BOUNDS;

const AMOUNT_SUFFIXES: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

// Resolved controls always use the canonical UPPER_CASE names (see
// resolveControls); a blank value means "use the built-in default".
function controlValue(env: Record<string, string | undefined>, name: string): string {
  return String(env[name] ?? '').trim();
}

function parseInteger(raw: string, name: string, min: number, fallback: number): number {
  if (raw === '') return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min) throw new Error(`${name}: expected integer >= ${min}`);
  return value;
}

function parseNonNegativeFloat(raw: string, name: string, fallback: number): number {
  if (raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name}: expected nonnegative seconds`);
  return value;
}

function parseBoolean(raw: string, name: string, fallback: boolean): boolean {
  const text = raw.trim().toLowerCase();
  if (text === '') return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  throw new Error(`${name}: expected boolean`);
}

// Strict "min:max" ranges (same parser and errors as the sibling repos).
export function parseRange(raw: string, label: string): Range | undefined {
  const text = String(raw ?? '').trim();
  if (text === '' || text === ':') return undefined;
  if (!text.includes(':')) {
    throw new Error(`${label}: "${text}" must use the "min:max" range syntax (a colon is required)`);
  }
  if (text.split(':').length !== 2) throw new Error(`${label}: "${text}" must contain exactly one colon (min:max)`);
  const [rawMin, rawMax] = text.split(':');
  const parseBound = (bound: string): number | undefined => {
    const cleaned = bound.trim().replace(/%$/, '').replace(/[$,]/g, '');
    if (cleaned === '') return undefined;
    const value = Number(cleaned);
    if (!Number.isFinite(value)) throw new Error(`${label}: "${bound.trim()}" is not a number`);
    return value;
  };
  const min = parseBound(rawMin);
  const max = parseBound(rawMax);
  if (min === undefined && max === undefined) return undefined;
  if (min !== undefined && max !== undefined && min > max) {
    throw new Error(`${label}: min (${min}) must not exceed max (${max})`);
  }
  return { min, max };
}

function parseAumBound(bound: string): number | undefined {
  const cleaned = bound.trim().replace(/[$,]/g, '');
  if (cleaned === '') return undefined;
  const suffixMatch = /^(\d+(?:\.\d+)?|\.\d+)([KMBT])$/i.exec(cleaned);
  const value = suffixMatch ? Number(suffixMatch[1]) * (AMOUNT_SUFFIXES[suffixMatch[2].toUpperCase()] ?? 1) : Number(cleaned);
  if (!Number.isFinite(value) || value < 0) throw new Error(`AUM: invalid bound "${bound.trim()}" (use a number with an optional K/M/B/T suffix)`);
  return value;
}

export function parseAumRange(raw: string): (Range & { source?: string }) | undefined {
  const text = String(raw ?? '').trim();
  if (text === '' || text === ':') return undefined;
  const lower = text.toLowerCase();
  for (const preset of Object.keys(AUM_PRESET_BOUNDS) as AumPreset[]) {
    if (lower === preset) return { ...AUM_PRESET_BOUNDS[preset] } as Range & { source?: string };
  }
  if (!text.includes(':')) {
    throw new Error(`AUM: "${text}" must use the "min:max" range syntax (a colon is required)`);
  }
  if (text.split(':').length !== 2) throw new Error(`AUM: "${text}" must contain exactly one colon (min:max)`);
  const [rawMin, rawMax] = text.split(':');
  const min = parseAumBound(rawMin);
  const max = parseAumBound(rawMax);
  if (min === undefined && max === undefined) return undefined;
  if (min !== undefined && max !== undefined && min > max) {
    throw new Error(`AUM: min (${min}) must not exceed max (${max})`);
  }
  return { min, max };
}

function parseRanges(env: Record<string, string | undefined>, prefix: 'PERFORMANCE' | 'TOTAL_RETURN'): RangeMap {
  const ranges: RangeMap = {};
  for (const period of RETURN_PERIODS) {
    const parsed = parseRange(controlValue(env, `${prefix}_${period}`), `${prefix}_${period}`);
    if (parsed) ranges[period] = parsed;
  }
  return ranges;
}

export function readConfig(env: Record<string, string | undefined> = {}): UpdaterConfig {
  const historyRange = controlValue(env, 'HISTORY_RANGE') || 'max';
  if (!/^(max|[1-9]\d*y)$/i.test(historyRange)) throw new Error('HISTORY_RANGE: use max or Ny');
  return {
    concurrency: parseInteger(controlValue(env, 'CONCURRENCY'), 'CONCURRENCY', 1, CONCURRENCY_FALLBACK),
    requestSleep: parseNonNegativeFloat(controlValue(env, 'REQUEST_SLEEP'), 'REQUEST_SLEEP', REQUEST_SLEEP_FALLBACK),
    maxFetches: parseInteger(controlValue(env, 'MAX_FETCHES'), 'MAX_FETCHES', 0, 0),
    holdingsPageSize: parseInteger(controlValue(env, 'HOLDINGS_PAGE_SIZE'), 'HOLDINGS_PAGE_SIZE', 1, HOLDINGS_PAGE_SIZE_FALLBACK),
    historyPageSize: parseInteger(controlValue(env, 'HISTORY_PAGE_SIZE'), 'HISTORY_PAGE_SIZE', 1, HISTORY_PAGE_SIZE_FALLBACK),
    storeRawDownloads: parseBoolean(controlValue(env, 'STORE_RAW_DOWNLOADS'), 'STORE_RAW_DOWNLOADS', false),
    maxRetries: parseInteger(controlValue(env, 'MAX_RETRIES'), 'MAX_RETRIES', 1, MAX_RETRIES_FALLBACK),
    tickers: controlValue(env, 'TICKERS')
      .split(/[\s,;]+/)
      .map(sanitizeTicker)
      .filter(Boolean),
    historyRange,
    catalogUrl: controlValue(env, 'CATALOG_URL') || ISSUER_CATALOG,
    secUa: controlValue(env, 'SEC_UA') || SEC_UA_DEFAULT,
    skipYahoo: parseBoolean(controlValue(env, 'SKIP_YAHOO'), 'SKIP_YAHOO', false),
    skipIssuer: parseBoolean(controlValue(env, 'SKIP_ISSUER'), 'SKIP_ISSUER', false),
    edgarFallback: parseBoolean(controlValue(env, 'EDGAR_FALLBACK'), 'EDGAR_FALLBACK', true),
    aumRange: parseAumRange(controlValue(env, 'AUM')),
    terRange: parseRange(controlValue(env, 'TER'), 'TER'),
    dividendYieldRange: parseRange(controlValue(env, 'DIVIDEND_YIELD'), 'DIVIDEND_YIELD'),
    secYieldRange: parseRange(controlValue(env, 'SEC_YIELD'), 'SEC_YIELD'),
    performanceRanges: parseRanges(env, 'PERFORMANCE'),
    totalReturnRanges: parseRanges(env, 'TOTAL_RETURN'),
  };
}

const USAGE = `Parametric ETF static data updater (Bun, no dependencies).
Usage: ./scripts/update-data.ts [-h|--help]   (or: bun scripts/update-data.ts)
Every control is an UPPER_CASE environment variable. Precedence (later wins):
  scripts/update-data.config.json < advanced JSON < nonblank workflow inputs < environment < protected Actions variable
An explicitly set environment variable wins even when empty (it clears the control).
Invalid values are rejected before any request or write; nothing is silently ignored.
PARAMETRIC_<NAME> takes precedence over <NAME>; PARAMETRIC_LIMIT (MAX_FETCHES) and HISTORICAL_PAGE_SIZE (HISTORY_PAGE_SIZE) are accepted aliases.
Controls (defaults live in the config file):
  MAX_FETCHES=0          batch size; 0 or empty is a full pass (cursor in api/parametric/update-state.json)
  REQUEST_SLEEP=3        seconds between direct request starts within each worker (each worker has its own lane)
  CONCURRENCY=1          parallel fund workers (integer >= 1); r.jina.ai proxy requests share one global gate (min ${PROXY_SLEEP_SECONDS}s between starts)
  TICKERS="PAPI PHEQ"    exact fund allowlist, applied before MAX_FETCHES
  AUM                    min:max or nano/micro/small/mid/large (bounds accept K/M/B/T)
  TER DIVIDEND_YIELD SEC_YIELD   min:max percentages
  ${RETURN_PERIODS.map((p) => `PERFORMANCE_${p}`).join(' ')}   min:max (annualized for 3Y+)
  ${RETURN_PERIODS.map((p) => `TOTAL_RETURN_${p}`).join(' ')}   min:max (cumulative)
  HOLDINGS_PAGE_SIZE=250 HISTORY_PAGE_SIZE=1000   rows per generated JSON page (integers >= 1)
  MAX_RETRIES=2          retries after the initial request (integer >= 1); proxy requests retry at most once
  HISTORY_RANGE=max      Yahoo history window: max or Ny (for example 5y)
  SEC_UA                 SEC User-Agent with a contact (default declared in the config file, redacted in logs)
  SKIP_YAHOO SKIP_ISSUER EDGAR_FALLBACK STORE_RAW_DOWNLOADS VERBOSE   booleans (1/0, true/false, yes/no, on/off)
  USE_SYSTEM_CA=auto     TLS trust store: auto restarts once with Bun's --use-system-ca on an untrusted-certificate error, true always uses the system CA store, false never restarts
  CATALOG_URL            catalog mirror URL (default: ${ISSUER_CATALOG})
Examples:
  TICKERS="PAPI PHEQ PEPS" VERBOSE=1 ./scripts/update-data.ts
  CONCURRENCY=15 REQUEST_SLEEP=3 ./scripts/update-data.ts
  MAX_FETCHES=3 AUM="100M:" TER=":0.5" ./scripts/update-data.ts
Official holdings come from eatonvance.com when it publishes a full sheet and from SEC EDGAR Form N-PORT-P
otherwise; NAV history and dividends come from the Yahoo Finance chart API. Full passes clear update-state.json.
No provider data is deleted on fetch failure.
`;

// Only a lane's timer reservations are queued, never network operations. Each
// worker keeps its lane across funds, retries, redirects and fallback providers.
export function createRequestQueue() {
  let tail: Promise<void> = Promise.resolve();
  return function enqueueRequest<T>(work: () => Promise<T>): Promise<T> {
    const result = tail.then(work);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}
type RequestClock = { now: () => number; sleep: (ms: number) => Promise<void> };
export function createRequestGate(
  delayMs: number,
  clock: RequestClock = { now: () => performance.now(), sleep },
): () => Promise<void> {
  const enqueue = createRequestQueue();
  let nextStart = 0;
  return () => enqueue(async () => {
    // Recheck early timer wakeups; after a late wakeup do not "catch up" in a
    // burst. Reserve this SAME lane from the actual wakeup, not the old deadline.
    let wait: number;
    while ((wait = nextStart - clock.now()) > 0) await clock.sleep(wait);
    nextStart = clock.now() + Math.max(0, delayMs);
  });
}
const requestLane = new AsyncLocalStorage<() => Promise<void>>();
let discoveryGate = createRequestGate(REQUEST_SLEEP_FALLBACK * 1000);
export function withRequestLane<T>(delayMs: number, work: () => Promise<T>): Promise<T> {
  return requestLane.run(createRequestGate(delayMs), work);
}
// Global gate for the rate-limited r.jina.ai proxy: proxy request starts are at
// least PROXY_SLEEP_SECONDS apart for the whole process, whatever REQUEST_SLEEP
// and CONCURRENCY say. Direct requests keep using their per-worker lanes.
let proxyGate = createRequestGate(PROXY_SLEEP_SECONDS * 1000);
export function configureProxyGate(delayMs: number): void {
  proxyGate = createRequestGate(delayMs);
}
function isProxyUrl(url: string): boolean {
  return url.startsWith(`${RENDER_PROXY}/`);
}
async function paceRequests(url: string): Promise<void> {
  await (isProxyUrl(url) ? proxyGate : (requestLane.getStore() ?? discoveryGate))();
}
// Run-level health: how many requests were answered with a success, and whether the issuer was
// found unreachable (direct and through the proxy). A run that refreshed nothing but saw at least
// one source answer must not turn the weekly job red forever; exit 1 is for "nothing answered".
let answeredRequests = 0;
let issuerUnreachable = false;
// One-off source notices print directly before the fund list and VERBOSE-only once fund lines are printing.
let fundListStarted = false;
function sourceNotice(message: string): void { if (fundListStarted) outputNote(message); else console.warn(message); }
export function runHealth(): { answered: number; issuerUnreachable: boolean } {
  return { answered: answeredRequests, issuerUnreachable };
}
/** Test hook: forgets the one-way switches and counters of this process. */
export function resetRunState(): void {
  answeredRequests = 0;
  issuerUnreachable = false;
  issuerDirectDenials = 0;
  issuerProxyOnly = false;
  secDirectDenials = 0;
  secProxyOnly = false;
  secState = { funds: null, names: null, texts: new Map(), reader: new Map() };
  cikByTicker.clear();
}
class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** `fetchWithRetry` already prefixes its messages with the fetch label, so a
    caller that prints its own tag must not repeat the label. */
function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^\[[^\]]*\] ?/, '');
}

export async function fetchWithRetry(
  url: string,
  label: string,
  init: RequestInit = {},
  maxRetries = 2,
): Promise<Response> {
  let lastError: unknown = null;
  // Retries must not multiply traffic to the rate-limited proxy
  if (isProxyUrl(url)) maxRetries = Math.min(maxRetries, 1);
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await paceRequests(url);
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(45000), ...init });
      if (response.ok) { answeredRequests += 1; return response; }
      const retryable = [403, 408, 425, 429].includes(response.status) || response.status >= 500;
      if (!retryable) throw new HttpError(`${label}: HTTP ${response.status} ${response.statusText}`, response.status, false);
      lastError = new HttpError(`${label}: HTTP ${response.status} (attempt ${attempt + 1} of ${maxRetries + 1})`, response.status, true);
    } catch (error) {
      if (error instanceof HttpError && !error.retryable) throw error;
      lastError = error instanceof HttpError ? error : new Error(`${label}: network error (${String(error)})`);
    }
    if (attempt < maxRetries) await sleep(Math.min(30_000, 1_000 * 2 ** attempt) + 250);
  }
  throw lastError instanceof Error ? lastError : new Error(`${label}: failed`);
}

function yahooHeaders(): Record<string, string> {
  return { 'User-Agent': YAHOO_BROWSER_UA, Accept: 'application/json' };
}

function secHeaders(config: UpdaterConfig): Record<string, string> {
  return { 'User-Agent': config.secUa, Accept: 'application/json,*/*' };
}

// The rendering proxy converts XML documents to markdown by default; HTML mode
// returns the raw document (verified on a runner on 2026-10-02, including a
// 1.2 MB N-PORT-P filing with 955 positions, untruncated).
function secProxyHeaders(config: UpdaterConfig, kind: 'json' | 'xml' | 'text'): Record<string, string> {
  return { ...secHeaders(config), ...(kind === 'xml' ? { 'X-Return-Format': 'html' } : {}) };
}

// The issuer's Akamai rule answers 403 to browser-looking and unknown agents and 200 to plain HTTP-library agents
// (probed 2026-10-03). Decision of the owner (2026-10-03): issuer reads present a plain curl client string. It is a
// client string only (no cookies, no tokens, no evasion beyond it). One constant, used for the issuer (eatonvance.com
// imwebdata JSON and the catalog) only: SEC reads keep the contact agent, Yahoo keeps its own.
export const ISSUER_UA = 'curl/8.7.1';
function issuerHeaders(): Record<string, string> {
  return { 'User-Agent': ISSUER_UA, Accept: 'application/json,text/html;q=0.9,*/*;q=0.8' };
}

// The issuer (Akamai bot manager) answers 403 to a plain fetch. After a small
// number of consecutive denials the rest of the run is routed through the
// read-only rendering proxy, and one always-visible notice is printed.
let issuerDirectDenials = 0;
let issuerProxyOnly = false;
function issuerUrl(url: string): string {
  return `${RENDER_PROXY}/https://${url.replace(/^https?:\/\//, '')}`;
}
export function stripProxyPreamble(text: string): string {
  const marker = text.indexOf('Markdown Content:');
  return marker >= 0 ? text.slice(marker + 'Markdown Content:'.length).replace(/^\s+/, '') : text;
}

// Best-effort source: direct first, the rendering proxy only after a denial (global gate, one retry),
// and once both are denied the issuer is skipped for the rest of the run instead of being hammered.
// `markUnreachable` is false for the catalog's extra proxy attempt: the direct request was answered (the page is only rendered
// client side), so a denied proxy says nothing about the direct JSON service, which still has to be tried.
async function fetchIssuerViaProxy(url: string, label: string, config: UpdaterConfig, markUnreachable = true): Promise<string> {
  try {
    const response = await fetchWithRetry(issuerUrl(url), `${label} (proxy)`, { headers: issuerHeaders() }, config.maxRetries);
    return stripProxyPreamble(await response.text());
  } catch (error) {
    if (markUnreachable && error instanceof HttpError && [403, 429].includes(error.status) && !issuerUnreachable) {
      issuerUnreachable = true;
      sourceNotice(`[ issuer   ] unreachable from here (direct and proxy denied) - the issuer is skipped for the rest of this run; SEC EDGAR and Yahoo carry the feed`);
    }
    throw error;
  }
}

async function fetchIssuerText(url: string, label: string, config: UpdaterConfig): Promise<string> {
  if (issuerUnreachable) throw new Error(`${label}: issuer unreachable earlier in this run`);
  if (issuerProxyOnly) return fetchIssuerViaProxy(url, label, config);
  try {
    const response = await fetchWithRetry(url, label, { headers: issuerHeaders() }, 0);
    issuerDirectDenials = 0;
    return await response.text();
  } catch (error) {
    const denied = error instanceof HttpError && [403, 429].includes(error.status);
    if (!denied) throw error;
    issuerDirectDenials += 1;
    if (issuerDirectDenials < ISSUER_DENIAL_LIMIT) throw error;
    issuerProxyOnly = true;
    sourceNotice(`[ issuer   ] ${label}: ${errorMessage(error)} - switching to the read-only rendering proxy for the rest of this run`);
    return fetchIssuerViaProxy(url, label, config);
  }
}

// SEC EDGAR and its data host answer 403 to datacenter IPs (observed on the
// GitHub runners on 2026-10-02; the probe run reached the same files through
// the read-only rendering proxy). This fallback has its own one-way switch and
// its own denial counter, so the issuer path keeps its own state.
let secDirectDenials = 0;
let secProxyOnly = false;
const SEC_DENIAL_LIMIT = 1;
function secProxyUrl(url: string): string {
  return `${RENDER_PROXY}/https://${url.replace(/^https?:\/\//, '')}`;
}

// The rendering proxy prefixes its answer with a short plain-text preamble and
// can wrap the document. The payload is recovered from the first opening token
// to the last closing one, so a wrapped JSON/XML document still parses.
export function proxyPayload(text: string, kind: 'json' | 'xml' | 'text'): string {
  const marker = text.indexOf('Markdown Content:');
  const body = (marker >= 0 ? text.slice(marker + 'Markdown Content:'.length) : text).trimStart();
  if (kind === 'text') return body;
  const start = body.search(kind === 'json' ? /[[{]/ : /</);
  const end = kind === 'json' ? Math.max(body.lastIndexOf('}'), body.lastIndexOf(']')) : body.lastIndexOf('>');
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

// Exported for the offline proxy-fallback test.
export async function fetchSecText(url: string, label: string, config: UpdaterConfig, kind: 'json' | 'xml' | 'text' = 'text'): Promise<string> {
  if (secProxyOnly) {
    const response = await fetchWithRetry(secProxyUrl(url), `${label} (proxy)`, { headers: secProxyHeaders(config, kind) }, config.maxRetries);
    return proxyPayload(await response.text(), kind);
  }
  try {
    const response = await fetchWithRetry(url, label, { headers: secHeaders(config) }, 0);
    secDirectDenials = 0;
    return await response.text();
  } catch (error) {
    const denied = error instanceof HttpError && [403, 429].includes(error.status);
    if (!denied) throw error;
    secDirectDenials += 1;
    if (secDirectDenials < SEC_DENIAL_LIMIT) throw error;
    secProxyOnly = true;
    sourceNotice(`[ edgar    ] ${errorMessage(error)} — switching to the read-only rendering proxy for the rest of this run`);
    const response = await fetchWithRetry(secProxyUrl(url), `${label} (proxy)`, { headers: secProxyHeaders(config, kind) }, config.maxRetries);
    return proxyPayload(await response.text(), kind);
  }
}

// Exported for the offline proxy-fallback test.
export async function fetchSecJson(url: string, label: string, config: UpdaterConfig): Promise<JsonRecord> {
  const text = await fetchSecText(url, label, config, 'json');
  try {
    return JSON.parse(proxyPayload(text, 'json')) as JsonRecord;
  } catch {
    throw new Error(`${label}: response is not valid JSON`);
  }
}

async function fetchText(url: string, label: string, headers: Record<string, string>, config: UpdaterConfig): Promise<string> {
  const response = await fetchWithRetry(url, label, { headers }, config.maxRetries);
  return await response.text();
}

async function fetchJson(url: string, label: string, headers: Record<string, string>, config: UpdaterConfig): Promise<JsonRecord> {
  const text = await fetchText(url, label, headers, config);
  try {
    return JSON.parse(text) as JsonRecord;
  } catch {
    throw new Error(`${label}: response is not valid JSON`);
  }
}

export type CatalogReturns = {
  ytd: number | null;
  yr1: number | null;
  yr3: number | null;
  yr5: number | null;
  yr10: number | null;
  sinceInception: number | null;
};

// Cumulative multi-year figures as published (the exact inverse of the
// annualized ones is only an approximation once rounding gets involved).
export type CumulativeReturns = { yr1: number | null; yr3: number | null; yr5: number | null; yr10: number | null; sinceInception: number | null };

export type OfficialReturns = CatalogReturns & {
  asOfDate: string | null;
  mo1: number | null;
  mo3: number | null;
  qtd?: number | null;
};

export type CatalogFund = {
  ticker: string;
  name: string;
  category: string;
  categoryPath: string;
  inception: string | null;
  exchange: string;
  cusip: string;
  isin: string;
  benchmark: string;
  secYieldDate?: string | null;
  frequencyCode?: string;
  frequency?: string;
  ter: number | null;
  nav: number | null;
  close: number | null;
  premiumDiscount: number | null;
  premiumDiscountAmount: number | null;
  netAssets: number | null;
  dividendYield: number | null;
  secYield: number | null;
  asOfDate: string | null;
  returns: CatalogReturns;
  returnsAsOfDate: string | null;
  mo1: number | null;
  quarterEnd: CatalogReturns;
  quarterEndAsOfDate: string | null;
  fundPage: string;
  trustCik: string | null;
  source: 'parametric' | 'previous index' | 'seed';
};

const EMPTY_RETURNS: CatalogReturns = { ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null };
const EMPTY_CUMULATIVE: CumulativeReturns = { yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null };

export const HOLDINGS_HEADERS = ['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'Asset Category'];
/** Funds whose holdings legitimately fail a holdingsGuard check (geared, futures, look-through, top-N lists): ticker, or '*' for every fund -> relaxed checks. */
const HOLDINGS_GUARD_RELAX: Record<string, string[]> = {};
/** Funds the issuer closed, each confirmed from an SEC filing or the issuer notice (`source`): never fetched or guarded, last published data kept, index row marked closed. */
export const CLOSED_FUNDS: ClosedFund[] = [];
export const NO_DATA_BASIS = 'no data published for this fund yet; the next successful update fills it';
export const HISTORY_HEADERS = ['Date', 'NAV', 'Market Price', 'Premium/Discount'];
export const YAHOO_HISTORY_HEADERS = ['Date', 'Close', 'Adj Close', 'Volume'];

export type ParsedHoldings = {
  asOfDate: string | null;
  container?: string;
  headers: string[];
  rows: JsonRecord[];
};

// Shared cadence codes. The issuer adapter maps its human-readable schedule
// into these codes; they are not literal Eaton Vance API values.
export const DIVIDEND_FREQUENCY_CODES: Record<string, { frequency: string; paymentsPerYear: number | null }> = {
  M: { frequency: 'Monthly', paymentsPerYear: 12 },
  Q: { frequency: 'Quarterly', paymentsPerYear: 4 },
  B: { frequency: 'Bi-Monthly', paymentsPerYear: 6 },
  S: { frequency: 'Semi-annually', paymentsPerYear: 2 },
  A: { frequency: 'Annually', paymentsPerYear: 1 },
};

export function issuerFrequency(raw: unknown): { frequency: string; paymentsPerYear: number | null; code: string } {
  const text = cleanText(raw).toLowerCase();
  if (text === 'monthly') return { frequency: 'Monthly', paymentsPerYear: 12, code: 'M' };
  if (text === 'quarterly') return { frequency: 'Quarterly', paymentsPerYear: 4, code: 'Q' };
  if (text === 'bi-monthly' || text === 'bimonthly') return { frequency: 'Bi-Monthly', paymentsPerYear: 6, code: 'B' };
  if (text === 'semi-annually' || text === 'semiannually') return { frequency: 'Semi-annually', paymentsPerYear: 2, code: 'S' };
  if (text === 'annually' || text === 'annual') return { frequency: 'Annually', paymentsPerYear: 1, code: 'A' };
  return { frequency: text ? 'Unknown' : '—', paymentsPerYear: null, code: '' };
}

// Security types whose "securityTicker" is an exchange symbol. Bonds, money
// market paper, repos, currencies and derivatives carry issuer codes instead
// ("T", "COF", "SPX"), which would collide across funds in the Watchlist.
const EQUITY_LIKE_SECURITY_TYPE = /(COMMON|PREFERRED|STOCK|REIT|ADR|GDR|EQUITY|SHARE|UNIT|FUND|ETF|TRUST|MONEY MARKET|WARRANT|RIGHT|MLP|PARTNERSHIP)/i;
const NON_EQUITY_SECURITY_TYPE = /(FUTURE|OPTION|SWAP|FORWARD|NOTE|BOND|BILL|PAPER|REPURCHASE|REPO|CURRENC|SPOT|LINKED|DEBT|LOAN|MORTGAGE|ASSET BACKED|CERTIFICATE OF DEPOSIT|TIME DEPOSIT|CASH|TREASUR|MUNICIPAL|SOVEREIGN|AGENCY|\bCMO\b|\bABS\b|\bMBS\b|\bTBA\b|\bCDO\b|\bCLO\b|WHEN ISSUED)/i;

export function holdingTickerFor(securityType: unknown, rawTicker: unknown): string {
  const ticker = cleanHoldingTicker(rawTicker);
  if (!ticker) return '';
  const type = cleanText(securityType);
  if (!type) return ticker;
  if (NON_EQUITY_SECURITY_TYPE.test(type)) return '';
  return EQUITY_LIKE_SECURITY_TYPE.test(type) ? ticker : '';
}

export type ProductData = {
  ticker: string;
  name: string;
  cusip: string;
  isin: string;
  exchange: string;
  assetClass: string;
  benchmark: string;
  inception: string | null;
  grossExpense: number | null;
  netExpense: number | null;
  nav: number | null;
  navDate: string | null;
  marketPrice: number | null;
  marketPriceDate: string | null;
  premiumDiscountAmount: number | null;
  premiumDiscountPercent?: number | null;
  sharesOutstanding?: number | null;
  netAssets: number | null;
  netAssetsDate: string | null;
  netAssetsKind?: string;
  bidAskSpread: number | null;
  dividendYield: number | null;
  dividendYieldDate: string | null;
  dividendYieldKind: string;
  secYield: number | null;
  secYieldDate: string | null;
  secYieldKind: string;
  frequencyCode: string;
  latestDividend: { exDate: string; amount: number; payDate: string; recordDate: string } | null;
  monthEnd: OfficialReturns;
  quarterEnd: OfficialReturns;
  dividends: Array<{ epoch: number; amount: number; exDate: string; payDate: string; recordDate: string }>;
  holdings: ParsedHoldings | null;
  /** Which of the five issuer files came back structurally complete in this run (a partial answer is a failed read of that section). */
  sections?: Record<IssuerSection, boolean>;
  /** Sections restored from the previously published official data because their read failed (see retainIssuerSections). */
  kept?: IssuerSection[];
};
export type IssuerSection = 'detail' | 'pricing' | 'returns' | 'yields' | 'distribution';

// adjCloseRaw: Yahoo's unrounded value, only used to tell float noise from a real change (never persisted).
export type ChartDay = { date: string; close: number; adjClose: number; volume: number; adjCloseRaw?: number };
export type ParsedChart = {
  exchangeName: string;
  longName: string;
  regularMarketPrice: number | null;
  regularMarketTime: number | null;
  firstTradeDate: number | null;
  days: ChartDay[];
  dividends: Array<{ epoch: number; amount: number }>;
};

/** Official monthly NAV total returns (percent) of the three months of an N-PORT report quarter, oldest first, per share class. */
export type NportMonthlyReturns = Array<{ classId: string; months: Array<number | null> }>;
/** One own N-PORT-P filing of the fund: the shared reader's parse plus the brand's monthly returns and designated index. */
export type NportOwnFiling = { filing: NportFiling; repPdDate: string; monthlyReturns: NportMonthlyReturns; designatedIndex: string };

export type HistoryPoint = { date: string; nav: number | null; marketPrice: number | null; premiumDiscount: number | null };
export type OfficialDividend = { epoch: number; amount: number; exDate: string; payDate: string; recordDate: string; type: string };

export function navTotalReturnDays(points: HistoryPoint[], dividends: OfficialDividend[]): ChartDay[] {
  const navPoints = points.filter((point) => point.nav !== null && point.nav > 0);
  if (!navPoints.length) return [];
  const sortedDividends = [...dividends].sort((a, b) => a.epoch - b.epoch);
  let factor = 1;
  let next = 0;
  const days: ChartDay[] = [];
  for (let i = 0; i < navPoints.length; i++) {
    const point = navPoints[i];
    while (next < sortedDividends.length && sortedDividends[next].exDate <= point.date) {
      const dividend = sortedDividends[next];
      if (point.nav && point.nav > 0 && dividend.amount > 0) factor *= 1 + dividend.amount / point.nav;
      next += 1;
    }
    days.push({
      date: point.date,
      close: round(point.nav as number, 6),
      adjClose: round((point.nav as number) * factor, 6),
      volume: 0,
    });
  }
  return days;
}

const HOLDING_NAME_SUFFIXES = new Set([
  'STOCK', 'COMMON', 'PREFERRED', 'PFD', 'SHARES', 'ORDINARY', 'DEPOSITARY', 'ADS', 'ADR',
  'INC', 'INCORPORATED', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'LIMITED', 'PLC',
  'PUBLIC', 'SA', 'SAS', 'SARL', 'SRL', 'SL', 'KG', 'AG', 'BA', 'BV', 'NV', 'OY', 'SE',
  'AS', 'AB', 'AD', 'KK', 'KABUSHIKI', 'KAISHA', 'PTY', 'PT', 'SFC', 'ANONIMA', 'GMBH',
  'HOLDINGS', 'HLDGS', 'DEL', 'NEW', 'DELISTED', 'REPR', 'GROUP', 'TR', 'TRUST', 'NOTE',
  'NL', 'SPA', 'LP', 'LC', 'LLC', 'CAP', 'STK', 'SHS',
  'NOTES', 'BOND', 'BONDS', 'SER', 'SERIES',
]);
const HOLDING_NAME_PHRASES = new Set([
  'COMMON STOCK', 'PREFERRED STOCK', 'DEPOSITARY SHARES', 'AMERICAN DEPOSITARY SHARES',
  'ORDINARY SHARES', 'LIABILITY CO', 'S A', 'N V', 'B V', 'PRIVATE LTD', 'PUBLIC LTD',
]);
// Words that carry no identity at all: dropped wherever they sit at the edge
// of a filed name, so "The Coca-Cola Co" and "Coca CO" meet.
const HOLDING_NAME_FILLERS = new Set([
  'THE', 'OF', 'AND', 'FOR', 'DE', 'LA', 'LE', 'VAN', 'VON', 'DER', 'DEN', 'DI', 'Y',
  'E', 'DU', 'DA', 'LOS', 'LAS', 'EL', 'AL', 'DEL', 'NPV', 'PAR', 'VAL', 'USD', 'EUR',
  'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'HKD', 'CNY', 'SEK', 'NOK', 'NZD', 'MXN', 'INR',
]);

// Trailing share-class / security-type designations. The class letter is kept
// and canonicalized ("... Class C Capital Stock" -> "... Cl C") rather than
// dropped, so GOOG vs GOOGL — like BF/A vs BF/B — never collide.
const SHARE_CLASS_RE = /(?:\s+(?:CLASS|CL))\s+([A-Z])\b\s*$/;
// Words that only describe the security, never the issuer; safe to peel off the
// end of a filed name (and, once a share class is known, from behind it).
const SECURITY_TYPE_WORDS = new Set([
  'STOCK', 'STK', 'SHARES', 'SHS', 'SH', 'SHARE', 'CAPITAL', 'CAP', 'COMMON', 'ORDINARY',
  'GENERAL', 'VOTING', 'NON', 'NONVOTING', 'NVOTING', 'CONVERTIBLE', 'DEPOSITARY', 'PAID',
  'SUBORDINATED', 'NOTES', 'NOTE', 'SER', 'SERIES', 'LIABILITY', 'NEW', 'REP', 'REPR',
]);

export function normalizeHoldingName(raw: unknown): string {
  const text = String(raw ?? '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
  let tokens = text.split(' ').filter(Boolean);
  let classLetter = '';
  let changed = true;
  while (changed && tokens.length > 1) {
    changed = false;
    const withClass = tokens.join(' ').match(SHARE_CLASS_RE);
    if (withClass) {
      classLetter = withClass[1];
      tokens = tokens.slice(0, tokens.length - 2); // drop "Class C" (or "Cl C")
      changed = true;
    }
    const last = tokens[tokens.length - 1];
    if (SECURITY_TYPE_WORDS.has(last) && tokens.length > 1) {
      tokens.pop(); // "... Capital Stock" -> "... Capital"
      changed = true;
      continue;
    }
    if (tokens.length >= 2 && HOLDING_NAME_PHRASES.has(`${tokens[tokens.length - 2]} ${last}`)) {
      tokens = tokens.slice(0, -2);
      changed = true;
      continue;
    }
    if (HOLDING_NAME_SUFFIXES.has(last)) {
      tokens.pop();
      changed = true;
      continue;
    }
    while (tokens.length > 2 && HOLDING_NAME_FILLERS.has(tokens[tokens.length - 1])) {
      tokens.pop(); // keep peeling: a filler may hide the next legal-form suffix
      changed = true;
    }
  }
  while (tokens.length > 1 && HOLDING_NAME_FILLERS.has(tokens[0])) tokens.shift();
  const body = tokens.join(' ').trim();
  return classLetter ? `${body} CL ${classLetter}`.replace(/\s+/g, ' ').trim() : body;
}

export function normalizeHoldingNameCore(raw: unknown): string {
  return normalizeHoldingName(raw).replace(/ /g, '');
}

// Holding tickers keep their class-share markers (SCE^L, BF/A, BRK-B): they
// are the real exchange symbols, unlike fund tickers which sanitizeTicker
// upper-cases and strips everything but letters/digits.
const HOLDING_TICKER_PLACEHOLDERS = new Set(['', 'N/A', 'NA', 'NONE', 'NIL', 'NULL', '-', '--', '---', 'SEE FILE', 'VARIES']);

export function cleanHoldingTicker(raw: unknown): string {
  const symbol = String(raw ?? '').trim().toUpperCase();
  if (HOLDING_TICKER_PLACEHOLDERS.has(symbol)) return '';
  return /^[A-Z0-9][A-Z0-9.^/-]*$/.test(symbol) ? symbol : '';
}

export function yahooSearchUrl(name: string): string {
  return `${YAHOO_SEARCH_URL}?q=${encodeURIComponent(name)}&quotesCount=10&newsCount=0&enableFuzzyQuery=false`;
}

// Strict matcher for Yahoo search payloads: the quote's long name must
// normalize to the same name (or token-core) as the filed holding name. Only
// EQUITY/ETF quotes are accepted, and single/two-word holdings may additionally
// match by token containment (e.g. "BULLISH" -> "Bullish BLCM Inc").
export function pickSearchTicker(name: string, payload: JsonRecord): string | null {
  const matches: unknown[] = Array.isArray(payload?.quoteMatches) ? payload.quoteMatches : [];
  const norm = normalizeHoldingName(name);
  if (!norm) return null;
  const core = norm.replace(/ /g, '');
  const tokens = norm.split(' ');
  for (const match of matches) {
    if (!match || typeof match !== 'object') continue;
    const record = match as JsonRecord;
    const quoteType = String(record.quoteType || '').toUpperCase();
    if (quoteType !== 'EQUITY' && quoteType !== 'ETF') continue;
    const symbol = cleanHoldingTicker(record.symbol);
    if (!symbol) continue;
    const longName = String(record.longname || record.shortname || '');
    const candidate = normalizeHoldingName(longName);
    if (!candidate) continue;
    if (candidate === norm || candidate.replace(/ /g, '') === core) return symbol;
    if (tokens.length <= 2 && tokens.every((token) => candidate.includes(token))) return symbol;
  }
  return null;
}

// ---------------------------------------------------------------------------
// SEC EDGAR layer: the shared nport-reader block at the end of this file finds, reads and checks the fund's own N-PORT-P
// filing; this layer adds the SEC tables, the 497K list, the monthly NAV returns and the Parametric holdings sheet.
// ---------------------------------------------------------------------------

/** One EDGAR filing of a series Atom feed (the 497K list). */
export type EdgarFiling = { accession: string; filed: string; reportDate: string };

export function edgarSeriesFilingsUrl(seriesId: string, count = 10, form = '497K'): string {
  const params = new URLSearchParams({
    action: 'getcompany',
    CIK: String(seriesId || '').toUpperCase(),
    type: form,
    dateb: '',
    owner: 'include',
    count: String(count),
    output: 'atom',
  });
  return `${EDGAR_BROWSE_URL}?${params.toString()}`;
}

// browse-edgar's Atom feed for one series: its newest filings of one form (the 497K list), newest first.
export function parseEdgarAtomFilings(xml: string, formPrefix: string): EdgarFiling[] {
  const result: EdgarFiling[] = [];
  for (const entry of String(xml || '').matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    const body = entry[1];
    const form = tagValue(body, 'filing-type') || tagValue(body, 'type');
    if (form && !form.toUpperCase().startsWith(formPrefix)) continue;
    const accession = tagValue(body, 'accession-number') || tagValue(body, 'accession-nunber');
    if (!accession) continue;
    result.push({
      accession,
      filed: tagValue(body, 'filing-date'),
      reportDate: tagValue(body, 'period') || '',
    });
  }
  return result;
}

function tagValue(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return match ? cleanText(match[1]) : '';
}

/** The monthly NAV total returns of an N-PORT-P document (returnInfo, which the shared parser leaves out), per share class. */
export function parseNportMonthlyReturns(xml: string): NportMonthlyReturns {
  return Array.from(String(xml || '').matchAll(/<(?:[A-Za-z0-9_.-]+:)?monthlyTotReturn\b([^>]*)\/?>/gi), (match) => {
    const attr = (name: string): string => new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(match[1])?.[1] ?? '';
    return { classId: attr('classId').toUpperCase(), months: [attr('rtn1'), attr('rtn2'), attr('rtn3')].map((raw) => numberOrNull(raw)) };
  });
}

/** The fund's index as filed (fundInfo nameDesignatedIndex), '' when none. */
export function parseNportDesignatedIndex(xml: string): string {
  const match = /<(?:[A-Za-z0-9_.-]+:)?nameDesignatedIndex\b[^>]*>([\s\S]*?)<\//i.exec(String(xml || ''));
  return match ? cleanText(match[1]) : '';
}

/**
 * The Parametric holdings sheet of an N-PORT filing (HOLDINGS_HEADERS). A missing number stays empty (never 0), a missing
 * text is '-'; tickers come from nportTickers (U.S. equities only), identifiers are the position's own.
 */
export function nportHoldingsSheet(filing: NportFiling, tickers: ReadonlyArray<string>): JsonRecord[] {
  return filing.positions.map((position, index) => ({
    Name: position.name || '-',
    Ticker: tickers[index] || '-',
    Identifier: nportIdentifier(position) || '-',
    Weight: nportCell(position.weight),
    'Market Value': nportCell(position.value, 2),
    'Shares Held': nportCell(position.balance),
    'Asset Category': position.assetCat || '-',
  }));
}

/** The sum of a filing's position values (valUSD) to cents, null when it is 0: the stand-in for a filing without netAssets. */
export function nportTotalValue(filing: NportFiling): number | null {
  const total = filing.positions.reduce((sum, position) => sum + (position.value ?? 0), 0);
  return total ? round(total, 2) : null;
}

/**
 * Official quarter-end returns of one share class from SEC N-PORT-P filings: every filing carries the
 * NAV total return of each month of its quarter, so year-to-date and one-year figures are those monthly
 * returns compounded (a derived figure, rounded like the filed months). A horizon is null unless every
 * month of it is present in the filings.
 */
export type SecReturns = { asOfDate: string; mo1: number | null; qtd: number | null; ytd: number | null; yr1: number | null };
export function nportQuarterReturns(filings: Array<Pick<NportOwnFiling, 'repPdDate' | 'monthlyReturns'>>, classId = ''): SecReturns | null {
  const months = new Map<string, number>();
  let latest = '';
  for (const filing of filings) {
    const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(filing.repPdDate || '');
    if (!match) continue;
    const row = filing.monthlyReturns.find((item) => classId && item.classId === classId.toUpperCase()) ?? filing.monthlyReturns[0];
    if (!row) continue;
    if (filing.repPdDate > latest) latest = filing.repPdDate;
    const end = Number(match[1]) * 12 + Number(match[2]) - 1;
    row.months.forEach((value, index) => {
      if (value === null) return;
      const key = end - 2 + index;
      months.set(`${Math.floor(key / 12)}-${String((key % 12) + 1).padStart(2, '0')}`, value);
    });
  }
  const last = /^(\d{4})-(\d{2})-\d{2}$/.exec(latest);
  if (!last) return null;
  const endIndex = Number(last[1]) * 12 + Number(last[2]) - 1;
  const compound = (count: number): number | null => {
    let factor = 1;
    for (let back = 0; back < count; back++) {
      const key = endIndex - back;
      const value = months.get(`${Math.floor(key / 12)}-${String((key % 12) + 1).padStart(2, '0')}`);
      if (value === undefined) return null;
      factor *= 1 + value / 100;
    }
    return round((factor - 1) * 100, 2);
  };
  const lastKey = `${Math.floor(endIndex / 12)}-${String((endIndex % 12) + 1).padStart(2, '0')}`;
  const result = { asOfDate: latest, mo1: months.has(lastKey) ? months.get(lastKey)! : null, qtd: compound(3), ytd: compound(Number(last[2])), yr1: compound(12) };
  return result.mo1 === null && result.qtd === null ? null : result;
}

// Summary prospectus (Form 497K) facts: the fee table and the inception date. The document is XBRL-free
// HTML (or markdown through the proxy), so the figures are read from the flattened text.
export type ProspectusFacts = { documentDate: string | null; grossExpense: number | null; netExpense: number | null; inception: string | null };
export function htmlToPlain(html: string): string {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
    .replace(/[\u200a\u200b\u00a0|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function parseProspectusFacts(html: string, ticker: string): ProspectusFacts | null {
  const text = htmlToPlain(html);
  if (!new RegExp(`\\b${ticker.replace(/[^A-Z0-9]/gi, '')}\\b`).test(text.slice(0, 4000))) return null;
  const start = text.search(/Annual Fund Operating Expenses/i);
  const section = start >= 0 ? text.slice(start, start + 3000) : '';
  const percent = (value: string | undefined): number | null => {
    const number = numberOrNull(value ?? '');
    return number !== null && number > 0 && number <= 10 ? number : null;
  };
  const gross = percent(/Total Annual (?:Fund )?Operating Expenses(?:\s+\d{1,2})?\s+(\d+(?:\.\d+)?)\s*%/i.exec(section)?.[1]);
  const net = percent(/Total Annual (?:Fund )?Operating Expenses After[^%\d]{0,100}?(?:\s\d{1,2})?\s(\d+\.\d+)\s*%/i.exec(section)?.[1]);
  const inceptionMatch = /commenced operations on (\d{1,2})\/(\d{1,2})\/(\d{2,4})/i.exec(text);
  const year = inceptionMatch ? Number(inceptionMatch[3]) + (inceptionMatch[3].length === 2 ? 2000 : 0) : 0;
  const inception = inceptionMatch ? `${year}-${inceptionMatch[1].padStart(2, '0')}-${inceptionMatch[2].padStart(2, '0')}` : null;
  const dateMatch = /Summary Prospectus\s*(?:\|\s*)?([A-Z][a-z]+) (\d{1,2}), (\d{4})/.exec(text);
  const monthIndex = dateMatch ? ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].indexOf(dateMatch[1]) : -1;
  const documentDate = dateMatch && monthIndex >= 0 ? `${dateMatch[3]}-${String(monthIndex + 1).padStart(2, '0')}-${dateMatch[2].padStart(2, '0')}` : null;
  if (gross === null && net === null) return null;
  return { documentDate, grossExpense: gross ?? net, netExpense: net ?? gross, inception };
}

/** accession -> primary document name for one form family, from the registrant's submissions JSON. */
export function parseSubmissionDocuments(submissions: JsonRecord, formPrefix: string): Map<string, string> {
  const recent = submissions?.filings?.recent;
  const map = new Map<string, string>();
  if (!recent || !Array.isArray(recent.form)) return map;
  recent.form.forEach((form: unknown, index: number) => {
    const accession = String(recent.accessionNumber?.[index] || '');
    const document = String(recent.primaryDocument?.[index] || '');
    if (accession && document && String(form).toUpperCase().startsWith(formPrefix)) map.set(accession, document);
  });
  return map;
}
export function filingDocumentUrl(cik: string, accession: string, document: string): string {
  return `${EDGAR_ARCHIVES}/${Number(String(cik).replace(/^0+/, '') || 0)}/${String(accession).replace(/-/g, '')}/${document}`;
}

// EDGAR full-text search maps a fund ticker to the registrant that filed its
// N-PORT-P, so the fallback works for every Parametric ETF without a hand-kept
// CIK table.
export function eftsSearchUrl(query: string): string {
  const params = new URLSearchParams({
    q: `"${query}"`,
    forms: 'NPORT-P',
    dateRange: 'custom',
    start: '0',
    end: String(25),
  });
  return `${SEC_EFTS_HOST}/search-index?${params.toString()}`;
}

export function pickEftsCik(payload: JsonRecord, fundName: string): string | null {
  // EDGAR returns { hits: { hits: [...] } }; older/simplified payloads (and the
  // unit-test fixtures) use a flat { hits: [...] } array.
  const hits: unknown[] = Array.isArray(payload?.hits)
    ? (payload.hits as unknown[])
    : Array.isArray((payload?.hits as JsonRecord)?.hits)
      ? ((payload.hits as JsonRecord).hits as unknown[])
      : [];
  const wanted = normalizeHoldingName(fundName);
  for (const raw of hits) {
    if (!raw || typeof raw !== 'object') continue;
    const hit = raw as JsonRecord;
    const source = (hit._source || {}) as JsonRecord;
    const display = source.display_names;
    // Real payload: display_names is ["NAME  (CIK 0001209466)", ...].
    const names: string[] = Array.isArray(display)
      ? display.map((entry: unknown) => String(entry))
      : Array.isArray((display as JsonRecord)?.names)
        ? ((display as JsonRecord).names as unknown[]).map((entry) => String(entry))
        : [];
    const fromDisplay = names.map((name) => /\(CIK\s*(\d{4,10})\)/i.exec(name)).find(Boolean);
    const ciks: string[] = Array.isArray(source.ciks) ? source.ciks.map((entry: unknown) => String(entry)) : [];
    const rawCik = String((display as JsonRecord)?.cik || fromDisplay?.[1] || ciks[0] || '');
    const cik = rawCik.replace(/\D/g, '').padStart(10, '0');
    if (!cik || cik === '0000000000') continue;
    if (wanted && names.length) {
      const matched = names.some((name) => {
        const normalized = normalizeHoldingName(name.replace(/\(CIK\s*\d+\)/i, ''));
        return normalized && (wanted.includes(normalized) || normalized.includes(wanted));
      });
      if (!matched) continue;
    }
    return cik;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Yahoo chart layer: daily history, distributions, quote meta
// ---------------------------------------------------------------------------

export function parseChart(payload: JsonRecord): ParsedChart {
  const result = (payload?.chart?.result || [])[0] as JsonRecord | undefined;
  if (!result) throw new Error('chart: empty result');
  const meta = (result.meta || {}) as JsonRecord;
  const timestamps: number[] = result.timestamp || [];
  const quote = ((result.indicators || {}).quote || [])[0] as JsonRecord | undefined;
  const adj = ((result.indicators || {}).adjclose || [])[0] as JsonRecord | undefined;
  const closes: unknown[] = (quote && quote.close) || [];
  const volumes: unknown[] = (quote && quote.volume) || [];
  const adjCloses: unknown[] = (adj && adj.adjclose) || closes;
  const days: ChartDay[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (typeof close !== 'number' || !Number.isFinite(close)) continue;
    const adjClose = typeof adjCloses[i] === 'number' && Number.isFinite(adjCloses[i] as number) ? (adjCloses[i] as number) : close;
    days.push({
      date: epochToIsoDate(timestamps[i]),
      close: round(close, 6),
      // Yahoo recomputes the split/dividend-adjusted close on every request;
      // at 6 decimals the last digit or two jitters between otherwise
      // identical requests, making every history row (and the fund) look
      // "updated" on every single run. 2 decimals is well past any
      // meaningful precision for a price and absorbs that jitter.
      adjClose: round(adjClose, 2),
      volume: typeof volumes[i] === 'number' ? (volumes[i] as number) : 0,
      adjCloseRaw: adjClose,
    });
  }
  const events = ((result.events || {}) as JsonRecord).dividends as Record<string, JsonRecord> | undefined;
  const dividends = Object.values(events || {})
    .map((event) => ({ epoch: Number(event.date), amount: Number(event.amount) }))
    .filter((event) => Number.isFinite(event.epoch) && Number.isFinite(event.amount) && event.amount > 0)
    .sort((a, b) => a.epoch - b.epoch);
  return {
    exchangeName: String(meta.fullExchangeName || meta.exchangeName || ''),
    longName: String(meta.longName || meta.shortName || ''),
    regularMarketPrice: numberOrNull(meta.regularMarketPrice) ?? numberOrNull(meta.previousClose),
    regularMarketTime: numberOrNull(meta.regularMarketTime),
    firstTradeDate: numberOrNull(meta.firstTradeDate),
    days,
    dividends,
  };
}

export function chartUrl(ticker: string, config: UpdaterConfig): string {
  // Explicit period1/period2: `range=max` silently downgrades to monthly bars.
  const period2 = Math.floor(Date.now() / 1000);
  let period1 = 0; // "max"
  const yearsMatch = /^(\d+)y$/i.exec(config.historyRange);
  if (yearsMatch) period1 = Math.floor(period2 - Number(yearsMatch[1]) * 365.25 * 86_400);
  return `${YAHOO_CHART_URL}/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&events=div%7Csplit`;
}

// ---------------------------------------------------------------------------
// Derived metric helpers (unit-tested, sibling parity)
// ---------------------------------------------------------------------------

// (1 + CAGR)^n - 1 — the exact inverse of annualizing (same helper as SPDR).
export function annualizedToTotal(annualizedPercent: number | null | undefined, years: number): number | null {
  if (typeof annualizedPercent !== 'number' || !Number.isFinite(annualizedPercent)) return null;
  if (years <= 0) return null;
  return round(((1 + annualizedPercent / 100) ** years - 1) * 100, 2);
}

export function totalToAnnualized(totalPercent: number | null | undefined, years: number): number | null {
  if (typeof totalPercent !== 'number' || !Number.isFinite(totalPercent)) return null;
  if (years <= 0) return null;
  return round(((1 + totalPercent / 100) ** (1 / years) - 1) * 100, 2);
}

// Indicated yield: latest distribution x payments per year / price — used only
// when the issuer publishes no trailing-12-month yield for the fund.
export function indicatedYield(
  latestDistribution: number | null | undefined,
  paymentsPerYear: number | null | undefined,
  price: number | null | undefined,
): number | null {
  if (typeof latestDistribution !== 'number' || typeof paymentsPerYear !== 'number' || typeof price !== 'number') return null;
  if (!Number.isFinite(latestDistribution) || !Number.isFinite(paymentsPerYear) || !Number.isFinite(price) || price <= 0) return null;
  if (paymentsPerYear <= 0 || latestDistribution <= 0) return null;
  return round(((latestDistribution * paymentsPerYear) / price) * 100, 2);
}

export function inferDistributionFrequency(
  dividends: Array<{ epoch: number; amount: number }>,
): { frequency: string; paymentsPerYear: number | null } {
  if (!dividends.length) return { frequency: 'None', paymentsPerYear: null };
  const recent = dividends.slice(-9);
  if (recent.length < 2) return { frequency: 'Unknown', paymentsPerYear: null };
  const gapsDays: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const gap = (recent[i].epoch - recent[i - 1].epoch) / 86_400;
    if (gap > 14 && gap < 400) gapsDays.push(gap);
  }
  if (!gapsDays.length) return { frequency: 'Unknown', paymentsPerYear: null };
  gapsDays.sort((a, b) => a - b);
  const medianGap = gapsDays[Math.floor(gapsDays.length / 2)];
  if (medianGap >= 300) return { frequency: 'Annually', paymentsPerYear: 1 };
  if (medianGap >= 150) return { frequency: 'Semi-annually', paymentsPerYear: 2 };
  if (medianGap >= 75) return { frequency: 'Quarterly', paymentsPerYear: 4 };
  if (medianGap >= 25) return { frequency: 'Monthly', paymentsPerYear: 12 };
  return { frequency: 'Irregular', paymentsPerYear: null };
}

export type PriceReturns = {
  asOfDate: string;
  ytd: number | null;
  yr1: number | null;
  cagr3y: number | null;
  cagr5y: number | null;
  cagr10y: number | null;
  siAnn: number | null;
  mo1: number | null;
  qtd: number | null;
};

const EMPTY_PRICE_RETURNS: PriceReturns = {
  asOfDate: '', ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null, mo1: null, qtd: null,
};

function pctChange(start: number, end: number): number {
  return round(((end - start) / start) * 100, 2);
}

function annualized(start: number, end: number, years: number): number | null {
  if (start <= 0 || years <= 0) return null;
  return round(((end / start) ** (1 / years) - 1) * 100, 2);
}

// Total returns from an adjusted daily series anchored to the last trading day
// at or before `now`. Yahoo is Parametric's only daily history source, so these
// derived figures fill the periods the issuer publishes (month/quarter-end
// tables) and drive the History-derived blocks.
export function priceReturns(days: ChartDay[], now = new Date(), coveredFrom: string | null = null): PriceReturns {
  const empty: PriceReturns = { ...EMPTY_PRICE_RETURNS };
  if (!days.length) return empty;
  const last = days[days.length - 1];
  // A window is derivable only when its anchor day lies inside the span the
  // adjusted series covers (complete issuer distribution coverage is required).
  const anchored = (day: ChartDay | null): day is ChartDay => day !== null && day.date < last.date && (coveredFrom === null || day.date >= coveredFrom);
  const lastEpoch = Date.parse(`${last.date}T00:00:00Z`) / 1000;
  const atOrBefore = (iso: string): ChartDay | null => {
    const target = Date.parse(`${iso}T00:00:00Z`) / 1000;
    if (Number.isNaN(target)) return null;
    let found: ChartDay | null = null;
    for (const day of days) {
      if (Date.parse(`${day.date}T00:00:00Z`) / 1000 <= target) found = day;
      else break;
    }
    return found;
  };
  const yearsAgo = (years: number): ChartDay | null => {
    const date = new Date(now.getTime());
    date.setUTCFullYear(date.getUTCFullYear() - years);
    return atOrBefore(date.toISOString().slice(0, 10));
  };
  const ytdStart = atOrBefore(`${now.getUTCFullYear()}-01-01`);
  const mo1Start = new Date(now.getTime() - 31 * 86_400_000).toISOString().slice(0, 10);
  const quarterStart = `${now.getUTCFullYear()}-${String(Math.floor(now.getUTCMonth() / 3) * 3 + 1).padStart(2, '0')}-01`;
  const year1 = yearsAgo(1);
  const year3 = yearsAgo(3);
  const year5 = yearsAgo(5);
  const year10 = yearsAgo(10);
  const first = days[0];
  const siYears = (lastEpoch - Date.parse(`${first.date}T00:00:00Z`) / 1000) / (365.25 * 86_400);
  const mo1StartDay = atOrBefore(mo1Start);
  const qtdStartDay = atOrBefore(quarterStart);
  return {
    asOfDate: last.date,
    ytd: anchored(ytdStart) && ytdStart.adjClose > 0 ? pctChange(ytdStart.adjClose, last.adjClose) : null,
    yr1: anchored(year1) ? pctChange(year1.adjClose, last.adjClose) : null,
    cagr3y: anchored(year3) ? annualized(year3.adjClose, last.adjClose, 3) : null,
    cagr5y: anchored(year5) ? annualized(year5.adjClose, last.adjClose, 5) : null,
    cagr10y: anchored(year10) ? annualized(year10.adjClose, last.adjClose, 10) : null,
    siAnn: siYears >= 1 && anchored(first) ? annualized(first.adjClose, last.adjClose, siYears) : null,
    mo1: anchored(mo1StartDay) ? pctChange(mo1StartDay.adjClose, last.adjClose) : null,
    qtd: anchored(qtdStartDay) ? pctChange(qtdStartDay.adjClose, last.adjClose) : null,
  };
}

export function lastCompletedQuarterEnd(now = new Date()): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-based
  if (month <= 2) return new Date(Date.UTC(year - 1, 11, 31)); // Jan-Mar -> Dec 31
  if (month <= 5) return new Date(Date.UTC(year, 2, 31)); // Apr-Jun -> Mar 31
  if (month <= 8) return new Date(Date.UTC(year, 5, 30)); // Jul-Sep -> Jun 30
  return new Date(Date.UTC(year, 8, 30)); // Oct-Dec -> Sep 30
}

export type DividendYieldBasis = 'official-trailing-12m' | 'official-distribution-rate' | 'official-other' | 'computed-trailing-12m' | 'indicated';
export const DIVIDEND_YIELD_BASES: readonly DividendYieldBasis[] = ['official-trailing-12m', 'official-distribution-rate', 'official-other', 'computed-trailing-12m', 'indicated'];

/**
 * Code of the definition behind a stored yield, read back from a meta.json: the stored code wins, else the
 * legacy `dividendYieldKind` text decides. Null exactly when there is no yield. Parametric publishes no
 * dividend yield, so an unknown text with a yield is only `official-other` when it is not the indicated estimate.
 */
export function dividendYieldBasisFromMeta(yields: JsonRecord, hasYield: boolean): DividendYieldBasis | null {
  if (!hasYield) return null;
  const stored = String(yields.dividendYieldBasis ?? '');
  const known = DIVIDEND_YIELD_BASES.find((code) => code === stored);
  if (known) return known;
  const kind = String(yields.dividendYieldKind ?? '');
  if (kind === '' || /^indicated\b/.test(kind)) return 'indicated';
  return 'official-other';
}

/**
 * Merges the official Eaton Vance returns with the ones derived from the
 * adjusted daily series. Official figures win wherever they exist (they are the
 * published month-end table); derived figures fill the gaps for young funds.
 */
export function deriveCatalogMetrics(
  official: CatalogReturns,
  derived: PriceReturns,
  publishedDividendYield: number | null,
  publishedSecYield: number | null,
  latestDistribution: number | null,
  paymentsPerYear: number | null,
  price: number | null,
  officialCumulative: CumulativeReturns | null = null,
  officialAsOf: string | null = null,
  publishedYieldBasis: DividendYieldBasis | null = null,
): JsonRecord {
  const coalesce = (value: number | null | undefined): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const ytd = coalesce(official.ytd) ?? coalesce(derived.ytd);
  const tr1y = coalesce(official.yr1) ?? coalesce(derived.yr1);
  const cagr3y = coalesce(official.yr3) ?? coalesce(derived.cagr3y);
  const cagr5y = coalesce(official.yr5) ?? coalesce(derived.cagr5y);
  const cagr10y = coalesce(official.yr10) ?? coalesce(derived.cagr10y);
  const siAnn = coalesce(official.sinceInception) ?? coalesce(derived.siAnn);
  // Which source each published period came from decides the honest label.
  const periods: Array<[number | null | undefined, number | null | undefined]> = [
    [official.ytd, derived.ytd], [official.yr1, derived.yr1], [official.yr3, derived.cagr3y],
    [official.yr5, derived.cagr5y], [official.yr10, derived.cagr10y], [official.sinceInception, derived.siAnn],
  ];
  const usedOfficial = periods.some(([o]) => coalesce(o) !== null);
  const usedDerived = periods.some(([o, d]) => coalesce(o) === null && coalesce(d) !== null);
  const returnsBasis = usedOfficial && usedDerived
    ? 'mixed: official Eaton Vance / MSIM month-end NAV returns where the fund detail page publishes them; remaining periods are estimates derived from the Yahoo Finance adjusted daily series, not official NAV returns'
    : usedOfficial
      ? 'official Eaton Vance / MSIM month-end NAV returns (fund detail page)'
      : 'derived from the Yahoo Finance adjusted daily series, not official NAV returns';
  // Official figures are as of the issuer's returns table; derived ones as of the last Yahoo close.
  const performanceAsOf = usedOfficial ? (officialAsOf || null) : (derived.asOfDate || null);
  const published = coalesce(publishedDividendYield);
  const dividendYield = published ?? indicatedYield(latestDistribution, paymentsPerYear, price);
  // The code travels with the yield it describes: a provider-published yield is official-other unless the caller knows better.
  const dividendYieldBasis: DividendYieldBasis | null = dividendYield === null ? null : published !== null ? (publishedYieldBasis ?? 'official-other') : 'indicated';
  const text = (value: number | null): string | null => (value === null ? null : `${value.toFixed(2)}%`);
  return {
    ytd,
    tr1y,
    tr3y: coalesce(officialCumulative?.yr3) ?? annualizedToTotal(cagr3y, 3),
    tr5y: coalesce(officialCumulative?.yr5) ?? annualizedToTotal(cagr5y, 5),
    tr10y: coalesce(officialCumulative?.yr10) ?? annualizedToTotal(cagr10y, 10),
    cagr3y,
    cagr5y,
    cagr10y,
    siAnn,
    dividendYield,
    dividendYieldText: text(dividendYield) ?? '—',
    dividendYieldBasis,
    secYield: coalesce(publishedSecYield),
    secYieldText: text(coalesce(publishedSecYield)) ?? '—',
    returnsBasis,
    performanceAsOf,
  };
}

// ---------------------------------------------------------------------------
// Eligibility filters (AND logic, iShares semantics)
// ---------------------------------------------------------------------------

function inRange(value: number | null | undefined, range?: Range): boolean {
  if (!range) return true;
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (range.min !== undefined && value < range.min) return false;
  if (range.max !== undefined && value > range.max) return false;
  return true;
}

function annualizedValue(metrics: JsonRecord, period: ReturnPeriod): number | null {
  if (period === 'YTD') return numberOrNull(metrics.ytd);
  if (period === '1Y') return numberOrNull(metrics.tr1y);
  return numberOrNull(metrics[`cagr${period.toLowerCase()}`]);
}

function cumulativeValue(metrics: JsonRecord, period: ReturnPeriod): number | null {
  const key = period === 'YTD' ? 'ytd' : period === '1Y' ? 'tr1y' : `tr${period.toLowerCase()}`;
  return numberOrNull(metrics[key]);
}

export function fundFilterReasons(
  candidate: { ticker: string; aumValue?: number | null; terValue?: number | null; metrics: JsonRecord },
  config: UpdaterConfig,
): string[] {
  const reasons: string[] = [];
  if (config.tickers.length && !config.tickers.includes(candidate.ticker)) reasons.push('TICKERS');
  if (config.aumRange && !inRange(candidate.aumValue ?? null, config.aumRange)) reasons.push('AUM');
  if (config.terRange && !inRange(candidate.terValue ?? null, config.terRange)) reasons.push('TER');
  if (config.dividendYieldRange && !inRange(numberOrNull(candidate.metrics.dividendYield), config.dividendYieldRange)) {
    reasons.push('DIVIDEND_YIELD');
  }
  if (config.secYieldRange && !inRange(numberOrNull(candidate.metrics.secYield), config.secYieldRange)) reasons.push('SEC_YIELD');
  for (const period of RETURN_PERIODS) {
    const performance = config.performanceRanges[period];
    if (performance && !inRange(annualizedValue(candidate.metrics, period), performance)) reasons.push(`PERFORMANCE_${period}`);
    const total = config.totalReturnRanges[period];
    if (total && !inRange(cumulativeValue(candidate.metrics, period), total)) reasons.push(`TOTAL_RETURN_${period}`);
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// Deterministic writers
// ---------------------------------------------------------------------------

// Comparing raw text would treat a run that only refreshed generatedAt (with
// every fund's actual data unchanged) as a real change and rewrite the file
// every time. Compare with both timestamps stripped instead.
export function samePublishedContent(previous: string, value: unknown): boolean {
  const withoutRunTimestamp = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(withoutRunTimestamp);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.entries(item).filter(([key]) => !['generatedAt', 'catalogReadAt', 'savedAt'].includes(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, withoutRunTimestamp(value)]));
  };
  try {
    return JSON.stringify(withoutRunTimestamp(JSON.parse(previous))) === JSON.stringify(withoutRunTimestamp(value));
  } catch { return false; }
}

/** Write through a temp file and rename, so a killed run never leaves a truncated JSON file. */
async function atomicWrite(file: URL, text: string): Promise<void> {
  const tmp = new URL(`${file.href}.tmp-${process.pid}`);
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, file);
}

async function writeIfChanged(file: URL, value: unknown): Promise<boolean> {
  const next = `${JSON.stringify(value, null, 1)}\n`;
  let previous: string | null = null;
  try {
    previous = await readFile(file, 'utf8');
  } catch {
    // First write.
  }
  if (previous === next || (previous !== null && samePublishedContent(previous, value))) return false;
  await atomicWrite(file, next);
  return true;
}

export async function writePages(
  dir: URL,
  ticker: string,
  kind: 'holdings' | 'history',
  headers: string[],
  rows: JsonRecord[],
  pageSize: number,
): Promise<{ pages: string[]; pageSize: number; totalRows: number }> {
  await mkdir(new URL(`${kind}/`, dir), { recursive: true });
  const pages: string[] = [];
  if (rows.length) {
    const pageCount = Math.ceil(rows.length / pageSize);
    for (let page = 1; page <= pageCount; page++) {
      const slice = rows.slice((page - 1) * pageSize, page * pageSize);
      const name = `${kind}/${pad3(page)}.json`;
      await writeIfChanged(new URL(name, dir), {
        ticker,
        page,
        pageSize,
        totalRows: rows.length,
        headers,
        rows: slice,
      });
      pages.push(name);
    }
  }
  await removeStalePages(dir, kind, new Set(pages));
  return { pages, pageSize, totalRows: rows.length };
}

async function removeStalePages(fundDir: URL, kind: 'holdings' | 'history', kept: Set<string>): Promise<void> {
  const kindDir = new URL(`${kind}/`, fundDir);
  let entries: string[] = [];
  try {
    entries = await readdir(kindDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.endsWith('.json') && !kept.has(`${kind}/${entry}`)) {
      await rm(new URL(entry, kindDir), { force: true });
    }
  }
}

type UpdateState = { cursor: string | null; savedAt: string; scope?: string };

async function readUpdateState(): Promise<UpdateState | null> {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8')) as UpdateState;
  } catch {
    return null;
  }
}

/** The cursor is only valid for the filter set it was saved under. */
export function cursorScope(config: UpdaterConfig): string {
  return JSON.stringify({
    tickers: [...config.tickers].sort(), aum: config.aumRange ?? null, ter: config.terRange ?? null, dy: config.dividendYieldRange ?? null,
    sec: config.secYieldRange ?? null, perf: config.performanceRanges, tr: config.totalReturnRanges,
  });
}

/** Bounded run: save the cursor with its scope. Unfiltered full pass: reset. Filtered full pass: leave the saved state alone. */
async function writeUpdateState(lastProcessedTicker: string | null, config: UpdaterConfig): Promise<void> {
  const scope = cursorScope(config);
  if (config.maxFetches > 0) {
    if (!lastProcessedTicker) return;
    const previous: UpdateState | null = await readUpdateState();
    if (previous?.cursor === lastProcessedTicker && previous.scope === scope) return;
    await writeIfChanged(STATE_FILE, { scope, cursor: lastProcessedTicker, savedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') });
    return;
  }
  if (scope === cursorScope({ ...config, tickers: [], aumRange: undefined, terRange: undefined, dividendYieldRange: undefined, secYieldRange: undefined, performanceRanges: {}, totalReturnRanges: {} })) await rm(STATE_FILE, { force: true });
}

async function readPreviousIndex(): Promise<Map<string, JsonRecord>> {
  const map = new Map<string, JsonRecord>();
  try {
    const payload = JSON.parse(await readFile(INDEX_FILE, 'utf8')) as JsonRecord;
    for (const fund of payload.funds || []) {
      if (fund && typeof fund.ticker === 'string') map.set(fund.ticker, fund);
    }
  } catch {
    // First run.
  }
  // Every fund with a meta.json belongs to the feed, even when the index lost its row and the catalog no longer lists it.
  let tickers: string[] = [];
  try { tickers = (await readdir(new URL('funds/', API_ROOT))).sort(); } catch { /* no fund files yet */ }
  for (const ticker of tickers) {
    if (map.get(ticker)?.dataFile) continue;
    let meta: JsonRecord;
    try { meta = JSON.parse(await readFile(new URL(`funds/${ticker}/meta.json`, API_ROOT), 'utf8')) as JsonRecord; } catch { continue; }
    if (meta.ticker === ticker) map.set(ticker, indexRowFromMeta(meta));
  }
  return map;
}

/** The index row of a fund as the published previous state: a catalog-only row (dataFile null) publishes nothing, so it is empty. */
function publishedRow(row: JsonRecord | undefined): JsonRecord {
  return row && row.dataFile ? row : {};
}

/** The index row of a catalog fund with nothing published yet: dataFile null, no holdings or history, every metrics key null except the basis. */
export function catalogOnlyRow(fund: CatalogFund): JsonRecord {
  const row = indexRowFromMeta({ ticker: fund.ticker, name: fund.name, category: fund.category, categoryPath: fund.categoryPath, exchange: fund.exchange });
  return {
    ...row,
    fundPage: fund.fundPage,
    dataFile: null,
    cusip: fund.cusip || null,
    isin: fund.isin || null,
    metrics: { ...(row.metrics as JsonRecord), returnsBasis: NO_DATA_BASIS },
  };
}

/** Rebuilds an index row from a fund's meta.json: every key of the metrics contract, null for what the meta does not carry. */
export function indexRowFromMeta(meta: JsonRecord): JsonRecord {
  const ticker = String(meta.ticker);
  const returns = (meta.returns as JsonRecord) || {};
  const monthEnd = (returns.monthEnd as JsonRecord) || {};
  const official = returns.returnsBasis === OFFICIAL_RETURNS_BASIS;
  const yields = (meta.yields as JsonRecord) || {};
  const asOf = official && typeof returns.performanceAsOf === 'string' ? returns.performanceAsOf : null;
  const storedYield = numberOrNull(yields.dividendYield);
  const metrics = deriveCatalogMetrics(
    official ? { ytd: numberOrNull(monthEnd.ytd), yr1: numberOrNull(monthEnd.yr1), yr3: numberOrNull(monthEnd.yr3), yr5: numberOrNull(monthEnd.yr5), yr10: numberOrNull(monthEnd.yr10), sinceInception: numberOrNull(monthEnd.sinceInception) } : EMPTY_RETURNS,
    EMPTY_PRICE_RETURNS, storedYield, numberOrNull(yields.secYield), null, null, null, null, asOf,
    dividendYieldBasisFromMeta(yields, storedYield !== null),
  );
  const display = (value: unknown): string => (typeof value === 'string' && value ? value : '—');
  const block = (key: string): JsonRecord => (meta[key] as JsonRecord) || {};
  const identifiers = block('identifiers');
  const expense = block('expense');
  const rows = (block('distributions').rows as string[][]) || [];
  const last = rows.length ? rows[rows.length - 1] : null;
  return {
    ticker,
    name: String(meta.name ?? ticker),
    category: String(meta.category ?? 'ETF'),
    categoryPath: String(meta.categoryPath ?? meta.category ?? 'ETF'),
    fundPage: String(block('source').fundPage ?? ISSUER_CATALOG),
    dataFile: `./funds/${ticker}/meta.json`,
    cusip: identifiers.cusip ?? null,
    isin: identifiers.isin ?? null,
    exchange: String(meta.exchange ?? ''),
    ter: display(expense.display),
    terValue: numberOrNull(expense.net),
    terGross: expense.gross === null || expense.gross === undefined ? '—' : `${expense.gross}%`,
    terGrossValue: numberOrNull(expense.gross),
    nav: display(block('nav').display),
    navValue: numberOrNull(block('nav').value),
    aum: display(block('aum').display),
    aumValue: numberOrNull(block('aum').value),
    aumAsOfDate: display(block('aum').asOfDate),
    asOfDate: display(block('nav').asOfDate ? formatEdgarDate(String(block('nav').asOfDate)) : null),
    inceptionDate: display(block('inception').inceptionDate),
    closePrice: display(block('marketPrice').display),
    closePriceValue: numberOrNull(block('marketPrice').value),
    premiumDiscount: display(block('premiumDiscount').display),
    premiumDiscountValue: numberOrNull(block('premiumDiscount').value),
    distributions: { frequency: String(block('distributions').frequency ?? '—'), exDate: last ? String(last[0]) : '—', dividend: last ? String(last[1]) : '—' },
    returns: { monthEnd, quarterEnd: returns.quarterEnd ?? null },
    metrics,
    holdings: numberOrNull(block('holdings').totalRows) ?? 0,
    history: numberOrNull(block('history').totalRows) ?? 0,
  };
}

async function readPreviousSheet(ticker: string, kind: 'holdings' | 'history'): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = [];
  let page = 1;
  for (;;) {
    let payload: JsonRecord;
    try {
      payload = JSON.parse(await readFile(new URL(`funds/${ticker}/${kind}/${pad3(page)}.json`, API_ROOT), 'utf8')) as JsonRecord;
    } catch {
      return rows;
    }
    rows.push(...(payload.rows || []));
    const totalRows = numberOrNull(payload.totalRows);
    if (totalRows !== null && rows.length >= totalRows) return rows;
    if (!(payload.rows || []).length) return rows;
    page += 1;
  }
}

async function readPreviousSheetHeaders(ticker: string, kind: 'holdings' | 'history'): Promise<string[]> {
  try {
    const payload = JSON.parse(await readFile(new URL(`funds/${ticker}/${kind}/${pad3(1)}.json`, API_ROOT), 'utf8')) as JsonRecord;
    return Array.isArray(payload.headers) ? (payload.headers as string[]) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Eaton Vance / MSIM issuer layer (Parametric funds)
// ---------------------------------------------------------------------------

export function isParametricFundUrl(url: string): boolean {
  try {
    const parsed = new URL(url, ISSUER_SITE);
    return parsed.origin === ISSUER_SITE && parsed.pathname.startsWith(ISSUER_PRODUCT_PATH)
      && parsed.pathname.toLowerCase().includes(ISSUER_BRAND_SLUG)
      && /\.html$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function issuerFundUrl(ticker: string): string {
  const slug = PARAMETRIC_FUND_SLUGS[ticker.toUpperCase()];
  if (!slug) throw new Error(`${ticker}: no verified Parametric fund page`);
  return `${ISSUER_SITE}${ISSUER_PRODUCT_PATH}us-equity/${slug}.html`;
}

// Verified page slugs for the Parametric suite (checked live 2026-10-01). The
// catalog table is the source of truth; this map only keeps URLs canonical and
// lets a previously published fund stay reachable when the catalog is down.
export const PARAMETRIC_FUND_SLUGS: Record<string, string> = {
  PAPI: 'parametric-equity-premium-income-etf',
  PHEQ: 'parametric-hedged-equity-etf',
  PEPS: 'parametric-equity-plus-etf',
};

// The catalog table renders one row per fund as:
//   | PAPI<br> [Parametric Equity Premium Income ETF](https://www.eatonvance.com/.../parametric-...-etf.html) | 09/30/2026 | 26.28 | ...
export type CatalogEntry = {
  ticker: string;
  name: string;
  fundPage: string;
  nav: number | null;
  marketPrice: number | null;
  asOfDate: string | null;
  secYield: number | null;
  secYieldDate: string | null;
  frequency: string;
};

export function parseIssuerCatalog(text: string): CatalogEntry[] {
  const source = normalizeSource(text);
  const funds = new Map<string, CatalogEntry>();
  const rowRe = /^\|\s*([A-Z0-9]{2,6})\s*(?:<br\s*\/?>)?\s*\[([^\]]+)\]\(([^)\s]+)\)\s*\|([^\n]*)$/gim;
  let header: { nav: number; market: number; asOf: number; yieldDate: number; secYield: number; frequency: number } | null = null;
  for (const line of source.split('\n')) {
    if (!line.startsWith('|') || isSeparatorRow(line)) continue;
    const cells = tableCells(line);
    // Header cells wrap over several lines ("Market <br>Price ($)"); the line
    // break is spacing, not part of the column name.
    const labels = cells.map((cell) => cell.replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase());
    if (!header && labels.some((label) => /nav \(\$\)/.test(label)) && labels.some((label) => /30-day/.test(label))) {
      header = {
        nav: labels.findIndex((label) => /^nav \(\$\)/.test(label)),
        market: labels.findIndex((label) => /^market\s*price \(\$\)/.test(label)),
        asOf: labels.findIndex((label) => /as of date/.test(label)),
        yieldDate: labels.findIndex((label) => /^yield/.test(label) && /as of/.test(label)),
        secYield: labels.findIndex((label) => /30-day/.test(label) && /yield/.test(label)),
        frequency: labels.findIndex((label) => /^dist/.test(label)),
      };
    }
    const match = rowRe.exec(line);
    rowRe.lastIndex = 0;
    if (!match) continue;
    const ticker = sanitizeTicker(match[1]);
    if (!ticker) continue;
    let fundPage = match[3];
    try {
      const parsed = new URL(fundPage, ISSUER_SITE);
      fundPage = `${parsed.origin}${parsed.pathname}`;
    } catch {
      continue;
    }
    if (!isParametricFundUrl(fundPage)) continue;
    // The cells after the fund link are the row's own figures; the header row
    // (parsed above) supplies their positions.
    const figures = tableCells(`| ${match[4]}`);
    // `figures` starts after the fund-name cell, while the header indices are
    // absolute, so the fund-name column (0) is skipped.
    const at = (index: number): string => (index >= 1 && index - 1 < figures.length ? figures[index - 1] : '');
    if (!funds.has(ticker)) {
      funds.set(ticker, {
        ticker,
        name: cleanText(match[2]),
        fundPage,
        nav: header ? numberOrNull(at(header.nav)) : null,
        marketPrice: header ? numberOrNull(at(header.market)) : null,
        asOfDate: header ? toIsoDate(at(header.asOf)) : null,
        secYield: header ? numberOrNull(at(header.secYield)) : null,
        secYieldDate: header ? toIsoDate(at(header.yieldDate)) : null,
        frequency: header ? cleanText(at(header.frequency)) : '',
      });
    }
  }
  if (!funds.size) {
    // The catalog is now a card listing, not a table: "PAPI", then "[name](url)", then "Market Price as of mm/dd/yyyy" and "$price".
    const cardRe = /(?:^|\n)([A-Z0-9]{2,6})[ \t]*\n+\[([^\]\n]+)\]\((https?:[^)\s]+)\)(?:[ \t]*\n+Market Price as of (\d{1,2}\/\d{1,2}\/\d{4})[\s\S]{0,200}?\$([\d,.]+))?/g;
    for (const match of source.matchAll(cardRe)) {
      const ticker = sanitizeTicker(match[1]);
      let fundPage: string;
      try { const parsed = new URL(match[3], ISSUER_SITE); fundPage = `${parsed.origin}${parsed.pathname}`; } catch { continue; }
      if (!ticker || funds.has(ticker) || !isParametricFundUrl(fundPage)) continue;
      funds.set(ticker, {
        ticker, name: cleanText(match[2]), fundPage, nav: null,
        marketPrice: match[5] ? numberOrNull(match[5]) : null, asOfDate: match[4] ? toIsoDate(match[4]) : null,
        secYield: null, secYieldDate: null, frequency: '',
      });
    }
  }
  const list = [...funds.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  if (!list.length) throw new Error('catalog: no Parametric fund links found');
  return list;
}

// Labels carry markdown footnote links ("Expense Ratio [1](https://...#x)") and
// optional trailing colons; the value lines never do.
export function labelKey(line: string): string {
  return cleanText(stripFootnotes(String(line ?? '').replace(/<br\s*\/?>/gi, ' ')))
    .replace(/[:\s]+$/, '').trim().toLowerCase();
}

// Footnote markers ([1], [2] plus their markdown link target) are decoration,
// never part of a label or of the benchmark's name.
export function stripFootnotes(value: unknown): string {
  return String(value ?? '')
    .replace(/\[\d+\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[[^\]]*\]/g, ' ');
}

function findLabelLine(lines: string[], label: string, from = 0): number {
  const wanted = labelKey(label);
  for (let i = from; i < lines.length; i++) {
    if (labelKey(lines[i]) === wanted && !/^\|/.test(lines[i])) return i;
  }
  return -1;
}

// The detail template repeats each label twice (a top card and the section);
// the first value that parses wins, which keeps the parser independent of the
// template's section order.
function labelledValue(lines: string[], label: string): string {
  const index = findLabelLine(lines, label);
  if (index < 0) return '';
  for (let i = index + 1; i < Math.min(lines.length, index + 5); i++) {
    const candidate = lines[i];
    if (!candidate || candidate.startsWith('|') || candidate.startsWith('#')) continue;
    if (/^as of\b/i.test(candidate)) continue;
    return candidate;
  }
  return '';
}

function labelledDate(lines: string[], label: string): string | null {
  const index = findLabelLine(lines, label);
  if (index < 0) return null;
  for (let i = index + 1; i < Math.min(lines.length, index + 6); i++) {
    const match = /^as of\s+(\d{2}\/\d{2}\/\d{4})$/i.exec(lines[i]);
    if (match) return toIsoDate(match[1]);
  }
  return null;
}

// "Returns" heading followed by "As of 09/30/2026 (updated daily upon availability)".
function returnsTableDate(lines: string[]): string | null {
  for (let index = findLabelLine(lines, 'Returns'); index >= 0; index = findLabelLine(lines, 'Returns', index + 1)) {
    for (let i = index + 1; i < Math.min(lines.length, index + 4); i++) {
      const match = /^as of\s+(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(lines[i]);
      if (match) return toIsoDate(match[1]);
    }
  }
  return null;
}

export function parseKeyFacts(text: string): Map<string, string> {
  const facts = new Map<string, string>();
  for (const line of sourceLines(text)) {
    if (!line.startsWith('|') || isSeparatorRow(line)) continue;
    const cells = tableCells(line);
    if (cells.length !== 2) continue;
    const key = cleanText(cells[0].replace(/<br\s*\/?>/gi, ' ').replace(/\s+as of\s+.*$/i, ''));
    if (!key || !cells[1]) continue;
    if (!facts.has(key)) facts.set(key, cells[1]);
  }
  return facts;
}

// Header cell -> numeric slot. `asOfDate` is deliberately not part of the slot
// union, so an indexed assignment into OfficialReturns can only ever target a
// numeric field (the mandatory type-safety review for this schema).
// Key-fact rows carry their own as-of date in the label cell ("Total Net Assets
// ($MM)<br> as of 09/30/2026"); the value cell only holds the number.
export function parseKeyFactDates(text: string): Map<string, string> {
  const dates = new Map<string, string>();
  for (const line of sourceLines(text)) {
    if (!line.startsWith('|') || isSeparatorRow(line)) continue;
    const cells = tableCells(line);
    if (cells.length !== 2) continue;
    const raw = cells[0].replace(/<br\s*\/?>/gi, ' ');
    const match = /as of\s+(\d{2}\/\d{2}\/\d{4})/i.exec(raw);
    const key = cleanText(raw.replace(/\s+as of\s+\d{2}\/\d{2}\/\d{4}\s*$/i, ''));
    if (key && match && !dates.has(key)) dates.set(key, toIsoDate(match[1]));
  }
  return dates;
}

type IssuerReturnSlot = ReturnPeriod | 'mo1' | 'mo3' | 'sinceInception';
const RETURN_HEADER_SLOTS: Record<string, IssuerReturnSlot> = {
  '1 month': 'mo1', '1 months': 'mo1',
  '3 months': 'mo3', '3 month': 'mo3',
  ytd: 'YTD',
  '1 yr': '1Y', '1 year': '1Y', '1 yr.': '1Y',
  '3 yr': '3Y', '3 year': '3Y', '3 yr.': '3Y',
  '5 yr': '5Y', '5 year': '5Y', '5 yr.': '5Y',
  '10 yr': '10Y', '10 year': '10Y', '10 yr.': '10Y',
  'since inception': 'sinceInception',
};
type NumericReturnKey = Exclude<IssuerReturnSlot, 'sinceInception'>;
const RETURN_SLOT_KEYS: Record<NumericReturnKey, 'mo1' | 'mo3' | 'ytd' | 'yr1' | 'yr3' | 'yr5' | 'yr10'> = {
  mo1: 'mo1', mo3: 'mo3', YTD: 'ytd', '1Y': 'yr1', '3Y': 'yr3', '5Y': 'yr5', '10Y': 'yr10',
};

export function parseIssuerReturnsTable(text: string, ticker: string): { monthEnd: OfficialReturns; monthMarket: OfficialReturns } {
  const empty = (): OfficialReturns => ({ ...EMPTY_RETURNS, asOfDate: null, mo1: null, mo3: null });
  const monthEnd = empty(), monthMarket = empty();
  const lines = sourceLines(text);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('|') || isSeparatorRow(line)) continue;
    const header = tableCells(line).map((cell) => cell.toLowerCase());
    if (!header.some((cell) => RETURN_HEADER_SLOTS[cell] !== undefined)) continue;
    const slotByColumn = header.map((cell) => RETURN_HEADER_SLOTS[cell]);
    // Every following row that carries this fund's own "%" figures is one of
    // the published series (Market Price and NAV), newest table first.
    for (let j = i + 1; j < lines.length; j++) {
      const rowLine = lines[j];
      if (!rowLine.startsWith('|')) break;
      if (isSeparatorRow(rowLine)) continue;
      const cells = tableCells(rowLine);
      const label = cells[0] || '';
      if (!/\(%\)/.test(label) || !new RegExp(`\\b${ticker}\\b`, 'i').test(label)) break;
      const isNav = /\bnav\b/i.test(label);
      const isMarket = /\bmarket price\b/i.test(label);
      if (!isNav && !isMarket) break;
      const target = isNav ? monthEnd : monthMarket;
      for (let column = 1; column < cells.length; column++) {
        const slot = slotByColumn[column];
        const value = numberOrNull(cells[column]);
        if (slot === undefined || value === null) continue;
        if (slot === 'sinceInception') target.sinceInception = value;
        else target[RETURN_SLOT_KEYS[slot]] = value;
      }
    }
    break;
  }
  return { monthEnd, monthMarket };
}

export function parseIssuerDistributions(text: string): Array<{ epoch: number; amount: number; exDate: string; payDate: string; recordDate: string }> {
  const lines = sourceLines(text);
  const payments: Array<{ epoch: number; amount: number; exDate: string; payDate: string; recordDate: string }> = [];
  let inTable = false;
  for (const line of lines) {
    if (!line.startsWith('|')) { inTable = false; continue; }
    if (isSeparatorRow(line)) continue;
    const cells = tableCells(line);
    if (cells.some((cell) => /^ex-date$/i.test(cell))) { inTable = true; continue; }
    if (!inTable || cells.length < 5) continue;
    const recordDate = toIsoDate(cells[0]);
    const exDate = toIsoDate(cells[1]);
    const payDate = toIsoDate(cells[2]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exDate)) continue;
    const netIncome = numberOrNull(cells[3]) ?? 0;
    const shortGains = numberOrNull(cells[4]) ?? 0;
    const longGains = numberOrNull(cells[5]) ?? 0;
    const amount = round(netIncome + shortGains + longGains, 6);
    // A dash/blank row is a placeholder, not a zero distribution.
    if (amount <= 0) continue;
    const epoch = isoToEpoch(exDate);
    if (epoch === null) continue;
    payments.push({ epoch, amount, exDate, payDate, recordDate });
  }
  return payments.sort((a, b) => a.epoch - b.epoch);
}

// Full holdings downloads, when the issuer publishes one, are CSV links on the
// page ("Download Full Holdings"). The page's own table only carries the top 10.
export function holdingsDownloadUrl(text: string, ticker: string): string | null {
  const source = String(text ?? '');
  const candidates: string[] = [];
  for (const match of source.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (/download\s+(full\s+)?holdings/i.test(cleanText(match[2]))) candidates.push(match[1]);
  }
  for (const match of source.matchAll(/\[([^\]]*holdings[^\]]*)\]\(([^)\s]+)\)/gi)) {
    if (/download/i.test(match[1])) candidates.push(match[2]);
  }
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate, ISSUER_SITE);
      if (!/\.(csv|xlsx|xls)$/i.test(url.pathname)) continue;
      if (!url.searchParams.get('ticker') && !new RegExp(ticker, 'i').test(url.href)) continue;
      return url.href;
    } catch {
      continue;
    }
  }
  return null;
}

// Minimal RFC-4180 field splitter: the official sheets quote thousands
// separators inside cells ("6,775"), so a naive split would shift columns.
export function csvCells(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const character = line[i];
    if (character === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i += 1; }
      else quoted = !quoted;
      continue;
    }
    if (character === ',' && !quoted) {
      cells.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  cells.push(current);
  return cells.map((cell) => cleanText(cell));
}

export function parseHoldingsCsv(text: string): ParsedHoldings | null {
  const lines = String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headerIndex = lines.findIndex((line) => /security name/i.test(line) && /percent|weight|%/i.test(line));
  if (headerIndex < 0) return null;
  const headers = csvCells(lines[headerIndex]);
  const column = (name: RegExp): number => headers.findIndex((header) => name.test(header));
  const nameAt = column(/security name|holding/i), tickerAt = column(/ticker/i), weightAt = column(/percent|weight/i);
  const cusipAt = column(/cusip/i), isinAt = column(/isin/i), sharesAt = column(/shares|principal/i), valueAt = column(/market value/i), typeAt = column(/asset/i);
  if (nameAt < 0 || weightAt < 0) return null;
  const rows: JsonRecord[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const cells = csvCells(line);
    const name = cells[nameAt];
    const weight = numberOrNull(cells[weightAt]);
    if (!name || weight === null) continue;
    const assetType = typeAt >= 0 ? cells[typeAt] || '' : '';
    const isin = isinAt >= 0 ? cells[isinAt] : '';
    const cusip = cusipAt >= 0 && /^[A-Z0-9]{9}$/.test(cells[cusipAt]) ? cells[cusipAt] : /^US[A-Z0-9]{10}$/.test(isin) ? isin.slice(2, 11) : '';
    rows.push({
      Name: name,
      Ticker: holdingTickerFor(assetType, tickerAt >= 0 ? cells[tickerAt] : ''),
      Identifier: cusip || isin || '',
      Weight: String(weight),
      'Market Value': valueAt >= 0 ? String(numberOrNull(cells[valueAt]) ?? '') : '',
      'Shares Held': sharesAt >= 0 ? String(numberOrNull(cells[sharesAt]) ?? '') : '',
      'Asset Category': assetType,
    });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => Number(b.Weight) - Number(a.Weight) || String(a.Identifier).localeCompare(String(b.Identifier)) || String(a.Name).localeCompare(String(b.Name)));
  const asOfMatch = /as of\s+(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(text) || /(\d{4}-\d{2}-\d{2})/.exec(text);
  return { asOfDate: asOfMatch ? toIsoDate(asOfMatch[1]) : null, container: 'issuer CSV', headers: HOLDINGS_HEADERS, rows };
}

// The detail page carries only the ten largest positions; the feed stitches the
// issuer's headline facts with SEC N-PORT-P holdings for the full sheet.
export function parseTopHoldings(text: string): JsonRecord[] {
  const lines = sourceLines(text);
  const rows: JsonRecord[] = [];
  let inTable = false;
  for (const line of lines) {
    if (!line.startsWith('|')) { inTable = false; continue; }
    if (isSeparatorRow(line)) continue;
    const cells = tableCells(line);
    const header = cells.map((cell) => cell.toLowerCase());
    if (header.includes('ticker') && header.includes('holdings') && header.includes('security identifier')) { inTable = true; continue; }
    if (!inTable || cells.length < 7) continue;
    const [ticker, name, , identifier, weight, shares, value] = cells;
    if (!name || numberOrNull(weight) === null) continue;
    rows.push({
      Name: name,
      Ticker: holdingTickerFor(name, ticker === '-' ? '' : ticker),
      Identifier: identifier === '-' ? '' : identifier,
      Weight: String(numberOrNull(weight) ?? ''),
      'Market Value': String(numberOrNull(value) ?? ''),
      'Shares Held': String(numberOrNull(shares) ?? ''),
      'Asset Category': /fund|money market|MSILF|government/i.test(name) ? 'Money Market' : 'Common Stock',
    });
  }
  return rows;
}

export function parseIssuerProduct(text: string, ticker: string): ProductData {
  const source = normalizeSource(text);
  const lines = sourceLines(text);
  const facts = parseKeyFacts(text);
  const returns = parseIssuerReturnsTable(text, ticker);
  const dividends = parseIssuerDistributions(text);
  const asOf = labelledDate(lines, 'Market Price');
  // The returns table carries its own "As of" line under the "Returns" heading;
  // it is the performance date and is not the NAV/price date.
  const returnsAsOf = returnsTableDate(lines);
  const heading = source.split('\n').map((line) => line.trim()).find((line) => line.startsWith('# '));
  const fundName = cleanText(heading ? heading.slice(2) : '');
  const benchmark = cleanText(stripFootnotes(facts.get('Benchmarks') || '').split(/<br\s*\/?>/i)[0]);
  const frequency = issuerFrequency(facts.get('Distribution Frequency'));
  const expenseIndex = findLabelLine(lines, 'Expense Ratio');
  const expenseValue = (name: RegExp): number | null => {
    if (expenseIndex < 0) return null;
    const window = lines.slice(expenseIndex, expenseIndex + 6);
    const index = window.findIndex((line) => name.test(line));
    return index >= 0 ? numberOrNull(window[index + 1]) : null;
  };
  const aumMillions = numberOrNull(facts.get('Total Net Assets ($MM)'));
  return {
    ticker,
    name: fundName || facts.get('Ticker') || ticker,
    cusip: cleanText(facts.get('CUSIP') || ''),
    isin: '',
    exchange: cleanText(facts.get('Exchange') || ''),
    assetClass: cleanText(facts.get('Asset Class') || ''),
    benchmark,
    inception: facts.has('Inception Date') ? toIsoDate(facts.get('Inception Date')) : null,
    grossExpense: expenseValue(/^gross$/i),
    netExpense: expenseValue(/^net$/i),
    nav: numberOrNull(labelledValue(lines, 'NAV')),
    navDate: asOf,
    marketPrice: numberOrNull(labelledValue(lines, 'Market Price')),
    marketPriceDate: asOf,
    premiumDiscountAmount: numberOrNull(labelledValue(lines, 'Premium/Discount')),
    netAssets: aumMillions === null ? null : round(aumMillions * 1e6, 0),
    netAssetsDate: parseKeyFactDates(text).get('Total Net Assets ($MM)') ?? null,
    bidAskSpread: numberOrNull(labelledValue(lines, 'Bid/Ask Spread')),
    dividendYield: null,
    dividendYieldDate: null,
    dividendYieldKind: '',
    secYield: null,
    secYieldDate: null,
    secYieldKind: '',
    frequencyCode: frequency.code,
    latestDividend: dividends.length ? {
      exDate: dividends[dividends.length - 1].exDate,
      amount: dividends[dividends.length - 1].amount,
      payDate: dividends[dividends.length - 1].payDate,
      recordDate: dividends[dividends.length - 1].recordDate,
    } : null,
    monthEnd: { ...returns.monthEnd, asOfDate: returnsAsOf },
    quarterEnd: { ...returns.monthEnd, asOfDate: returnsAsOf },
    dividends,
    holdings: null,
  };
}

// The product pages are rendered client side from the issuer's public JSON data
// service (the markdown of the page carries only disclosures). The five files
// below hold every fact the old page tables used to show.
export const PARAMETRIC_PRODUCT_IDS: Record<string, string> = { PAPI: '100637', PHEQ: '100638', PEPS: '100678' };
export const ISSUER_API_PARTS = ['detail/en-us-financial-advisor', 'detail/en-pricing', 'detail/en-returns', 'detail/en-yield', 'detail/en-distribution'] as const;
export function issuerApiUrl(productId: string, part: string): string {
  return `${ISSUER_SITE}/im/json/imwebdata/data/product/EF/${productId}/${part}.json`;
}

type ApiJson = Record<string, any>;
const apiNumber = (value: unknown): number | null => numberOrNull(typeof value === 'string' ? value.trim() : value);
const apiDate = (value: unknown): string | null => {
  const iso = toIsoDate(String(value ?? '').replace(/-/g, '/').trim());
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
};

function apiReturnsRow(rows: ApiJson[], timeFrame: string, inception: string | null): OfficialReturns {
  const row = rows.find((item) => item?.timeFrame === timeFrame && item?.perfType === 'NET');
  const empty: OfficialReturns = { ...EMPTY_RETURNS, asOfDate: null, mo1: null, mo3: null };
  if (!row) return empty;
  const asOfDate = apiDate(row.perfAsOfDate);
  return {
    asOfDate,
    mo1: apiNumber(row.oneMonth),
    mo3: apiNumber(row.threeMonths),
    qtd: apiNumber(row.qtd),
    ytd: apiNumber(row.ytd),
    yr1: apiNumber(row.oneYr),
    yr3: apiNumber(row.threeYr),
    yr5: apiNumber(row.fiveYr),
    yr10: apiNumber(row.tenYr),
    // An annualized figure over less than a year is not a meaningful since-inception rate.
    sinceInception: annualizedSinceInception(apiNumber(row.si), inception, asOfDate),
  };
}

const isRecord = (value: unknown): boolean => typeof value === 'object' && value !== null && !Array.isArray(value);
/**
 * A file counts as loaded only when its own container is present: an empty object, an HTML error page or a file
 * cut by the proxy is a failed read of that section, while a container that merely lacks a field is an honest null.
 */
export const ISSUER_SECTION_LOADED: Record<IssuerSection, (json: ApiJson) => boolean> = {
  detail: (json) => { const detail = json?.en ?? json; return Array.isArray(detail?.shareClasses) && detail.shareClasses.length > 0; },
  pricing: (json) => {
    const pricing = json?.en?.shareClasses?.[0]?.currencies?.[0]?.pricings;
    return isRecord(pricing) && (apiNumber(pricing.nav4f ?? pricing.nav) !== null || apiNumber(pricing.marketPrice) !== null);
  },
  returns: (json) => Array.isArray(json?.en?.shareClasses?.[0]?.currencies?.[0]?.performances),
  yields: (json) => isRecord(json?.en?.shareClasses?.[0]?.currencies?.[0]?.yield),
  distribution: (json) => Array.isArray(json?.en?.shareClasses?.[0]?.distributions),
};

/** Product facts from the issuer JSON service: detail, pricing, returns, yield and distribution files (already parsed JSON). */
export function parseIssuerApi(files: { detail: ApiJson; pricing: ApiJson; returns: ApiJson; yields: ApiJson; distribution: ApiJson }, ticker: string): ProductData {
  const detail = files.detail?.en ?? files.detail ?? {};
  const shareClass = (detail.shareClasses ?? []).find((item: ApiJson) => String(item?.identifiers?.ticker ?? '').toUpperCase() === ticker.toUpperCase()) ?? (detail.shareClasses ?? [])[0] ?? {};
  const ids = shareClass.identifiers ?? {};
  const fees = shareClass.fees ?? {};
  const benchmark = (shareClass.benchmarks ?? []).find((item: ApiJson) => item?.benchmarkSubType === 'P') ?? (shareClass.benchmarks ?? [])[0];
  const inception = apiDate(detail.inceptionDate ?? shareClass.inceptionDate);
  const pricing = files.pricing?.en?.shareClasses?.[0]?.currencies?.[0]?.pricings ?? {};
  const returnRows: ApiJson[] = files.returns?.en?.shareClasses?.[0]?.currencies?.[0]?.performances ?? [];
  const yieldBlock = files.yields?.en?.shareClasses?.[0]?.currencies?.[0]?.yield ?? {};
  const distributions: ApiJson[] = files.distribution?.en?.shareClasses?.[0]?.distributions ?? [];
  const dividends = distributions.flatMap((row) => {
    const exDate = apiDate(row.exDistributionDate);
    const epoch = exDate ? isoToEpoch(exDate) : null;
    const amount = round((apiNumber(row.dividendPerShare) ?? 0) + (apiNumber(row.totalCapitalGainPerShare) ?? 0), 6);
    if (!exDate || epoch === null || amount <= 0) return [];
    return [{ epoch, amount, exDate, payDate: apiDate(row.payableDate) ?? '', recordDate: apiDate(row.recordDate) ?? '' }];
  }).sort((a, b) => a.epoch - b.epoch);
  const nav = apiNumber(pricing.nav4f ?? pricing.nav);
  const navDate = apiDate(pricing.navAsOfDate);
  const shares = apiNumber(pricing.outstandingShares);
  const frequency = issuerFrequency(detail.distFrequency);
  // The daily SEC yield is the freshest published one; the monthly figure is its fallback.
  const dailySec = apiNumber(yieldBlock.dailySec30Yield);
  const secYield = dailySec ?? apiNumber(yieldBlock.sec30Yield);
  const secYieldDate = dailySec !== null ? apiDate(yieldBlock.dailyAsofDate) : apiDate(yieldBlock.thirtyDayAsofDate);
  const monthEnd = apiReturnsRow(returnRows, 'MONTHLY', inception);
  const quarterEnd = apiReturnsRow(returnRows, 'QUARTERLY', inception);
  return {
    ticker,
    name: cleanText(detail.name) || ticker,
    cusip: cleanText(ids.cusip || ''),
    isin: cleanText(ids.isin || '').toUpperCase(),
    exchange: cleanText(detail.exchange || ''),
    assetClass: cleanText(detail.assetClassName || ''),
    benchmark: cleanText(benchmark?.name || ''),
    inception,
    grossExpense: apiNumber(fees.grossExpenseRatio),
    netExpense: apiNumber(fees.netExpenseRatio),
    nav,
    navDate,
    marketPrice: apiNumber(pricing.marketPrice),
    marketPriceDate: navDate,
    premiumDiscountAmount: apiNumber(pricing.premiumDiscount),
    premiumDiscountPercent: apiNumber(pricing.premiumDiscountPercentage),
    sharesOutstanding: shares,
    // The service publishes no net assets figure: shares outstanding x NAV, both as of the NAV date.
    netAssets: shares !== null && nav !== null ? round(shares * nav, 2) : null,
    netAssetsDate: navDate,
    netAssetsKind: 'derived: shares outstanding x NAV (the issuer publishes no net assets figure)',
    bidAskSpread: apiNumber(pricing.medianBid),
    dividendYield: null,
    dividendYieldDate: null,
    dividendYieldKind: '',
    secYield,
    secYieldDate,
    secYieldKind: '',
    frequencyCode: frequency.code,
    latestDividend: dividends.length ? dividends[dividends.length - 1] : null,
    monthEnd,
    quarterEnd,
    dividends,
    holdings: null,
    sections: {
      detail: ISSUER_SECTION_LOADED.detail(files.detail), pricing: ISSUER_SECTION_LOADED.pricing(files.pricing), returns: ISSUER_SECTION_LOADED.returns(files.returns),
      yields: ISSUER_SECTION_LOADED.yields(files.yields), distribution: ISSUER_SECTION_LOADED.distribution(files.distribution),
    },
    kept: [],
  };
}

// ---------------------------------------------------------------------------
// Fund assembly
// ---------------------------------------------------------------------------

function historyRows(days: ChartDay[]): JsonRecord[] {
  return days.map((day) => ({
    Date: formatEdgarDate(day.date),
    Close: String(day.close),
    'Adj Close': String(day.adjClose),
    Volume: String(day.volume),
  }));
}

// Yahoo's adjusted close is float32 and its last digits move with the request's period2, so a value
// sitting on a cent boundary (31.544998 vs 31.545001) flips between runs. Within that noise the
// published cent is kept: a rerun with the same source data changes nothing.
export const ADJ_CLOSE_NOISE = 1e-4;

export function mergeHistory(previous: JsonRecord[], fresh: ChartDay[]): JsonRecord[] {
  const byDate = new Map<string, JsonRecord>();
  // "Oct 01 2026" is read as a calendar date, never through the machine's timezone (a run east of UTC wrote a second Oct 01 row).
  for (const row of previous) {
    const iso = isoFromEdgar(row.Date);
    if (iso) byDate.set(iso, row);
  }
  for (const day of fresh) {
    const [row] = historyRows([day]);
    const published = byDate.get(day.date);
    const publishedAdj = published ? numberOrNull(published['Adj Close']) : null;
    const raw = day.adjCloseRaw ?? day.adjClose;
    if (publishedAdj !== null && row['Adj Close'] !== published!['Adj Close'] && Math.abs(raw - publishedAdj) <= 0.005 + ADJ_CLOSE_NOISE) row['Adj Close'] = published!['Adj Close'];
    byDate.set(day.date, row);
  }
  return [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row);
}

export function chartDaysFromRows(rows: JsonRecord[]): ChartDay[] {
  return rows.flatMap((row) => {
    const date = isoFromEdgar(row.Date);
    const close = numberOrNull(row.Close);
    const adjClose = numberOrNull(row['Adj Close']);
    return date && close !== null && adjClose !== null
      ? [{ date, close, adjClose, volume: numberOrNull(row.Volume) ?? 0 }]
      : [];
  });
}

function previousDividends(meta: JsonRecord): Array<{ epoch: number; amount: number }> {
  return (meta.distributions?.rows ?? []).flatMap((row: any[]) => {
    const date = toIsoDate(row[0]);
    const amount = numberOrNull(row[1]);
    return date && amount !== null ? [{ epoch: Date.parse(date) / 1000, amount }] : [];
  });
}

function distributionRows(dividends: Array<{ epoch: number; amount: number }>): string[][] {
  return dividends.map((dividend) => [formatUsDate(dividend.epoch), String(round(dividend.amount, 6))]);
}

export function annualizedSinceInception(value: number | null, inception: string | null, asOfDate: string | null): number | null {
  // the shared calendar-anniversary rule (calendar-dates block); an unknown date keeps the value
  return value === null || fundAgeAtLeast(inception, asOfDate, 1) ? value : null;
}

/** Official returns are only ever the ones read from the issuer in this run, never older published values. */
export function officialReturnsFor(product: ProductData | null): CatalogReturns {
  return mergeOfficial(product?.monthEnd ?? null, null);
}

function mergeOfficial(primary: CatalogReturns | null, secondary: CatalogReturns | null): CatalogReturns {
  const pick = (key: keyof CatalogReturns): number | null => primary?.[key] ?? secondary?.[key] ?? null;
  return { ytd: pick('ytd'), yr1: pick('yr1'), yr3: pick('yr3'), yr5: pick('yr5'), yr10: pick('yr10'), sinceInception: pick('sinceInception') };
}

function returnsBlock(
  derived: PriceReturns,
  official: CatalogReturns,
  officialMo1: number | null,
  asOfDate: string | null,
  previous: JsonRecord,
  issuer: { qtd: number | null; quarterEnd: OfficialReturns | null } | null = null,
  sec: SecReturns | null = null,
): JsonRecord | null {
  const hasOfficial = Object.values(official).some((value) => value !== null);
  const hasDerived = Boolean(derived.asOfDate);
  if (!hasOfficial && !hasDerived && !sec) return (previous.returns as JsonRecord) ?? null;
  const text = (value: number | null | undefined): string => (value === null || value === undefined ? '—' : `${value.toFixed(2)}%`);
  const asOf = asOfDate || derived.asOfDate;
  // With the issuer table in hand, 1-month and quarter-to-date are the table's own figures (an honest null stays null).
  const mo1 = issuer ? officialMo1 : (officialMo1 ?? derived.mo1);
  const qtd = issuer ? issuer.qtd : derived.qtd;
  return {
    derivedFrom: hasOfficial
      ? 'official Eaton Vance / MSIM published returns; month-to-date and history-derived periods use the Yahoo Finance adjusted series'
      : 'derived from the Yahoo Finance adjusted daily series, not official published NAV returns',
    monthEnd: {
      asOfDate: asOf ? formatEdgarDate(asOf) : '—',
      mo1,
      mo1Text: text(mo1),
      qtd,
      qtdText: text(qtd),
      ytd: official.ytd ?? derived.ytd,
      ytdText: text(official.ytd ?? derived.ytd),
      yr1: official.yr1 ?? derived.yr1,
      yr1Text: text(official.yr1 ?? derived.yr1),
      yr3: official.yr3 ?? derived.cagr3y,
      yr3Text: text(official.yr3 ?? derived.cagr3y),
      yr5: official.yr5 ?? derived.cagr5y,
      yr5Text: text(official.yr5 ?? derived.cagr5y),
      yr10: official.yr10 ?? derived.cagr10y,
      yr10Text: text(official.yr10 ?? derived.cagr10y),
      sinceInception: official.sinceInception ?? derived.siAnn,
      sinceInceptionText: text(official.sinceInception ?? derived.siAnn),
    },
    // Which source the quarter-end block comes from is stated next to it: the issuer table, SEC N-PORT-P months compounded, or nothing.
    quarterEndBasis: issuer?.quarterEnd
      ? 'official Eaton Vance / MSIM quarter-end NAV returns (fund detail page)'
      : sec
        ? 'derived: official monthly NAV total returns from SEC Form N-PORT-P filings, compounded (year-to-date and one-year only when every month is filed); not the issuer table'
        : 'not available: neither the issuer table nor SEC N-PORT-P months were read in this run',
    quarterEnd: issuer?.quarterEnd
      ? {
        asOfDate: issuer.quarterEnd.asOfDate ? formatEdgarDate(issuer.quarterEnd.asOfDate) : formatEdgarDate(lastCompletedQuarterEnd().toISOString().slice(0, 10)),
        ytd: issuer.quarterEnd.ytd, yr1: issuer.quarterEnd.yr1, yr3: issuer.quarterEnd.yr3, yr5: issuer.quarterEnd.yr5, yr10: issuer.quarterEnd.yr10, sinceInception: issuer.quarterEnd.sinceInception,
      }
      : sec
        ? { asOfDate: formatEdgarDate(sec.asOfDate), ytd: sec.ytd, yr1: sec.yr1, yr3: null, yr5: null, yr10: null, sinceInception: null }
        : {
          asOfDate: formatEdgarDate(lastCompletedQuarterEnd().toISOString().slice(0, 10)),
          ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null,
        },
  };
}

async function storeRaw(ticker: string, name: string, payload: unknown): Promise<void> {
  const rawDir = new URL(`raw/${ticker}/`, API_ROOT);
  await mkdir(rawDir, { recursive: true });
  await writeFile(new URL(name, rawDir), `${JSON.stringify(payload, null, 1)}\n`, 'utf8');
}

const cikByTicker = new Map<string, string | null>();

/**
 * One run's SEC state: the two SEC ticker tables (each loaded once, the promise shared by concurrent workers), the raw SEC
 * documents (so the N-PORT reader and the monthly returns share one request per document) and the reader's own cache.
 */
let secState: { funds: Promise<Map<string, NportSeriesRef>> | null; names: Promise<Map<string, string>> | null; texts: Map<string, Promise<string>>; reader: Map<string, unknown> } = { funds: null, names: null, texts: new Map(), reader: new Map() };

function loadFundTickerMap(config: UpdaterConfig): Promise<Map<string, NportSeriesRef>> {
  secState.funds ??= (async () => {
    try {
      const payload = await fetchSecJson(SEC_FUND_TICKERS_URL, '[edgar   ] fund ticker table', config);
      const map = parseSecFundTickers(payload);
      outputNote(`[ edgar    ] SEC fund ticker table: ${Array.isArray(payload?.data) ? payload.data.length : map.size} ETF / mutual-fund share classes`);
      return map;
    } catch (error) {
      outputNote(`[ edgar    ] fund ticker table: ${errorMessage(error)} — falling back to full-text search`);
      return new Map<string, NportSeriesRef>();
    }
  })();
  return secState.funds;
}

function loadCompanyNames(config: UpdaterConfig): Promise<Map<string, string>> {
  secState.names ??= (async () => {
    try {
      const payload = await fetchSecJson(SEC_COMPANY_TICKERS_URL, '[edgar   ] company ticker table', config);
      outputNote(`[ edgar    ] SEC company ticker table: ${Object.keys(payload ?? {}).length} issuer names`);
      return parseSecCompanyNames(payload);
    } catch (error) {
      outputNote(`[ edgar    ] company ticker table: ${errorMessage(error)} — N-PORT tickers stay "-"`);
      return new Map<string, string>();
    }
  })();
  return secState.names;
}

/** A SEC document or JSON as text, fetched once per run (a failed fetch is asked again by the next caller). */
function secText(url: string, label: string, config: UpdaterConfig): Promise<string> {
  let cached = secState.texts.get(url);
  if (!cached) {
    const loading = fetchSecText(url, label, config, /\.json(?:$|\?)/.test(url) ? 'json' : 'xml');
    loading.catch(() => { if (secState.texts.get(url) === loading) secState.texts.delete(url); });
    secState.texts.set(url, loading);
    cached = loading;
  }
  return cached;
}

async function resolveRegistrantCik(fund: CatalogFund, config: UpdaterConfig): Promise<string | null> {
  if (cikByTicker.has(fund.ticker)) return cikByTicker.get(fund.ticker) as string | null;
  let cik: string | null = fund.trustCik || null;
  if (!cik) {
    const table = await loadFundTickerMap(config);
    cik = table.get(fund.ticker)?.cik || null;
  }
  if (!cik) {
    try {
      const payload = await fetchSecJson(eftsSearchUrl(fund.ticker), `[edgar   ] search ${fund.ticker}`, config);
      cik = pickEftsCik(payload, fund.name);
    } catch (error) {
      outputNote(`[ edgar    ] search ${fund.ticker}: ${errorMessage(error)}`);
    }
  }
  cikByTicker.set(fund.ticker, cik);
  return cik;
}

/** The fund's SEC identity for the N-PORT reader: registrant CIK and series id from SEC's table, else the trust or full-text search CIK and the name. */
async function nportFundRef(fund: CatalogFund, config: UpdaterConfig): Promise<{ ticker: string; cik: string; seriesId: string; name: string } | null> {
  const ref = (await loadFundTickerMap(config)).get(fund.ticker);
  const cik = ref?.cik || (await resolveRegistrantCik(fund, config));
  return cik ? { ticker: fund.ticker, cik, seriesId: ref?.seriesId || '', name: fund.name } : null;
}

/**
 * The fund's own newest N-PORT-P filings (at most `count`, newest report period first) with their monthly NAV returns, for
 * the quarter-end returns and the SEC net assets. Candidates and identity come from the shared nport-reader helpers (series
 * feed, else the registrant's submissions; the filing must name the fund's series, or its name without a series id).
 */
async function loadOwnNportFilings(fund: { ticker: string; cik: string; seriesId: string; name: string }, count: number, config: UpdaterConfig): Promise<NportOwnFiling[]> {
  if (count <= 0) return [];
  let known: NportCandidate[] = [];
  try {
    known = parseNportSubmissions(JSON.parse(await secText(nportSubmissionsUrl(fund.cik), `[edgar   ] ${fund.ticker} N-PORT periods`, config)));
  } catch (error) {
    outputNote(`[ edgar    ] ${fund.ticker}: ${errorMessage(error)}`);
  }
  let candidates: NportCandidate[] | null = null;
  if (fund.seriesId) {
    try {
      candidates = parseNportFeed(await secText(nportSeriesFeedUrl(fund.seriesId), `[edgar   ] ${fund.ticker} N-PORT filings`, config));
    } catch (error) {
      outputNote(`[ edgar    ] ${fund.ticker} series ${fund.seriesId}: ${errorMessage(error)} — scanning registrant submissions`);
    }
  }
  const own: NportOwnFiling[] = [];
  const sorted = nportNewestFirst(candidates || known, known).slice(0, NPORT_CANDIDATE_LIMIT);
  for (let i = 0; i < sorted.length && own.length < count; i++) {
    const candidate = sorted[i];
    let text: string;
    try {
      text = await secText(nportDocumentUrl(Number(candidate.cik) ? candidate.cik : fund.cik, candidate.accession), `[ nport    ] ${fund.ticker} N-PORT ${candidate.accession}`, config);
    } catch (error) {
      console.warn(`[ edgar    ] ${fund.ticker}: ${candidate.accession}: ${errorMessage(error)} - trying the previous filing`);
      continue;
    }
    const filing = parseNportFiling(text);
    if (nportIdentity(filing, fund).problem) continue;
    own.push({ filing, repPdDate: filing.repPdDate, monthlyReturns: parseNportMonthlyReturns(text), designatedIndex: parseNportDesignatedIndex(text) });
  }
  return own;
}

// Registrants file one N-PORT-P per series, so the newest filing of the trust usually belongs to another fund: a bounded list
// of the newest filings is scanned until the documents carrying this fund's own series id are found.
const NPORT_CANDIDATE_LIMIT = 20;

/**
 * Reads the five issuer JSON files of one fund (direct, then through the rendering proxy). A file that fails, is not JSON
 * or lacks its container is a FAILED section (`product.sections`), not a null: the caller keeps the published section.
 * The read throws only when no section at all could be loaded.
 */
export async function loadIssuerApi(productId: string, ticker: string, config: UpdaterConfig): Promise<ProductData> {
  const names = ['detail', 'pricing', 'returns', 'yields', 'distribution'] as const;
  const loaded: Record<string, ApiJson> = { detail: {}, pricing: {}, returns: {}, yields: {}, distribution: {} };
  let firstError: Error | null = null;
  const failed: string[] = [];
  for (const [index, part] of ISSUER_API_PARTS.entries()) {
    const name = names[index];
    try {
      const text = await fetchIssuerText(issuerApiUrl(productId, part), `[ product  ] ${ticker} ${part.replace('detail/', '')}`, config);
      let json: ApiJson;
      try { json = JSON.parse(proxyPayload(text, 'json')) as ApiJson; } catch { throw new Error(`${ticker}: ${part} is not JSON`); }
      if (!ISSUER_SECTION_LOADED[name](json)) throw new Error(`${ticker}: ${part} came back partial or empty`);
      loaded[name] = json;
    } catch (error) {
      firstError ??= error instanceof Error ? error : new Error(String(error));
      failed.push(name);
    }
  }
  const product = parseIssuerApi(loaded as { detail: ApiJson; pricing: ApiJson; returns: ApiJson; yields: ApiJson; distribution: ApiJson }, ticker);
  if (!Object.values(product.sections!).some(Boolean)) throw firstError ?? new Error(`${ticker}: no issuer file could be loaded`);
  if (failed.length) outputNote(`[ product  ] ${ticker}: ${failed.join(', ')} not loaded (${errorMessage(firstError)})`);
  return product;
}

const OFFICIAL_RETURNS_BASIS = 'official Eaton Vance / MSIM month-end NAV returns (fund detail page)';
const OFFICIAL_SOURCE = /^official Eaton Vance/;
const OFFICIAL_SEC_YIELD = /^30-day SEC yield as published by eatonvance\.com/;
const OFFICIAL_DISTRIBUTIONS_SOURCE = 'official Eaton Vance / MSIM distribution schedule';

function publishedReturnsRow(block: unknown, asOfDate: string | null): OfficialReturns | null {
  if (!isRecord(block)) return null;
  const row = block as JsonRecord;
  const out: OfficialReturns = {
    asOfDate, mo1: numberOrNull(row.mo1), mo3: null, qtd: numberOrNull(row.qtd), ytd: numberOrNull(row.ytd), yr1: numberOrNull(row.yr1),
    yr3: numberOrNull(row.yr3), yr5: numberOrNull(row.yr5), yr10: numberOrNull(row.yr10), sinceInception: numberOrNull(row.sinceInception),
  };
  return [out.ytd, out.yr1, out.yr3, out.yr5, out.yr10, out.sinceInception, out.mo1].some((value) => value !== null) ? out : null;
}

/**
 * The issuer answered partly (or not at all): every section whose read failed and that was published as official before is
 * restored from the previous meta.json as ONE unit (values with their dates, basis and sources), so the normal build
 * republishes it unchanged instead of flipping to nulls or Yahoo-derived values. A fully loaded file that lacks a field is
 * an honest null and is never refilled. Returns the product (a shell when nothing loaded) and the kept section names;
 * null when nothing failed or nothing official was published.
 */
export function retainIssuerSections(product: ProductData | null, ticker: string, previousMeta: JsonRecord | null): { product: ProductData | null; kept: IssuerSection[] } {
  const loaded = product?.sections ?? { detail: false, pricing: false, returns: false, yields: false, distribution: false };
  if (!previousMeta || Object.values(loaded).every(Boolean)) return { product, kept: [] };
  const base = product ?? parseIssuerApi({ detail: {}, pricing: {}, returns: {}, yields: {}, distribution: {} }, ticker);
  const kept: IssuerSection[] = [];
  const iso = (value: unknown): string | null => { const date = toIsoDate(value); return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null; };
  if (!loaded.detail && OFFICIAL_SOURCE.test(String(previousMeta.expense?.source ?? '')) && (numberOrNull(previousMeta.expense?.net) !== null || numberOrNull(previousMeta.expense?.gross) !== null)) {
    base.netExpense = numberOrNull(previousMeta.expense.netDisplay === null ? null : previousMeta.expense.net);
    base.grossExpense = numberOrNull(previousMeta.expense.grossDisplay === null ? null : previousMeta.expense.gross);
    base.inception = OFFICIAL_SOURCE.test(String(previousMeta.inception?.source ?? '')) ? iso(previousMeta.inception?.fundInceptionDate) : null;
    base.benchmark = cleanText(previousMeta.identifiers?.indexTicker || '');
    base.frequencyCode = String(previousMeta.distributions?.frequencyCode || '');
    kept.push('detail');
  }
  const nav = previousMeta.nav;
  if (!loaded.pricing && OFFICIAL_SOURCE.test(String(nav?.source ?? '')) && numberOrNull(nav?.value) !== null) {
    base.nav = numberOrNull(nav.value);
    base.navDate = iso(nav.asOfDate);
    const price = previousMeta.marketPrice;
    base.marketPrice = OFFICIAL_SOURCE.test(String(price?.source ?? '')) ? numberOrNull(price.value) : null;
    base.marketPriceDate = base.marketPrice !== null ? iso(price.asOfDate) : null;
    base.premiumDiscountAmount = numberOrNull(previousMeta.premiumDiscount?.amount);
    base.bidAskSpread = numberOrNull(previousMeta.bidAskSpread?.value);
    base.netAssets = numberOrNull(previousMeta.aum?.value);
    base.netAssetsDate = base.navDate;
    base.netAssetsKind = String(previousMeta.aum?.source || base.netAssetsKind);
    kept.push('pricing');
  }
  const published = previousMeta.returns;
  if (!loaded.returns && published?.returnsBasis === OFFICIAL_RETURNS_BASIS && iso(published.performanceAsOf)) {
    const asOf = iso(published.performanceAsOf);
    const monthEnd = publishedReturnsRow(published.monthEnd, asOf);
    if (monthEnd) {
      base.monthEnd = monthEnd;
      if (/^official/.test(String(published.quarterEndBasis ?? ''))) base.quarterEnd = publishedReturnsRow(published.quarterEnd, isoFromEdgar(published.quarterEnd?.asOfDate)) ?? base.quarterEnd;
      kept.push('returns');
    }
  }
  const yields = previousMeta.yields;
  if (!loaded.yields && OFFICIAL_SEC_YIELD.test(String(yields?.secYieldKind ?? '')) && numberOrNull(yields?.secYield) !== null) {
    base.secYield = numberOrNull(yields.secYield);
    base.secYieldDate = isoFromEdgar(/as of (.+)$/.exec(String(yields.secYieldKind))?.[1] ?? '');
    kept.push('yields');
  }
  const priorDividends = previousDividends(previousMeta);
  if (!loaded.distribution && previousMeta.distributions?.source === OFFICIAL_DISTRIBUTIONS_SOURCE && priorDividends.length) {
    base.dividends = priorDividends.map((payment) => ({ ...payment, exDate: new Date(payment.epoch * 1000).toISOString().slice(0, 10), payDate: '', recordDate: '' }));
    base.latestDividend = base.dividends[base.dividends.length - 1];
    kept.push('distribution');
  }
  if (!kept.length) return { product, kept };
  base.kept = kept;
  return { product: base, kept };
}

async function loadIssuerHoldings(fund: CatalogFund, pageText: string, config: UpdaterConfig): Promise<ParsedHoldings | null> {
  const url = holdingsDownloadUrl(pageText, fund.ticker);
  if (!url) return null;
  if (!/\.csv$/i.test(url)) {
    outputNote(`[ holdings ] ${fund.ticker}: ${url} is not a CSV sheet — using SEC N-PORT-P holdings`);
    return null;
  }
  try {
    const text = await fetchIssuerText(url, `[ holdings ] ${fund.ticker} official CSV`, config);
    if (config.storeRawDownloads) await storeRaw(fund.ticker, 'holdings.csv', text);
    const parsed = parseHoldingsCsv(text);
    if (parsed && parsed.rows.length > 10) return parsed;
    outputNote(`[ holdings ] ${fund.ticker}: official CSV incomplete — using SEC N-PORT-P holdings`);
  } catch (error) {
    outputNote(`[ holdings ] ${fund.ticker}: ${errorMessage(error)} — using SEC N-PORT-P holdings`);
  }
  return null;
}

// SEC Form 497K (summary prospectus): fees and inception. The series-filtered Atom feed lists the fund's own
// 497K filings (supplements without a fee table are skipped), the registrant's submissions JSON names each
// filing's primary document; both are cached per run.
const PROSPECTUS_CANDIDATE_LIMIT = 4;
const NPORT_RETURN_FILINGS = 4;
const submissionDocumentCache = new Map<string, Promise<Map<string, string>>>();
function loadSubmissionDocuments(cik: string, config: UpdaterConfig): Promise<Map<string, string>> {
  let cached = submissionDocumentCache.get(cik);
  if (!cached) {
    cached = fetchSecJson(`${SEC_DATA_HOST}/submissions/CIK${cik.padStart(10, '0')}.json`, `[edgar   ] ${cik} submissions`, config).then((json) => parseSubmissionDocuments(json, '497K'));
    submissionDocumentCache.set(cik, cached);
  }
  return cached;
}
export type ProspectusRead = { facts: ProspectusFacts; accession: string; filed: string; url: string };
async function loadProspectus(fund: CatalogFund, config: UpdaterConfig): Promise<ProspectusRead | null> {
  const ref = (await loadFundTickerMap(config)).get(fund.ticker);
  if (!ref?.seriesId) return null;
  const atom = await fetchSecText(edgarSeriesFilingsUrl(ref.seriesId, 6, '497K'), `[edgar   ] ${fund.ticker} 497K list`, config, 'xml');
  const filings = parseEdgarAtomFilings(atom, '497K').slice(0, PROSPECTUS_CANDIDATE_LIMIT);
  if (!filings.length) return null;
  const documents = await loadSubmissionDocuments(ref.cik, config);
  for (const filing of filings) {
    const document = documents.get(filing.accession);
    if (!document) continue;
    const url = filingDocumentUrl(ref.cik, filing.accession, document);
    const facts = parseProspectusFacts(await fetchSecText(url, `[ 497K     ] ${fund.ticker} ${filing.accession}`, config, 'xml'), fund.ticker);
    if (facts) return { facts, accession: filing.accession, filed: filing.filed, url };
  }
  return null;
}

/** Exit code rule: red only when every selected fund failed AND no source answered a single request. */
export function runFailed(selected: number, failures: number, answered: number): boolean {
  return selected > 0 && failures === selected && answered === 0;
}

/** A published fund is kept (and the fund counted as failed) when this run read no official source for it; a new fund may proceed. */
export function sourceGate(officialRead: boolean, hasPublished: boolean, officialSourcesEnabled: boolean): 'proceed' | 'skip' | 'fail' {
  if (officialRead || !hasPublished) return 'proceed';
  return officialSourcesEnabled ? 'fail' : 'skip';
}

function catalogFundFromIndex(ticker: string, row: JsonRecord): CatalogFund {
  const metrics = (row.metrics as JsonRecord) || {};
  const monthEnd = ((row.returns as JsonRecord)?.monthEnd as JsonRecord) || {};
  const quarterEnd = ((row.returns as JsonRecord)?.quarterEnd as JsonRecord) || {};
  return {
    ticker,
    name: String(row.name ?? ticker),
    category: String(row.category ?? 'ETF'),
    categoryPath: String(row.categoryPath ?? row.category ?? 'ETF'),
    inception: null,
    exchange: String(row.exchange ?? ''),
    cusip: String(row.cusip ?? '').toUpperCase(),
    isin: String(row.isin ?? '').toUpperCase(),
    benchmark: '',
    ter: numberOrNull(row.terValue),
    nav: numberOrNull(row.navValue),
    close: numberOrNull(row.closePriceValue),
    premiumDiscount: numberOrNull(row.premiumDiscountValue),
    netAssets: numberOrNull(row.aumValue),
    dividendYield: numberOrNull(metrics.dividendYield),
    secYield: numberOrNull(metrics.secYield),
    asOfDate: null,
    returns: {
      ytd: numberOrNull(monthEnd.ytd),
      yr1: numberOrNull(monthEnd.yr1),
      yr3: numberOrNull(monthEnd.yr3),
      yr5: numberOrNull(monthEnd.yr5),
      yr10: numberOrNull(monthEnd.yr10),
      sinceInception: numberOrNull(monthEnd.sinceInception),
    },
    returnsAsOfDate: (/^\d{4}-\d{2}-\d{2}$/.test(String(metrics.performanceAsOf ?? '')) ? String(metrics.performanceAsOf) : null) ?? isoFromEdgar(monthEnd.asOfDate),
    mo1: numberOrNull(monthEnd.mo1),
    quarterEnd: {
      ytd: numberOrNull(quarterEnd.ytd),
      yr1: numberOrNull(quarterEnd.yr1),
      yr3: numberOrNull(quarterEnd.yr3),
      yr5: numberOrNull(quarterEnd.yr5),
      yr10: numberOrNull(quarterEnd.yr10),
      sinceInception: numberOrNull(quarterEnd.sinceInception),
    },
    quarterEndAsOfDate: null,
    fundPage: PARAMETRIC_FUND_SLUGS[ticker] ? issuerFundUrl(ticker) : String(row.fundPage ?? ISSUER_CATALOG),
    trustCik: null,
    source: 'previous index',
    secYieldDate: null,
    frequencyCode: '',
    premiumDiscountAmount: null,
  };
}

export function retainUnavailable(candidate: unknown, previous: unknown): unknown {
  if (candidate === null || candidate === undefined || candidate === '' || candidate === '—') return previous ?? candidate;
  if (Array.isArray(candidate)) return candidate;
  if (typeof candidate !== 'object') return candidate;
  const prior = previous && typeof previous === 'object' && !Array.isArray(previous) ? (previous as JsonRecord) : {};
  return Object.fromEntries(Object.entries(candidate).map(([key, value]) => [key, retainUnavailable(value, prior[key])]));
}

// ---------------------------------------------------------------------------
// Per-fund processing (continue-on-error)
// ---------------------------------------------------------------------------

async function processFund(
  fund: CatalogFund,
  config: UpdaterConfig,
  previous: JsonRecord,
): Promise<JsonRecord | null> {
  const ticker = fund.ticker;
  const fundDir = new URL(`funds/${ticker}/`, API_ROOT);
  let previousMeta: JsonRecord = {};
  try { previousMeta = JSON.parse(await readFile(new URL('meta.json', fundDir), 'utf8')); } catch { /* first run */ }
  previous = { ...previous, ...previousMeta };
  fund.inception ??= previousMeta.inception?.fundInceptionDate ?? null;

  // 1) Issuer detail page: headline facts, published returns and distributions.
  let product: ProductData | null = null;
  let pageText = '';
  if (!config.skipIssuer) {
    const productId = PARAMETRIC_PRODUCT_IDS[ticker];
    if (productId) {
      try {
        product = await loadIssuerApi(productId, ticker, config);
      } catch (error) {
        outputNote(`[ product  ] ${ticker}: ${errorMessage(error)}`);
      }
    }
    if (!product) {
      const pageUrl = PARAMETRIC_FUND_SLUGS[ticker] ? issuerFundUrl(ticker) : fund.fundPage;
      try {
        pageText = await fetchIssuerText(pageUrl, `[ product  ] ${ticker}`, config);
        const parsed = parseIssuerProduct(pageText, ticker);
        // The rendered page carries facts only when its tables are present; a page of disclosures alone is a failed read.
        product = parsed.nav !== null || parsed.netExpense !== null || parsed.netAssets !== null ? parsed : null;
        if (config.storeRawDownloads) await storeRaw(ticker, 'product.md', pageText);
      } catch (error) {
        outputNote(`[ product  ] ${ticker}: ${errorMessage(error)}`);
      }
    }
  }
  const issuerAnswered = product !== null;
  // A failed or partial issuer read keeps the published official sections (one unit each); one notice per fund.
  let keptSections: IssuerSection[] = [];
  if (!config.skipIssuer && (!product || product.sections) && Object.keys(previousMeta).length) {
    ({ product, kept: keptSections } = retainIssuerSections(product, ticker, previousMeta));
    if (keptSections.length) console.log(`[ ${'kept'.padEnd(9)}] ${ticker}: the issuer read ${issuerAnswered ? 'came back partial' : 'failed'}, kept the published ${keptSections.join(', ')}`);
  }
  const known = (section: IssuerSection): boolean => Boolean(product && (!product.sections || product.sections[section] || product.kept?.includes(section)));
  const secFacts = !known('detail');
  const officialHoldings = pageText ? await loadIssuerHoldings(fund, pageText, config) : null;
  if (officialHoldings && product) product.holdings = officialHoldings;
  const cusip = product?.cusip || fund.cusip || String(previous.identifiers?.cusip || '');

  // 2) SEC EDGAR, reachable from datacenter runners: N-PORT-P (holdings, net assets, monthly NAV returns) and the
  //    497K summary prospectus (fees, inception). The issuer's own holdings sheet wins when the page was read.
  let holdings: ParsedHoldings | null = product?.holdings ?? null;
  let holdingsSource = holdings ? 'Eaton Vance official daily holdings download' : String(previous.holdings?.source || 'previous run');
  const nportFilings: NportOwnFiling[] = [];
  let holdingsEdgar: NportOwnFiling | null = null;
  let secReturns: SecReturns | null = null;
  let prospectus: ProspectusRead | null = null;
  if (config.edgarFallback) {
    const needHoldings = !holdings;
    // the newest own filing also gives the SEC net assets, series name and index when the issuer facts are missing
    const wanted = known('returns') ? (needHoldings ? 1 : 0) : NPORT_RETURN_FILINGS;
    try {
      const ref = needHoldings || wanted ? await nportFundRef(fund, config) : null;
      if ((needHoldings || wanted) && !ref) console.warn(`[ edgar    ] ${ticker}: no SEC registrant found`);
      if (ref && needHoldings) {
        // the fund's own newest filing, used only when strictly newer than the published holdings (shared nport-reader block)
        const read = await readNportHoldings(ref, { asOf: previousMeta.holdings?.asOfDate, rows: numberOrNull(previousMeta.holdings?.totalRows) ?? 0 }, (url, label) => secText(url, `[ nport    ] ${label}`, config), { cache: secState.reader });
        if ('problem' in read) outputNote(`[ edgar    ] ${read.problem}`);
        else {
          const document = await secText(read.url, `[ nport    ] ${ticker} N-PORT ${read.candidate.accession}`, config);
          holdingsEdgar = { filing: read.filing, repPdDate: read.filing.repPdDate, monthlyReturns: parseNportMonthlyReturns(document), designatedIndex: parseNportDesignatedIndex(document) };
          holdings = { asOfDate: read.filing.repPdDate || null, headers: HOLDINGS_HEADERS, rows: nportHoldingsSheet(read.filing, nportTickers(read.filing.positions, await loadCompanyNames(config))) };
          holdingsSource = `SEC EDGAR Form N-PORT-P (accession ${read.candidate.accession}, report period ${read.filing.repPdDate || 'n/a'})`;
        }
      }
      if (ref) nportFilings.push(...(await loadOwnNportFilings(ref, wanted, config)));
      if (ref && wanted && !nportFilings.length) console.warn(`[ edgar    ] ${ticker}: no N-PORT-P filing of this series found`);
    } catch (error) {
      console.warn(`[ edgar    ] ${ticker}: ${errorMessage(error)}`);
    }
    if (secFacts) {
      const classId = (await loadFundTickerMap(config)).get(ticker)?.classId ?? '';
      secReturns = known('returns') ? null : nportQuarterReturns(nportFilings, classId);
      try {
        prospectus = await loadProspectus(fund, config);
        if (!prospectus) console.warn(`[ edgar    ] ${ticker}: no 497K summary prospectus with a fee table found`);
      } catch (error) {
        console.warn(`[ edgar    ] ${ticker}: 497K: ${errorMessage(error)}`);
      }
    }
  }
  const latestNport: NportOwnFiling | null = holdingsEdgar ?? nportFilings[0] ?? null;

  // Every fund is either refreshed from at least one official source or kept exactly as published: Yahoo prices alone never
  // replace official facts, and a derived return is never printed next to an official label.
  const gate = sourceGate(issuerAnswered || prospectus !== null || latestNport !== null, Object.keys(previousMeta).length > 0, !config.skipIssuer || config.edgarFallback);
  if (gate === 'skip') return null;
  if (gate === 'fail') throw new Error('no official source answered (issuer and SEC EDGAR) - kept the published fund unchanged');

  const holdingsRows: JsonRecord[] = holdings ? holdings.rows : await readPreviousSheet(ticker, 'holdings');
  const holdingsHeaders = holdings?.headers.length
    ? holdings.headers
    : (await readPreviousSheetHeaders(ticker, 'holdings')).length
      ? await readPreviousSheetHeaders(ticker, 'holdings')
      : HOLDINGS_HEADERS;
  const holdingsAsOf = holdings?.asOfDate ?? ((previous.holdings as JsonRecord)?.asOfDate as string | undefined) ?? null;
  const previousHoldingsCount = numberOrNull((previous.holdings as JsonRecord)?.totalRows) ?? holdingsRows.length;
  // Fresh holdings (issuer CSV or N-PORT-P, never the re-read previous sheet) that look broken (no weight column, non-numeric
  // weights, a bad weight sum, half the rows gone) never replace the published ones: the fund is kept and counted as failed.
  const publishedHeaders = await readPreviousSheetHeaders(ticker, 'holdings');
  const publishedWeights = holdings && Object.keys(previousMeta).length ? holdingsWeightCount(publishedHeaders.length ? publishedHeaders : HOLDINGS_HEADERS, await readPreviousSheet(ticker, 'holdings')) : null;
  const holdingsProblem = holdings ? holdingsGuard(holdingsHeaders, holdingsRows, numberOrNull(previousMeta.holdings?.totalRows), HOLDINGS_GUARD_RELAX[ticker] ?? HOLDINGS_GUARD_RELAX['*'] ?? [], publishedWeights) : null;
  if (holdingsProblem) throw new Error(`holdings guard: ${holdingsProblem}; ${Object.keys(previousMeta).length ? 'kept the published fund unchanged' : 'no data published for this fund yet'}`);

  // 3) History: the Yahoo chart (adjusted daily series + dividends).
  let chart: ParsedChart | null = null;
  if (!config.skipYahoo) {
    try {
      const fetched = parseChart(await fetchJson(chartUrl(ticker, config), `[ chart    ] ${ticker}`, yahooHeaders(), config));
      // A HISTORY_RANGE window never shrinks the published history and distributions (and with them 3y, 5y, 10y and since inception)
      chart = /^\d+y$/i.test(config.historyRange) ? mergeWindowedChart(fetched, await readPreviousSheet(ticker, 'history'), Array.isArray(previousMeta.distributions?.rows) ? previousMeta.distributions.rows : []) : fetched;
      if (!chart) throw new Error(`the ${config.historyRange} chart window does not join the published history`);
    } catch (error) {
      outputNote(`[ chart    ] ${ticker}: ${errorMessage(error)} — keeping previous history`);
    }
  }

  const previousHistory = await readPreviousSheet(ticker, 'history');
  let history: JsonRecord[] = previousHistory;
  let historySource = ((previous.history as JsonRecord)?.source as string) || 'previous run';
  let coveredFrom: string | null = null;
  if (chart?.days.length) {
    history = mergeHistory(previousHistory, chart.days);
    coveredFrom = chart.days[0].date;
    historySource = 'Yahoo Finance public chart API (adjusted close)';
  }
  if (!history.length && !holdingsRows.length) {
    throw new Error('No holdings or history available; fund not published');
  }
  // Returns are derived from the same kept cents the history pages publish, so Yahoo's float noise
  // can flip neither a stored Adj Close nor a stored return.
  const keptAdj = new Map(chartDaysFromRows(history).map((day) => [day.date, day.adjClose]));
  const chartDays = chart?.days.length ? chart.days.map((day) => ({ ...day, adjClose: keptAdj.get(day.date) ?? day.adjClose })) : chartDaysFromRows(history);
  const derivedReturns = chartDays.length ? priceReturns(chartDays, new Date(), coveredFrom) : EMPTY_PRICE_RETURNS;

  // 4) Distributions: the published schedule wins; Yahoo dividends fill the gaps.
  const yahooDividends = chart?.dividends ?? [];
  const priorDividends = previousDividends(previous);
  const dividends = product?.dividends.length
    ? product.dividends.map((payment) => ({ epoch: payment.epoch, amount: payment.amount }))
    : (yahooDividends.length ? yahooDividends : priorDividends);
  const latestDividend = dividends.length ? dividends[dividends.length - 1] : null;
  const catalogFrequency = issuerFrequency(fund.frequency);
  const decodedFrequency = product?.frequencyCode
    ? DIVIDEND_FREQUENCY_CODES[product.frequencyCode] ?? null
    : catalogFrequency.paymentsPerYear !== null
      ? catalogFrequency
      : null;
  const inferredFrequency = dividends.length >= 2 ? inferDistributionFrequency(dividends) : null;
  const frequency =
    decodedFrequency && decodedFrequency.paymentsPerYear !== null
      ? decodedFrequency
      : inferredFrequency && inferredFrequency.paymentsPerYear !== null
        ? inferredFrequency
        : decodedFrequency
          ? decodedFrequency
          : dividends.length
            ? inferDistributionFrequency(dividends)
            : { frequency: String((previous.distributions as JsonRecord)?.frequency || '—'), paymentsPerYear: null };

  // 5) Headline numbers: the issuer when it answered, SEC EDGAR otherwise; what neither carries is an honest null
  //    (an older published NAV, TER or yield is never presented as current). Immutable facts (inception, identifiers) are kept.
  const inception = product?.inception ?? prospectus?.facts.inception ?? fund.inception ?? null;
  const inceptionSource = product?.inception ? 'issuer' : prospectus?.facts.inception ? 'sec-497k' : inception ? 'previous run (immutable)' : null;
  const officialProduct = known('returns') ? product : null;
  const returnsAsOfDate = officialProduct?.monthEnd.asOfDate ?? null;
  // the shared "younger than one year" rule: no horizon the fund is too young for (calendar anniversary), official or derived
  const official = withoutYoungReturns(officialReturnsFor(officialProduct), inception, returnsAsOfDate, { yr1: 1, yr3: 3, yr5: 5, yr10: 10, sinceInception: 1 });
  const derived = withoutYoungReturns(derivedReturns, inception, derivedReturns.asOfDate, { yr1: 1, cagr3y: 3, cagr5y: 5, cagr10y: 10, siAnn: 1 });
  const officialCumulative = officialProduct?.quarterEnd ? { ...EMPTY_CUMULATIVE } : null;
  const feeNet = secFacts ? prospectus?.facts.netExpense ?? null : product!.netExpense;
  const feeGross = secFacts ? prospectus?.facts.grossExpense ?? null : product!.grossExpense;
  const ter = feeNet ?? feeGross;
  const terGross = feeGross ?? feeNet;
  const nav = product ? product.nav : null;
  // Market price: the issuer's when read, else the Yahoo quote of this run, else the last close already in the published history (dated as such).
  const lastKnownDay = chartDays.length ? chartDays[chartDays.length - 1] : null;
  const price = product?.marketPrice ?? chart?.regularMarketPrice ?? lastKnownDay?.close ?? null;
  const priceDate = product?.marketPrice != null
    ? product.marketPriceDate
    : chart?.regularMarketPrice != null
      ? (chart.regularMarketTime ? epochToIsoDate(chart.regularMarketTime) : null)
      : lastKnownDay?.date ?? null;
  const priceSource = product?.marketPrice != null
    ? 'official Eaton Vance / MSIM product data (market price)'
    : chart?.regularMarketPrice != null
      ? 'Yahoo Finance chart API (regular market price)'
      : lastKnownDay ? 'last close in the published Yahoo history (this run could not reach Yahoo)' : 'not available';
  const secYield = product ? product.secYield : null;
  const secYieldDate = product ? product.secYieldDate : null;
  const metrics = deriveCatalogMetrics(
    official,
    derived,
    product?.dividendYield ?? null,
    secYield,
    latestDividend ? latestDividend.amount : null,
    frequency.paymentsPerYear,
    price,
    officialCumulative,
    returnsAsOfDate,
  );

  const filterReasons = fundFilterReasons({ ticker, aumValue: product?.netAssets ?? latestNport?.filing.netAssets ?? null, terValue: ter, metrics }, config);
  if (filterReasons.length) { outputNote(`[ filter   ] ${ticker}: ${filterReasons.join('; ')}`); return null; }

  const holdingsManifest = await writePages(fundDir, ticker, 'holdings', holdingsHeaders, holdingsRows, config.holdingsPageSize);
  const historyManifest = await writePages(fundDir, ticker, 'history', YAHOO_HISTORY_HEADERS, history, config.historyPageSize);
  const distributions = dividends.length ? distributionRows(dividends) : (((previous.distributions?.rows as JsonRecord[]) || []) as string[][]);

  // Without a fresh issuer catalog the N-PORT-P series name is the most
  // authoritative fund name available.
  const name = product?.name || latestNport?.filing.seriesName || fund.name || String(previous.name ?? '') || ticker;
  // The product page publishes the premium/discount in dollars; the sibling
  // feeds publish a percentage, so it is computed from the page's own NAV and
  // market price (and the published dollar figure is kept alongside).
  const premiumDiscountAmount = product?.premiumDiscountAmount ?? null;
  const premiumDiscount = nav && price ? round(((price - nav) / nav) * 100, 2) : null;
  const nportNetAssets = latestNport
    ? latestNport.filing.netAssets ?? nportTotalValue(latestNport.filing)
    : null;
  const catalogNetAssets = product?.netAssets ?? null;
  const netAssets = catalogNetAssets ?? nportNetAssets ?? (product ? null : (fund.netAssets ?? null));
  const aumDate = catalogNetAssets !== null ? (product?.netAssetsDate ?? null) : (nportNetAssets !== null ? (latestNport?.repPdDate || null) : null);
  const navAsOfDate = product?.navDate ?? null;
  const returnsData = returnsBlock(derived, official, officialProduct ? officialProduct.monthEnd.mo1 : null, returnsAsOfDate, previous, officialProduct ? { qtd: officialProduct.monthEnd.qtd ?? null, quarterEnd: officialProduct.quarterEnd } : null, secReturns);
  const rowAsOfDate = navAsOfDate ?? priceDate;
  const asOfLabel = rowAsOfDate ? formatEdgarDate(rowAsOfDate) : String(previous.asOfDate ?? '—');
  const category = product?.assetClass && product.assetClass !== 'ETF' ? product.assetClass : fund.category;
  const benchmark = product?.benchmark || latestNport?.designatedIndex || fund.benchmark;
  const exchange = product?.exchange || fund.exchange || chart?.exchangeName || String(previous.exchange ?? '');
  const fundPage = PARAMETRIC_FUND_SLUGS[ticker] ? issuerFundUrl(ticker) : fund.fundPage;
  const holdingsCount = holdings ? holdingsRows.length : previousHoldingsCount;

  const meta: JsonRecord = {
    ticker,
    name,
    category,
    categoryPath: benchmark ? `${category} / ${benchmark}` : category,
    source: {
      fundPage,
      catalog: ISSUER_CATALOG,
      yahooChart: `${YAHOO_CHART_URL}/${encodeURIComponent(ticker)}`,
      holdingsSource,
      historySource,
      provider: `${product ? 'Eaton Vance / MSIM product data service (www.eatonvance.com/im/json/imwebdata) + ' : ''}SEC EDGAR (Form 497K fees and inception, Form N-PORT-P holdings, net assets and monthly NAV returns) + Yahoo Finance public chart API (market price, history and dividends)`,
      prospectus: prospectus ? { url: prospectus.url, accession: prospectus.accession, filed: prospectus.filed, documentDate: prospectus.facts.documentDate } : null,
      factsFrom: product ? 'issuer' : 'sec-edgar',
    },
    identifiers: { cusip: cusip || null, isin: product?.isin || fund.isin || null, indexTicker: benchmark || null },
    inception: {
      fundInceptionDate: inception,
      inceptionDate: inception ? formatEdgarDate(inception) : null,
      listingDate: null,
      source: inceptionSource === 'issuer'
        ? 'official Eaton Vance / MSIM product data'
        : inceptionSource === 'sec-497k'
          ? `SEC Form 497K summary prospectus (accession ${prospectus?.accession}, "commenced operations")`
          : inceptionSource,
    },
    expense: {
      gross: terGross,
      net: ter,
      display: ter === null ? '—' : `${ter.toFixed(2)}%`,
      grossDisplay: feeGross === null ? null : `${feeGross.toFixed(2)}%`,
      netDisplay: feeNet === null ? null : `${feeNet.toFixed(2)}%`,
      asOf: !secFacts ? asOfLabel : prospectus ? formatEdgarDate(prospectus.facts.documentDate || prospectus.filed) : '—',
      source: !secFacts
        ? 'official Eaton Vance / MSIM product data (net and gross expense ratio; terValue is the net ratio)'
        : prospectus
          ? `official SEC Form 497K summary prospectus dated ${prospectus.facts.documentDate || prospectus.filed} (accession ${prospectus.accession}): gross = total annual fund operating expenses, net = after fee waiver; terValue is the net ratio`
          : 'not available: neither the issuer nor a SEC 497K fee table was read in this run',
    },
    nav: {
      display: nav === null ? '—' : `$${nav.toFixed(2)}`,
      value: nav,
      asOfDate: navAsOfDate,
      source: known('pricing') ? 'official Eaton Vance / MSIM product data (pricing)' : 'not available: the per-share NAV is published only on the issuer site, which blocks datacenter runners (SEC filings carry no daily NAV)',
    },
    marketPrice: {
      display: price === null ? '—' : `$${price.toFixed(2)}`,
      value: price,
      asOfDate: priceDate,
      source: priceSource,
    },
    premiumDiscount: {
      display: premiumDiscount === null ? '—' : `${premiumDiscount.toFixed(2)}%`,
      value: premiumDiscount,
      asOfDate: navAsOfDate,
      source: known('pricing') ? 'computed from the issuer NAV and market price of the same date' : 'not available without the issuer NAV',
      amount: premiumDiscountAmount,
    },
    bidAskSpread: {
      display: product?.bidAskSpread === null || product?.bidAskSpread === undefined ? '—' : `${product.bidAskSpread.toFixed(2)}%`,
      value: product?.bidAskSpread ?? null,
      asOfDate: navAsOfDate,
      source: known('pricing') ? 'official Eaton Vance / MSIM product data (median bid/ask spread)' : 'not available without the issuer product data',
    },
    aum: {
      display: netAssets === null ? '—' : `$${(netAssets / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M`,
      value: netAssets,
      asOfDate: aumDate ? formatEdgarDate(aumDate) : '—',
      source: catalogNetAssets !== null
        ? (product?.netAssetsKind || 'official Eaton Vance / MSIM product page (total net assets)')
        : nportNetAssets !== null
          ? `official SEC Form N-PORT-P net assets as of the report period ${latestNport?.repPdDate || 'n/a'} (a quarter-end figure, older than the prices)`
          : 'not available',
    },
    yields: {
      dividendYield: metrics.dividendYield,
      dividendYieldText: metrics.dividendYieldText,
      dividendYieldBasis: metrics.dividendYieldBasis,
      dividendYieldKind: metrics.dividendYield !== null
        ? 'indicated (latest distribution x payments per year / market price)'
        : 'not published: no distributions yet',
      secYield: metrics.secYield,
      secYieldText: metrics.secYieldText,
      secYieldKind: metrics.secYield !== null
        ? `30-day SEC yield as published by eatonvance.com${secYieldDate ? `, as of ${formatEdgarDate(secYieldDate)}` : ''}`
        : 'not available: published only on the issuer site (blocked for datacenter runners) and not in SEC filings',
    },
    returns: returnsData ? { ...returnsData, returnsBasis: metrics.returnsBasis, performanceAsOf: metrics.performanceAsOf } : returnsData,
    distributions: {
      frequency: frequency.frequency,
      paymentsPerYear: frequency.paymentsPerYear,
      frequencyCode: product?.frequencyCode || null,
      source: product?.dividends.length ? OFFICIAL_DISTRIBUTIONS_SOURCE : yahooDividends.length ? 'Yahoo Finance chart API dividends' : String((previous.distributions as JsonRecord)?.source || 'previous run'),
      headers: ['Ex-Date', 'Amount'],
      rows: distributions,
    },
    holdings: {
      ...holdingsManifest,
      totalRows: holdingsManifest.totalRows || holdingsCount,
      asOfDate: holdingsAsOf,
      asOf: holdingsAsOf ? formatEdgarDate(holdingsAsOf) : '—',
      source: holdingsSource,
    },
    history: {
      ...historyManifest,
      asOf: chart?.days.length ? formatEdgarDate(chart.days[chart.days.length - 1].date) : (((previous.history as JsonRecord)?.asOf as string) ?? '—'),
      source: historySource,
    },
  };
  await writeIfChanged(new URL('meta.json', fundDir), meta);

  const monthEnd = ((returnsData as JsonRecord)?.monthEnd as JsonRecord) || {};
  return {
    ticker,
    name,
    category,
    categoryPath: meta.categoryPath,
    fundPage,
    dataFile: `./funds/${ticker}/meta.json`,
    cusip: cusip || null,
    isin: product?.isin || fund.isin || null,
    exchange,
    ter: ter === null ? '—' : `${ter}%`,
    terValue: ter,
    terGross: terGross === null ? '—' : `${terGross}%`,
    terGrossValue: terGross,
    nav: nav === null ? '—' : `$${nav.toFixed(2)}`,
    navValue: nav,
    aum: netAssets === null ? '—' : formatAumDisplay(netAssets),
    aumValue: netAssets,
    aumAsOfDate: aumDate ? formatEdgarDate(aumDate) : '—',
    asOfDate: asOfLabel,
    inceptionDate: inception ? formatEdgarDate(inception) : '—',
    closePrice: price === null ? '—' : `$${price.toFixed(2)}`,
    closePriceValue: price,
    premiumDiscount: premiumDiscount === null ? '—' : `${premiumDiscount.toFixed(2)}%`,
    premiumDiscountValue: premiumDiscount,
    distributions: {
      frequency: frequency.frequency,
      exDate: latestDividend ? formatUsDate(latestDividend.epoch) : '—',
      dividend: latestDividend ? String(round(latestDividend.amount, 6)) : '—',
    },
    returns: { monthEnd, quarterEnd: ((returnsData as JsonRecord)?.quarterEnd as JsonRecord) ?? null },
    metrics,
    holdings: holdingsCount,
    history: history.length,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// --- TLS trust store (identical in every ETF repo) ---
const SYSTEM_CA_MARKER = 'ETF_UPDATER_SYSTEM_CA';
const CERT_ERROR = /UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT|CERT_HAS_EXPIRED|unable to get (?:local )?issuer certificate|self[- ]signed certificate|certificate has expired/i;

export function isCertError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; cause?: unknown } | null;
  return CERT_ERROR.test(`${String(e?.code ?? '')} ${String(e?.message ?? '')}`) || (e?.cause ? isCertError(e.cause) : false);
}

export function systemCaActive(env: Record<string, string | undefined> = process.env, execArgv: string[] = process.execArgv): boolean {
  return execArgv.includes('--use-system-ca') || env.NODE_USE_SYSTEM_CA === '1' || env[SYSTEM_CA_MARKER] === '1';
}

export function reexecWithSystemCa(): never {
  const child = Bun.spawnSync([process.execPath, '--use-system-ca', ...process.argv.slice(1)], {
    env: { ...process.env, [SYSTEM_CA_MARKER]: '1' },
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  process.exit(child.exitCode ?? 1);
}

/** mode: auto (restart once on an untrusted-certificate error), true (restart now), false (never). */
export function installSystemCa(mode: string, reexec: () => never = reexecWithSystemCa, active: boolean = systemCaActive()): void {
  if (mode === 'false' || active) return;
  if (mode === 'true') reexec();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    try { return await realFetch(...args); }
    catch (error) {
      if (!isCertError(error)) throw error;
      console.error('[ notice   ] TLS certificate not trusted; restarting once with --use-system-ca');
      return reexec();
    }
  }) as typeof fetch;
}

// File defaults and explicit overrides: allowlisted scalar controls only, so
// GitHub Actions can resolve them without interpolating user input into bash.
// Precedence: config file < advanced JSON < nonblank named inputs < environment
// (an explicitly set variable wins even when empty; `PARAMETRIC_<KEY>` wins over
// `<KEY>`) < protected Actions variables (passed by the workflow as `env`).
export const CONTROL_NAMES = [
  'MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY', 'AUM', 'TER', 'DIVIDEND_YIELD', 'SEC_YIELD', 'TICKERS',
  'HOLDINGS_PAGE_SIZE', 'HISTORY_PAGE_SIZE', 'MAX_RETRIES', 'HISTORY_RANGE', 'STORE_RAW_DOWNLOADS',
  'CATALOG_URL', 'SEC_UA', 'SKIP_YAHOO', 'SKIP_ISSUER', 'EDGAR_FALLBACK', 'USE_SYSTEM_CA', 'VERBOSE',
  ...['PERFORMANCE', 'TOTAL_RETURN'].flatMap((prefix) => RETURN_PERIODS.map((period) => `${prefix}_${period}`)),
] as const;
export type ControlName = (typeof CONTROL_NAMES)[number];
export const CONFIG_FILE_URL = new URL('./update-data.config.json', import.meta.url);
// Legacy environment aliases that keep working next to PARAMETRIC_<NAME> and <NAME>.
const CONTROL_ALIASES: Partial<Record<ControlName, string[]>> = {
  MAX_FETCHES: ['PARAMETRIC_LIMIT'],
  HISTORY_PAGE_SIZE: ['HISTORICAL_PAGE_SIZE'],
};

export function resolveControls(
  file: unknown = {},
  advanced: unknown = {},
  inputs: unknown = {},
  env: Record<string, string | undefined> = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  const known = new Set<string>(CONTROL_NAMES);
  const apply = (value: unknown, skipEmpty = false): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuration must be a JSON object');
    for (const [key, raw] of Object.entries(value)) {
      if (!known.has(key)) throw new Error(`Unknown updater control: ${key}`);
      if (skipEmpty && (raw === '' || raw === undefined || raw === null)) continue;
      if (!['string', 'number', 'boolean'].includes(typeof raw)) throw new Error(`${key}: expected string, number or boolean`);
      const text = String(raw);
      if (/[\r\n\0]/.test(text)) throw new Error(`${key}: multiline/control characters are not allowed`);
      result[key] = text;
    }
  };
  apply(file);
  apply(advanced);
  apply(inputs, true);
  for (const key of CONTROL_NAMES) {
    const value = env[`PARAMETRIC_${key}`] ?? env[key] ?? CONTROL_ALIASES[key]?.map((alias) => env[alias]).find((v) => v !== undefined);
    if (value !== undefined) apply({ [key]: value });
  }
  for (const key of ['MAX_FETCHES', 'CONCURRENCY', 'HOLDINGS_PAGE_SIZE', 'HISTORY_PAGE_SIZE', 'MAX_RETRIES']) {
    const v = result[key];
    if (v === undefined || v === '') continue;
    const min = key === 'MAX_FETCHES' ? 0 : 1;
    if (!/^\d+$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) < min) throw new Error(`${key}: expected integer >= ${min}`);
  }
  if (result.REQUEST_SLEEP && (!Number.isFinite(Number(result.REQUEST_SLEEP)) || Number(result.REQUEST_SLEEP) < 0)) throw new Error('REQUEST_SLEEP: expected nonnegative seconds');
  if (result.HISTORY_RANGE && !/^(max|[1-9]\d*y)$/i.test(result.HISTORY_RANGE)) throw new Error('HISTORY_RANGE: use max or Ny');
  for (const key of ['STORE_RAW_DOWNLOADS', 'SKIP_YAHOO', 'SKIP_ISSUER', 'EDGAR_FALLBACK', 'VERBOSE']) {
    if (result[key] && !/^(0|1|true|false|yes|no|y|n|on|off)$/i.test(result[key])) throw new Error(`${key}: expected boolean`);
  }
  if (result.USE_SYSTEM_CA !== undefined) {
    if (!/^(auto|true|false)$/i.test(result.USE_SYSTEM_CA)) throw new Error('USE_SYSTEM_CA: expected auto, true or false');
    result.USE_SYSTEM_CA = result.USE_SYSTEM_CA.toLowerCase();
  }
  if (result.CATALOG_URL && !/^https?:\/\/\S+$/.test(result.CATALOG_URL)) throw new Error('CATALOG_URL: expected an absolute URL');
  readConfig(result); // validate every min:max filter before any request or write
  return result;
}

export async function runtimeControls(env: Record<string, string | undefined> = process.env): Promise<Record<string, string>> {
  let file: unknown = {};
  try { file = JSON.parse(await readFile(CONFIG_FILE_URL, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return resolveControls(file, {}, {}, env);
}

/**
 * Fund worker pool: `workers` independent workers drain one queue, each inside
 * its own request lane (REQUEST_SLEEP applies per worker, so workers fetch in
 * parallel; there is no global request-start queue).
 */
export async function runPool<T>(items: T[], workers: number, delayMs: number, handle: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const worker = async (): Promise<void> => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await handle(item);
  };
  const count = Math.max(1, Math.min(workers, items.length));
  await Promise.all(Array.from({ length: count }, () => withRequestLane(delayMs, worker)));
}

// The saved cursor is the last fund of the batch (in batch order) that updated
// successfully, independent of which concurrent worker finished first.
export function nextCursor(batch: Array<{ ticker: string }>, succeeded: Set<string>, previous: string | null): string | null {
  for (let i = batch.length - 1; i >= 0; i--) if (succeeded.has(batch[i].ticker)) return batch[i].ticker;
  return previous;
}

export function batchSelection(funds: CatalogFund[], config: UpdaterConfig, cursor: string | null): CatalogFund[] {
  const selected = withoutClosedFunds(funds.filter((fund) => !config.tickers.length || config.tickers.includes(fund.ticker)), (fund) => fund.ticker, CLOSED_FUNDS);
  if (!config.maxFetches) return selected;
  const index = selected.findIndex((fund) => fund.ticker === cursor);
  const ordered = index < 0 ? selected : selected.slice(index + 1).concat(selected.slice(0, index + 1));
  return ordered.slice(0, config.maxFetches);
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const controls = await runtimeControls(process.env);
  if (controls.VERBOSE !== undefined) process.env.VERBOSE = controls.VERBOSE;
  installSystemCa(controls.USE_SYSTEM_CA ?? 'auto');
  const config = readConfig(controls);
  await mkdir(API_ROOT, { recursive: true });
  const requestSleepMs = Math.max(0, config.requestSleep) * 1000;
  discoveryGate = createRequestGate(requestSleepMs);
  configureProxyGate(Math.max(requestSleepMs, PROXY_SLEEP_SECONDS * 1000));
  outputPrintConfig('Parametric', config);
  const catalog = new Map<string, CatalogFund>();
  const previousIndex = await readPreviousIndex();
  const previousRows = Array.from(previousIndex.values());
  // The live catalog (null when only the published feed is known): a catalog-only row it no longer lists is dropped, never retried.
  let live: string[] | null = null;
  let catalogSource = 'previous published index';
  if (!config.skipIssuer) {
    try {
      let entries: CatalogEntry[];
      try {
        entries = parseIssuerCatalog(await fetchIssuerText(config.catalogUrl, '[ catalog  ]', config));
      } catch (error) {
        // The catalog is rendered client side: a direct answer without fund links is retried once through the rendering proxy.
        if (issuerProxyOnly || issuerUnreachable || !/no Parametric fund links/.test(errorMessage(error))) throw error;
        entries = parseIssuerCatalog(await fetchIssuerViaProxy(config.catalogUrl, '[ catalog  ]', config, false));
      }
      for (const entry of entries) {
        const fund = catalogFundFromIndex(entry.ticker, previousIndex.get(entry.ticker) || {});
        fund.name = entry.name || fund.name;
        fund.fundPage = entry.fundPage;
        fund.source = 'parametric';
        fund.nav ??= entry.nav;
        fund.close ??= entry.marketPrice;
        fund.secYield ??= entry.secYield;
        fund.secYieldDate = entry.secYieldDate;
        fund.asOfDate ??= entry.asOfDate;
        fund.frequency = entry.frequency;
        catalog.set(entry.ticker, fund);
      }
      live = entries.map((entry) => entry.ticker);
      catalogSource = 'Eaton Vance / MSIM official ETF catalog';
    } catch (error) { console.warn(`[ catalog  ] ${errorMessage(error)} — retained published catalog`); }
  }
  // Published funds stay in the universe: every row without a live catalog, only the ones with data next to a live catalog.
  for (const [ticker, row] of previousIndex) if (!catalog.has(ticker) && (!live || row.dataFile)) catalog.set(ticker, catalogFundFromIndex(ticker, row));
  // Q27: a TICKERS entry outside the live catalog and the published funds stops the run before any fund request
  assertKnownTickers(config.tickers.length ? config.tickers : null, knownTickers(live, previousRows), 'the Parametric catalog or published feed');
  const universe = [...catalog.values()].sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));
  if (!universe.length) throw new Error('No verified issuer catalog or published seed available');
  console.log(`[ catalog  ] ${universe.length} Parametric ETFs (${catalogSource})`);

  // A TICKERS run never reads, writes or deletes the cursor (First-Trust rule).
  const useCursor = !config.tickers.length;
  const state = useCursor ? await readUpdateState() : null;
  // A plain `bun ./scripts/update-data.ts` (no MAX_FETCHES) always walks the
  // whole catalog from the top and clears the cursor afterwards; the saved
  // cursor only rotates the queue for explicitly bounded batch runs.
  const cursor = config.maxFetches > 0 && state?.scope === cursorScope(config) ? state.cursor || null : null;
  const selected = batchSelection(universe, config, cursor);
  const results: JsonRecord[] = [];
  const succeeded = new Set<string>();
  let failures = 0;

  outputPrintFilter(selected.length, universe.length, outputHasOutputFilters({ ...config, tickers: [] }));
  const output = outputCreateReporter(API_ROOT, selected.length);
  fundListStarted = true;
  // Soft deadline: stop taking new funds after 25 minutes so the index is still written before the 30 minute job limit.
  const deadline = Date.now() + 25 * 60_000;
  await runPool(selected, config.concurrency, requestSleepMs, async (fund) => {
    if (Date.now() > deadline) return;
    const before = await output.before(fund.ticker);
    try {
      const row = await processFund(fund, config, publishedRow(previousIndex.get(fund.ticker)));
      if (row) {
        results.push(row);
        succeeded.add(fund.ticker);
      }
      await output.result(fund.ticker, before, row ? undefined : 'skipped');
    } catch (error) {
      failures += 1;
      await output.result(fund.ticker, before, 'failed', String(error));
    }
  });
  const lastProcessedTicker = nextCursor(selected, succeeded, cursor);

  // Funds not selected for a successful update keep their previously published rows (stale catalog-only rows are dropped).
  const kept = new Map<string, JsonRecord>(withoutStalePlaceholders(previousRows, live).map((row) => [String(row.ticker), row] as [string, JsonRecord]));
  const keptFromPrevious = universe
    .filter((fund) => !results.some((row) => row.ticker === fund.ticker))
    .map((fund) => kept.get(fund.ticker))
    .filter(Boolean) as JsonRecord[];
  // A catalog fund with no published data (new, or its first refresh failed or was rejected by the guard) still gets a catalog-only row.
  const catalogOnly = universe
    .filter((fund) => !results.some((row) => row.ticker === fund.ticker) && !kept.has(fund.ticker))
    .map((fund) => catalogOnlyRow(fund));
  const funds = markClosedFunds([...results, ...keptFromPrevious, ...catalogOnly].sort((a, b) => String(a.ticker).localeCompare(String(b.ticker))), CLOSED_FUNDS);

  const counts = {
    funds: funds.length,
    holdings: funds.reduce((sum, fund) => sum + (numberOrNull(fund.holdings) || 0), 0),
    history: funds.reduce((sum, fund) => sum + (numberOrNull(fund.history) || 0), 0),
  };

  await writeIfChanged(INDEX_FILE, {
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    source: {
      provider: 'Eaton Vance / MSIM product pages (ETF catalog, fund facts, returns and distributions); SEC EDGAR Form N-PORT-P holdings; Yahoo Finance chart API (daily NAV history and dividends)',
      site: ISSUER_SITE,
      catalog: ISSUER_CATALOG,
      catalogDownload: config.catalogUrl,
    },
    counts,
    funds,
  });
  // Q28: a fund is announced on its first successful publish (a catalog-only row is not published), new catalog-only rows as pending
  const newFunds = newFundsLines(newFundsReport(previousRows, funds));
  for (const line of newFunds) console.log(line);
  if (newFunds.length && process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### NEW FUNDS\n\n${newFunds.join('\n')}\n`, 'utf8');

  // Full passes reset the cursor: the next run starts from the top again.
  if (useCursor) await writeUpdateState(lastProcessedTicker, config);

  const failed = runFailed(selected.length, failures, runHealth().answered);
  if (!failed && failures) console.warn(`[ kept     ] ${failures} fund(s) kept as published because their sources failed; ${runHealth().answered} requests were answered, so the run stays green`);
  console.log(output.summary(startedAt));
  console.log(outputCounts(counts.funds, counts.holdings, counts.history));
  console.log(
    `[ cursor   ] ${!useCursor ? 'TICKERS run: cursor untouched' : config.maxFetches > 0 && lastProcessedTicker ? `next run continues after ${lastProcessedTicker}` : 'full pass complete (cursor reset)'}`,
  );

  // Red only when nothing could be refreshed AND no source answered at all; a partial outage that kept every published fund stays green.
  if (failed) process.exitCode = 1;
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `### Parametric data update\n\n- updated: ${results.length}\n- kept from previous runs: ${keptFromPrevious.length}\n- failed: ${failures}\n- counts: ${counts.funds} funds / ${counts.holdings.toLocaleString('en-US')} holdings rows / ${counts.history.toLocaleString('en-US')} history rows\n`,
      'utf8',
    );
  }
}

// ---------------------------------------------------------------------------
// Entry point (kept at the end: main() relies on the let bindings above)
// ---------------------------------------------------------------------------

if ((import.meta as { main?: boolean }).main) {
  if (process.argv.includes('-h') || process.argv.includes('--help')) {
    console.log(USAGE.trim());
    outputPrintConfig('Parametric effective configuration', readConfig(await runtimeControls(process.env)));
  } else {
    await main().catch((error) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
  }
}

// <holdings-guard> shared block of .claude/tools/etfs/etf-std/holdings-guard.block.ts, applied by apply-holdings-guard.ts: never edit it in one repo
/**
 * Sanity check of a fund's new holdings before they replace the published ones. Returns why they must be rejected
 * (the caller then keeps the fund's previous state and reports it as failed), or null when they may be written.
 * An empty sheet passes only when nothing was published before. Otherwise a Name and a weight column (Weight,
 * Weight (%) or Market Weight) are required, >= 80% of the rows carry a numeric weight, the weights add up to
 * 50..150 and the sheet keeps >= 50% of the previously published rows. `relax` switches off the checks a fund
 * legitimately fails: 'numeric' and 'sum' (geared, inverse, futures, look-through, top-N lists) and 'count'. No relax lets
 * a sheet without a single numeric weight replace a published sheet that had numeric weights (`previousWeights`: how many
 * rows of the published sheet carry a numeric weight, see holdingsWeightCount; open-items etfs Q24).
 * Rows are arrays in header order or objects keyed by the header text. A fund in the brand's CLOSED_FUNDS never reaches the guard.
 */
export function holdingsGuard(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>, previousRows: number | null | undefined, relax: ReadonlyArray<string> = [], previousWeights: number | null = null): string | null {
  const previous = Number(previousRows) > 0 ? Number(previousRows) : 0;
  if (!rows.length) return previous ? `no holdings rows (${previous} published)` : null;
  const names = headers.map((header) => String(header).trim().toLowerCase());
  const nameAt = names.indexOf('name');
  let weightAt = names.indexOf('weight');
  if (weightAt < 0) weightAt = names.indexOf('weight (%)');
  if (weightAt < 0) weightAt = names.indexOf('market weight');
  if (nameAt < 0 || weightAt < 0) return `no ${nameAt < 0 ? 'Name' : 'weight'} column (headers: ${headers.join(', ') || 'none'})`;
  const weights = holdingsGuardWeights(headers, rows, weightAt);
  const numeric = weights.count;
  const sum = weights.sum;
  if (numeric === 0 && Number(previousWeights) > 0) return `no row has a numeric weight, the published sheet had ${Number(previousWeights)}`;
  if (relax.indexOf('numeric') < 0 && numeric < rows.length * 0.8) return `only ${numeric} of ${rows.length} rows have a numeric weight`;
  if (relax.indexOf('sum') < 0 && (sum < 50 || sum > 150)) return `weights add up to ${sum.toFixed(2)}, outside 50..150`;
  if (relax.indexOf('count') < 0 && previous && rows.length < previous * 0.5) return `${rows.length} rows, less than half of the ${previous} published`;
  return null;
}

/** How many rows carry a numeric weight (Weight, Weight (%) or Market Weight column), 0 without such a column: pass it for the published sheet as holdingsGuard's previousWeights. */
export function holdingsWeightCount(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>): number {
  const names = headers.map((header) => String(header).trim().toLowerCase());
  let weightAt = names.indexOf('weight');
  if (weightAt < 0) weightAt = names.indexOf('weight (%)');
  if (weightAt < 0) weightAt = names.indexOf('market weight');
  return weightAt < 0 ? 0 : holdingsGuardWeights(headers, rows, weightAt).count;
}

/** Count and sum of the numeric weights in column weightAt; rows are arrays in header order or objects keyed by the header text. */
function holdingsGuardWeights(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>, weightAt: number): { count: number; sum: number } {
  let count = 0;
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const row: any = rows[i];
    const weight = holdingsGuardNumber(Array.isArray(row) ? row[weightAt] : row && typeof row === 'object' ? row[headers[weightAt]] : undefined);
    if (weight !== null) {
      count++;
      sum += weight;
    }
  }
  return { count, sum };
}

/** A weight cell as a number: %, $, commas and spaces are ignored, (x) is negative; null when it is no plain number (a zero-width character inside counts as broken). */
function holdingsGuardNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = String(value === null || value === undefined ? '' : value).replace(/[ \t ,%$]/g, '').replace(/−/g, '-');
  const negative = /^\(.*\)$/.test(text);
  if (negative) text = text.slice(1, -1);
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  return negative ? -Number(text) : Number(text);
}

/** A fund its issuer closed (liquidated, delisted or merged away), confirmed from an official source: an SEC filing or the issuer's notice. */
export type ClosedFund = { ticker: string; closed: string; source: string };

/**
 * The brand's CLOSED_FUNDS entry for a ticker, or null. A closed fund is never fetched, never guarded and never reported failed: it keeps
 * its last published data and its index row carries `status: 'closed'`, `closedDate` and `closedSource`. A malformed entry throws, so a
 * typo (no ISO date, no https source) never ships.
 */
export function closedFund(list: ReadonlyArray<ClosedFund>, ticker: unknown): ClosedFund | null {
  const wanted = String(ticker === null || ticker === undefined ? '' : ticker).trim().toUpperCase();
  let found: ClosedFund | null = null;
  for (let i = 0; i < list.length; i++) {
    const fund = list[i];
    if (!/^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(fund.ticker) || !/^\d{4}-\d{2}-\d{2}$/.test(fund.closed) || !/^https:\/\/\S+$/.test(fund.source)) throw new Error(`CLOSED_FUNDS: ${fund.ticker} needs an upper-case ticker, an ISO closing date and an https source`);
    if (fund.ticker === wanted) found = fund;
  }
  return found;
}

/** The index rows with every closed fund marked (`status: 'closed'`, `closedDate`, `closedSource`); other rows are returned as they are. */
export function markClosedFunds<T extends object>(rows: ReadonlyArray<T>, list: ReadonlyArray<ClosedFund>): T[] {
  return rows.map((row) => {
    const fund = closedFund(list, (row as { ticker?: unknown }).ticker);
    return fund ? ({ ...row, status: 'closed', closedDate: fund.closed, closedSource: fund.source } as T) : row;
  });
}

/** A run's queue without the closed funds, which are named once in the log: they are neither fetched nor counted as failed. */
export function withoutClosedFunds<T>(queue: ReadonlyArray<T>, tickerOf: (item: T) => string, list: ReadonlyArray<ClosedFund>): T[] {
  const closed: string[] = [];
  const open: T[] = [];
  for (let i = 0; i < queue.length; i++) {
    if (closedFund(list, tickerOf(queue[i]))) closed.push(tickerOf(queue[i]));
    else open.push(queue[i]);
  }
  if (closed.length) console.log(`[ closed   ] ${closed.join(', ')}: closed by the issuer, published data kept`);
  return open;
}
// </holdings-guard>

// <nport-reader> shared block of .claude/tools/etfs/etf-std/nport-reader.block.ts, applied by apply-block.ts: never edit it in one repo
/**
 * SEC EDGAR Form N-PORT-P holdings reader (open-items etfs ETF-H2), one copy for every brand. Pure functions plus one reader
 * that takes the brand's own `getText(url, label)` (its SEC User-Agent, timeout, retries and pacing). Rules it enforces:
 * - identifiers come from the position itself: `<cusip>` text (or a `value` attribute), `<isin value>`, `<ticker value>`,
 *   `<other value>`; a derivative's reference instrument (inside `<derivativeInfo>`) never lends its identifiers to the position
 * - CUSIP `000000000` and `N/A` are missing; a missing weight or value is null (an empty cell), never 0
 * - a ticker only for a common-stock row (assetCat EC, not a CVR, right, warrant or escrow line) traded in USD with a U.S.
 *   ISIN or none, and never one ticker on two different securities (`nportTickers`)
 * - identity: the filing must name the fund's own series id, or, with no series id known, the fund's name (`nportIdentity`)
 * - freshness: the report period must be strictly newer than the published holdings (`nportIsFresh`)
 * - filings come newest report period first from the registrant's own archive folder, never from the filer agent's CIK
 *   (the accession number prefix)
 */
export type NportPosition = {
  name: string;
  title: string;
  lei: string;
  cusip: string;
  isin: string;
  ticker: string;
  other: string;
  otherDesc: string;
  balance: number | null;
  units: string;
  currency: string;
  /** valUSD, null when the filing has none */
  value: number | null;
  /** pctVal: percent of net assets (0.5 = 0.5%), null when the filing has none */
  weight: number | null;
  payoff: string;
  assetCat: string;
  issuerCat: string;
  country: string;
  /** derivCat of the position's derivativeInfo (FUT, FWD, SWP, OPT, ...), empty for a security */
  derivative: string;
  /** debtSec annualizedRt and maturityDt (ISO), null and '' for a non-debt row */
  coupon: number | null;
  maturity: string;
};

export type NportFiling = {
  seriesId: string;
  seriesName: string;
  regName: string;
  regCik: string;
  /** report period end (genInfo repPdDate) as ISO, '' when missing */
  repPdDate: string;
  netAssets: number | null;
  totalAssets: number | null;
  positions: NportPosition[];
};

export type NportCandidate = { accession: string; filed: string; period: string; cik: string };
export type NportSeriesRef = { cik: string; seriesId: string; classId: string };

/** XML text: entities decoded, tags dropped, whitespace collapsed. */
function nportText(raw: string): string {
  return String(raw)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m: string, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[\s ]+/g, ' ')
    .trim();
}

/** Text of the first `<tag>` (any namespace prefix) in `xml`, '' when absent. */
function nportTag(xml: string, tag: string): string {
  const match = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${tag}>`, 'i').exec(xml);
  return match ? nportText(match[1]) : '';
}

/** The `attribute` of the first `<tag ...>` (any namespace prefix) in `xml`, '' when absent. */
function nportAttr(xml: string, tag: string, attribute: string): string {
  const match = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}\\s[^>]*?\\b${attribute}\\s*=\\s*"([^"]*)"`, 'i').exec(xml);
  return match ? nportText(match[1]) : '';
}

/** A plain decimal or exponent number, null for an empty, N/A or broken cell. */
function nportNumber(raw: string): number | null {
  const text = String(raw).replace(/[\s,]/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** An identifier code, '' for N/A, NONE and all zeros (CUSIP 000000000 means "no CUSIP"). */
function nportCode(raw: string): string {
  const text = String(raw).trim().toUpperCase();
  return !text || /^(N\/?A|NONE|-+|0+)$/.test(text) ? '' : text;
}

/** ISO date of an N-PORT date (YYYY-MM-DD, possibly with a time), '' otherwise. */
function nportIso(raw: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw === null || raw === undefined ? '' : raw).trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

/** One N-PORT-P primary_doc.xml (or the full submission .txt that embeds it) as series facts and positions. */
export function parseNportFiling(xml: string): NportFiling {
  const text = String(xml === null || xml === undefined ? '' : xml);
  const genInfo = /<(?:[A-Za-z0-9_.-]+:)?genInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?genInfo>/i.exec(text);
  const fundInfo = /<(?:[A-Za-z0-9_.-]+:)?fundInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?fundInfo>/i.exec(text);
  const gen = genInfo ? genInfo[1] : '';
  const fund = fundInfo ? fundInfo[1].replace(/<(?:[A-Za-z0-9_.-]+:)?returnInfo\b[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?returnInfo>/gi, ' ') : '';
  const positions: NportPosition[] = [];
  const blocks = /<(?:[A-Za-z0-9_.-]+:)?invstOrSec\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?invstOrSec>/gi;
  let block: RegExpExecArray | null;
  while ((block = blocks.exec(text)) !== null) {
    const raw = block[1];
    const derivativeInfo = /<(?:[A-Za-z0-9_.-]+:)?derivativeInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?derivativeInfo>/i.exec(raw);
    // The reference instrument of a derivative (SPY for a SPY option, a bond for a CDS) is another security: drop it first.
    const own = raw.replace(/<(?:[A-Za-z0-9_.-]+:)?derivativeInfo\b[^>]*>[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?derivativeInfo>/gi, ' ');
    const identifiers = /<(?:[A-Za-z0-9_.-]+:)?identifiers\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?identifiers>/i.exec(own);
    const ids = identifiers ? identifiers[1] : '';
    const debt = /<(?:[A-Za-z0-9_.-]+:)?debtSec\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?debtSec>/i.exec(own);
    const name = nportTag(own, 'name');
    positions.push({
      name: name && !/^N\/?A$/i.test(name) ? name : nportTag(own, 'title'),
      title: nportTag(own, 'title'),
      lei: nportCode(nportTag(own, 'lei')),
      cusip: nportCode(nportTag(own, 'cusip') || nportAttr(ids, 'cusip', 'value')),
      isin: nportCode(nportAttr(ids, 'isin', 'value')),
      ticker: nportCode(nportAttr(ids, 'ticker', 'value')),
      other: nportCode(nportAttr(ids, 'other', 'value')),
      otherDesc: nportAttr(ids, 'other', 'otherDesc'),
      balance: nportNumber(nportTag(own, 'balance')),
      units: nportTag(own, 'units'),
      currency: (nportTag(own, 'curCd') || nportAttr(own, 'currencyConditional', 'curCd')).toUpperCase(),
      value: nportNumber(nportTag(own, 'valUSD')),
      weight: nportNumber(nportTag(own, 'pctVal')),
      payoff: nportTag(own, 'payoffProfile'),
      assetCat: (nportTag(own, 'assetCat') || nportAttr(own, 'assetConditional', 'assetCat')).toUpperCase(),
      issuerCat: (nportTag(own, 'issuerCat') || nportAttr(own, 'issuerConditional', 'issuerCat')).toUpperCase(),
      country: nportTag(own, 'invCountry').toUpperCase(),
      derivative: derivativeInfo ? (/\bderivCat\s*=\s*"([^"]*)"/i.exec(derivativeInfo[1]) || ['', 'OTHER'])[1].toUpperCase() : '',
      coupon: debt ? nportNumber(nportTag(debt[1], 'annualizedRt')) : null,
      maturity: debt ? nportIso(nportTag(debt[1], 'maturityDt')) : '',
    });
  }
  return {
    seriesId: nportTag(gen, 'seriesId').toUpperCase(),
    seriesName: nportTag(gen, 'seriesName'),
    regName: nportTag(gen, 'regName'),
    regCik: nportTag(gen, 'regCik').replace(/\D/g, ''),
    repPdDate: nportIso(nportTag(gen, 'repPdDate')),
    netAssets: nportNumber(nportTag(fund, 'netAssets')),
    totalAssets: nportNumber(nportTag(fund, 'totAssets')),
    positions,
  };
}

/**
 * A number as sheet text: '' for null, no exponent, at most `digits` decimals (trailing zeros dropped), and no binary float
 * artifact: `115797518.01` stays `115797518.01`, not the `115797518.01000001` of `toFixed(8)`.
 */
export function nportCell(value: number | null, digits = 8): string {
  if (value === null || !Number.isFinite(value)) return '';
  const fixed = value.toFixed(digits);
  // the shortest text of the rounded number; toFixed only where that text would be an exponent (very small or large numbers)
  const shortest = String(Number(fixed));
  if (!/e/i.test(shortest)) return shortest;
  return fixed.indexOf('.') < 0 ? fixed : fixed.replace(/0+$/, '').replace(/\.$/, '');
}

/** The position's own identifier for a sheet: CUSIP, else ISIN, else the "other" code (a Bloomberg or internal id), else ''. */
export function nportIdentifier(position: NportPosition): string {
  return position.cusip || position.isin || position.other;
}

/**
 * A company name as a lookup key: upper case, punctuation and legal suffixes dropped, `CLASS A` -> `CL A`. Initials are one
 * word whether written with dots, spaces or a slash (`N.V.` = `N V` = `NV`, `C.H. ROBINSON` = `C H ROBINSON`, `A/S` = `A S`,
 * `S.A.B. de C.V.` = `SAB DE CV`), `PUBLIC LIMITED COMPANY` is `plc`, and a leading `US` stays (`U.S. BANCORP` is not
 * `BANCORP, INC.`), so both spellings of one issuer give one key.
 */
export function nportNameKey(value: unknown): string {
  // EDGAR adds a state or qualifier suffix to company titles ("COSTCO WHOLESALE CORP /NEW", "BANK OF AMERICA CORP /DE/",
  // "US BANCORP \DE\", "ACUITY INC. (DE)"): drop a trailing one
  const raw = String(value === null || value === undefined ? '' : value).replace(/(?:\s*(?:[\/\\]\s*[A-Za-z]{2,3}\s*[\/\\]?|\(\s*[A-Za-z]{2,3}\s*\)))+\s*$/, '');
  let text = nportText(raw).toUpperCase().replace(/['’]/g, '').replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').trim();
  text = text.replace(/\bCLASS\s+([A-Z])\b/g, 'CL $1').replace(/\bCL\s+([A-Z])\b/g, 'CL $1');
  // a run of single letters is one word, never the class letter after CL
  const words: string[] = [];
  let joining = false;
  text.split(' ').forEach((word) => {
    const letter = /^[A-Z]$/.test(word);
    if (letter && joining) words[words.length - 1] += word;
    else words.push(word);
    joining = letter && (joining || words[words.length - 2] !== 'CL');
  });
  text = words.join(' ').replace(/\bPUBLIC (?:(?:LIMITED|LTD)(?: (?:COMP[A-Z]*|CO))?|(?:COMPANY|CO) (?:LIMITED|LTD))\b/g, 'PLC').replace(/\b(?:S DE RL )?DE CV\b/g, ' ');
  const share = /\bCL [A-Z]\b/.exec(text);
  text = text.replace(/\b(THE|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|SA|SAB|NV|AG|SE|SPA|AS|ASA|ORDINARY|COMMON|STOCK|SHS|SHARES|ADR|DEPOSITARY|RECEIPT|USD|US|REG|REGISTERED)\b/g, (word: string, _name: string, at: number) => (word === 'US' && at === 0 ? word : ' ')).replace(/\s+/g, ' ').trim();
  if (share && !/\bCL [A-Z]\b/.test(text)) text = `${text} ${share[0]}`;
  return text;
}

/** SEC company_tickers.json -> name key -> ticker (the first, largest company wins a shared key; the class-less key is added too). */
export function parseSecCompanyNames(payload: unknown): Map<string, string> {
  const names = new Map<string, string>();
  const rows = payload && typeof payload === 'object' ? Object.keys(payload as object).map((key) => (payload as Record<string, unknown>)[key]) : [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as { ticker?: unknown; title?: unknown } | null;
    if (!row || typeof row !== 'object') continue;
    const ticker = String(row.ticker === null || row.ticker === undefined ? '' : row.ticker).trim().toUpperCase();
    const key = nportNameKey(row.title);
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) || !key) continue;
    if (!names.has(key)) names.set(key, ticker);
    const core = key.replace(/ CL [A-Z]$/, '');
    if (core && !names.has(core)) names.set(core, ticker);
  }
  return names;
}

/** SEC company_tickers_mf.json -> fund ticker -> registrant CIK (10 digits), series id, class id. */
export function parseSecFundTickers(payload: unknown): Map<string, NportSeriesRef> {
  const map = new Map<string, NportSeriesRef>();
  const record = (payload && typeof payload === 'object' ? payload : {}) as { fields?: unknown; data?: unknown };
  const fields = Array.isArray(record.fields) ? record.fields.map(String) : [];
  const rows = Array.isArray(record.data) ? record.data : [];
  const at = (row: unknown[], field: string): string => (fields.indexOf(field) < 0 ? '' : String(row[fields.indexOf(field)] === null || row[fields.indexOf(field)] === undefined ? '' : row[fields.indexOf(field)]).trim());
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const ticker = at(row, 'symbol').toUpperCase();
    const cik = at(row, 'cik').replace(/\D/g, '');
    const seriesId = at(row, 'seriesId').toUpperCase();
    if (!ticker || !Number(cik) || !/^S\d{9}$/.test(seriesId) || map.has(ticker)) continue;
    map.set(ticker, { cik: `0000000000${Number(cik)}`.slice(-10), seriesId, classId: at(row, 'classId').toUpperCase() });
  }
  return map;
}

/**
 * Is the row a contingent value right, a right, a warrant or an escrow line filed as equity? A placeholder CUSIP or ISIN
 * (`436CVR021`, `US009CVR0445`, `549ESC028`, `866CNT017`) says so; so does the name or title (`NOVO NORDISK A/S - CVR`,
 * `XYZ INC RIGHTS`, `... WARRANT FEB 2026`, `Luby's Inc Escrow`), except on a CUSIP with the common-stock issue number 10
 * (Schwab titles Enovix common stock 293594107 "Enovix Corp Warrants"). `CVR` as the first word is a company (CVR Energy).
 */
function nportIsRight(position: NportPosition): boolean {
  if (/^[0-9A-Z]{3}(?:CVR|ESC|CNT)/.test(position.cusip) || /^US[0-9A-Z]{3}(?:CVR|ESC|CNT)/.test(position.isin)) return true;
  if (/^[0-9A-Z]{6}10[0-9]$/.test(position.cusip)) return false;
  return [position.name, position.title].some((text) => /\S\s*\bCVRS?\b|\bCONTINGENT\b|\bRIGHTS?\b|\bRTS\b|\bWARRANTS?\b|\bWTS\b|\bESCROW\b/i.test(text));
}

/**
 * Exchange tickers for the positions, in their order ('' for none). A ticker is given only to a common-stock row (assetCat
 * EC; a preferred EP, a CVR, right, warrant or escrow line gets none, a name match would give it the issuer's common ticker)
 * traded in USD (or with no currency) whose ISIN is U.S. or missing: first the filer's own `<ticker value>`, else the
 * SEC issuer-name table (`names`) when the row has a CUSIP or a U.S. ISIN. A ticker that lands on two different securities
 * (Alphabet A and C, an ordinary share and its ADR) is dropped from the name-matched rows; when the filer itself gave it
 * to two securities it is dropped from all of them. Bonds, cash, funds and derivatives stay identifier-keyed.
 */
export function nportTickers(positions: ReadonlyArray<NportPosition>, names: Map<string, string> | null = null): string[] {
  const fromFiler: boolean[] = [];
  const tickers = positions.map((position, index) => {
    fromFiler[index] = false;
    const equity = position.assetCat === 'EC' && !position.derivative && !nportIsRight(position);
    const usd = !position.currency || position.currency === 'USD';
    if (!equity || !usd || (position.isin && position.isin.slice(0, 2) !== 'US')) return '';
    if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(position.ticker)) {
      fromFiler[index] = true;
      return position.ticker;
    }
    if (!names || !(/^[0-9A-Z]{9}$/.test(position.cusip) || /^US[0-9A-Z]{10}$/.test(position.isin))) return '';
    const key = nportNameKey(position.name);
    return names.get(key) || names.get(key.replace(/ CL [A-Z]$/, '')) || '';
  });
  const securities = new Map<string, { keys: string[]; filer: string[] }>();
  tickers.forEach((ticker, index) => {
    if (!ticker) return;
    const position = positions[index];
    const key = position.cusip || position.isin || position.other || nportNameKey(position.name);
    const seen = securities.get(ticker) || { keys: [], filer: [] };
    if (seen.keys.indexOf(key) < 0) seen.keys.push(key);
    if (fromFiler[index] && seen.filer.indexOf(key) < 0) seen.filer.push(key);
    securities.set(ticker, seen);
  });
  return tickers.map((ticker, index) => {
    const seen = ticker ? securities.get(ticker) : undefined;
    if (!seen || seen.keys.length < 2) return ticker;
    return seen.filer.length === 1 && fromFiler[index] ? ticker : '';
  });
}

/** The browse-edgar Atom feed of one series' NPORT-P filings. */
export function nportSeriesFeedUrl(seriesId: string, count = 10): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(String(seriesId).toUpperCase())}&type=NPORT-P&dateb=&owner=include&count=${count}&output=atom`;
}

/** The registrant's submissions JSON (report periods of its recent filings). */
export function nportSubmissionsUrl(cik: string): string {
  return `https://data.sec.gov/submissions/CIK${`0000000000${Number(String(cik).replace(/\D/g, '')) || 0}`.slice(-10)}.json`;
}

/** primary_doc.xml of a filing in the registrant's own folder. Throws without a registrant CIK: the accession prefix is the filer agent. */
export function nportDocumentUrl(registrantCik: string, accession: string): string {
  const cik = Number(String(registrantCik).replace(/\D/g, ''));
  if (!cik) throw new Error(`N-PORT ${accession}: no registrant CIK (the accession prefix is the filer agent, never used as the folder)`);
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${String(accession).replace(/-/g, '')}/primary_doc.xml`;
}

/** NPORT-P entries of a browse-edgar Atom feed (amendments and other forms skipped), with the registrant CIK of the filing link. */
export function parseNportFeed(atom: string): NportCandidate[] {
  const out: NportCandidate[] = [];
  const entries = /<entry>([\s\S]*?)<\/entry>/gi;
  let entry: RegExpExecArray | null;
  while ((entry = entries.exec(String(atom === null || atom === undefined ? '' : atom))) !== null) {
    const body = entry[1];
    const form = (nportTag(body, 'filing-type') || nportAttr(body, 'category', 'term')).toUpperCase();
    const accession = nportTag(body, 'accession-number');
    if (form !== 'NPORT-P' || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
    const folder = /\/Archives\/edgar\/data\/(\d+)\//i.exec(nportTag(body, 'filing-href'));
    out.push({ accession, filed: nportIso(nportTag(body, 'filing-date')), period: nportIso(nportTag(body, 'period')), cik: folder ? folder[1] : '' });
  }
  return out;
}

/** NPORT-P filings of a registrant's submissions JSON (`filings.recent`), with report periods; the registrant is the JSON's own CIK. */
export function parseNportSubmissions(payload: unknown): NportCandidate[] {
  const record = (payload && typeof payload === 'object' ? payload : {}) as { cik?: unknown; filings?: { recent?: Record<string, unknown> } };
  const recent = record.filings && record.filings.recent ? record.filings.recent : {};
  const column = (name: string): unknown[] => (Array.isArray(recent[name]) ? (recent[name] as unknown[]) : []);
  const forms = column('form'), accessions = column('accessionNumber'), filed = column('filingDate'), periods = column('reportDate');
  const cik = String(record.cik === null || record.cik === undefined ? '' : record.cik).replace(/\D/g, '');
  const out: NportCandidate[] = [];
  for (let i = 0; i < forms.length; i++) {
    const accession = String(accessions[i] === null || accessions[i] === undefined ? '' : accessions[i]);
    if (String(forms[i]).toUpperCase() !== 'NPORT-P' || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
    out.push({ accession, filed: nportIso(filed[i]), period: nportIso(periods[i]), cik });
  }
  return out;
}

/**
 * Candidates newest report period first, then newest filing: a late filing for an older period never wins. A missing
 * period is taken from `known` (the registrant's submissions) by accession; candidates still without one go last.
 */
export function nportNewestFirst(candidates: ReadonlyArray<NportCandidate>, known: ReadonlyArray<NportCandidate> = []): NportCandidate[] {
  const periods = new Map<string, string>();
  for (let i = 0; i < known.length; i++) if (known[i].period) periods.set(known[i].accession, known[i].period);
  return candidates
    .map((candidate) => (candidate.period ? candidate : { ...candidate, period: periods.get(candidate.accession) || '' }))
    .sort((a, b) => (a.period && b.period ? b.period.localeCompare(a.period) : a.period ? -1 : b.period ? 1 : 0) || b.filed.localeCompare(a.filed));
}

/**
 * Does the filing belong to the fund? With a series id: only the same series id. Without one: the normalized series name
 * equals the fund name, or (`loose`, reported to the caller) one contains the other. Returns the problem, or null.
 */
export function nportIdentity(filing: Pick<NportFiling, 'seriesId' | 'seriesName'>, fund: { seriesId?: string | null; name?: string | null }): { problem: string | null; loose: boolean } {
  const wantedSeries = String(fund.seriesId || '').trim().toUpperCase();
  if (wantedSeries) return { problem: filing.seriesId === wantedSeries ? null : `names series ${filing.seriesId || 'none'}, not ${wantedSeries}`, loose: false };
  const filed = nportNameKey(filing.seriesName), wanted = nportNameKey(fund.name);
  if (!filed || !wanted) return { problem: 'no series id and no fund name to match', loose: false };
  if (filed === wanted) return { problem: null, loose: false };
  if (filed.indexOf(wanted) >= 0 || wanted.indexOf(filed) >= 0) return { problem: null, loose: true };
  return { problem: `names series "${filing.seriesName}", not "${String(fund.name)}"`, loose: false };
}

/**
 * May a filing replace the published holdings? Nothing published (no rows): any dated or undated report. Otherwise only a
 * report period strictly newer than the published holdings date; both must be ISO dates (convert the brand's display
 * date first), an unknown date on either side keeps the published sheet.
 */
export function nportIsFresh(repPdDate: unknown, publishedAsOf: unknown, publishedRows: unknown): boolean {
  if (!(Number(publishedRows) > 0)) return true;
  const report = nportIso(repPdDate), published = nportIso(publishedAsOf);
  return Boolean(report && published && String(publishedAsOf).trim().length === 10 && report > published);
}

export type NportRead = { filing: NportFiling; candidate: NportCandidate; url: string; loose: boolean } | { problem: string };

/**
 * The newest N-PORT-P filing of one fund, or why there is none. Candidates: the series' Atom feed (when a series id is known;
 * an empty feed means no filing yet) with periods from the registrant's submissions, else (no series id, or the feed failed)
 * the registrant's NPORT-P filings themselves; newest period first.
 * Documents are read until one passes the identity check (at most `maxDocuments`); that newest own filing is returned only
 * when it is fresh against the published holdings (`published.asOf` ISO, `published.rows`). Errors of the optional
 * submissions request are tolerated; others come back as `problem`. `cache` (one Map per run) keeps the submissions and
 * the parsed documents, so funds of one registrant share requests.
 */
export async function readNportHoldings(
  fund: { ticker: string; cik: string; seriesId?: string | null; name?: string | null },
  published: { asOf?: unknown; rows?: unknown },
  getText: (url: string, label: string) => Promise<string>,
  options: { maxDocuments?: number; cache?: Map<string, unknown> } = {},
): Promise<NportRead> {
  const cache = options.cache || new Map<string, unknown>();
  const once = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
    if (!cache.has(key)) cache.set(key, load().catch((error: unknown) => { cache.delete(key); throw error; }));
    return (await cache.get(key)) as T;
  };
  const cik = String(fund.cik || '').replace(/\D/g, '');
  if (!Number(cik)) return { problem: `${fund.ticker}: no registrant CIK` };
  let known: NportCandidate[] = [];
  try {
    known = await once(`submissions:${Number(cik)}`, async () => parseNportSubmissions(JSON.parse(await getText(nportSubmissionsUrl(cik), `${fund.ticker} N-PORT periods`))));
  } catch {
    known = [];
  }
  // null: no series feed (no series id, or the feed failed), so the registrant's own NPORT-P filings are scanned instead
  let candidates: NportCandidate[] | null = null;
  try {
    if (fund.seriesId) candidates = parseNportFeed(await getText(nportSeriesFeedUrl(fund.seriesId), `${fund.ticker} N-PORT filings`));
  } catch (error) {
    if (!known.length) return { problem: `${fund.ticker}: N-PORT filings unavailable (${error instanceof Error ? error.message : String(error)})` };
  }
  const sorted = nportNewestFirst(candidates || known, known);
  if (!sorted.length) return { problem: `${fund.ticker}: no NPORT-P filing yet` };
  const limit = Math.max(1, options.maxDocuments || (candidates ? 3 : 12));
  const misses: string[] = [];
  for (let i = 0; i < sorted.length && i < limit; i++) {
    const candidate = sorted[i];
    const url = nportDocumentUrl(Number(candidate.cik) ? candidate.cik : cik, candidate.accession);
    let filing: NportFiling;
    try {
      filing = await once(`document:${url}`, async () => parseNportFiling(await getText(url, `${fund.ticker} N-PORT ${candidate.accession}`)));
    } catch (error) {
      misses.push(`${candidate.accession} unreadable (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const identity = nportIdentity(filing, fund);
    if (identity.problem) {
      misses.push(`${candidate.accession} ${identity.problem}`);
      continue;
    }
    if (!filing.positions.length) return { problem: `${fund.ticker}: ${candidate.accession} has no positions` };
    if (!nportIsFresh(filing.repPdDate, published.asOf, published.rows)) return { problem: `${fund.ticker}: N-PORT ${filing.repPdDate || 'undated'} is not newer than the published holdings (${String(published.asOf || 'undated')})` };
    return { filing, candidate, url, loose: identity.loose };
  }
  return { problem: `${fund.ticker}: no N-PORT-P filing of its own${misses.length ? `: ${misses.join('; ')}` : ''}` };
}
// </nport-reader>

// <calendar-dates> shared block of .claude/tools/etfs/etf-std/calendar-dates.block.ts, applied by apply-block.ts: never edit it in one repo
/**
 * A calendar date as ISO `YYYY-MM-DD`, or null. Pure text work, never `Date.parse` or local getters, so a run in Tokyo
 * publishes the same day as CI (open-items etfs ETF-H4). Accepts ISO (`2026-10-24`, with a time the date part is kept as
 * written), `2026/10/24`, U.S. `10/24/2026` and `10-24-26` (two-digit years up to 69 are 20xx), month names in either order
 * (`Oct 24, 2026`, `October 24 2026`, `Sept. 30, 2026`, `24 Oct 2026`, `24-Oct-26`), an optional weekday or `as of` in front.
 * A day that does not exist (`02/30/2026`) is null.
 */
export function calendarIso(value: unknown): string | null {
  const text = String(value === null || value === undefined ? '' : value).replace(/[\s ]+/g, ' ').trim()
    .replace(/^as of:? /i, '').replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,? /i, '');
  const year = (raw: string): number => (raw.length === 2 ? (Number(raw) <= 69 ? 2000 : 1900) + Number(raw) : Number(raw));
  const month = (raw: string): number => {
    const word = raw.toLowerCase();
    const names = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    for (let i = 0; i < names.length; i++) if (word.length >= 3 && names[i].indexOf(word) === 0) return i + 1;
    return 0;
  };
  let y = 0, m = 0, d = 0, match: RegExpExecArray | null;
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text)) || (match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text))) {
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  } else if ((match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})$/.exec(text))) {
    y = year(match[3]); m = Number(match[1]); d = Number(match[2]);
  } else if ((match = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/.exec(text))) {
    y = Number(match[3]); m = month(match[1]); d = Number(match[2]);
  } else if ((match = /^(\d{1,2})(?:st|nd|rd|th)?[ -]([A-Za-z]{3,9})\.?,?[ -](\d{4}|\d{2})$/.exec(text))) {
    y = year(match[3]); m = month(match[2]); d = Number(match[1]);
  } else {
    return null;
  }
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > days[m - 1]) return null;
  return `${y}-${m < 10 ? '0' : ''}${m}-${d < 10 ? '0' : ''}${d}`;
}

/**
 * Is the fund at least `years` old on `asOf`? Calendar anniversary, inclusive: a fund started 2025-10-24 is one year old on
 * 2026-10-24 (a 29 February start on 1 March). Unknown or unreadable dates answer true, so a value is never dropped for want
 * of a date. The shared "younger than one year" rule: since-inception returns are annualized only from one year on.
 */
export function fundAgeAtLeast(inception: unknown, asOf: unknown, years: number): boolean {
  const start = calendarIso(inception), end = calendarIso(asOf);
  if (!start || !end) return true;
  return end >= `${Number(start.slice(0, 4)) + years}${start.slice(4)}`;
}

/**
 * The returns with every horizon the fund is too young for set to null: `horizons` maps a key of `returns` to the years it
 * needs (`{ yr1: 1, cagr3y: 3, siAnn: 1 }`). Keys that are absent or already null stay as they are; the object is copied.
 */
export function withoutYoungReturns<T extends object>(returns: T, inception: unknown, asOf: unknown, horizons: Record<string, number>): T {
  const out: Record<string, unknown> = { ...(returns as Record<string, unknown>) };
  const keys = Object.keys(horizons);
  for (let i = 0; i < keys.length; i++) {
    if (out[keys[i]] !== undefined && out[keys[i]] !== null && !fundAgeAtLeast(inception, asOf, horizons[keys[i]])) out[keys[i]] = null;
  }
  return out as T;
}
// </calendar-dates>

// <windowed-chart> shared block of .claude/tools/etfs/etf-std/windowed-chart.block.ts, applied by apply-block.ts: never edit it in one repo
export type WindowedChartDay = { date: string; close: number; adjClose: number; volume: number; adjCloseRaw?: number };
export type WindowedChartDividend = { epoch: number; amount: number };

/**
 * A HISTORY_RANGE window (`period1` N years back) never shrinks the published history, and with it the 3y, 5y, 10y and
 * since-inception returns (open-items etfs Q25; was a byte-identical copy in Fidelity, Invesco and JPMorgan). The published
 * rows older than the first fresh day are put in front of the fresh days; their Adj Close is rescaled by the ratio measured on
 * the overlapping days (Yahoo re-adjusts the whole series after each distribution). Published distributions older than the
 * window are kept as well. Returns the chart unchanged when nothing published is older, and null when the window cannot be
 * joined safely (no overlap, Close changed, inconsistent or implausible ratio): the caller then keeps the fund as published.
 * `published` rows carry `Date` (any calendarIso form), `Close`, `Adj Close`, `Volume`; distribution rows are
 * [date, amount, ...] arrays. The chart's days must be sorted by ISO date.
 */
export function mergeWindowedChart<C extends { days: WindowedChartDay[]; dividends: WindowedChartDividend[] }>(chart: C, published: ReadonlyArray<Record<string, unknown>>, publishedDistributions: ReadonlyArray<unknown> = []): C | null {
  if (!chart.days.length || !published.length) return chart;
  const num = (value: unknown): number | null => {
    const text = String(value === null || value === undefined ? '' : value).replace(/[\s,$]/g, '');
    return text && Number.isFinite(Number(text)) ? Number(text) : null;
  };
  const firstFresh = chart.days[0].date;
  const rows: Array<{ date: string; close: number; adjClose: number; volume: number }> = [];
  for (let i = 0; i < published.length; i++) {
    const date = calendarIso(published[i].Date), close = num(published[i].Close), adjClose = num(published[i]['Adj Close']);
    if (date && close !== null && adjClose !== null && adjClose > 0) rows.push({ date, close, adjClose, volume: num(published[i].Volume) || 0 });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const older = rows.filter((row) => row.date < firstFresh);
  if (!older.length) return chart;
  const byDate = new Map<string, { close: number; adjClose: number }>();
  for (let i = 0; i < rows.length; i++) byDate.set(rows[i].date, rows[i]);
  const adjRatios: number[] = [];
  const closeRatios: number[] = [];
  for (let i = 0; i < chart.days.length; i++) {
    const day = chart.days[i];
    const prior = byDate.get(day.date);
    if (!prior) continue;
    adjRatios.push((day.adjCloseRaw === undefined ? day.adjClose : day.adjCloseRaw) / prior.adjClose);
    if (prior.close > 0) closeRatios.push(day.close / prior.close);
  }
  if (!adjRatios.length) return null;
  const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
  if (closeRatios.length && Math.abs(mean(closeRatios) - 1) > 1e-3) return null;
  if (Math.max.apply(null, adjRatios) / Math.min.apply(null, adjRatios) - 1 > 5e-3) return null;
  const measured = mean(adjRatios);
  if (measured < 0.5 || measured > 1.001) return null;
  const factor = Math.abs(measured - 1) < 1e-4 ? 1 : measured;
  const days: WindowedChartDay[] = older.map((row) => {
    const raw = row.adjClose * factor;
    return { date: row.date, close: row.close, adjClose: factor === 1 ? row.adjClose : Math.round(raw * 100) / 100, volume: row.volume, adjCloseRaw: raw };
  });
  const firstFreshEpoch = Date.UTC(Number(firstFresh.slice(0, 4)), Number(firstFresh.slice(5, 7)) - 1, Number(firstFresh.slice(8, 10))) / 1000;
  const kept: WindowedChartDividend[] = [];
  for (let i = 0; i < publishedDistributions.length; i++) {
    const cells = publishedDistributions[i];
    const date = Array.isArray(cells) ? calendarIso(cells[0]) : null;
    const amount = Array.isArray(cells) ? num(cells[1]) : null;
    if (!date || amount === null || amount <= 0) continue;
    const epoch = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 1000;
    if (epoch < firstFreshEpoch) kept.push({ epoch, amount });
  }
  kept.sort((a, b) => a.epoch - b.epoch);
  return { ...chart, days: days.concat(chart.days), dividends: kept.concat(chart.dividends.filter((dividend) => dividend.epoch >= firstFreshEpoch)) };
}
// </windowed-chart>

// <fund-selection> shared block of .claude/tools/etfs/etf-std/fund-selection.block.ts, applied by apply-block.ts: never edit it in one repo
/** An index row as far as these helpers read it: the ticker and whether it has published data (`dataFile`, null for a catalog-only row). */
export type FundSelectionRow = { ticker?: unknown; dataFile?: unknown };

function fundSelectionTicker(row: FundSelectionRow): string {
  return String(row.ticker === null || row.ticker === undefined ? '' : row.ticker).trim().toUpperCase();
}

/**
 * The tickers a TICKERS entry may name: the live catalog plus every fund with published data (closed funds included). When
 * the live catalog could not be read (`live` null) every previous index row counts, since nothing tells a real catalog-only
 * row from a stale one. A catalog-only row from an earlier mistyped TICKERS run is therefore not "known" (open-items etfs Q27).
 */
export function knownTickers(live: ReadonlyArray<string> | null, previous: ReadonlyArray<FundSelectionRow>): string[] {
  const out: string[] = [];
  const add = (ticker: string): void => { if (ticker && out.indexOf(ticker) < 0) out.push(ticker); };
  if (live) for (let i = 0; i < live.length; i++) add(String(live[i]).trim().toUpperCase());
  for (let i = 0; i < previous.length; i++) if (!live || previous[i].dataFile) add(fundSelectionTicker(previous[i]));
  return out;
}

/** Throws before any fund request when TICKERS names a fund outside `known` (see knownTickers): a clear error, nothing fetched or written. */
export function assertKnownTickers(selected: ReadonlyArray<string> | null, known: ReadonlyArray<string>, where: string): void {
  const unknown = (selected || []).map((ticker) => String(ticker).trim().toUpperCase()).filter((ticker) => ticker && known.indexOf(ticker) < 0);
  if (unknown.length) throw new Error(`TICKERS: ${unknown.join(', ')} not in ${where}; nothing was fetched or written`);
}

/**
 * The index rows without stale catalog-only rows: a row with no published data whose ticker the live catalog no longer lists
 * (an earlier mistyped TICKERS entry, a fund withdrawn before launch). Rows with data always stay; nothing is dropped when the
 * live catalog could not be read (`live` null).
 */
export function withoutStalePlaceholders<T extends FundSelectionRow>(rows: ReadonlyArray<T>, live: ReadonlyArray<string> | null): T[] {
  if (!live) return rows.slice();
  const listed = live.map((ticker) => String(ticker).trim().toUpperCase());
  return rows.filter((row) => Boolean(row.dataFile) || listed.indexOf(fundSelectionTicker(row)) >= 0);
}

/**
 * New funds of a run (open-items etfs Q28): `published` - first published in this run (the previous index had no row for it,
 * or only a catalog-only one), so a fund whose first read failed is announced when it finally succeeds; `pending` - new in the
 * catalog this run but not published yet. Nothing is reported on a first run (empty previous index).
 */
export function newFundsReport(previous: ReadonlyArray<FundSelectionRow>, next: ReadonlyArray<FundSelectionRow>): { published: string[]; pending: string[] } {
  const report = { published: [] as string[], pending: [] as string[] };
  if (!previous.length) return report;
  const before = new Map<string, boolean>();
  for (let i = 0; i < previous.length; i++) before.set(fundSelectionTicker(previous[i]), Boolean(previous[i].dataFile));
  for (let i = 0; i < next.length; i++) {
    const ticker = fundSelectionTicker(next[i]);
    if (!ticker || before.get(ticker)) continue;
    if (next[i].dataFile) report.published.push(ticker);
    else if (!before.has(ticker)) report.pending.push(ticker);
  }
  report.published.sort();
  report.pending.sort();
  return report;
}

/** The log and step-summary lines of a newFundsReport: `NEW FUNDS: A, B` and `NEW FUNDS (not published yet): C`; none when empty. */
export function newFundsLines(report: { published: ReadonlyArray<string>; pending: ReadonlyArray<string> }): string[] {
  const lines: string[] = [];
  if (report.published.length) lines.push(`NEW FUNDS: ${report.published.join(', ')}`);
  if (report.pending.length) lines.push(`NEW FUNDS (not published yet): ${report.pending.join(', ')}`);
  return lines;
}
// </fund-selection>
