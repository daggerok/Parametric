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
const outputVerbose = (): boolean => /^(1|true|yes|y|on)$/i.test((globalThis as any).process?.env?.VERBOSE ?? '');
function outputNote(message: string): void { if (outputVerbose()) console.warn(message); }
/** Names are the canonical environment knobs, not internal parser properties. */
function outputConfigEntries(config: Record<string, any>): [string, string][] {
  const values = new Map<string, string>();
  const aliases: Record<string, string> = {
    requestSleep: 'REQUEST_SLEEP', catalogUrl: 'CATALOG_URL',
    aumRange: 'AUM', terRange: 'TER', dividendYieldRange: 'DIVIDEND_YIELD', secYieldRange: 'SEC_YIELD',
    performanceRanges: 'PERFORMANCE', totalReturnRanges: 'TOTAL_RETURN',
  };
  const range = (v: any): string => v?.source ?? `${Number.isFinite(v?.min) ? v.min : ''}:${Number.isFinite(v?.max) ? v.max : ''}`;
  for (const [key, value] of Object.entries(config)) {
    const name = aliases[key] ?? key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
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
function outputPrintConfig(brand: string, config: Record<string, any>): void {
  const entries: [string, string][] = [...outputConfigEntries(config), ['VERBOSE', String(outputVerbose())]];
  console.log(`[ config   ] ${brand} updater:\n${entries.map(([key, value]) => `              ${key}=${/TOKEN|PASSWORD|SECRET|COOKIE|SEC_UA/i.test(key) ? '<redacted>' : outputClean(value)}`).join('\n')}`);
}
function outputHasOutputFilters(config: Record<string, any>): boolean {
  return outputConfigEntries(config).some(([name, value]) =>
    /^(TICKERS|CATEGORY|AUM|TER|DIVIDEND_YIELD|SEC_YIELD|PERFORMANCE_|TOTAL_RETURN_)/.test(name) &&
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
function outputMoney(value: any): string {
  const raw = outputScalar(value);
  if (raw === null || raw === undefined || raw === '—' || raw === '--') return 'null';
  const text = String(raw).replace(/[$,\s]/g, '');
  const match = text.match(/^([+-]?[\d.]+)([KMBT])?$/i);
  if (!match) return outputClean(raw);
  const number = Number(match[1]) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[match[2]?.toUpperCase() as 'K' | 'M' | 'B' | 'T'] ?? 1);
  if (!Number.isFinite(number)) return 'null';
  for (const [unit, scale] of [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) {
    if (Math.abs(number) >= scale) return `$${(number / scale).toFixed(1)}${unit}`;
  }
  return `$${number.toFixed(2)}`;
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
    field('port', data.portfolioId),
    field('history', outputCount(data.history ?? data.historyCount)),
    sources ? `(${sources})` : '',
    field('holdings', outputCount(data.holdings ?? data.holdingsCount)),
    field('divs', outputCount(data.distributions)),
    field('netAssets', outputMoney(data.netAssets ?? data.aum)),
    field('div', outputScalar(data.dividendYield ?? metrics.dividendYield)),
    field('sec', outputScalar(data.secYield ?? metrics.secYield)),
  ].filter(part => part !== '').join(' ');
  return `[ ${String(index).padStart(width)}/${String(total).padEnd(width)}  ] ${outputClean(ticker).padEnd(5)} ${status.padEnd(9)}${detail ? ` ${detail}` : ''}${reason ? ` reason=${outputClean(reason)}` : ''}`;
}
function outputCreateReporter(root: URL | string, total: number) {
  let completed = 0;
  return {
    before: (ticker: string) => outputInspectFund(root, ticker),
    async result(ticker: string, before: { digest: string }, status?: string, reason?: unknown, extra: any = {}) {
      const after = await outputInspectFund(root, ticker);
      console.log(outputFundLine(++completed, total, ticker, status ?? (before.digest === after.digest ? 'unchanged' : 'updated'), { ...after.meta, ...extra }, reason));
    },
  };
}

import { mkdir, readFile, writeFile, readdir, rm, appendFile } from 'node:fs/promises';

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
// The issuer sits behind an Akamai bot manager that answers 403 to a plain
// fetch, from both this sandbox and GitHub Actions runners (verified
// 2026-10-01). The read-only rendering proxy is the documented sibling
// workaround (Franklin / ARK / Schwab); because a run that only needs the
// catalog and three fund pages would otherwise never reach the switch, one
// denial is already enough. The counter resets whenever a direct request
// succeeds, so a single transient 403 does not move the rest of the run.
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

// "08/21/2026" / "2026-08-21T00:00:00Z" -> "2026-08-21"; anything else passes
// through untouched so an unexpected source format never silently corrupts a
// date column.
export function toIsoDate(raw: unknown): string {
  const text = String(raw ?? '').trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  return text;
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
  const [rawMin, rawMax] = text.split(':', 2);
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
  const suffixMatch = /^([\d.]+)([KMBT])$/i.exec(cleaned);
  if (suffixMatch) return Number(suffixMatch[1]) * (AMOUNT_SUFFIXES[suffixMatch[2].toUpperCase()] ?? 1);
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
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
  const [rawMin, rawMax] = text.split(':', 2);
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
      if (response.ok) return response;
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

function issuerHeaders(): Record<string, string> {
  return { 'User-Agent': YAHOO_BROWSER_UA, Accept: 'text/html,application/xhtml+xml,*/*' };
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

async function fetchIssuerText(url: string, label: string, config: UpdaterConfig): Promise<string> {
  if (issuerProxyOnly) {
    const response = await fetchWithRetry(issuerUrl(url), `${label} (proxy)`, { headers: issuerHeaders() }, config.maxRetries);
    return stripProxyPreamble(await response.text());
  }
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
    console.warn(`[ issuer   ] ${label}: ${errorMessage(error)} — switching to the read-only rendering proxy for the rest of this run`);
    const response = await fetchWithRetry(issuerUrl(url), `${label} (proxy)`, { headers: issuerHeaders() }, config.maxRetries);
    return stripProxyPreamble(await response.text());
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
    console.warn(`[ edgar    ] ${errorMessage(error)} — switching to the read-only rendering proxy for the rest of this run`);
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
  netAssets: number | null;
  netAssetsDate: string | null;
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
};

export type ChartDay = { date: string; close: number; adjClose: number; volume: number };
export type ParsedChart = {
  exchangeName: string;
  longName: string;
  regularMarketPrice: number | null;
  regularMarketTime: number | null;
  firstTradeDate: number | null;
  days: ChartDay[];
  dividends: Array<{ epoch: number; amount: number }>;
};

export type ParsedNport = {
  regName: string;
  regCik: string;
  seriesName: string;
  seriesId: string;
  repPdDate: string;
  holdings: JsonRecord[];
  totalValue: number;
  netAssets: number | null;
  designatedIndex: string;
};

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
// SEC EDGAR layer: N-PORT-P holdings, resolved by the fund's own series id.
// ---------------------------------------------------------------------------

export type NportAccession = { accession: string; filed: string; reportDate: string; url: string };

export function nportUrlFor(cik: string, accession: string): string {
  return `${EDGAR_ARCHIVES}/${Number(String(cik).replace(/^0+/, '') || 0)}/${String(accession).replace(/-/g, '')}/primary_doc.xml`;
}

export function parseNportAccessions(submissions: JsonRecord): NportAccession[] {
  const recent = submissions?.filings?.recent;
  const result: NportAccession[] = [];
  if (!recent || !Array.isArray(recent.form)) return result;
  for (let i = 0; i < recent.form.length; i++) {
    if (!String(recent.form[i]).toUpperCase().startsWith('NPORT')) continue;
    const accession: string = String(recent.accessionNumber?.[i] || '');
    if (!accession) continue;
    result.push({
      accession,
      filed: String(recent.filingDate?.[i] || ''),
      reportDate: String(recent.reportDate?.[i] || ''),
      url: nportUrlFor(String(submissions.cik || '0'), accession),
    });
  }
  return result;
}

// EDGAR publishes the authoritative "ticker -> registrant CIK + series id"
// table for every ETF and mutual fund class; it is the reliable way to reach a
// fund's own N-PORT-P filing (the full-text search is only a last resort).
export type SecSeriesRef = { cik: string; seriesId: string; classId: string };

export function parseFundTickerMap(payload: JsonRecord): Map<string, SecSeriesRef> {
  const map = new Map<string, SecSeriesRef>();
  const fields: string[] = Array.isArray(payload?.fields) ? payload.fields.map((field: unknown) => String(field)) : [];
  const rows: unknown[] = Array.isArray(payload?.data) ? payload.data : [];
  const at = (row: unknown[], field: string): string => {
    const index = fields.indexOf(field);
    return index >= 0 ? String(row[index] ?? '') : '';
  };
  for (const raw of rows) {
    if (!Array.isArray(raw)) continue;
    const ticker = sanitizeTicker(at(raw, 'symbol'));
    if (!ticker || map.has(ticker)) continue;
    const cik = at(raw, 'cik').replace(/\D/g, '');
    if (!cik || Number(cik) === 0) continue;
    map.set(ticker, {
      cik: cik.padStart(10, '0'),
      seriesId: at(raw, 'seriesId').toUpperCase(),
      classId: at(raw, 'classId').toUpperCase(),
    });
  }
  return map;
}

// Operating-company name -> exchange ticker, so N-PORT positions (which carry
// CUSIP/ISIN but never a ticker) still land in the watchlist with a symbol.
export function parseCompanyTickerMap(payload: JsonRecord): Map<string, string> {
  const map = new Map<string, string>();
  const rows = payload && typeof payload === 'object' ? Object.values(payload as JsonRecord) : [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as JsonRecord;
    const ticker = cleanHoldingTicker(record.ticker);
    const title = String(record.title ?? '');
    if (!ticker || !title) continue;
    for (const key of [normalizeHoldingName(title), normalizeHoldingNameCore(title)]) {
      if (key && !map.has(key)) map.set(key, ticker);
    }
  }
  return map;
}

export function edgarSeriesFilingsUrl(seriesId: string, count = 10): string {
  const params = new URLSearchParams({
    action: 'getcompany',
    CIK: String(seriesId || '').toUpperCase(),
    type: 'NPORT-P',
    dateb: '',
    owner: 'include',
    count: String(count),
    output: 'atom',
  });
  return `${EDGAR_BROWSE_URL}?${params.toString()}`;
}

// browse-edgar's Atom feed for one series: the newest N-PORT-P accessions of
// exactly that fund, newest first.
export function parseEdgarAtomFilings(xml: string): NportAccession[] {
  const result: NportAccession[] = [];
  for (const entry of String(xml || '').matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    const body = entry[1];
    const form = tagValue(body, 'filing-type') || tagValue(body, 'type');
    if (form && !form.toUpperCase().startsWith('NPORT')) continue;
    const accession = tagValue(body, 'accession-number') || tagValue(body, 'accession-nunber');
    if (!accession) continue;
    const hrefMatch = /<filing-href>([\s\S]*?)<\/filing-href>/i.exec(body);
    const cikMatch = hrefMatch ? /\/edgar\/data\/(\d+)\//.exec(cleanText(hrefMatch[1])) : null;
    result.push({
      accession,
      filed: tagValue(body, 'filing-date'),
      reportDate: tagValue(body, 'period') || '',
      url: nportUrlFor(cikMatch ? cikMatch[1] : accession.slice(0, 10), accession),
    });
  }
  return result;
}

function tagValue(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return match ? cleanText(match[1]) : '';
}

export type NportHolding = JsonRecord;

// Minimal, forgiving N-PORT-P XML reader (machine-generated schemas only).
export function parseNport(xml: string): ParsedNport {
  const genInfoMatch = /<genInfo>([\s\S]*?)<\/genInfo>/i.exec(xml);
  const genInfo = genInfoMatch ? genInfoMatch[1] : String(xml || '').slice(0, 4000);
  const fundInfoMatch = /<fundInfo>([\s\S]*?)<\/fundInfo>/i.exec(xml);
  const fundInfo = fundInfoMatch ? fundInfoMatch[1] : '';
  const holdings: NportHolding[] = [];
  const blockRe = /<invstOrSec>([\s\S]*?)<\/invstOrSec>/gi;
  let block: RegExpExecArray | null;
  let totalValue = 0;
  while ((block = blockRe.exec(xml)) !== null) {
    const body = block[1];
    const name = tagValue(body, 'name') || tagValue(body, 'title') || '-';
    const cusip = tagValue(body, 'cusip');
    let identifier = cusip && cusip.toUpperCase() !== 'N/A' ? cusip : '';
    if (!identifier) {
      // Real EDGAR schema: <identifiers><isin value="..."/><other value="..."/></identifiers>
      for (const tagMatch of body.matchAll(/<(isin|sedol|other|cusip)[^>]*value="([^"]+)"/gi)) {
        identifier = cleanText(tagMatch[2]);
        if (identifier) break;
      }
    }
    const weight = normalizeNumberText(tagValue(body, 'pctVal'));
    const valueMatch = /<valUSD[^>]*>([\s\S]*?)<\/valUSD>/i.exec(body);
    const value = Number(valueMatch ? valueMatch[1].replace(/[,\s]/g, '') : tagValue(body, 'curVal'));
    const balance = normalizeNumberText(tagValue(body, 'balance'));
    holdings.push({
      Name: name,
      Ticker: '-',
      Identifier: identifier || '-',
      Weight: weight === '' ? '0' : weight,
      'Market Value': Number.isFinite(value) ? String(value) : '0',
      'Shares Held': balance === '' ? '-' : balance,
      'Asset Category': tagValue(body, 'assetCat') || '-',
    });
    if (Number.isFinite(value)) totalValue += value;
  }
  return {
    regName: tagValue(genInfo, 'regName'),
    regCik: tagValue(genInfo, 'regCik'),
    seriesName: tagValue(genInfo, 'seriesName'),
    seriesId: tagValue(genInfo, 'seriesId').toUpperCase(),
    repPdDate: toIsoDate(tagValue(genInfo, 'repPdDate')),
    holdings,
    totalValue,
    netAssets: numberOrNull(normalizeNumberText(tagValue(fundInfo, 'netAssets'))),
    designatedIndex: tagValue(fundInfo, 'nameDesignatedIndex'),
  };
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
    siAnn: siYears >= 0.75 && anchored(first) ? annualized(first.adjClose, last.adjClose, siYears) : null,
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
  const dividendYield = coalesce(publishedDividendYield) ?? indicatedYield(latestDistribution, paymentsPerYear, price);
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

async function writeIfChanged(file: URL, value: unknown): Promise<boolean> {
  const next = `${JSON.stringify(value, null, 1)}\n`;
  let previous: string | null = null;
  try {
    previous = await readFile(file, 'utf8');
  } catch {
    // First write.
  }
  if (previous === next || (previous !== null && samePublishedContent(previous, value))) return false;
  await writeFile(file, next, 'utf8');
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

type UpdateState = { cursor: string | null; savedAt: string };

async function readUpdateState(): Promise<UpdateState | null> {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8')) as UpdateState;
  } catch {
    return null;
  }
}

async function writeUpdateState(lastProcessedTicker: string | null): Promise<void> {
  if (!lastProcessedTicker) { await rm(STATE_FILE, { force: true }); return; }
  const previous: UpdateState | null = await readUpdateState();
  if (previous?.cursor === lastProcessedTicker) return;
  await writeIfChanged(STATE_FILE, { cursor: lastProcessedTicker, savedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') });
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
  return map;
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

export function mergeHistory(previous: JsonRecord[], fresh: ChartDay[]): JsonRecord[] {
  const byDate = new Map<string, JsonRecord>();
  for (const row of previous) {
    const epoch = Date.parse(String(row.Date));
    if (Number.isFinite(epoch)) byDate.set(new Date(epoch).toISOString().slice(0, 10), row);
  }
  for (const row of historyRows(fresh)) {
    const key = new Date(Date.parse(row.Date)).toISOString().slice(0, 10);
    const published = byDate.get(key);
    // Yahoo recomputes adjusted closes on every request. A value that sits on
    // a .xx5 rounding boundary flips the published cent back and forth between
    // otherwise identical requests, and the feed would churn on every run.
    // A published row therefore keeps its cent while the fresh value moves by
    // less than two cents; a genuine restatement or dividend adjustment is
    // larger and replaces the row normally.
    const freshAdj = numberOrNull(row['Adj Close']);
    const publishedAdj = published ? numberOrNull(published['Adj Close']) : null;
    if (freshAdj !== null && publishedAdj !== null && Math.abs(freshAdj - publishedAdj) < 0.02) row['Adj Close'] = published!['Adj Close'];
    byDate.set(key, row);
  }
  return [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row);
}

function chartDaysFromRows(rows: JsonRecord[]): ChartDay[] {
  return rows.flatMap((row) => {
    const date = new Date(Date.parse(String(row.Date)));
    const close = numberOrNull(row.Close);
    const adjClose = numberOrNull(row['Adj Close']);
    return Number.isFinite(date.getTime()) && close !== null && adjClose !== null
      ? [{ date: date.toISOString().slice(0, 10), close, adjClose, volume: numberOrNull(row.Volume) ?? 0 }]
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
  if (value === null) return null;
  const start = inception ? isoToEpoch(inception) : null;
  const end = asOfDate ? isoToEpoch(asOfDate) : null;
  if (start === null || end === null) return value;
  return (end - start) / 86_400 >= 365 ? value : null;
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
): JsonRecord | null {
  const hasOfficial = Object.values(official).some((value) => value !== null);
  const hasDerived = Boolean(derived.asOfDate);
  if (!hasOfficial && !hasDerived) return (previous.returns as JsonRecord) ?? null;
  const text = (value: number | null | undefined): string => (value === null || value === undefined ? '—' : `${value.toFixed(2)}%`);
  const asOf = asOfDate || derived.asOfDate;
  const mo1 = officialMo1 ?? derived.mo1;
  return {
    derivedFrom: hasOfficial
      ? 'official Eaton Vance / MSIM published returns; month-to-date and history-derived periods use the Yahoo Finance adjusted series'
      : 'derived from the Yahoo Finance adjusted daily series, not official published NAV returns',
    monthEnd: {
      asOfDate: asOf ? formatEdgarDate(asOf) : '—',
      mo1,
      mo1Text: text(mo1),
      qtd: derived.qtd,
      qtdText: text(derived.qtd),
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
    quarterEnd: {
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

// Lazily fetched, cached-per-run SEC lookup tables. The promise is cached, so
// concurrent workers share one request instead of each fetching the table.
let fundTickerMap: Promise<Map<string, SecSeriesRef>> | null = null;
let companyTickerMap: Promise<Map<string, string>> | null = null;

function loadFundTickerMap(config: UpdaterConfig): Promise<Map<string, SecSeriesRef>> {
  fundTickerMap ??= (async () => {
    try {
      const payload = await fetchSecJson(SEC_FUND_TICKERS_URL, '[edgar   ] fund ticker table', config);
      const map = parseFundTickerMap(payload);
      outputNote(`[ edgar    ] SEC fund ticker table: ${map.size} ETF / mutual-fund share classes`);
      return map;
    } catch (error) {
      console.warn(`[ edgar    ] fund ticker table: ${errorMessage(error)} — falling back to full-text search`);
      return new Map<string, SecSeriesRef>();
    }
  })();
  return fundTickerMap;
}

function loadCompanyTickerMap(config: UpdaterConfig): Promise<Map<string, string>> {
  companyTickerMap ??= (async () => {
    try {
      const payload = await fetchSecJson(SEC_COMPANY_TICKERS_URL, '[edgar   ] company ticker table', config);
      const map = parseCompanyTickerMap(payload);
      outputNote(`[ edgar    ] SEC company ticker table: ${map.size} issuer names`);
      return map;
    } catch (error) {
      console.warn(`[ edgar    ] company ticker table: ${errorMessage(error)} — N-PORT tickers stay "-"`);
      return new Map<string, string>();
    }
  })();
  return companyTickerMap;
}

// N-PORT positions carry CUSIP/ISIN but never a ticker; the SEC company table
// turns the filed issuer name back into an exchange symbol so the watchlist
// export stays usable, exactly like the sibling Fidelity updater.
function fillNportTickers(rows: NportHolding[], names: Map<string, string>): NportHolding[] {
  if (!names.size) return rows;
  return rows.map((row) => {
    if (cleanHoldingTicker(row.Ticker)) return row;
    const name = String(row.Name ?? '');
    const ticker = names.get(normalizeHoldingName(name)) || names.get(normalizeHoldingNameCore(name)) || '';
    return ticker ? { ...row, Ticker: ticker } : row;
  });
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

// Registrants file one N-PORT-P per series, so the newest filing of the trust
// usually belongs to another fund: a bounded, per-run-cached list of the newest
// filings is scanned until the document carrying this fund's own series id is
// found. The series-filtered Atom feed answers in one request when it is
// reachable; scanning the registrant's submissions is the fallback.
const NPORT_CANDIDATE_LIMIT = 20;
async function resolveNportFilings(
  fund: CatalogFund,
  config: UpdaterConfig,
): Promise<{ candidates: NportAccession[]; cik: string; seriesId: string } | null> {
  const table = await loadFundTickerMap(config);
  const ref = table.get(fund.ticker) || null;
  if (ref?.seriesId) {
    try {
      const atom = await fetchSecText(edgarSeriesFilingsUrl(ref.seriesId), `[edgar   ] ${fund.ticker} series ${ref.seriesId}`, config, 'xml');
      const filings = parseEdgarAtomFilings(atom);
      if (filings.length) return { candidates: filings, cik: ref.cik, seriesId: ref.seriesId };
    } catch (error) {
      outputNote(`[ edgar    ] ${fund.ticker} series ${ref.seriesId}: ${errorMessage(error)} — scanning registrant submissions`);
    }
  }
  const cik = ref?.cik || (await resolveRegistrantCik(fund, config));
  if (!cik) return null;
  try {
    const submissions = await fetchSecJson(`${SEC_DATA_HOST}/submissions/CIK${cik.padStart(10, '0')}.json`, `[edgar   ] ${cik} submissions`, config);
    const filings = parseNportAccessions(submissions).slice(0, NPORT_CANDIDATE_LIMIT);
    if (filings.length) return { candidates: filings, cik, seriesId: ref?.seriesId || '' };
  } catch (error) {
    outputNote(`[ edgar    ] ${fund.ticker}: ${errorMessage(error)}`);
  }
  return null;
}

// One document is fetched at most once per run, even when several funds scan
// past it on their way to their own filing.
const nportDocumentCache = new Map<string, ParsedNport>();
async function loadNportDocument(accession: NportAccession, config: UpdaterConfig): Promise<ParsedNport> {
  const cached = nportDocumentCache.get(accession.url);
  if (cached) return cached;
  const parsed = parseNport(await fetchSecText(accession.url, `[ nport    ] ${accession.accession}`, config, 'xml'));
  nportDocumentCache.set(accession.url, parsed);
  return parsed;
}

// A registrant files one N-PORT-P per series: only accept the document that
// really belongs to this fund, never the trust's newest filing.
export function nportBelongsToFund(parsed: { seriesId: string; seriesName: string }, filing: { seriesId: string }, fund: { name: string }): boolean {
  if (filing.seriesId) return parsed.seriesId.toUpperCase() === filing.seriesId.toUpperCase();
  const filed = normalizeHoldingName(parsed.seriesName);
  const wanted = normalizeHoldingName(fund.name);
  return Boolean(filed && wanted && (filed === wanted || filed.includes(wanted) || wanted.includes(filed)));
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
    const pageUrl = PARAMETRIC_FUND_SLUGS[ticker] ? issuerFundUrl(ticker) : fund.fundPage;
    try {
      pageText = await fetchIssuerText(pageUrl, `[ product  ] ${ticker}`, config);
      product = parseIssuerProduct(pageText, ticker);
      if (config.storeRawDownloads) await storeRaw(ticker, 'product.md', pageText);
    } catch (error) {
      outputNote(`[ product  ] ${ticker}: ${errorMessage(error)} — keeping published data`);
    }
  }
  const officialHoldings = pageText ? await loadIssuerHoldings(fund, pageText, config) : null;
  if (officialHoldings && product) product.holdings = officialHoldings;
  const cusip = product?.cusip || fund.cusip || String(previous.identifiers?.cusip || '');

  // 2) Holdings: the issuer's own full sheet when it exists, SEC N-PORT-P otherwise.
  let holdings: ParsedHoldings | null = product?.holdings ?? null;
  let holdingsSource = holdings ? 'Eaton Vance official daily holdings download' : String(previous.holdings?.source || 'previous run');
  let holdingsEdgar: ParsedNport | null = null;
  if (!holdings && config.edgarFallback) {
    try {
      const resolved = await resolveNportFilings(fund, config);
      if (resolved) {
        let checked = 0;
        for (const candidate of resolved.candidates) {
          let parsed: ParsedNport;
          try {
            parsed = await loadNportDocument(candidate, config);
          } catch (error) {
            outputNote(`[ edgar    ] ${ticker}: ${candidate.accession}: ${errorMessage(error)} — trying the previous filing`);
            continue;
          }
          checked += 1;
          if (!nportBelongsToFund(parsed, { seriesId: resolved.seriesId }, fund)) continue;
          if (parsed.holdings.length) {
            holdingsEdgar = parsed;
            holdings = {
              asOfDate: parsed.repPdDate || null,
              headers: HOLDINGS_HEADERS,
              rows: fillNportTickers(parsed.holdings, await loadCompanyTickerMap(config)),
            };
            holdingsSource = `SEC EDGAR Form N-PORT-P (accession ${candidate.accession}, report period ${parsed.repPdDate || 'n/a'})`;
          }
          break;
        }
        if (!holdings) outputNote(`[ edgar    ] ${ticker}: no N-PORT-P filing of this series among ${checked} checked — keeping previous holdings`);
      }
    } catch (error) {
      outputNote(`[ edgar    ] ${ticker}: ${errorMessage(error)} — keeping previous holdings`);
    }
  }

  const holdingsRows: JsonRecord[] = holdings ? holdings.rows : await readPreviousSheet(ticker, 'holdings');
  const holdingsHeaders = holdings?.headers.length
    ? holdings.headers
    : (await readPreviousSheetHeaders(ticker, 'holdings')).length
      ? await readPreviousSheetHeaders(ticker, 'holdings')
      : HOLDINGS_HEADERS;
  const holdingsAsOf = holdings?.asOfDate ?? ((previous.holdings as JsonRecord)?.asOfDate as string | undefined) ?? null;
  const previousHoldingsCount = numberOrNull((previous.holdings as JsonRecord)?.totalRows) ?? holdingsRows.length;

  // 3) History: the Yahoo chart (adjusted daily series + dividends).
  let chart: ParsedChart | null = null;
  if (!config.skipYahoo) {
    try {
      chart = parseChart(await fetchJson(chartUrl(ticker, config), `[ chart    ] ${ticker}`, yahooHeaders(), config));
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
  const chartDays = chart?.days.length ? chart.days : chartDaysFromRows(history);
  const derived = chartDays.length ? priceReturns(chartDays, new Date(), coveredFrom) : EMPTY_PRICE_RETURNS;

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

  // 5) Headline numbers, official first, published values retained otherwise.
  const inception = product?.inception ?? fund.inception ?? null;
  const returnsAsOfDate = product?.monthEnd.asOfDate ?? fund.returnsAsOfDate ?? null;
  const official = mergeOfficial(product?.monthEnd ?? null, fund.returns);
  const officialCumulative = product?.quarterEnd ? { ...EMPTY_CUMULATIVE } : null;
  const ter = product?.netExpense ?? product?.grossExpense ?? fund.ter ?? numberOrNull(previous.terValue);
  const nav = product?.nav ?? fund.nav ?? numberOrNull(previous.navValue);
  const price = product?.marketPrice ?? fund.close ?? chart?.regularMarketPrice ?? numberOrNull(previous.closePriceValue);
  const secYield = product?.secYield ?? fund.secYield ?? null;
  const secYieldDate = product?.secYieldDate ?? fund.secYieldDate ?? null;
  const metrics = deriveCatalogMetrics(
    official,
    derived,
    product?.dividendYield ?? fund.dividendYield,
    secYield,
    latestDividend ? latestDividend.amount : null,
    frequency.paymentsPerYear,
    price,
    officialCumulative,
    returnsAsOfDate,
  );

  const filterReasons = fundFilterReasons({ ticker, aumValue: product?.netAssets ?? holdingsEdgar?.netAssets ?? fund.netAssets, terValue: ter, metrics }, config);
  if (filterReasons.length) { outputNote(`[ filter   ] ${ticker}: ${filterReasons.join('; ')}`); return null; }

  const holdingsManifest = await writePages(fundDir, ticker, 'holdings', holdingsHeaders, holdingsRows, config.holdingsPageSize);
  const historyManifest = await writePages(fundDir, ticker, 'history', YAHOO_HISTORY_HEADERS, history, config.historyPageSize);
  const distributions = dividends.length ? distributionRows(dividends) : (((previous.distributions?.rows as JsonRecord[]) || []) as string[][]);

  // Without a fresh issuer catalog the N-PORT-P series name is the most
  // authoritative fund name available.
  const name = product?.name || holdingsEdgar?.seriesName || fund.name || String(previous.name ?? '') || ticker;
  // The product page publishes the premium/discount in dollars; the sibling
  // feeds publish a percentage, so it is computed from the page's own NAV and
  // market price (and the published dollar figure is kept alongside).
  const premiumDiscountAmount = product?.premiumDiscountAmount ?? fund.premiumDiscountAmount ?? null;
  const premiumDiscount = nav && price ? round(((price - nav) / nav) * 100, 2) : fund.premiumDiscount ?? null;
  const nportNetAssets = holdingsEdgar
    ? holdingsEdgar.netAssets ?? (holdingsEdgar.totalValue ? round(holdingsEdgar.totalValue, 2) : null)
    : null;
  const catalogNetAssets = product?.netAssets ?? (fund.source === 'parametric' ? fund.netAssets : null);
  const netAssets = catalogNetAssets ?? nportNetAssets ?? fund.netAssets ?? numberOrNull(previous.aumValue);
  const navAsOfDate = product?.navDate ?? (chart?.regularMarketTime ? epochToIsoDate(chart.regularMarketTime) : fund.asOfDate ?? null);
  const returnsData = returnsBlock(derived, official, product?.monthEnd.mo1 ?? fund.mo1 ?? null, returnsAsOfDate, previous);
  const asOfLabel = navAsOfDate ? formatEdgarDate(navAsOfDate) : String(previous.asOfDate ?? '—');
  const category = product?.assetClass && product.assetClass !== 'ETF' ? product.assetClass : fund.category;
  const benchmark = product?.benchmark || holdingsEdgar?.designatedIndex || fund.benchmark;
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
      provider: 'Eaton Vance / MSIM product pages + SEC EDGAR Form N-PORT-P (holdings) + Yahoo Finance public chart API (NAV history and dividends)',
    },
    identifiers: { cusip: cusip || null, isin: product?.isin || fund.isin || null, indexTicker: benchmark || null },
    inception: {
      fundInceptionDate: inception,
      inceptionDate: inception ? formatEdgarDate(inception) : null,
      listingDate: null,
    },
    expense: {
      gross: product?.grossExpense ?? ter,
      net: product?.netExpense ?? ter,
      display: ter === null ? '—' : `${ter.toFixed(2)}%`,
      grossDisplay: product?.grossExpense === null || product?.grossExpense === undefined ? null : `${product.grossExpense.toFixed(2)}%`,
      netDisplay: product?.netExpense === null || product?.netExpense === undefined ? null : `${product.netExpense.toFixed(2)}%`,
      asOf: asOfLabel,
      source: 'official Eaton Vance / MSIM product page (gross and net expense ratio)',
    },
    nav: {
      display: nav === null ? '—' : `$${nav.toFixed(2)}`,
      value: nav,
      asOfDate: navAsOfDate,
      source: product ? 'official Eaton Vance / MSIM product page' : 'previous run',
    },
    marketPrice: {
      display: price === null ? '—' : `$${price.toFixed(2)}`,
      value: price,
      asOfDate: navAsOfDate,
      source: product ? 'official Eaton Vance / MSIM product page (market price)' : 'Yahoo Finance chart API (last close)',
    },
    premiumDiscount: {
      display: premiumDiscount === null ? '—' : `${premiumDiscount.toFixed(2)}%`,
      value: premiumDiscount,
      asOfDate: navAsOfDate,
      source: product ? 'official Eaton Vance / MSIM product page (market price versus NAV)' : 'previous run',
      amount: premiumDiscountAmount,
    },
    bidAskSpread: {
      display: product?.bidAskSpread === null || product?.bidAskSpread === undefined ? '—' : `${product.bidAskSpread.toFixed(2)}%`,
      value: product?.bidAskSpread ?? null,
      asOfDate: navAsOfDate,
      source: 'official Eaton Vance / MSIM product page (30-day median bid/ask spread)',
    },
    aum: {
      display: netAssets === null ? '—' : `$${(netAssets / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M`,
      value: netAssets,
      asOfDate: product?.netAssetsDate
        ? formatEdgarDate(product.netAssetsDate)
        : holdingsEdgar?.repPdDate
          ? formatEdgarDate(holdingsEdgar.repPdDate)
          : ((previous.aum as JsonRecord)?.asOfDate as string) ?? '—',
      source: catalogNetAssets !== null
        ? 'official Eaton Vance / MSIM product page (total net assets)'
        : nportNetAssets !== null
          ? `SEC Form N-PORT-P net assets (report period ${holdingsEdgar?.repPdDate || 'n/a'})`
          : 'previous run',
    },
    yields: {
      dividendYield: metrics.dividendYield,
      dividendYieldText: metrics.dividendYieldText,
      dividendYieldKind: metrics.dividendYield !== null
        ? 'indicated (latest distribution x payments per year / market price)'
        : 'not published: no distributions yet',
      secYield: metrics.secYield,
      secYieldText: metrics.secYieldText,
      secYieldKind: metrics.secYield !== null
        ? `30-day SEC yield as published by eatonvance.com${secYieldDate ? `, as of ${formatEdgarDate(secYieldDate)}` : ''}`
        : 'not published by eatonvance.com for this fund',
    },
    returns: returnsData ? { ...returnsData, returnsBasis: metrics.returnsBasis, performanceAsOf: metrics.performanceAsOf } : returnsData,
    distributions: {
      frequency: frequency.frequency,
      paymentsPerYear: frequency.paymentsPerYear,
      frequencyCode: product?.frequencyCode || null,
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
  await writeIfChanged(new URL('meta.json', fundDir), retainUnavailable(meta, previousMeta));

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
    nav: nav === null ? '—' : `$${nav.toFixed(2)}`,
    navValue: nav,
    aum: netAssets === null ? '—' : formatAumDisplay(netAssets),
    aumValue: netAssets,
    asOfDate: asOfLabel,
    inceptionDate: inception ? formatEdgarDate(inception) : (previous.inceptionDate || '—'),
    closePrice: price === null ? '—' : `$${price.toFixed(2)}`,
    closePriceValue: price,
    premiumDiscount: premiumDiscount === null ? '—' : `${premiumDiscount.toFixed(2)}%`,
    premiumDiscountValue: premiumDiscount,
    distributions: {
      frequency: frequency.frequency,
      exDate: latestDividend ? formatUsDate(latestDividend.epoch) : '—',
      dividend: latestDividend ? String(round(latestDividend.amount, 6)) : '—',
    },
    returns: { monthEnd, quarterEnd: null },
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
  const selected = funds.filter((fund) => !config.tickers.length || config.tickers.includes(fund.ticker));
  if (!config.maxFetches) return selected;
  const index = selected.findIndex((fund) => fund.ticker === cursor);
  const ordered = index < 0 ? selected : selected.slice(index + 1).concat(selected.slice(0, index + 1));
  return ordered.slice(0, config.maxFetches);
}

async function main(): Promise<void> {
  const controls = await runtimeControls(process.env);
  if (controls.VERBOSE !== undefined) process.env.VERBOSE = controls.VERBOSE;
  installSystemCa(controls.USE_SYSTEM_CA ?? 'auto');
  const config = readConfig(controls);
  await mkdir(API_ROOT, { recursive: true });
  const requestSleepMs = Math.max(0, config.requestSleep) * 1000;
  discoveryGate = createRequestGate(requestSleepMs);
  configureProxyGate(Math.max(requestSleepMs, PROXY_SLEEP_SECONDS * 1000));
  outputPrintConfig('Parametric', config);
  console.log('');
  const catalog = new Map<string, CatalogFund>();
  const previousIndex = await readPreviousIndex();
  for (const [ticker, row] of previousIndex) catalog.set(ticker, catalogFundFromIndex(ticker, row));
  let catalogSource = 'previous published index';
  if (!config.skipIssuer) {
    try {
      const html = await fetchIssuerText(config.catalogUrl, '[ catalog  ]', config);
      for (const entry of parseIssuerCatalog(html)) {
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
      catalogSource = 'Eaton Vance / MSIM official ETF catalog';
    } catch (error) { console.warn(`[ catalog  ] ${errorMessage(error)} — retained published catalog`); }
  }
  const unknown = config.tickers.filter(ticker => !catalog.has(ticker));
  if (unknown.length) throw new Error(`Requested tickers absent from catalog: ${unknown.join(' ')}`);
  const universe = [...catalog.values()].sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));
  if (!universe.length) throw new Error('No verified issuer catalog or published seed available');
  console.log(`[ catalog  ] ${universe.length} Parametric ETFs (${catalogSource})`);

  const state = await readUpdateState();
  // A plain `bun ./scripts/update-data.ts` (no MAX_FETCHES) always walks the
  // whole catalog from the top and clears the cursor afterwards; the saved
  // cursor only rotates the queue for explicitly bounded batch runs.
  const cursor = config.maxFetches > 0 ? state?.cursor || null : null;
  const selected = batchSelection(universe, config, cursor);
  const results: JsonRecord[] = [];
  const succeeded = new Set<string>();
  let failures = 0;

  outputPrintFilter(selected.length, universe.length, outputHasOutputFilters(config));
  const output = outputCreateReporter(API_ROOT, selected.length);
  await runPool(selected, config.concurrency, requestSleepMs, async (fund) => {
    const before = await output.before(fund.ticker);
    try {
      const row = await processFund(fund, config, previousIndex.get(fund.ticker) || {});
      if (row) {
        results.push(retainUnavailable(row, previousIndex.get(fund.ticker)) as JsonRecord);
        succeeded.add(fund.ticker);
      }
      await output.result(fund.ticker, before, row ? undefined : 'skipped');
    } catch (error) {
      failures += 1;
      await output.result(fund.ticker, before, 'failed', String(error));
    }
  });
  const lastProcessedTicker = nextCursor(selected, succeeded, cursor);

  // Funds not selected for a successful update keep their previously published rows.
  const keptFromPrevious = universe
    .filter((fund) => !results.some((row) => row.ticker === fund.ticker))
    .map((fund) => previousIndex.get(fund.ticker))
    .filter(Boolean) as JsonRecord[];
  const funds = [...results, ...keptFromPrevious].sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)));

  const counts = {
    funds: funds.length,
    holdings: funds.reduce((sum, fund) => sum + (numberOrNull(fund.holdings) || 0), 0),
    history: funds.reduce((sum, fund) => sum + (numberOrNull(fund.history) || 0), 0),
  };

  if (results.length || !previousIndex.size) await writeIfChanged(INDEX_FILE, {
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

  // Full passes reset the cursor: the next run starts from the top again.
  await writeUpdateState(config.maxFetches > 0 ? lastProcessedTicker : null);

  console.log('');
  console.log(`[ done     ] ${results.length} funds updated, ${keptFromPrevious.length} kept from previous runs, ${failures} failures`);
  console.log(`[ done     ] counts: ${counts.funds} funds / ${counts.holdings.toLocaleString('en-US')} holdings rows / ${counts.history.toLocaleString('en-US')} history rows`);
  console.log(
    `[ cursor   ] ${config.maxFetches > 0 && lastProcessedTicker ? `next run continues after ${lastProcessedTicker}` : 'full pass complete (cursor reset)'}`,
  );

  if (failures) process.exitCode = 1;
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
