# Parametric

One of the app's features lets you select Parametric ETFs in the Watchlist and aggregate their holdings to see how often each ticker appears across the selected funds. Repeated holdings make overlapping exposure visible: the more selected funds include a ticker, the greater its potential influence on the portfolio; gains in that holding may help, while declines may hurt, and actual impact also depends on each fund's position size. Another feature makes it faster and easier to find funds with stronger growth over different periods, higher dividend yields or distributions, greater Total Return (price performance plus dividends), and other key performance metrics. A single-file client-side tool that reads the generated `./api/parametric` static feed (the eatonvance.com ETF catalog and per-fund Parametric product pages - official NAV and market price, premium/discount, expenses, published month-end returns and the full distribution schedule - with SEC EDGAR N-PORT-P holdings and the Yahoo Finance chart API for complete daily NAV history and dividends as fallbacks) into a searchable ETF/asset-class catalog with per-fund tabs, watchlist aggregation, ticker copy and CSV/TXT export - the same look, feel, columns and business logic as the sibling applications.

## Using Bun

```bash
bunx degit daggerok/Parametric#main ./12345 && cd $_
bunx serve . -p 1234
open http://0:1234
```

Application URL: <https://daggerok.github.io/Parametric/>

## Updating the static Parametric data

```bash
./scripts/update-data.ts
```

The script is directly executable (`#!/usr/bin/env bun`); `bun scripts/update-data.ts` is equivalent. Run `./scripts/update-data.ts --help` to print every control, its default and examples. Defaults are versioned in [`scripts/update-data.config.json`](scripts/update-data.config.json) and every control is an UPPER_CASE environment variable.

Precedence, later wins: file defaults < advanced JSON < nonblank inputs < protected Actions variable/env. In a local run the environment is the last layer, and an explicitly set variable wins even when empty (it clears the control). `PARAMETRIC_<NAME>` takes precedence over `<NAME>`, and the legacy `PARAMETRIC_LIMIT` (`MAX_FETCHES`) and `HISTORICAL_PAGE_SIZE` (`HISTORY_PAGE_SIZE`) aliases still work. Unknown keys, non-scalar values, multiline values and invalid values are rejected before any request or write.

The **Update Parametric ETF data** workflow runs weekly and on demand. It exposes the most common controls as manual inputs and accepts every other control through the `advanced` JSON input (for example `{"STORE_RAW_DOWNLOADS":"true","CATALOG_URL":"https://..."}`); a blank input inherits the file value. The repository Actions variable `SEC_UA`, when set, overrides the SEC User-Agent. The workflow resolves controls with the same `resolveControls` the command line uses and only ever commits `api/parametric`.

### Data sources

| Block | Source |
| --- | --- |
| Catalog (the Parametric ETF suite) | [eatonvance.com ETFs](https://www.eatonvance.com/products/etfs.html), the shared MSIM product table filtered to the `/products/etfs/**/parametric-*` fund pages |
| Fund facts per fund | the fund's own product page, e.g. [PAPI](https://www.eatonvance.com/products/etfs/us-equity/parametric-equity-premium-income-etf.html): NAV, market price, premium/discount, 30-day median bid/ask spread, gross/net expense ratio, inception, exchange, benchmark, total net assets, distribution frequency |
| Returns and distributions | the `Returns`, `Distributions` and `Key Facts & Characteristics` tables of the same product page |
| Holdings per fund | the issuer's full-holdings download when the page links one; otherwise [SEC EDGAR Form N-PORT-P](https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001676326&type=NPORT-P) for Morgan Stanley ETF Trust (CIK `0001676326`), resolved through the fund's own series id |
| Daily history | [Yahoo Finance chart API](https://query1.finance.yahoo.com/v8/finance/chart/PAPI) (`period1`/`period2`, daily bars, dividends) |
| Fallback | published `api/parametric/**` data is retained when a provider is unreachable; nothing is deleted on failure |

The issuer's product pages sit behind a bot manager that answers 403 to plain fetches, so after a denial the updater repeats the request through a read-only rendering proxy and prints one notice when it switches. SEC EDGAR answers 403 to datacenter IPs (GitHub runners included), so its requests use the same proxy fallback; Yahoo is fetched directly.

### Metrics and caveats

Each fund carries a derived `metrics` object that powers the catalog columns shared with the sibling sites:

- `ytd` / `tr1y` - official YTD and 1-year NAV returns -> *YTD Return*, *TR 1Y*
- `cagr3y` / `cagr5y` / `cagr10y` - published annualized 3Y/5Y/10Y figures -> *CAGR 3Y/5Y/10Y*
- `tr3y` / `tr5y` / `tr10y` - cumulative 3Y/5Y/10Y figures `(1 + CAGR)^n - 1` -> *TR 3Y/5Y/10Y*
- `siAnn` - since-inception annualized -> *SI Ann.*
- `dividendYield` - indicated yield (latest distribution x payments per year / market price), an estimate
- `secYield` - 30-day SEC yield when the catalog publishes it

Caveats:

- Official figures win: returns, expense ratios, NAV, market price and total net assets come from the issuer's product page. Where the page publishes no figure (young funds have no 3Y/5Y/10Y), returns are derived from the Yahoo adjusted series and labelled as estimates in `returnsBasis`; derived values never replace a published one. The market-price returns row is parsed separately and is not used for the NAV metrics
- The page publishes the premium/discount in dollars; the percentage is computed from the page's own NAV and market price, and the dollar figure is kept alongside
- As-of dates and sources are recorded per block in each fund's `meta.json` (`nav.asOfDate`, `aum.asOfDate`, `holdings.asOfDate`, `*.source`)
- An unavailable value is `null` or `—`, never `0`; a failed provider keeps the previously published value. An active filter range excludes funds whose value is unavailable
- Holdings tickers: issuer and N-PORT-P rows of bonds, repos, futures, options and other non-equity securities keep an empty ticker, because issuer codes would collide across funds in the Watchlist. N-PORT-P positions carry no ticker, so it is filled from the SEC company ticker table by issuer name, otherwise it stays `-`
- Holdings layout: the product page lists only the top ten positions, so the full sheet is the issuer's CSV when the page links one, otherwise the fund's own N-PORT-P filing (series ids `S000082252` PAPI, `S000082250` PHEQ, `S000088098` PEPS); a filing of another series is rejected. N-PORT-P weights are already percent of net assets and are kept as filed, without forcing them to sum to 100%
- Distributions: the issuer's published schedule (net investment income plus capital gains) wins; Yahoo dividends fill the gaps; zero or blank rows are skipped
- A bounded run (`MAX_FETCHES` above 0) resumes after the cursor saved in `api/parametric/update-state.json`; a full pass clears it. Funds that are not selected or fail keep their previously published data

### Update controls

| Environment variable | Default | Meaning |
| --- | --: | --- |
| `MAX_FETCHES` | `0` | Batch size: a positive value continues after the saved cursor, `0` or empty is a full pass over every fund |
| `REQUEST_SLEEP` | `3` | Minimum delay in seconds between direct request starts within each worker lane, including retries. Proxy requests ignore it and use the global 3.2 s proxy gate |
| `CONCURRENCY` | `1` | Fund workers (integer >= 1). Direct requests are paced per worker, so N workers give about N times the throughput. Once issuer or SEC traffic switches to the r.jina.ai rendering proxy, all proxy request starts share one global gate (minimum 3.2 s apart, whatever REQUEST_SLEEP or CONCURRENCY say) and a proxy request is retried at most once |
| `TICKERS` | all | Space-, comma- or semicolon-separated ticker allowlist, applied before `MAX_FETCHES` |
| `AUM` | `:` | Net assets range `min:max`; bounds are USD amounts with optional `K`/`M`/`B`/`T`, or a preset `nano`, `micro`, `small`, `mid`, `large` |
| `TER` | `:` | Expense ratio range in percent, strict `min:max` |
| `DIVIDEND_YIELD` | `:` | Indicated dividend yield range in percent |
| `SEC_YIELD` | `:` | Published 30-day SEC yield range in percent |
| `PERFORMANCE_YTD`, `PERFORMANCE_1Y`, `PERFORMANCE_3Y`, `PERFORMANCE_5Y`, `PERFORMANCE_10Y` | `:` | NAV return ranges; 3Y/5Y/10Y are annualized |
| `TOTAL_RETURN_YTD`, `TOTAL_RETURN_1Y`, `TOTAL_RETURN_3Y`, `TOTAL_RETURN_5Y`, `TOTAL_RETURN_10Y` | `:` | Cumulative total-return ranges |
| `HOLDINGS_PAGE_SIZE` | `250` | Rows in each generated holdings JSON page (integer >= 1) |
| `HISTORY_PAGE_SIZE` | `1000` | Rows in each generated daily-history JSON page (integer >= 1) |
| `MAX_RETRIES` | `2` | Retries after the initial request (integer >= 1); 403/408/425/429/5xx are retried with backoff, other HTTP errors fail promptly |
| `HISTORY_RANGE` | `max` | Yahoo history window: `max` or `Ny`, for example `5y`; it sets the request's `period1` |
| `SEC_UA` | `daggerok ETF feed daggerok@gmail.com` | SEC User-Agent with a contact, as SEC policy requires; redacted in logs. The `SEC_UA` repository variable overrides it |
| `SKIP_YAHOO` | `false` | Keep previous history and dividends |
| `SKIP_ISSUER` | `false` | Use the published catalog and the fallbacks only; cached data is never deleted |
| `EDGAR_FALLBACK` | `true` | Use the fund's own SEC N-PORT-P holdings when the issuer publishes no full sheet |
| `STORE_RAW_DOWNLOADS` | `false` | Keep the fetched product page and holdings sheet under each fund's `raw/`; never cookies or auth headers |
| `CATALOG_URL` | official catalog URL | Optional catalog mirror URL |
| `USE_SYSTEM_CA` | `auto` | TLS trust store: `auto` restarts the updater once with Bun's `--use-system-ca` when a request fails with an untrusted-certificate error; `true` always uses the system CA store; `false` never restarts. Not an individual workflow input: use `advanced`, the config file or the CLI environment |
| `VERBOSE` | `false` | Show per-provider fallback and retry diagnostics |

Filters combine with AND logic, and `TICKERS` does not override them.

### Examples

```bash
TICKERS="PAPI PHEQ PEPS" ./scripts/update-data.ts
CONCURRENCY=15 REQUEST_SLEEP=3 ./scripts/update-data.ts
MAX_FETCHES=3 ./scripts/update-data.ts
AUM="100M:" TER=":0.5" ./scripts/update-data.ts
PERFORMANCE_1Y="5:" HISTORY_RANGE=5y ./scripts/update-data.ts
```

## TypeScript and verification

The browser app is intentionally build-free: `index.html` carries the markup, styles and bootstrap, and `app.tsx` is TypeScript compiled in the browser with Babel standalone - no build step, no bundler, no `tsconfig.json` needed. Bun runs TypeScript out of the box, and the updater has no runtime dependencies.

Verification before every publish:

```bash
bun install --frozen-lockfile
bun test
bun build --target=bun scripts/update-data.ts --outfile=/dev/null
git diff --check
```

## Brands table

| Brand | Where to get the data |
| --- | --- |
| **AAM** | [aamlive.com](https://www.aamlive.com/ETF) \| [AAM](https://daggerok.github.io/AAM/) |
| **abrdn (Aberdeen)** | [aberdeeninvestments.com](https://www.aberdeeninvestments.com/en-us/investor/funds/etfs) \| [aberdeen](https://daggerok.github.io/aberdeen/) |
| **Amplify** | [amplifyetfs.com](https://amplifyetfs.com/) \| [Amplify](https://daggerok.github.io/Amplify/) |
| **ARK Invest** | [ark-funds.com](https://www.ark-funds.com/our-etfs/) \| [ARK](https://daggerok.github.io/ARK/) |
| **Capital Group** | [capitalgroup.com](https://www.capitalgroup.com/advisor/investments/exchange-traded-funds.html) \| [Capital-Group](https://daggerok.github.io/Capital-Group/) |
| **Fidelity** | [fidelity.com](https://www.fidelity.com/etfs) \| [Fidelity](https://daggerok.github.io/Fidelity/) |
| **First Trust** | [ftportfolios.com](https://www.ftportfolios.com/Retail/etf/etflist.aspx) \| [First-Trust](https://daggerok.github.io/First-Trust/) |
| **Franklin Templeton** | [franklintempleton.com](https://www.franklintempleton.com/investments/options/exchange-traded-funds) \| [Franklin](https://daggerok.github.io/Franklin/) |
| **Global X** | [globalxetfs.com/explore](https://www.globalxetfs.com/explore) \| [Global-X](https://daggerok.github.io/Global-X/) |
| **Goldman Sachs** | [am.gs.com](https://am.gs.com/en-us/individual/funds?locale=en-us&audience=individual&sf=funds&filters=funds%7CETF&limit=100) \| [Goldman-Sachs](https://daggerok.github.io/Goldman-Sachs/) |
| **Invesco** | [invesco.com](https://www.invesco.com/us/en/financial-products/etfs.html) \| [Invesco](https://daggerok.github.io/Invesco/) |
| **iShares** | [ishares.com](https://www.ishares.com/) \| [iShares](https://daggerok.github.io/iShares/) |
| **JPMorgan** | [am.jpmorgan.com](https://am.jpmorgan.com/us/en/asset-management/adv/products/fund-explorer/etf) \| [JPMorgan](https://daggerok.github.io/JPMorgan/) |
| **NEOS** | [neosfunds.com](https://neosfunds.com/#explore-etfs) \| [Neos](https://daggerok.github.io/Neos/) |
| **Northern Trust** | [etfs.ntam.northerntrust.com](https://etfs.ntam.northerntrust.com/us/en/individual/funds) \| [Northern-Trust](https://daggerok.github.io/Northern-Trust/) |
| **Pacer ETFs** | [paceretfs.com](https://www.paceretfs.com/products/) \| [Pacer](https://daggerok.github.io/Pacer/) |
| **Parametric** | [eatonvance.com](https://www.eatonvance.com/products/etfs.html) \| [Parametric](https://daggerok.github.io/Parametric/) |
| **ProShares** | [proshares.com](https://www.proshares.com/our-etfs/find-proshares-etfs) \| [ProShares](https://daggerok.github.io/ProShares/) |
| **Schwab** | [schwabassetmanagement.com](https://www.schwabassetmanagement.com/products) \| [Schwab](https://daggerok.github.io/Schwab/) |
| **SP Funds** | [sp-funds.com](https://www.sp-funds.com/) \| [SP-Funds](https://daggerok.github.io/SP-Funds/) |
| **SPDR** | [ssga.com](https://www.ssga.com/us/en/intermediary/etfs/fund-finder) \| [SPDR](https://daggerok.github.io/SPDR/) |
| **Sprott ETFs** | [sprottetfs.com](https://sprottetfs.com/) \| [Sprott](https://daggerok.github.io/Sprott/) |
| **Tema ETFs** | [temaetfs.com](https://temaetfs.com/funds) \| [Tema](https://daggerok.github.io/Tema/) |
| **Themes ETFs** | [themesetfs.com/etfs](https://themesetfs.com/etfs) \| [Themes](https://daggerok.github.io/Themes/) |
| **VanEck** | [vaneck.com](https://www.vaneck.com/us/en/etf-mutual-fund-finder/) \| [VanEck](https://daggerok.github.io/VanEck/) |
| **Vanguard** | [investor.vanguard.com](https://investor.vanguard.com/etf/list) \| [Vanguard](https://daggerok.github.io/Vanguard/) |
| **VictoryShares** | [vcm.com VictoryShares ETFs](https://www.vcm.com/products/victoryshares-etfs/victoryshares-etfs-list) \| [VictoryShares](https://daggerok.github.io/VictoryShares/) |
| **WisdomTree** | [wisdomtree.com](https://www.wisdomtree.com/investments) \| [WisdomTree](https://daggerok.github.io/WisdomTree/) |
| **Xtrackers** | [etf.dws.com](https://etf.dws.com/en-us/etf-products/) \| [Xtrackers](https://daggerok.github.io/Xtrackers/) |

## Sibling applications

| Application | Data provider | Repository |
| --- | --- | --- |
| AAM | Official AAM catalog/detail HTML + full holdings XLS + SEC N-PORT holdings fallback + Yahoo market history/dividends | [AAM](https://github.com/daggerok/AAM) |
| abrdn (Aberdeen) | Official Aberdeen gateway + SEC N-PORT holdings fallback + Yahoo history/dividends | [aberdeen](https://github.com/daggerok/aberdeen) |
| Amplify | Amplify ETFs Firestore data feed + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [Amplify](https://github.com/daggerok/Amplify) |
| ARK Invest | ark-funds.com fund pages + overview/NAV-history/performance JSON + official daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance distributions/history fallback | [ARK](https://github.com/daggerok/ARK) |
| Capital Group | Official Capital Group fund data + SEC N-PORT holdings fallback + Yahoo history fallback | [Capital-Group](https://github.com/daggerok/Capital-Group) |
| Fidelity | SEC EDGAR N-PORT-P + Yahoo Finance | [Fidelity](https://github.com/daggerok/Fidelity) |
| First Trust | ftportfolios.com official ETF list + fund summary, holdings, distribution and price-history export pages + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history fallback | [First-Trust](https://github.com/daggerok/First-Trust) |
| Franklin Templeton | franklintempleton.com ETF listings + product pages + SEC EDGAR N-PORT-P | [Franklin](https://github.com/daggerok/Franklin) |
| Global X | globalxetfs.com Next.js catalog and fund pages + dated full-holdings CSV | [Global-X](https://github.com/daggerok/Global-X) |
| Goldman Sachs | am.gs.com fund finder + detail pages + SEC EDGAR N-PORT-P | [Goldman-Sachs](https://github.com/daggerok/Goldman-Sachs) |
| Invesco | invesco.com CSV downloads + Yahoo Finance | [Invesco](https://github.com/daggerok/Invesco) |
| iShares | iShares (BlackRock) product workbooks | [iShares](https://github.com/daggerok/iShares) |
| JPMorgan | am.jpmorgan.com fund explorer + product-data JSON | [JPMorgan](https://github.com/daggerok/JPMorgan) |
| NEOS | neosfunds.com lineup table + official fund pages + daily holdings CSV | [Neos](https://github.com/daggerok/Neos) |
| Northern Trust | etfs.ntam.northerntrust.com funds list + per-fund CSV/JSON downloads | [Northern-Trust](https://github.com/daggerok/Northern-Trust) |
| Pacer ETFs | paceretfs.com product catalog and fund pages (Cloudflare WAF; r.jina.ai proxy fallback) + SEC EDGAR N-PORT-P (Pacer Funds Trust) + Yahoo Finance history/dividends | [Pacer](https://github.com/daggerok/Pacer) |
| Parametric | eatonvance.com ETF catalog and Parametric product pages + SEC EDGAR N-PORT-P holdings + Yahoo Finance history/dividends | [Parametric](https://github.com/daggerok/Parametric) |
| ProShares | proshares.com ETF finder + fund pages + official data host | [ProShares](https://github.com/daggerok/ProShares) |
| Schwab | schwabassetmanagement.com product pages + CSV exports | [Schwab](https://github.com/daggerok/Schwab) |
| SP Funds | sp-funds.com homepage catalog, fund pages and daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [SP-Funds](https://github.com/daggerok/SP-Funds) |
| SPDR | SSGA / State Street public feeds | [SPDR](https://github.com/daggerok/SPDR) |
| Sprott ETFs | sprottetfs.com fund pages + SEC EDGAR N-PORT-P (Sprott Funds Trust) + Yahoo Finance history/dividends | [Sprott](https://github.com/daggerok/Sprott) |
| Tema ETFs | Tema official fund pages + dated daily holdings CSV; SEC EDGAR N-PORT-P holdings fallback only + Yahoo Finance price/history/dividend fallback | [Tema](https://github.com/daggerok/Tema) |
| Themes ETFs | themesetfs.com catalog + daily holdings CSV + Yahoo Finance history/dividends + SEC N-PORT-P holdings fallback | [Themes](https://github.com/daggerok/Themes) |
| VanEck | vaneck.com ETF finder + product pages | [VanEck](https://github.com/daggerok/VanEck) |
| Vanguard | Vanguard product pages + SEC EDGAR N-PORT-P | [Vanguard](https://github.com/daggerok/Vanguard) |
| VictoryShares | VCM VictoryShares catalog and product JSON + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance adjusted-market-price history | [VictoryShares](https://github.com/daggerok/VictoryShares) |
| WisdomTree | WisdomTree product table + SEC EDGAR N-PORT-P + Yahoo Finance | [WisdomTree](https://github.com/daggerok/WisdomTree) |
| Xtrackers | Official DWS catalog/US sitemap + PDP/XLSX + SEC N-PORT-P holdings fallback + Yahoo Finance daily prices/history/dividends | [Xtrackers](https://github.com/daggerok/Xtrackers) |

## License

[MIT - same as all sibling ETF repositories.](./LICENSE)

Parametric® and the fund names/tickers referenced here are trademarks of Morgan Stanley / Parametric Portfolio Associates LLC. This is an independent, unofficial tool; it is not affiliated with, endorsed by, or sponsored by Morgan Stanley, Parametric Portfolio Associates LLC, Eaton Vance or Morgan Stanley Investment Management. All data is reproduced from the issuers' own public fund pages, public SEC EDGAR filings and Yahoo Finance for research purposes. All other trademarks, including index names, are the property of their respective owners.
