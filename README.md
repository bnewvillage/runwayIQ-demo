# Runway IQ — public demo

A running, clickable build of **Runway IQ**, a multi-country purchasing-intelligence
tool for a motorcycle-parts retailer operating in the UAE, Qatar and Saudi Arabia.
It turns a sales and stock history into reorder decisions: what to buy, what to
stop tying capital up in, and where stock should physically sit.

**Every figure in this demo is invented.** The brands, the items, the customers,
the warehouses and all 24,000-odd sales lines are generated in your browser when
the page loads. No real company, catalogue, customer or trading position appears
anywhere in this repository.

```bash
npm install
npm run dev      # http://localhost:5180
npm run build    # static site in dist/
```

No environment variables, no API keys, no backend, no database. `dist/` is a
static folder that works on GitHub Pages, any object store, or opened from disk.

---

## What you are looking at

Twelve tools over one shared dataset. The interesting ones first:

| Page | What it answers |
|---|---|
| **Overview** | The state of the operation in one screen — what is waiting, what it is costing, what moved. |
| **Demand Glance** | The fast pass: every SKU that needs ordering in the next three months, grouped by brand. |
| **Forecast Analytics** | One brand in full, where the buying decision actually gets made. Override the model per SKU and commit the result as a snapshot. |
| **Forecast Accuracy** | Whether those overrides *helped*. Scores committed snapshots against what actually sold. |
| **Demand Forecast** | The whole catalogue at a horizon you choose. Deliberately a manual run — it is the expensive one. |
| **Stock Analysis** | Health tiers, stock turn, GMROI and sell-through by brand and market. |
| **UAE Stock Placement** | Stock sitting in the warehouse that should be at the showroom, sized by the busiest three days each item has had. |
| **Sales Analytics** / **Sales Extended** | Value and volume. Two pages, because the data supports different questions (see below). |
| **Baskets** | What sells together, re-cut live as you change what counts as one shopping session. |
| **Requests** | Purchase requests raised but not yet ordered, against current stock in every market. |

### Things worth clicking

- **Demand Forecast → 12mo → Run.** Watch the method mix under the headline: the
  model reports **WMA · long: ~1,135** against **Holt · long: ~72**. The tier is
  named for a trend model that the data only earns about 6% of the time, and the
  page says so rather than letting you assume otherwise.
- **Sales Extended.** The live ERP feed reports *100% of units priced*; the
  pre-cutover export reports about *28%*. That single fact is why value and
  volume are two separate pages instead of one page with a toggle.
- **UAE Stock Placement.** Most movers hold most of their units at the warehouse
  rather than the showroom. The recommended move covers each item's busiest
  three-day run of *customer* sales — not its busiest day, and not its
  distribution orders.
- **Stock Analysis.** GMROI spans roughly 0.2 to 1.5 across brands while stock
  turn barely moves. That gap is the entire reason to measure both.

---

## How the demo works

The real app is a React front end talking to a FastAPI service on Cloud Run,
reading Postgres, behind Firebase Google auth. This repo is that front end with
**three files swapped** and nothing else changed:

| File | In the product | Here |
|---|---|---|
| `src/lib/api.js` | `fetch` against ~30 authenticated REST endpoints | The same ~30 functions, same names, same arguments, same response shapes — answered from the generated world |
| `src/firebase.js` | Firebase app + Google auth | A local session. Nothing is transmitted or verified |
| `src/main.jsx` | `BrowserRouter` | `HashRouter`, so deep links survive a static host with no rewrite rules |

Everything above that line — all twelve pages, every pure-logic module, every
chart and table — is the shipped code, untouched. That is deliberate: a demo
rebuilt as a separate mockup stops being evidence about the product.

### The data

```
src/demo/world.js       the synthetic business: catalogue, customers, invoices, stock
src/demo/forecast.js    the horizon-tiered forecast model (Holt / WMA)
src/lib/api.js          every endpoint, derived from the above
```

`world.js` builds a **single invoice ledger** and every aggregate is summed back
out of it — the sales cube, the item tables, the customer panel, the health
tiers, the basket tuples. Nothing is a canned per-page fixture. That matters
because the pages in the real app agree with each other by construction, since
they read one database; fixtures would drift the moment you opened two pages and
compared them.

It is seeded, so the catalogue and the pattern of trade are identical on every
machine and every reload. The one thing that is not fixed is the **clock**: the
773-day record is anchored to the day you open the page, so the demo still reads
as a live system in a year rather than one whose newest data point has gone
stale.

The generated world carries the awkward properties of the real one on purpose,
because they are what the tool exists to handle:

- **Three markets that joined the record at different times**, each with its own
  data floor and its own ERP cutover — and those two dates are not the same.
- **Pre-cutover history that priced some channels and not others**, so value
  figures stop at the cutover while volume figures do not.
- **A long tail** — about 28% of stocked item/market pairs go a full year without
  selling, which is what populates Aging, Critical and Dead Stock.
- **Promotional windows**, so a rule that trims promotional spikes has something
  to trim.
- **Returns**, as negative ledger rows already folded into every revenue figure.
- **Stock generated independently of sales**, so overstocked slow movers and
  stocked-out fast movers both exist. Deriving stock from sales would erase the
  exact relationship the app is for.

### What is not here

- No backend, database, ERP connection or nightly pipeline.
- **Refresh database** deliberately reports that there is nothing to refresh
  rather than silently doing nothing.
- Forecast snapshots, drafts and overrides are **in-memory**. You can start a
  review, override the model, commit it and see it scored — and a reload puts it
  back. A demo where one visitor's edits changed what the next one saw would be a
  shared mutable deployment.
- Everything runs in your browser. Nothing is sent anywhere, and nothing is
  stored beyond your own tab.

---

## Deploying

`npm run build` produces a self-contained `dist/`. Paths are relative and routing
is hash-based, so it needs no server configuration:

- **GitHub Pages** — publish `dist/` (e.g. via a `gh-pages` branch or an Actions
  workflow). A project site served from `/<repo>/` works as-is.
- **Netlify / Cloudflare Pages / S3** — build command `npm run build`, publish
  directory `dist`.

---

## Licence and scope

This is a demonstration of an interface and a set of ideas, published with
invented data. It is not the production system and is not intended to be run
against real data.
