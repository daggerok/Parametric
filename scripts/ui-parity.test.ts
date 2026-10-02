/// <reference types="bun" />
// UI parity guard: `index.html` and `app.tsx` must be exact copies of the
// pinned sibling (daggerok/Capital-Group) after the enumerated substitutions —
// no structural edits, no extra rows, no reworded tooltips.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('evidence/ui-parity.json'));

for (const name of ['app.tsx', 'index.html']) {
  test(`${name}: exact pinned sibling copy after the allowed substitutions`, () => {
    const source = read(`evidence/ui-reference/${name}`);
    expect(createHash('sha256').update(source).digest('hex')).toBe(manifest.files[name].referenceSha256);
    const expected = manifest.substitutions.reduce(
      (text: string, sub: { from: string; to: string }) => text.split(sub.from).join(sub.to),
      source,
    );
    const output = read(name);
    expect(output).toBe(expected);
    // The recorded manifest hash must describe the file that is actually
    // shipped, so the evidence cannot silently go stale.
    expect(createHash('sha256').update(output).digest('hex')).toBe(manifest.files[name].outputSha256);
    expect(manifest.files[name].matches).toBe(true);
  });
}

test('Frequency display rule: none/unknown/dashes and unchanged cadence labels', () => {
  const source = read('app.tsx');
  const start = source.indexOf('function formatDividendFrequency');
  const body = source.slice(start, source.indexOf('\n}', start) + 2);
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(body);
  const format = new Function(`${js}; return formatDividendFrequency`)();
  for (const value of [null, undefined, '', '   ', '-', '—', '–', '‐', 'None']) expect(format(value)).toBe('00 - None');
  expect(format('Unknown')).toBe('00 - Unknown');
  expect(format('Monthly')).toBe('01 - Monthly');
  expect(format('Quarterly')).toBe('04 - Quarterly');
});

test('no brand string from the pinned sibling is left behind', () => {
  for (const name of ['app.tsx', 'index.html']) {
    const text = read(name);
    for (const needle of ['Capital Group', 'capital-group', 'capitalgroup.com']) {
      expect(text.includes(needle)).toBe(false);
    }
    expect(text).toContain('api/parametric/');
  }
});

test('the app reads the documented Parametric feed endpoints', () => {
  const app = read('app.tsx');
  expect(app).toContain("const INDEX_URL = './api/parametric/index.json'");
  expect(app).toContain('./api/parametric/funds/${encodeURIComponent(ticker)}/meta.json');
  expect(app).toContain('eatonvance.com ETF fund data');
  expect(app).toContain('SEC EDGAR N-PORT-P');
  // Table rows stay selectable only through the "Use" checkbox.
  expect(/<tr[^>]*onclick/i.test(app)).toBe(false);
});
