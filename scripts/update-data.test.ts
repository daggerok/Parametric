/// <reference types="bun" />
// Offline tests: inlined fixtures captured from the live providers; no
// network requests are made here.
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
  proxyPayload, fetchSecJson, fetchSecText, withRequestLane,
} from './update-data';

// Literal payloads captured from the live providers on 2026-10-01.
const FIXTURES: Record<string, string> = {
  "ev-catalog.md": "| Fund Name | Price <br> As of Date | Market <br>Price ($) | Market Price <br>Change ($) | Market Price <br>Change (%) | NAV ($) | NAV <br>Change ($) | NAV <br>Change (%) | Premium/ <br>Discount ($) | Yield <br> As of Date | 30-Day <br>Yield (%) | Dist. <br>Frequency | Fact <br> Sheet | Quick <br> Card |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| CVIE<br> [Calvert International Responsible Index ETF](https://www.eatonvance.com/products/etfs/international-equity/calvert-international-responsible-index-etf.html) | 09/30/2026 | 83.13 | -1.04 | -1.24 | 83.28 | -0.05 | -0.06 | -0.15 | 08/31/2026 | 1.91 | Quarterly | [![pdf icon](https://www.eatonvance.com/content/dam/im/assets/web/images/icon/resources-blue.svg)Fact Sheet](https://www.eatonvance.com/content/dam/im/assets/publication/factsheet/etf/fc_etf_calvertinternationalresponsibleindex_en.pdf) | ![Quick plus icon](https://www.eatonvance.com/content/dam/im/assets/web/images/icon/plus.svg) |\n| EVTR<br> [Eaton Vance Total Return Bond ETF](https://www.eatonvance.com/products/etfs/multi-sector/eaton-vance-total-return-bond-etf.html) | 09/30/2026 | 48.19 | -0.29 | -0.60 | 48.17 | -0.28 | -0.59 | 0.02 | 08/31/2026 | 5.09 | Monthly | [![pdf icon](https://www.eatonvance.com/content/dam/im/assets/web/images/icon/resources-blue.svg)Fact Sheet](https://www.eatonvance.com/content/dam/im/assets/publication/factsheet/etf/fc_etf_eatonvancetotalreturnbondetf_en.pdf) | ![Quick plus icon](https://www.eatonvance.com/content/dam/im/assets/web/images/icon/plus.svg) |\n| PEPS<br> [Parametric Equity Plus ETF](https://www.eatonvance.com/products/etfs/us-equity/parametric-equity-plus-etf.html) | 09/30/2026 | 32.91 | -0.01 | -0.03 | 32.84 | -0.07 | -0.21 | 0.07 | 08/31/2026 | 0.97 | Quarterly | [![pdf icon](https://www.eatonvance.com/content/dam/im/assets/web/images/icon/resources-blue.svg)Fact Sheet](https://www.eatonvance.com/content/dam/im/assets/publication/factsheet/etf/fc_etf_parametricequityplus_en.pdf) | ![Quick plus icon](https://www.eatonvance.com/content/dam/im/assets/web/images/icon/plus.svg) |\n| PAPI<br> [Parametric Equity Premium Income ETF](https://www.eatonvance.com/products/etfs/us-equity/parametric-equity-premium-income-etf.html) | 09/30/2026 | 26.28 | -0.38 | -1.43 | 26.22 | -0.36 | -1.37 | 0.06 | 08/31/2026 | 2.63 | Monthly | [![pdf icon](https://www.eatonvance.com/content/dam/im/assets/web/images/icon/resources-blue.svg)Fact Sheet](https://www.eatonvance.com/content/dam/im/assets/publication/factsheet/etf/fc_etf_parametricequitypreimumincome_en.pdf) | ![Quick plus icon](https://www.eatonvance.com/content/dam/im/assets/web/images/icon/plus.svg) |\n| PHEQ<br> [Parametric Hedged Equity ETF](https://www.eatonvance.com/products/etfs/us-equity/parametric-hedged-equity-etf.html) | 09/30/2026 | 35.40 | 0.03 | 0.08 | 35.20 | -0.13 | -0.36 | 0.20 | 08/31/2026 | 0.81 | Quarterly | [![pdf icon](https://www.eatonvance.com/content/dam/im/assets/web/images/icon/resources-blue.svg)Fact Sheet](https://www.eatonvance.com/content/dam/im/assets/publication/factsheet/etf/fc_etf_parametrichedgedequity_en.pdf) | ![Quick plus icon](https://www.eatonvance.com/content/dam/im/assets/web/images/icon/plus.svg) |\n",
  "papi-page.md": "Parametric Equity Premium Income ETFUS Equityenen-usenusfinancial-advisorhttps://www.eatonvance.com/im/json/imwebdata/dataimweb-tom:product/EF/EQ/100637ETF Detail Template3d4c63e4-4608-4b66-a547-24b68d5cc81cevprod/content/imwebev/eaton-vance/content/imwebev/eaton-vance/en-us/financial-advisor/products/etfs/us-equity/parametric-equity-premium-income-etfU.S. Equity2026-10-01T20:12:16.169962816Z\n\n# Parametric Equity Premium Income ETF\n\nPAPI\n\nCUSIP\n\n61774R866\n\nMorningstar Category\n\nDerivative Income\n\nMarket Price\n\n$26.28\n\nas of 09/30/2026\n\nNAV\n\n$26.22\n\nas of 09/30/2026\n\nPricing & Expenses\n\nMarket Price\n\nas of 09/30/2026\n\n$26.28\n\nNAV\n\nas of 09/30/2026\n\n$26.22\n\nPremium/Discount\n\nas of 09/30/2026\n\n$0.06\n\n30 Day Median\n\nBid/Ask Spread\n\nas of 09/30/2026\n\n0.22%\n\nExpense Ratio [1](https://www.eatonvance.com/products/etfs/us-equity/parametric-equity-premium-income-etf.html#pd-bottom-disc)\n\nGross\n\n0.29%\n\nExpense Ratio [1](https://www.eatonvance.com/products/etfs/us-equity/parametric-equity-premium-income-etf.html#pd-bottom-disc)\n\nNet\n\n0.29%\n\nReturns\n\nAs of 09/30/2026 (updated daily upon availability)\n\n|  | 1 Month | 3 Months | YTD | 1 YR | 3 YR | 5 YR | 10 YR | Since Inception |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| PAPI Market Price (%) | -5.07 | 0.27 | 8.04 | 8.91 | - | - | - | 9.47 |\n| PAPI NAV (%) | -5.08 | 0.20 | 7.63 | 9.00 | - | - | - | 9.40 |\n| Russell 1000 Value Index [2](https://www.eatonvance.com/products/etfs/us-equity/parametric-equity-premium-income-etf.html#pd-bottom-disc) | -3.13 | 2.61 | 19.27 | 23.81 | - | - | - | 20.42 |\n| ICE BofA 3-Month U.S. Treasury Bill Index [3](https://www.eatonvance.com/products/etfs/us-equity/parametric-equity-premium-income-etf.html#pd-bottom-disc) | 0.27 | 0.89 | 2.65 | 3.65 | - | - | - | 4.48 |\n\nDistributions\n\nAs of 09/30/2026 (updated as distributions are paid)\n\n| Record Date | Ex-Date | Payable Date | Net Investment Income ($ per share) | Short-Term Capital Gains ($ per share) | Long-Term Capital Gains ($ per share) | Total Capital Gains ($ per share) |\n| --- | --- | --- | --- | --- | --- | --- |\n| 09/30/2026 | 09/30/2026 | 10/06/2026 | 0.176725 | 0.000000 | 0.000000 | 0.000000 |\n| 08/31/2026 | 08/31/2026 | 09/04/2026 | 0.163133 | 0.000000 | 0.000000 | 0.000000 |\n| 07/31/2026 | 07/31/2026 | 08/06/2026 | 0.167561 | 0.000000 | 0.000000 | 0.000000 |\n| 06/30/2026 | 06/30/2026 | 07/07/2026 | 0.202480 | 0.000000 | 0.000000 | 0.000000 |\n| 05/29/2026 | 05/29/2026 | 06/04/2026 | 0.155483 | 0.000000 | 0.000000 | 0.000000 |\n| 04/30/2026 | 04/30/2026 | 05/06/2026 | 0.155169 | 0.000000 | 0.000000 | 0.000000 |\n| 03/31/2026 | 03/31/2026 | 04/07/2026 | 0.237625 | 0.000000 | 0.000000 | 0.000000 |\n| 02/27/2026 | 02/27/2026 | 03/05/2026 | 0.163919 | 0.000000 | 0.000000 | 0.000000 |\n| 01/30/2026 | 01/30/2026 | 02/05/2026 | 0.161100 | 0.000000 | 0.000000 | 0.000000 |\n| 12/23/2025 | 12/23/2025 | 12/30/2025 | 0.178940 | 0.000000 | 0.000000 | 0.000000 |\n| 11/28/2025 | 11/28/2025 | 12/04/2025 | 0.148388 | 0.000000 | 0.000000 | 0.000000 |\n| 10/31/2025 | 10/31/2025 | 11/06/2025 | 0.149350 | 0.000000 | 0.000000 | 0.000000 |\n| 09/30/2025 | 09/30/2025 | 10/06/2025 | 0.179502 | 0.000000 | 0.000000 | 0.000000 |\n| 08/29/2025 | 08/29/2025 | 09/05/2025 | 0.151572 | 0.000000 | 0.000000 | 0.000000 |\n| 07/31/2025 | 07/31/2025 | 08/06/2025 | 0.147279 | 0.000000 | 0.000000 | 0.000000 |\n| 06/30/2025 | 06/30/2025 | 07/07/2025 | 0.184253 | 0.000000 | 0.000000 | 0.000000 |\n| 05/30/2025 | 05/30/2025 | 06/05/2025 | 0.148193 | 0.000000 | 0.000000 | 0.000000 |\n| 04/30/2025 | 04/30/2025 | 05/06/2025 | 0.202728 | 0.000000 | 0.000000 | 0.000000 |\n| 03/31/2025 | 03/31/2025 | 04/04/2025 | 0.192936 | 0.000000 | 0.000000 | 0.000000 |\n| 02/28/2025 | 02/28/2025 | 03/06/2025 | 0.134011 | 0.000000 | 0.000000 | 0.000000 |\n| 01/31/2025 | 01/31/2025 | 02/06/2025 | 0.138619 | 0.000000 | 0.000000 | 0.000000 |\n| 12/23/2024 | 12/23/2024 | 12/27/2024 | 0.164041 | 0.000000 | 0.000000 | 0.000000 |\n| 11/29/2024 | 11/29/2024 | 12/05/2024 | 0.154423 | 0.000000 | 0.000000 | 0.000000 |\n| 10/31/2024 | 10/31/2024 | 11/06/2024 | 0.132452 | 0.000000 | 0.000000 | 0.000000 |\n| 09/30/2024 | 09/30/2024 | 10/04/2024 | 0.171292 | 0.000000 | 0.000000 | 0.000000 |\n| 08/30/2024 | 08/30/2024 | 09/06/2024 | 0.147055 | 0.000000 | 0.000000 | 0.000000 |\n| 07/31/2024 | 07/31/2024 | 08/06/2024 | 0.121669 | 0.000000 | 0.000000 | 0.000000 |\n| 06/28/2024 | 06/28/2024 | 07/05/2024 | 0.164082 | 0.000000 | 0.000000 | 0.000000 |\n| 05/31/2024 | 05/31/2024 | 06/06/2024 | 0.184967 | 0.000000 | 0.000000 | 0.000000 |\n| 05/01/2024 | 04/30/2024 | 05/06/2024 | 0.171561 | 0.000000 | 0.000000 | 0.000000 |\n| 04/01/2024 | 03/28/2024 | 04/04/2024 | 0.180093 | 0.000000 | 0.000000 | 0.000000 |\n| 03/01/2024 | 02/29/2024 | 03/06/2024 | 0.141503 | 0.000000 | 0.000000 | 0.000000 |\n| 02/01/2024 | 01/31/2024 | 02/06/2024 | 0.115170 | 0.000000 | 0.000000 | 0.000000 |\n| 12/22/2023 | 12/21/2023 | 12/28/2023 | 0.208278 | 0.000000 | 0.000000 | 0.000000 |\n| 12/01/2023 | 11/30/2023 | 12/06/2023 | 0.166059 | 0.000000 | 0.000000 | 0.000000 |\n\nKey Facts & Characteristics\n\n|     |     |\n| --- | --- |\n| Asset Class | US Equity |\n| CUSIP | 61774R866 |\n| Ticker | PAPI |\n| IOPV Intraday Ticker | PAPI.IV |\n| Inception Date | 10/16/2023 |\n| Investment Style | Active |\n| Exchange | NYSE Arca |\n| Custodian | JP Morgan Chase Bank, N.A. |\n| Benchmarks | Russell 1000 Value Index [2](https://www.eatonvance.com/products/etfs/us-equity/parametric-equity-premium-income-etf.html#pd-bottom-disc)<br>ICE BofA 3-Month U.S. Treasury Bill Index [3](https://www.eatonvance.com/products/etfs/us-equity/parametric-equity-premium-income-etf.html#pd-bottom-disc) |\n| Distribution Frequency | Monthly |\n| Total Net Assets ($MM)<br> as of 09/30/2026 | 479.91 |\n\nTop 10 Holdings\n\nAs of\n09/30/2026 (updated daily upon availability)\n\n| Ticker | Holdings | Type | Security Identifier | % of Funds | Shares/Par | Market Value |\n| --- | --- | --- | --- | --- | --- | --- |\n| - | MSILF GOVERNMENT | CUSIP | 61747C707 | 1.65 | 7,982,326 | 7,982,325.78 |\n| VLO | VALERO ENERGY CORP COMMON | CUSIP | 91913Y100 | 0.81 | 10,141 | 3,930,753.01 |\n| SWKS | SKYWORKS SOLUTIONS INC | CUSIP | 83088M102 | 0.76 | 43,137 | 3,687,350.76 |\n| CRM | SALESFORCE.COM INC. | CUSIP | 79466L302 | 0.75 | 15,864 | 3,641,898.48 |\n| DINO | HF SINCLAIR CORP COMMON | CUSIP | 403949100 | 0.74 | 33,207 | 3,563,775.24 |\n| MSFT | MICROSOFT CORP COMMON | CUSIP | 594918104 | 0.72 | 6,775 | 3,474,897.50 |\n| PSX | PHILLIPS 66 COMMON STOCK | CUSIP | 718546104 | 0.72 | 13,546 | 3,458,429.26 |\n| CTSH | COGNIZANT TECHNOLOGY | CUSIP | 192446102 | 0.68 | 57,143 | 3,282,293.92 |\n| AVT | AVNET INC COMMON STOCK | CUSIP | 053807103 | 0.68 | 32,658 | 3,264,167.10 |\n| MAN | MANPOWERGROUP INC COMMON | CUSIP | 56418H100 | 0.67 | 57,905 | 3,218,359.90 |\n",
  "pheq-page.md": "Parametric Hedged Equity ETFUS Equityenen-usenusfinancial-advisorhttps://www.eatonvance.com/im/json/imwebdata/dataimweb-tom:product/EF/EQ/100638ETF Detail Templatebbe39159-bdc0-4285-a0e9-1e24fdaa64b9evprod/content/imwebev/eaton-vance/content/imwebev/eaton-vance/en-us/financial-advisor/products/etfs/us-equity/parametric-hedged-equity-etfU.S. Equity2026-10-01T21:52:46.813490711Z\n\n# Parametric Hedged Equity ETF\n\nPHEQ\n\nCUSIP\n\n61774R874\n\nMorningstar Category\n\nEquity Hedged\n\nMarket Price\n\n$35.40\n\nas of 09/30/2026\n\nNAV\n\n$35.20\n\nas of 09/30/2026\n\nPricing & Expenses\n\nMarket Price\n\nas of 09/30/2026\n\n$35.40\n\nNAV\n\nas of 09/30/2026\n\n$35.20\n\nPremium/Discount\n\nas of 09/30/2026\n\n$0.20\n\n30 Day Median\n\nBid/Ask Spread\n\nas of 09/30/2026\n\n0.28%\n\nExpense Ratio [1](https://www.eatonvance.com/products/etfs/us-equity/parametric-hedged-equity-etf.html#pd-bottom-disc)\n\nGross\n\n0.29%\n\nExpense Ratio [1](https://www.eatonvance.com/products/etfs/us-equity/parametric-hedged-equity-etf.html#pd-bottom-disc)\n\nNet\n\n0.29%\n\nReturns\n\nAs of 09/30/2026 (updated daily upon availability)\n\n|  | 1 Month | 3 Months | YTD | 1 YR | 3 YR | 5 YR | 10 YR | Since Inception |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| PHEQ Market Price (%) | 0.71 | 2.54 | 9.09 | 11.52 | - | - | - | 14.31 |\n| PHEQ NAV (%) | 0.19 | 1.96 | 8.51 | 10.72 | - | - | - | 14.08 |\n| S&P 500 Index [2](https://www.eatonvance.com/products/etfs/us-equity/parametric-hedged-equity-etf.html#pd-bottom-disc) | -0.35 | 2.30 | - | 15.74 | - | - | - | 22.43 |\n\nDistributions\n\nAs of 09/30/2026 (updated as distributions are paid)\n\n| Record Date | Ex-Date | Payable Date | Net Investment Income ($ per share) | Short-Term Capital Gains ($ per share) | Long-Term Capital Gains ($ per share) | Total Capital Gains ($ per share) |\n| --- | --- | --- | --- | --- | --- | --- |\n| 09/21/2026 | 09/21/2026 | 09/25/2026 | 0.048626 | 0.000000 | 0.000000 | 0.000000 |\n| 06/22/2026 | 06/22/2026 | 06/26/2026 | 0.047099 | 0.000000 | 0.000000 | 0.000000 |\n| 03/23/2026 | 03/23/2026 | 03/27/2026 | 0.028882 | 0.000000 | 0.000000 | 0.000000 |\n| 12/23/2025 | 12/23/2025 | 12/30/2025 | 0.165321 | 0.000000 | 0.000000 | 0.000000 |\n| 09/22/2025 | 09/22/2025 | 09/26/2025 | 0.083352 | 0.000000 | 0.000000 | 0.000000 |\n| 06/23/2025 | 06/23/2025 | 06/27/2025 | 0.075352 | 0.000000 | 0.000000 | 0.000000 |\n| 03/24/2025 | 03/24/2025 | 03/28/2025 | 0.064095 | 0.000000 | 0.000000 | 0.000000 |\n| 12/23/2024 | 12/23/2024 | 12/27/2024 | 0.199903 | 0.000000 | 0.000000 | 0.000000 |\n| 09/23/2024 | 09/23/2024 | 09/27/2024 | 0.071946 | 0.000000 | 0.000000 | 0.000000 |\n| 06/24/2024 | 06/24/2024 | 06/28/2024 | 0.090459 | 0.000000 | 0.000000 | 0.000000 |\n| 03/19/2024 | 03/18/2024 | 03/22/2024 | 0.049190 | 0.000000 | 0.000000 | 0.000000 |\n| 12/19/2023 | 12/18/2023 | 12/22/2023 | 0.449273 | 0.000000 | 0.000000 | 0.000000 |\n\nKey Facts & Characteristics\n\n|     |     |\n| --- | --- |\n| Asset Class | US Equity |\n| CUSIP | 61774R874 |\n| Ticker | PHEQ |\n| IOPV Intraday Ticker | PHEQ.IV |\n| Inception Date | 10/16/2023 |\n| Investment Style | Active |\n| Exchange | NYSE Arca |\n| Custodian | JP Morgan Chase Bank, N.A. |\n| Benchmarks | S&P 500 Index [2](https://www.eatonvance.com/products/etfs/us-equity/parametric-hedged-equity-etf.html#pd-bottom-disc) |\n| Distribution Frequency | Quarterly |\n| Total Net Assets ($MM)<br> as of 09/30/2026 | 153.10 |\n\nTop 10 Holdings\n\nAs of\n09/30/2026 (updated daily upon availability)\n\n| Ticker | Holdings | Type | Security Identifier | % of Funds | Shares/Par | Market Value |\n| --- | --- | --- | --- | --- | --- | --- |\n| NVDA | NVIDIA CORP COMMON STOCK | CUSIP | 67066G104 | 8.49 | 56,998 | 13,017,203.24 |\n| AAPL | APPLE INC COMMON STOCK | CUSIP | 037833100 | 7.57 | 34,850 | 11,605,747.00 |\n| MSFT | MICROSOFT CORP COMMON | CUSIP | 594918104 | 5.97 | 17,848 | 9,154,239.20 |\n| AMZN | AMAZON.COM INC COMMON | CUSIP | 023135106 | 3.93 | 24,183 | 6,025,194.45 |\n| GOOGL | ALPHABET INC-CL A - | CUSIP | 02079K305 | 3.23 | 14,380 | 4,947,870.40 |\n| GOOG | ALPHABET INC-CL C - | CUSIP | 02079K107 | 2.72 | 12,234 | 4,168,613.16 |\n| AVGO | BROADCOM INC COMMON STOCK | CUSIP | 11135F101 | 2.67 | 11,660 | 4,094,875.40 |\n| META | META PLATFORMS INC COMMON | CUSIP | 30303M102 | 2.41 | 5,106 | 3,702,769.08 |\n| MU | MICRON TECHNOLOGY INC | CUSIP | 595112103 | 1.93 | 2,784 | 2,965,266.24 |\n| TSLA | TESLA INC COMMON STOCK | CUSIP | 88160R101 | 1.76 | 7,619 | 2,703,297.39 |\n",
  "peps-page.md": "Parametric Equity Plus ETFUS Equityenen-usenusfinancial-advisorhttps://www.eatonvance.com/im/json/imwebdata/dataimweb-tom:product/EF/EQ/100678ETF Detail Templatefdb2f027-f25e-42fb-b7bc-4773914dbe47evprod/content/imwebev/eaton-vance/content/imwebev/eaton-vance/en-us/financial-advisor/products/etfs/us-equity/parametric-equity-plus-etfU.S. Equity2026-10-01T23:13:09.176054122Z\n\n# Parametric Equity Plus ETF\n\nPEPS\n\nCUSIP\n\n61774R775\n\nMorningstar Category\n\nDerivative Income\n\nMarket Price\n\n$32.91\n\nas of 09/30/2026\n\nNAV\n\n$32.84\n\nas of 09/30/2026\n\nPricing & Expenses\n\nMarket Price\n\nas of 09/30/2026\n\n$32.91\n\nNAV\n\nas of 09/30/2026\n\n$32.84\n\nPremium/Discount\n\nas of 09/30/2026\n\n$0.07\n\n30 Day Median\n\nBid/Ask Spread\n\nas of 09/30/2026\n\n0.31%\n\nExpense Ratio [1](https://www.eatonvance.com/products/etfs/us-equity/parametric-equity-plus-etf.html#pd-bottom-disc)\n\nGross\n\n0.29%\n\nExpense Ratio [1](https://www.eatonvance.com/products/etfs/us-equity/parametric-equity-plus-etf.html#pd-bottom-disc)\n\nNet\n\n0.10%\n\nReturns\n\nAs of 09/30/2026 (updated daily upon availability)\n\n|  | 1 Month | 3 Months | YTD | 1 YR | 3 YR | 5 YR | 10 YR | Since Inception |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| PEPS Market Price (%) | 0.44 | 2.76 | 12.73 | 16.75 | - | - | - | 16.80 |\n| PEPS NAV (%) | 0.29 | 2.57 | 12.68 | 16.54 | - | - | - | 16.67 |\n| S&P 500 Index [2](https://www.eatonvance.com/products/etfs/us-equity/parametric-equity-plus-etf.html#pd-bottom-disc) | -0.35 | 2.30 | - | 15.74 | - | - | - | 15.39 |\n\nDistributions\n\nAs of 09/30/2026 (updated as distributions are paid)\n\n| Record Date | Ex-Date | Payable Date | Net Investment Income ($ per share) | Short-Term Capital Gains ($ per share) | Long-Term Capital Gains ($ per share) | Total Capital Gains ($ per share) |\n| --- | --- | --- | --- | --- | --- | --- |\n| 09/21/2026 | 09/21/2026 | 09/25/2026 | 0.085493 | 0.000000 | 0.000000 | 0.000000 |\n| 06/22/2026 | 06/22/2026 | 06/26/2026 | 0.076929 | 0.000000 | 0.000000 | 0.000000 |\n| 03/23/2026 | 03/23/2026 | 03/27/2026 | 0.057562 | 0.000000 | 0.000000 | 0.000000 |\n| 12/23/2025 | 12/23/2025 | 12/30/2025 | 0.097811 | 0.000000 | 0.000000 | 0.000000 |\n| 09/22/2025 | 09/22/2025 | 09/26/2025 | 0.066298 | 0.000000 | 0.000000 | 0.000000 |\n| 06/23/2025 | 06/23/2025 | 06/27/2025 | 0.064874 | 0.000000 | 0.000000 | 0.000000 |\n| 03/24/2025 | 03/24/2025 | 03/28/2025 | 0.065013 | 0.000000 | 0.000000 | 0.000000 |\n| 12/23/2024 | 12/23/2024 | 12/27/2024 | 0.041695 | 0.000000 | 0.000000 | 0.000000 |\n\nKey Facts & Characteristics\n\n|     |     |\n| --- | --- |\n| Asset Class | US Equity |\n| CUSIP | 61774R775 |\n| Ticker | PEPS |\n| IOPV Intraday Ticker | PEPS.IV |\n| Inception Date | 11/07/2024 |\n| Investment Style | Active |\n| Exchange | NASDAQ |\n| Custodian | JP Morgan Chase Bank, N.A. |\n| Benchmarks | S&P 500 Index [2](https://www.eatonvance.com/products/etfs/us-equity/parametric-equity-plus-etf.html#pd-bottom-disc) |\n| Distribution Frequency | Quarterly |\n| Total Net Assets ($MM)<br> as of 09/30/2026 | 29.56 |\n\nTop 10 Holdings\n\nAs of\n09/30/2026 (updated daily upon availability)\n\n| Ticker | Holdings | Type | Security Identifier | % of Funds | Shares/Par | Market Value |\n| --- | --- | --- | --- | --- | --- | --- |\n| NVDA | NVIDIA CORP COMMON STOCK | CUSIP | 67066G104 | 7.53 | 9,748 | 2,226,248.24 |\n| AAPL | APPLE INC COMMON STOCK | CUSIP | 037833100 | 7.17 | 6,362 | 2,118,673.24 |\n| MSFT | MICROSOFT CORP COMMON | CUSIP | 594918104 | 5.55 | 3,201 | 1,641,792.90 |\n| AMZN | AMAZON.COM INC COMMON | CUSIP | 023135106 | 3.52 | 4,174 | 1,039,952.10 |\n| GOOGL | ALPHABET INC-CL A - | CUSIP | 02079K305 | 2.95 | 2,533 | 871,554.64 |\n| - | MSILF GOVERNMENT | CUSIP | 61747C707 | 2.87 | 847,257 | 847,256.83 |\n| GOOG | ALPHABET INC-CL C - | CUSIP | 02079K107 | 2.62 | 2,273 | 774,502.02 |\n| AVGO | BROADCOM INC COMMON STOCK | CUSIP | 11135F101 | 2.57 | 2,160 | 758,570.40 |\n| META | META PLATFORMS INC COMMON | CUSIP | 30303M102 | 2.38 | 972 | 704,874.96 |\n| MU | MICRON TECHNOLOGY INC | CUSIP | 595112103 | 2.20 | 610 | 649,717.10 |\n",
  "nport-PAPI-sample.xml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?><edgarSubmission xmlns=\"http://www.sec.gov/edgar/nport\" xmlns:com=\"http://www.sec.gov/edgar/common\" xmlns:ncom=\"http://www.sec.gov/edgar/nportcommon\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xsi:schemaLocation=\"http://www.sec.gov/edgar/nport eis_NPORT_Filer.xsd\">\n  <headerData>\n    <submissionType>NPORT-P</submissionType>\n    <isConfidential>false</isConfidential>\n    <filerInfo>\n\n      <filer>\n        <issuerCredentials>\n          <cik>0001676326</cik>\n          <ccc>XXXXXXXX</ccc>\n        </issuerCredentials>\n      </filer>\n\n\n      <seriesClassInfo>\n        <seriesId>S000082252</seriesId>\n        <classId>C000245536</classId>\n      </seriesClassInfo>\n\n\n    </filerInfo>\n  </headerData>\n  <formData>\n    <genInfo>\n      <regName>Morgan Stanley ETF Trust</regName>\n      <regFileNumber>811-23820</regFileNumber>\n      <regCik>0001676326</regCik>\n      <regLei>549300HASXQLXGOR9H31</regLei>\n      <regStreet1>1585 Broadway</regStreet1>\n      <regCity>New York</regCity>\n      <regStateConditional regCountry=\"US\" regState=\"US-NY\"/>\n      <regZipOrPostalCode>10036</regZipOrPostalCode>\n      <regPhone>800-548-7786</regPhone>\n      <seriesName>Parametric Equity Premium Income ETF</seriesName>\n      <seriesId>S000082252</seriesId>\n      <seriesLei>254900H9BZPTHXHGWS44</seriesLei>\n      <repPdEnd>2026-09-30</repPdEnd>\n      <repPdDate>2026-06-30</repPdDate>\n      <isFinalFiling>N</isFinalFiling>\n    </genInfo>\n    <fundInfo>\n      <totAssets>407452624.20</totAssets>\n      <totLiabs>7608521.22</totLiabs>\n      <netAssets>399844102.98</netAssets>\n      <assetsAttrMiscSec>0.00000000</assetsAttrMiscSec>\n      <assetsInvested>0.00000000</assetsInvested>\n      <amtPayOneYrBanksBorr>0.00000000</amtPayOneYrBanksBorr>\n      <amtPayOneYrCtrldComp>0.00000000</amtPayOneYrCtrldComp>\n      <amtPayOneYrOthAffil>0.00000000</amtPayOneYrOthAffil>\n      <amtPayOneYrOther>0.00000000</amtPayOneYrOther>\n      <amtPayAftOneYrBanksBorr>0.00000000</amtPayAftOneYrBanksBorr>\n      <amtPayAftOneYrCtrldComp>0.00000000</amtPayAftOneYrCtrldComp>\n      <amtPayAftOneYrOthAffil>0.00000000</amtPayAftOneYrOthAffil>\n      <amtPayAftOneYrOther>0.00000000</amtPayAftOneYrOther>\n      <delayDeliv>0.00000000</delayDeliv>\n      <standByCommit>0.00000000</standByCommit>\n      <liquidPref>0.00000000</liquidPref>\n      <cshNotRptdInCorD>2126973.73000000</cshNotRptdInCorD>\n      <borrowers>\n        <borrower aggrVal=\"25458.96000000\" lei=\"12UUJYTN7D3SW8KCSG25\" name=\"CITADEL SECURITIES LLC\"/>\n        <borrower aggrVal=\"2341635.35000000\" lei=\"VYVVCKR63DVZZN70PB21\" name=\"WELLS FARGO SECURITIES, LLC\"/>\n        <borrower aggrVal=\"66847.32000000\" lei=\"BFM8T61CT2L1QCEMIK50\" name=\"UBS AG LONDON BRANCH\"/>\n        <borrower aggrVal=\"141487.30000000\" lei=\"SUVUFHICNZMP2WKHG940\" name=\"TD SECURITIES (USA) LLC\"/>\n        <borrower aggrVal=\"901694.07000000\" lei=\"549300QQRY1JCFQHYS08\" name=\"Janney Montgomery Scott, LLC\"/>\n        <borrower aggrVal=\"17982000.37000000\" lei=\"549300KUN9K9K32C6D97\" name=\"BNP PARIBAS PRIME BROKERAGE INTERNATIONAL LIMITED\"/>\n        <borrower aggrVal=\"3885614.98000000\" lei=\"549300HN4UKV1E2R3U73\" name=\"BOFA SECURITIES, INC.\"/>\n        <borrower aggrVal=\"1294833.10000000\" lei=\"58PU97L1C0WSRCWADL48\" name=\"JEFFERIES LLC\"/>\n        <borrower aggrVal=\"869252.16000000\" lei=\"KB1H1DSPRFMYMCUFXT09\" name=\"WELLS FARGO BANK, N.A.\"/>\n        <borrower aggrVal=\"833743.96000000\" lei=\"ZBUT11V806EZRVTWT807\" name=\"J.P. MORGAN SECURITIES LLC\"/>\n      </borrowers>\n      <aggregateCondition isNonCashCollateral=\"Y\">\n        <aggregateInfos>\n          <aggregateInfo amt=\"27125804.58540000\" collatrl=\"25448359.73280000\">\n            <invstCat>UST</invstCat>\n          </aggregateInfo>\n        </aggregateInfos>\n      </aggregateCondition>\n      <returnInfo>\n        <monthlyTotReturns>\n          <monthlyTotReturn classId=\"C000245536\" rtn1=\"-1.37000000\" rtn2=\"-1.02000000\" rtn3=\"1.79000000\"/>\n        </monthlyTotReturns>\n        <monthlyReturnCats>\n          <commodityContracts>\n            <mon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            <mon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            <mon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            <forwardCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </forwardCategory>\n            <futureCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </futureCategory>\n            <optionCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </optionCategory>\n            <swaptionCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </swaptionCategory>\n            <swapCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </swapCategory>\n            <warrantCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </warrantCategory>\n            <otherCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </otherCategory>\n          </commodityContracts>\n          <creditContracts>\n            <mon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            <mon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            <mon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            <forwardCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </forwardCategory>\n            <futureCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </futureCategory>\n            <optionCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </optionCategory>\n            <swaptionCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </swaptionCategory>\n            <swapCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </swapCategory>\n            <warrantCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </warrantCategory>\n            <otherCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </otherCategory>\n          </creditContracts>\n          <equityContracts>\n            <mon1 netRealizedGain=\"-16041968.72000000\" netUnrealizedAppr=\"633328.25000000\"/>\n            <mon2 netRealizedGain=\"-1588097.27000000\" netUnrealizedAppr=\"-428559.64000000\"/>\n            <mon3 netRealizedGain=\"2160324.75000000\" netUnrealizedAppr=\"-76417.46000000\"/>\n            <forwardCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </forwardCategory>\n            <futureCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </futureCategory>\n            <optionCategory>\n              <instrMon1 netRealizedGain=\"-16041968.72000000\" netUnrealizedAppr=\"633328.25000000\"/>\n              <instrMon2 netRealizedGain=\"-1588097.27000000\" netUnrealizedAppr=\"-428559.64000000\"/>\n              <instrMon3 netRealizedGain=\"2160324.75000000\" netUnrealizedAppr=\"-76417.46000000\"/>\n            </optionCategory>\n            <swaptionCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </swaptionCategory>\n            <swapCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </swapCategory>\n            <warrantCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </warrantCategory>\n            <otherCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </otherCategory>\n          </equityContracts>\n          <foreignExchgContracts>\n            <mon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            <mon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            <mon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            <forwardCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </forwardCategory>\n            <futureCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </futureCategory>\n            <optionCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </optionCategory>\n            <swaptionCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </swaptionCategory>\n            <swapCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </swapCategory>\n            <warrantCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </warrantCategory>\n            <otherCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </otherCategory>\n          </foreignExchgContracts>\n          <interestRtContracts>\n            <mon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            <mon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            <mon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            <forwardCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </forwardCategory>\n            <futureCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </futureCategory>\n            <optionCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </optionCategory>\n            <swaptionCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </swaptionCategory>\n            <swapCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </swapCategory>\n            <warrantCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </warrantCategory>\n            <otherCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </otherCategory>\n          </interestRtContracts>\n          <otherContracts>\n            <mon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            <mon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            <mon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            <forwardCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </forwardCategory>\n            <futureCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </futureCategory>\n            <optionCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </optionCategory>\n            <swaptionCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </swaptionCategory>\n            <swapCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </swapCategory>\n            <warrantCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </warrantCategory>\n            <otherCategory>\n              <instrMon1 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon2 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n              <instrMon3 netRealizedGain=\"0.00000000\" netUnrealizedAppr=\"0.00000000\"/>\n            </otherCategory>\n          </otherContracts>\n        </monthlyReturnCats>\n        <othMon1 netRealizedGain=\"-525449.36000000\" netUnrealizedAppr=\"10605433.65000000\"/>\n        <othMon2 netRealizedGain=\"-1.21000000\" netUnrealizedAppr=\"-2673753.23000000\"/>\n        <othMon3 netRealizedGain=\"-493.33000000\" netUnrealizedAppr=\"3549296.92000000\"/>\n      </returnInfo>\n      <mon1Flow redemption=\"1330018.03000000\" reinvestment=\"0.00000000\" sales=\"29785538.66000000\"/>\n      <mon2Flow redemption=\"1331993.57000000\" reinvestment=\"0.00000000\" sales=\"25110065.10000000\"/>\n      <mon3Flow redemption=\"0.00000000\" reinvestment=\"0.00000000\" sales=\"10633200.47000000\"/>\n\n\n      <varInfo>\n\n        <fundsDesignatedInfo>\n          <nameDesignatedIndex>Russell 1000 Value</nameDesignatedIndex>\n          <indexIdentifier>RS1000V</indexIdentifier>\n\n        </fundsDesignatedInfo>\n\n      </varInfo>\n    </fundInfo>\n    <invstOrSec>\n        <name>Kraft Heinz Co. (The)</name>\n        <lei>9845007488EC87F5AF14</lei>\n        <title>Kraft Heinz Co. (The)</title>\n        <cusip>500754106</cusip>\n        <identifiers>\n          <isin value=\"US5007541064\"/>\n        </identifiers>\n        <balance>93467.00000000</balance>\n        <units>NS</units>\n        <curCd>USD</curCd>\n        <valUSD>2207690.54000000</valUSD>\n        <pctVal>0.552137826604</pctVal>\n        <payoffProfile>Long</payoffProfile>\n        <assetCat>EC</assetCat>\n        <issuerCat>CORP</issuerCat>\n        <invCountry>US</invCountry>\n        <isRestrictedSec>N</isRestrictedSec>\n\n        <fairValLevel>1</fairValLevel>\n        <securityLending>\n          <isCashCollateral>N</isCashCollateral>\n          <isNonCashCollateral>N</isNonCashCollateral>\n          <loanByFundCondition isLoanByFund=\"Y\" loanVal=\"135488.19000000\"/>\n        </securityLending>\n      </invstOrSec>\n<invstOrSec>\n        <name>RLI Corp.</name>\n        <lei>529900AMTJE5ECN9PS55</lei>\n        <title>RLI Corp.</title>\n        <cusip>749607107</cusip>\n        <identifiers>\n          <isin value=\"US7496071074\"/>\n        </identifiers>\n        <balance>35281.00000000</balance>\n        <units>NS</units>\n        <curCd>USD</curCd>\n        <valUSD>2084048.67000000</valUSD>\n        <pctVal>0.521215307282</pctVal>\n        <payoffProfile>Long</payoffProfile>\n        <assetCat>EC</assetCat>\n        <issuerCat>CORP</issuerCat>\n        <invCountry>US</invCountry>\n        <isRestrictedSec>N</isRestrictedSec>\n\n        <fairValLevel>1</fairValLevel>\n        <securityLending>\n          <isCashCollateral>N</isCashCollateral>\n          <isNonCashCollateral>N</isNonCashCollateral>\n          <isLoanByFund>N</isLoanByFund>\n        </securityLending>\n      </invstOrSec>\n<invstOrSec>\n        <name>Dolby Laboratories, Inc.</name>\n        <lei>549300X04FB2QPCJ5J24</lei>\n        <title>Dolby Laboratories, Inc., Class A</title>\n        <cusip>25659T107</cusip>\n        <identifiers>\n          <isin value=\"US25659T1079\"/>\n        </identifiers>\n        <balance>32184.00000000</balance>\n        <units>NS</units>\n        <curCd>USD</curCd>\n        <valUSD>1692234.72000000</valUSD>\n        <pctVal>0.423223628256</pctVal>\n        <payoffProfile>Long</payoffProfile>\n        <assetCat>EC</assetCat>\n        <issuerCat>CORP</issuerCat>\n        <invCountry>US</invCountry>\n        <isRestrictedSec>N</isRestrictedSec>\n\n        <fairValLevel>1</fairValLevel>\n        <securityLending>\n          <isCashCollateral>N</isCashCollateral>\n          <isNonCashCollateral>N</isNonCashCollateral>\n          <isLoanByFund>N</isLoanByFund>\n        </securityLending>\n      </invstOrSec>\n<invstOrSec>\n        <name>Archer-Daniels-Midland Co.</name>\n        <lei>549300LO13MQ9HYSTR83</lei>\n        <title>Archer-Daniels-Midland Co.</title>\n        <cusip>039483102</cusip>\n        <identifiers>\n          <isin value=\"US0394831020\"/>\n        </identifiers>\n        <balance>29934.00000000</balance>\n        <units>NS</units>\n        <curCd>USD</curCd>\n        <valUSD>2286957.60000000</valUSD>\n        <pctVal>0.571962318052</pctVal>\n        <payoffProfile>Long</payoffProfile>\n        <assetCat>EC</assetCat>\n        <issuerCat>CORP</issuerCat>\n        <invCountry>US</invCountry>\n        <isRestrictedSec>N</isRestrictedSec>\n\n        <fairValLevel>1</fairValLevel>\n        <securityLending>\n          <isCashCollateral>N</isCashCollateral>\n          <isNonCashCollateral>N</isNonCashCollateral>\n          <isLoanByFund>N</isLoanByFund>\n        </securityLending>\n      </invstOrSec>\n<invstOrSec>\n        <name>Exxon Mobil Corp.</name>\n        <lei>J3WHBG0MTS7O8ZVMDC91</lei>\n        <title>Exxon Mobil Corp.</title>\n        <cusip>30231G102</cusip>\n        <identifiers>\n          <isin value=\"US30231G1022\"/>\n        </identifiers>\n        <balance>13580.00000000</balance>\n        <units>NS</units>\n        <curCd>USD</curCd>\n        <valUSD>1856657.60000000</valUSD>\n        <pctVal>0.464345375150</pctVal>\n        <payoffProfile>Long</payoffProfile>\n        <assetCat>EC</assetCat>\n        <issuerCat>CORP</issuerCat>\n        <invCountry>US</invCountry>\n        <isRestrictedSec>N</isRestrictedSec>\n\n        <fairValLevel>1</fairValLevel>\n        <securityLending>\n          <isCashCollateral>N</isCashCollateral>\n          <isNonCashCollateral>N</isNonCashCollateral>\n          <isLoanByFund>N</isLoanByFund>\n        </securityLending>\n      </invstOrSec>\n</invstOrSecs></formData></edgarSubmission>\n",
  "sec-atom-PAPI.xml": "<?xml version=\"1.0\" encoding=\"ISO-8859-1\" ?>\n  <feed xmlns=\"http://www.w3.org/2005/Atom\">\n    <author>\n      <email>webmaster@sec.gov</email>\n      <name>Webmaster</name>\n    </author>\n    <company-info>\n      <addresses>\n        <address type=\"mailing\">\n          <city>NEW YORK</city>\n          <state>NY</state>\n          <street1>1585 BROADWAY</street1>\n          <zip>10036</zip>\n        </address>\n        <address type=\"business\">\n          <city>NEW YORK</city>\n          <phone>212.296.1404</phone>\n          <state>NY</state>\n          <street1>1585 BROADWAY</street1>\n          <zip>10036</zip>\n        </address>\n      </addresses>\n      <cik>0001676326</cik>\n      <cik-href>https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;CIK=0001676326&amp;owner=include&amp;count=10</cik-href>\n      <conformed-name>Morgan Stanley ETF Trust</conformed-name>\n      <fiscal-year-end>0930</fiscal-year-end>\n      <state-location>NY</state-location>\n      <state-location-href>https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;State=NY&amp;owner=include&amp;count=10</state-location-href>\n      <state-of-incorporation>DE</state-of-incorporation>\n    </company-info>\n    <entry>\n      <category label=\"form type\" scheme=\"https://www.sec.gov/\" term=\"NPORT-P\" />\n      <content type=\"text/xml\">\n        <accession-number>0002071691-26-018745</accession-number>\n        <act>40</act>\n        <file-number>811-23820</file-number>\n        <file-number-href>https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;filenum=811-23820&amp;owner=include&amp;count=10</file-number-href>\n        <filing-date>2026-08-21</filing-date>\n        <filing-href>https://www.sec.gov/Archives/edgar/data/1676326/000207169126018745/0002071691-26-018745-index.htm</filing-href>\n        <filing-type>NPORT-P</filing-type>\n        <film-number>261302133</film-number>\n        <form-name>Monthly Portfolio Investments Report on Form N-PORT (Public)</form-name>\n        <size>17 MB</size>\n      </content>\n      <id>urn:tag:sec.gov,2008:accession-number=0002071691-26-018745</id>\n      <link href=\"https://www.sec.gov/Archives/edgar/data/1676326/000207169126018745/0002071691-26-018745-index.htm\" rel=\"alternate\" type=\"text/html\" />\n      <summary type=\"html\"> &lt;b&gt;Filed:&lt;/b&gt; 2026-08-21 &lt;b&gt;AccNo:&lt;/b&gt; 0002071691-26-018745 &lt;b&gt;Size:&lt;/b&gt; 17 MB</summary>\n      <title>NPORT-P  - Monthly Portfolio Investments Report on Form N-PORT (Public)</title>\n      <updated>2026-08-21T09:19:01-04:00</updated>\n    </entry>\n    <entry>\n      <category label=\"form type\" scheme=\"https://www.sec.gov/\" term=\"NPORT-P\" />\n      <content type=\"text/xml\">\n        <accession-number>0002071691-26-011921</accession-number>\n        <act>40</act>\n        <file-number>811-23820</file-number>\n        <file-number-href>https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;filenum=811-23820&amp;owner=include&amp;count=10</file-number-href>\n        <filing-date>2026-05-27</filing-date>\n        <filing-href>https://www.sec.gov/Archives/edgar/data/1676326/000207169126011921/0002071691-26-011921-index.htm</filing-href>\n        <filing-type>NPORT-P</filing-type>\n        <film-number>261022369</film-number>\n        <form-name>Monthly Portfolio Investments Report on Form N-PORT (Public)</form-name>\n        <size>199 KB</size>\n      </content>\n      <id>urn:tag:sec.gov,2008:accession-number=0002071691-26-011921</id>\n      <link href=\"https://www.sec.gov/Archives/edgar/data/1676326/000207169126011921/0002071691-26-011921-index.htm\" rel=\"alternate\" type=\"text/html\" />\n      <summary type=\"html\"> &lt;b&gt;Filed:&lt;/b&gt; 2026-05-27 &lt;b&gt;AccNo:&lt;/b&gt; 0002071691-26-011921 &lt;b&gt;Size:&lt;/b&gt; 199 KB</summary>\n      <title>NPORT-P  - Monthly Portfolio Investments Report on Form N-PORT (Public)</title>\n      <updated>2026-05-27T09:03:05-04:00</updated>\n    </entry>\n    <entry>\n      <category label=\"form type\" scheme=\"https://www.sec.gov/\" term=\"NPORT-P\" />\n      <content type=\"text/xml\">\n        <accession-number>0002071691-26-005079</accession-number>\n        <act>40</act>\n        <file-number>811-23820</file-number>\n        <file-number-href>https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;filenum=811-23820&amp;owner=include&amp;count=10</file-number-href>\n        <filing-date>2026-02-27</filing-date>\n        <filing-href>https://www.sec.gov/Archives/edgar/data/1676326/000207169126005079/0002071691-26-005079-index.htm</filing-href>\n        <filing-type>NPORT-P</filing-type>\n        <film-number>26692951</film-number>\n        <form-name>Monthly Portfolio Investments Report on Form N-PORT (Public)</form-name>\n        <size>15 MB</size>\n      </content>\n      <id>urn:tag:sec.gov,2008:accession-number=0002071691-26-005079</id>\n      <link href=\"https://www.sec.gov/Archives/edgar/data/1676326/000207169126005079/0002071691-26-005079-index.htm\" rel=\"alternate\" type=\"text/html\" />\n      <summary type=\"html\"> &lt;b&gt;Filed:&lt;/b&gt; 2026-02-27 &lt;b&gt;AccNo:&lt;/b&gt; 0002071691-26-005079 &lt;b&gt;Size:&lt;/b&gt; 15 MB</summary>\n      <title>NPORT-P  - Monthly Portfolio Investments Report on Form N-PORT (Public)</title>\n      <updated>2026-02-27T08:49:02-05:00</updated>\n    </entry>\n    <entry>\n      <category label=\"form type\" scheme=\"https://www.sec.gov/\" term=\"NPORT-P\" />\n      <content type=\"text/xml\">\n        <accession-number>0002071691-25-007394</accession-number>\n        <act>40</act>\n        <file-number>811-23820</file-number>\n        <file-number-href>https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;filenum=811-23820&amp;owner=include&amp;count=10</file-number-href>\n        <filing-date>2025-11-26</filing-date>\n        <filing-href>https://www.sec.gov/Archives/edgar/data/1676326/000207169125007394/0002071691-25-007394-index.htm</filing-href>\n        <filing-type>NPORT-P</filing-type>\n        <film-number>251524911</film-number>\n        <form-name>Monthly Portfolio Investments Report on Form N-PORT (Public)</form-name>\n        <size>199 KB</size>\n      </content>\n      <id>urn:tag:sec.gov,2008:accession-number=0002071691-25-007394</id>\n      <link href=\"https://www.sec.gov/Archives/edgar/data/1676326/000207169125007394/0002071691-25-007394-index.htm\" rel=\"alternate\" type=\"text/html\" />\n      <summary type=\"html\"> &lt;b&gt;Filed:&lt;/b&gt; 2025-11-26 &lt;b&gt;AccNo:&lt;/b&gt; 0002071691-25-007394 &lt;b&gt;Size:&lt;/b&gt; 199 KB</summary>\n      <title>NPORT-P  - Monthly Portfolio Investments Report on Form N-PORT (Public)</title>\n      <updated>2025-11-26T09:08:19-05:00</updated>\n    </entry>\n    <entry>\n      <category label=\"form type\" scheme=\"https://www.sec.gov/\" term=\"NPORT-P\" />\n      <content type=\"text/xml\">\n        <accession-number>0001752724-25-197802</accession-number>\n        <act>40</act>\n        <file-number>811-23820</file-number>\n        <file-number-href>https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;filenum=811-23820&amp;owner=include&amp;count=10</file-number-href>\n        <filing-date>2025-08-22</filing-date>\n        <filing-href>https://www.sec.gov/Archives/edgar/data/1676326/000175272425197802/0001752724-25-197802-index.htm</filing-href>\n        <filing-type>NPORT-P</filing-type>\n        <film-number>251242344</film-number>\n        <form-name>Monthly Portfolio Investments Report on Form N-PORT (Public)</form-name>\n        <size>12 MB</size>\n      </content>\n      <id>urn:tag:sec.gov,2008:accession-number=0001752724-25-197802</id>\n      <link href=\"https://www.sec.gov/Archives/edgar/data/1676326/000175272425197802/0001752724-25-197802-index.htm\" rel=\"alternate\" type=\"text/html\" />\n      <summary type=\"html\"> &lt;b&gt;Filed:&lt;/b&gt; 2025-08-22 &lt;b&gt;AccNo:&lt;/b&gt; 0001752724-25-197802 &lt;b&gt;Size:&lt;/b&gt; 12 MB</summary>\n      <title>NPORT-P  - Monthly Portfolio Investments Report on Form N-PORT (Public)</title>\n      <updated>2025-08-22T08:54:47-04:00</updated>\n    </entry>\n    <entry>\n      <category label=\"form type\" scheme=\"https://www.sec.gov/\" term=\"NPORT-P\" />\n      <content type=\"text/xml\">\n        <accession-number>0001752724-25-122955</accession-number>\n        <act>40</act>\n        <file-number>811-23820</file-number>\n        <file-number-href>https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;filenum=811-23820&amp;owner=include&amp;count=10</file-number-href>\n        <filing-date>2025-05-28</filing-date>\n        <filing-href>https://www.sec.gov/Archives/edgar/data/1676326/000175272425122955/0001752724-25-122955-index.htm</filing-href>\n        <filing-type>NPORT-P</filing-type>\n        <film-number>25991390</film-number>\n        <form-name>Monthly Portfolio Investments Report on Form N-PORT (Public)</form-name>\n        <size>199 KB</size>\n      </content>\n      <id>urn:tag:sec.gov,2008:accession-number=0001752724-25-122955</id>\n      <link href=\"https://www.sec.gov/Archives/edgar/data/1676326/000175272425122955/0001752724-25-122955-index.htm\" rel=\"alternate\" type=\"text/html\" />\n      <summary type=\"html\"> &lt;b&gt;Filed:&lt;/b&gt; 2025-05-28 &lt;b&gt;AccNo:&lt;/b&gt; 0001752724-25-122955 &lt;b&gt;Size:&lt;/b&gt; 199 KB</summary>\n      <title>NPORT-P  - Monthly Portfolio Investments Report on Form N-PORT (Public)</title>\n      <updated>2025-05-28T08:52:30-04:00</updated>\n    </entry>\n    <entry>\n      <category label=\"form type\" scheme=\"https://www.sec.gov/\" term=\"NPORT-P\" />\n      <content type=\"text/xml\">\n        <accession-number>0001752724-25-038483</accession-number>\n        <act>40</act>\n        <file-number>811-23820</file-number>\n        <file-number-href>https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;filenum=811-23820&amp;owner=include&amp;count=10</file-number-href>\n        <filing-date>2025-02-26</filing-date>\n        <filing-href>https://www.sec.gov/Archives/edgar/data/1676326/000175272425038483/0001752724-25-038483-index.htm</filing-href>\n        <filing-type>NPORT-P</filing-type>\n        <film-number>25666385</film-number>\n        <form-name>Monthly Portfolio Investments Report on Form N-PORT (Public)</form-name>\n        <size>11 MB</size>\n      </content>\n      <id>urn:tag:sec.gov,2008:accession-number=0001752724-25-038483</id>\n      <link href=\"https://www.sec.gov/Archives/edgar/data/1676326/000175272425038483/0001752724-25-038483-index.htm\" rel=\"alternate\" type=\"text/html\" />\n      <summary type=\"html\"> &lt;b&gt;Filed:&lt;/b&gt; 2025-02-26 &lt;b&gt;AccNo:&lt;/b&gt; 0001752724-25-038483 &lt;b&gt;Size:&lt;/b&gt; 11 MB</summary>\n      <title>NPORT-P  - Monthly Portfolio Investments Report on Form N-PORT (Public)</title>\n      <updated>2025-02-26T09:03:40-05:00</updated>\n    </entry>\n    <entry>\n      <category label=\"form type\" scheme=\"https://www.sec.gov/\" term=\"NPORT-P\" />\n      <content type=\"text/xml\">\n        <accession-number>0001752724-24-273526</accession-number>\n        <act>40</act>\n        <file-number>811-23820</file-number>\n        <file-number-href>https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;filenum=811-23820&amp;owner=include&amp;count=10</file-number-href>\n        <filing-date>2024-11-27</filing-date>\n        <filing-href>https://www.sec.gov/Archives/edgar/data/1676326/000175272424273526/0001752724-24-273526-index.htm</filing-href>\n        <filing-type>NPORT-P</filing-type>\n        <film-number>241507630</film-number>\n        <form-name>Monthly Portfolio Investments Report on Form N-PORT (Public)</form-name>\n        <size>186 KB</size>\n      </content>\n      <id>urn:tag:sec.gov,2008:accession-number=0001752724-24-273526</id>\n      <link href=\"https://www.sec.gov/Archives/edgar/data/1676326/000175272424273526/0001752724-24-273526-index.htm\" rel=\"alternate\" type=\"text/html\" />\n      <summary type=\"html\"> &lt;b&gt;Filed:&lt;/b&gt; 2024-11-27 &lt;b&gt;AccNo:&lt;/b&gt; 0001752724-24-273526 &lt;b&gt;Size:&lt;/b&gt; 186 KB</summary>\n      <title>NPORT-P  - Monthly Portfolio Investments Report on Form N-PORT (Public)</title>\n      <updated>2024-11-27T10:22:13-05:00</updated>\n    </entry>\n    <entry>\n      <category label=\"form type\" scheme=\"https://www.sec.gov/\" term=\"NPORT-P\" />\n      <content type=\"text/xml\">\n        <accession-number>0001752724-24-185978</accession-number>\n        <act>40</act>\n        <file-number>811-23820</file-number>\n        <file-number-href>https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;filenum=811-23820&amp;owner=include&amp;count=10</file-number-href>\n        <filing-date>2024-08-22</filing-date>\n        <filing-href>https://www.sec.gov/Archives/edgar/data/1676326/000175272424185978/0001752724-24-185978-index.htm</filing-href>\n        <filing-type>NPORT-P</filing-type>\n        <film-number>241230303</film-number>\n        <form-name>Monthly Portfolio Investments Report on Form N-PORT (Public)</form-name>\n        <size>9 MB</size>\n      </content>\n      <id>urn:tag:sec.gov,2008:accession-number=0001752724-24-185978</id>\n      <link href=\"https://www.sec.gov/Archives/edgar/data/1676326/000175272424185978/0001752724-24-185978-index.htm\" rel=\"alternate\" type=\"text/html\" />\n      <summary type=\"html\"> &lt;b&gt;Filed:&lt;/b&gt; 2024-08-22 &lt;b&gt;AccNo:&lt;/b&gt; 0001752724-24-185978 &lt;b&gt;Size:&lt;/b&gt; 9 MB</summary>\n      <title>NPORT-P  - Monthly Portfolio Investments Report on Form N-PORT (Public)</title>\n      <updated>2024-08-22T09:20:16-04:00</updated>\n    </entry>\n    <entry>\n      <category label=\"form type\" scheme=\"https://www.sec.gov/\" term=\"NPORT-P\" />\n      <content type=\"text/xml\">\n        <accession-number>0001752724-24-119864</accession-number>\n        <act>40</act>\n        <file-number>811-23820</file-number>\n        <file-number-href>https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;filenum=811-23820&amp;owner=include&amp;count=10</file-number-href>\n        <filing-date>2024-05-28</filing-date>\n        <filing-href>https://www.sec.gov/Archives/edgar/data/1676326/000175272424119864/0001752724-24-119864-index.htm</filing-href>\n        <filing-type>NPORT-P</filing-type>\n        <film-number>24986590</film-number>\n        <form-name>Monthly Portfolio Investments Report on Form N-PORT (Public)</form-name>\n        <size>189 KB</size>\n      </content>\n      <id>urn:tag:sec.gov,2008:accession-number=0001752724-24-119864</id>\n      <link href=\"https://www.sec.gov/Archives/edgar/data/1676326/000175272424119864/0001752724-24-119864-index.htm\" rel=\"alternate\" type=\"text/html\" />\n      <summary type=\"html\"> &lt;b&gt;Filed:&lt;/b&gt; 2024-05-28 &lt;b&gt;AccNo:&lt;/b&gt; 0001752724-24-119864 &lt;b&gt;Size:&lt;/b&gt; 189 KB</summary>\n      <title>NPORT-P  - Monthly Portfolio Investments Report on Form N-PORT (Public)</title>\n      <updated>2024-05-28T09:08:12-04:00</updated>\n    </entry>\n    <id>https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;CIK=0001676326</id>\n    <link href=\"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;CIK=S000082252&amp;type=NPORT-P&amp;start=0&amp;count=10\" rel=\"alternate\" type=\"text/html\" />\n    <link href=\"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;CIK=S000082252&amp;type=NPORT-P&amp;start=0&amp;count=10&amp;output=atom\" rel=\"self\" type=\"application/atom+xml\" />\n    <link href=\"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;CIK=S000082252&amp;scd=filings&amp;type=NPORT-P%25&amp;datea=&amp;dateb=&amp;owner=include&amp;count=10&amp;output=atom&amp;start=10\" rel=\"next\" type=\"application/atom+xml\" />\n    <title>Morgan Stanley ETF Trust  (0001676326)</title>\n    <updated>2026-10-01T19:21:28-04:00</updated>\n  </feed>\n",
  "sec-mf-tickers.json": "{\n  \"fields\": [\n    \"cik\",\n    \"seriesId\",\n    \"classId\",\n    \"symbol\"\n  ],\n  \"data\": [\n    [\n      1676326,\n      \"S000077958\",\n      \"C000238675\",\n      \"CVIE\"\n    ],\n    [\n      1676326,\n      \"S000077959\",\n      \"C000238676\",\n      \"CVLC\"\n    ],\n    [\n      1676326,\n      \"S000077960\",\n      \"C000238677\",\n      \"CDEI\"\n    ],\n    [\n      1676326,\n      \"S000077961\",\n      \"C000238678\",\n      \"CVMC\"\n    ],\n    [\n      1676326,\n      \"S000077962\",\n      \"C000238679\",\n      \"CVSE\"\n    ],\n    [\n      1676326,\n      \"S000077963\",\n      \"C000238680\",\n      \"CVSB\"\n    ],\n    [\n      1676326,\n      \"S000082246\",\n      \"C000245530\",\n      \"EVHY\"\n    ],\n    [\n      1676326,\n      \"S000082247\",\n      \"C000245531\",\n      \"EVIM\"\n    ],\n    [\n      1676326,\n      \"S000082248\",\n      \"C000245532\",\n      \"EVSB\"\n    ],\n    [\n      1676326,\n      \"S000082250\",\n      \"C000245534\",\n      \"PHEQ\"\n    ],\n    [\n      1676326,\n      \"S000082252\",\n      \"C000245536\",\n      \"PAPI\"\n    ],\n    [\n      1676326,\n      \"S000083413\",\n      \"C000247024\",\n      \"EVTR\"\n    ],\n    [\n      1676326,\n      \"S000083416\",\n      \"C000247027\",\n      \"EVSM\"\n    ],\n    [\n      1676326,\n      \"S000088098\",\n      \"C000254149\",\n      \"PEPS\"\n    ],\n    [\n      1676326,\n      \"S000088107\",\n      \"C000254158\",\n      \"ECLO\"\n    ],\n    [\n      1676326,\n      \"S000088108\",\n      \"C000254159\",\n      \"EVYM\"\n    ],\n    [\n      1676326,\n      \"S000088109\",\n      \"C000254160\",\n      \"XAGG\"\n    ],\n    [\n      1676326,\n      \"S000092949\",\n      \"C000260999\",\n      \"EVMO\"\n    ]\n  ]\n}",
  "yahoo-PAPI-sample.json": "{\n  \"chart\": {\n    \"result\": [\n      {\n        \"meta\": {\n          \"currency\": \"USD\",\n          \"symbol\": \"PAPI\",\n          \"exchangeName\": \"PCX\",\n          \"fullExchangeName\": \"NYSEArca\",\n          \"instrumentType\": \"ETF\",\n          \"firstTradeDate\": 1697722200,\n          \"regularMarketTime\": 1790884800,\n          \"hasPrePostMarketData\": true,\n          \"gmtoffset\": -14400,\n          \"timezone\": \"EDT\",\n          \"exchangeTimezoneName\": \"America/New_York\",\n          \"regularMarketPrice\": 26.48,\n          \"regularMarketChangePercent\": 0.761,\n          \"fulldayPrice\": 26.48,\n          \"fulldayChange\": 0.2,\n          \"fulldayChangePercent\": 0.761,\n          \"fiftyTwoWeekHigh\": 28.535,\n          \"fiftyTwoWeekLow\": 25.0,\n          \"regularMarketDayHigh\": 26.53,\n          \"regularMarketDayLow\": 26.25,\n          \"regularMarketVolume\": 85084,\n          \"longName\": \"Parametric Equity Premium Income ETF\",\n          \"shortName\": \"Parametric Equity Premium Incom\",\n          \"chartPreviousClose\": 24.99,\n          \"priceHint\": 2,\n          \"currentTradingPeriod\": {\n            \"pre\": {\n              \"timezone\": \"EDT\",\n              \"end\": 1790861400,\n              \"start\": 1790841600,\n              \"gmtoffset\": -14400\n            },\n            \"regular\": {\n              \"timezone\": \"EDT\",\n              \"end\": 1790884800,\n              \"start\": 1790861400,\n              \"gmtoffset\": -14400\n            },\n            \"post\": {\n              \"timezone\": \"EDT\",\n              \"end\": 1790899200,\n              \"start\": 1790884800,\n              \"gmtoffset\": -14400\n            }\n          },\n          \"dataGranularity\": \"1wk\",\n          \"range\": \"max\",\n          \"validRanges\": [\n            \"1d\",\n            \"5d\",\n            \"1mo\",\n            \"3mo\",\n            \"6mo\",\n            \"1y\",\n            \"2y\",\n            \"5y\",\n            \"ytd\",\n            \"max\"\n          ]\n        },\n        \"timestamp\": [\n          1785729600,\n          1786334400,\n          1786939200,\n          1787544000,\n          1788148800,\n          1788753600,\n          1789358400,\n          1789963200,\n          1790568000,\n          1790884800\n        ],\n        \"indicators\": {\n          \"quote\": [\n            {\n              \"close\": [\n                27.670000076293945,\n                27.959999084472656,\n                28.239999771118164,\n                28.1299991607666,\n                27.84000015258789,\n                27.5,\n                27.219999313354492,\n                26.760000228881836,\n                26.280000686645508,\n                26.479999542236328\n              ],\n              \"volume\": [\n                463400,\n                477400,\n                374900,\n                412500,\n                667600,\n                192300,\n                418500,\n                433700,\n                306300,\n                85084\n              ]\n            }\n          ],\n          \"adjclose\": [\n            {\n              \"adjclose\": [\n                27.327024459838867,\n                27.61343002319336,\n                27.88995933532715,\n                27.781320571899414,\n                27.65516471862793,\n                27.31742286682129,\n                27.03927993774414,\n                26.58233642578125,\n                26.280000686645508,\n                26.479999542236328\n              ]\n            }\n          ]\n        },\n        \"events\": {\n          \"dividends\": {\n            \"1701061200\": {\n              \"amount\": 0.166,\n              \"date\": 1701354600\n            },\n            \"1702875600\": {\n              \"amount\": 0.208,\n              \"date\": 1703169000\n            },\n            \"1706504400\": {\n              \"amount\": 0.115,\n              \"date\": 1706711400\n            },\n            \"1708923600\": {\n              \"amount\": 0.142,\n              \"date\": 1709217000\n            },\n            \"1711339200\": {\n              \"amount\": 0.18,\n              \"date\": 1711632600\n            },\n            \"1714363200\": {\n              \"amount\": 0.172,\n              \"date\": 1714483800\n            },\n            \"1716782400\": {\n              \"amount\": 0.185,\n              \"date\": 1717162200\n            },\n            \"1719201600\": {\n              \"amount\": 0.164,\n              \"date\": 1719581400\n            },\n            \"1722225600\": {\n              \"amount\": 0.122,\n              \"date\": 1722432600\n            },\n            \"1724644800\": {\n              \"amount\": 0.147,\n              \"date\": 1725024600\n            },\n            \"1727668800\": {\n              \"amount\": 0.171,\n              \"date\": 1727703000\n            },\n            \"1730088000\": {\n              \"amount\": 0.133,\n              \"date\": 1730381400\n            },\n            \"1732510800\": {\n              \"amount\": 0.154,\n              \"date\": 1732890600\n            },\n            \"1734930000\": {\n              \"amount\": 0.164,\n              \"date\": 1734964200\n            },\n            \"1737954000\": {\n              \"amount\": 0.139,\n              \"date\": 1738333800\n            },\n            \"1740373200\": {\n              \"amount\": 0.134,\n              \"date\": 1740753000\n            },\n            \"1743393600\": {\n              \"amount\": 0.193,\n              \"date\": 1743427800\n            },\n            \"1745812800\": {\n              \"amount\": 0.203,\n              \"date\": 1746019800\n            },\n            \"1748232000\": {\n              \"amount\": 0.148,\n              \"date\": 1748611800\n            },\n            \"1751256000\": {\n              \"amount\": 0.184,\n              \"date\": 1751290200\n            },\n            \"1753675200\": {\n              \"amount\": 0.147,\n              \"date\": 1753968600\n            },\n            \"1756094400\": {\n              \"amount\": 0.152,\n              \"date\": 1756474200\n            },\n            \"1759118400\": {\n              \"amount\": 0.18,\n              \"date\": 1759239000\n            },\n            \"1761537600\": {\n              \"amount\": 0.149,\n              \"date\": 1761917400\n            },\n            \"1763960400\": {\n              \"amount\": 0.148,\n              \"date\": 1764340200\n            },\n            \"1766379600\": {\n              \"amount\": 0.179,\n              \"date\": 1766500200\n            },\n            \"1769403600\": {\n              \"amount\": 0.161,\n              \"date\": 1769783400\n            },\n            \"1771822800\": {\n              \"amount\": 0.164,\n              \"date\": 1772202600\n            },\n            \"1774843200\": {\n              \"amount\": 0.238,\n              \"date\": 1774963800\n            },\n            \"1777262400\": {\n              \"amount\": 0.155,\n              \"date\": 1777555800\n            },\n            \"1779681600\": {\n              \"amount\": 0.156,\n              \"date\": 1780061400\n            },\n            \"1782705600\": {\n              \"amount\": 0.203,\n              \"date\": 1782826200\n            },\n            \"1785124800\": {\n              \"amount\": 0.168,\n              \"date\": 1785504600\n            },\n            \"1788148800\": {\n              \"amount\": 0.163,\n              \"date\": 1788183000\n            },\n            \"1790568000\": {\n              \"amount\": 0.177,\n              \"date\": 1790775000\n            }\n          }\n        }\n      }\n    ]\n  }\n}",
};
const fixture = (name: string): string => FIXTURES[name];
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
    // The same table publishes the daily NAV/market price and the 30-day SEC
    // yield with its own as-of date; those columns are mapped by header name.
    const premium = funds.find((fund) => fund.ticker === 'PAPI')!;
    expect(premium.nav).toBe(26.22);
    expect(premium.marketPrice).toBe(26.28);
    expect(premium.asOfDate).toBe('2026-09-30');
    expect(premium.secYield).toBe(2.63);
    expect(premium.secYieldDate).toBe('2026-08-31');
    expect(premium.frequency).toBe('Monthly');
    expect(funds.find((fund) => fund.ticker === 'PEPS')!.secYield).toBe(0.97);
    expect(funds.find((fund) => fund.ticker === 'PHEQ')!.secYield).toBe(0.81);
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
    // The page publishes the premium in dollars ("$0.06"); the feed's
    // percentage is computed from the page's own market price and NAV.
    expect(product.premiumDiscountAmount).toBe(0.06);
    expect(Math.round(((product.marketPrice! - product.nav!) / product.nav!) * 100 * 100) / 100).toBe(0.23);
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
    expect(hedged.premiumDiscountAmount).toBe(0.2);
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

  test('the manual controls JSON reaches every control without a dispatch input cap', () => {
    const controls = resolveControls({}, { SKIP_ISSUER: 'true', VERBOSE: 'true', SEC_UA: 'ops contact' });
    expect(controls.SKIP_ISSUER).toBe('true');
    expect(controls.VERBOSE).toBe('true');
    expect(controls.SEC_UA).toBe('ops contact');
  });

  test('the update workflow takes all controls through a single JSON dispatch input', () => {
    const text = readFileSync(new URL('../.github/workflows/update-data.yml', import.meta.url), 'utf8');
    const inputs = text.split('    inputs:')[1].split('\npermissions:')[0];
    expect([...inputs.matchAll(/^      ([a-z0-9_]+):$/gm)].map((match) => match[1])).toEqual(['controls']);
    expect(text).toContain('CONTROLS: ${{ inputs.controls }}');
    // Schedule + manual only; the sibling rule forbids a push-triggered refresh.
    expect(text).toContain("cron: '0 0 * * 0'");
    expect(text).not.toMatch(/^  push:/m);
    expect(text).not.toContain('bunx tsc');
  });

  test('every canonical control is documented in the README', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    for (const name of CONTROL_NAMES) expect(readme).toContain('`' + name + '`');
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
// SEC rendering-proxy fallback (offline)
// ---------------------------------------------------------------------------

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
    // The real payload shape captured through the proxy on 2026-10-01.
    const body = 'Title: company_tickers_mf.json\n\nMarkdown Content:\n{"fields":["cik","seriesId","classId","symbol"],"data":[[1676326,"S000082252","C000245536","PAPI"]]}';
    globalThis.fetch = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
      const url = String(input);
      calls.push(url);
      headers.push(init?.headers || {});
      if (url.startsWith('https://r.jina.ai/')) return new Response(body, { status: 200 });
      return new Response('blocked', { status: 403, statusText: 'Forbidden' });
    }) as typeof fetch;
    try {
      const config = { maxRetries: 0, secUa: 'test up' } as any;
      const payload = await withRequestLane(0, () => fetchSecJson('https://www.sec.gov/files/company_tickers_mf.json', '[edgar   ] test table', config));
      expect(payload).toEqual({ fields: ['cik', 'seriesId', 'classId', 'symbol'], data: [[1676326, 'S000082252', 'C000245536', 'PAPI']] });
      expect(calls[0]).toBe('https://www.sec.gov/files/company_tickers_mf.json');
      expect(calls[1]).toBe('https://r.jina.ai/https://www.sec.gov/files/company_tickers_mf.json');
      // JSON keeps the proxy's default mode.
      expect(headers[1]['X-Return-Format']).toBeUndefined();
      // One-way for the rest of the run: the next request does not retry direct.
      calls.length = 0;
      await withRequestLane(0, () => fetchSecJson('https://www.sec.gov/submissions/CIK0001676326.json', '[edgar   ] test submissions', config));
      expect(calls).toEqual(['https://r.jina.ai/https://www.sec.gov/submissions/CIK0001676326.json']);
      // XML asks the proxy for the raw document: its default mode renders XML
      // as markdown, which loses every tag the N-PORT reader needs.
      calls.length = 0;
      headers.length = 0;
      await withRequestLane(0, () => fetchSecText('https://www.sec.gov/Archives/edgar/data/1676326/000207169126018753/primary_doc.xml', '[edgar   ] test nport', config, 'xml'));
      expect(calls).toEqual(['https://r.jina.ai/https://www.sec.gov/Archives/edgar/data/1676326/000207169126018753/primary_doc.xml']);
      expect(headers[0]['X-Return-Format']).toBe('html');
    } finally {
      globalThis.fetch = original;
    }
  });

  test('the N-PORT reader tolerates the lowercase tags the proxy HTML mode returns', () => {
    const raw = fixture('nport-PAPI-sample.xml');
    const parsed = parseNport(raw);
    // Jina's raw-document mode lowercases element names; every value survives.
    const lower = parseNport(raw.toLowerCase());
    expect(lower.seriesId).toBe(parsed.seriesId.toUpperCase());
    expect(lower.seriesName).toBe(parsed.seriesName.toLowerCase());
    expect(lower.holdings.length).toBe(parsed.holdings.length);
    expect(lower.holdings.length).toBeGreaterThan(0);
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
      expect(meta.name).toBe(fund.name);
      expect(meta.history.totalRows).toBeGreaterThan(0);
      // Identifiers, TER/AUM, the 30-day SEC yield and the premium/discount are
      // published only when the eatonvance.com edge answered during the
      // generation run; when it did not, the feed keeps an explicit null
      // instead of inventing a value, and the two files must agree either way.
      const cusip = fund.identifiers?.cusip ?? null;
      expect(meta.identifiers.cusip).toBe(cusip);
      if (cusip !== null) expect(cusip).toMatch(/^[A-Z0-9]{9}$/);
    }
  });
});
