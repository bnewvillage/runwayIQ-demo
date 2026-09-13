# Runway IQ — public demo

Purchasing intelligence for a parts retailer trading across three Gulf markets.
It answers three questions from a sales and stock history: what to buy, what to
stop tying capital up in, and where stock should physically sit.

This repository is a **running demo of that system's front end**, with the
backend replaced by a data generator. Every figure you see is invented — the
brands, items, customers, warehouses and all ~24,000 sales lines are generated in
your browser when the page loads. No real company, catalogue, customer or trading
position appears anywhere in this repository.

```bash
npm install
npm run dev      # http://localhost:5180
npm run build    # static site in dist/
```

No environment variables, no API keys, no backend, no database.

---

## 1. The problem

Reorder decisions look like arithmetic — forecast the demand, subtract the stock,
buy the difference. Almost none of the work is the arithmetic. The work is that
the record you are computing over is uneven in ways that quietly invalidate the
answer.

**The three markets did not start together.** Each joined the record on its own
date, and each has *two* such dates that are routinely confused: the **data
floor**, where any record at all begins, and the **ERP cutover**, where the
source hands over from a manual export to the live feed. They are months apart.
Below a floor, "did not sell" and "was not being recorded" are the same
observation, and a health tier that reads one as the other will call stock dead
on the strength of a gap in the paperwork.

**Half the history is priced and half is not.** The pre-cutover export carried
amounts for some channels and essentially none for one of them. Treating a
missing price as a sale at zero turns a profitable channel into a loss-making
one. So value and volume cannot live on the same page: quantities are complete
over the whole record, prices are complete only after each market's cutover, and
the app splits into two sales pages along exactly that line rather than offering
a toggle that invites a comparison the data cannot support.

**Most of the catalogue does not sell.** A long-tail parts catalogue has a large
majority of stocked item/market pairs going a full year without a sale. That is
not a data problem to be cleaned up — it is the shape of the business, and it is
why the health tiers have to grade *never sold* as carefully as *sold and
stopped*, on the same boundaries, or the majority of every tier is described by a
rule that does not apply to it.

**Demand observed through a shelf is censored.** An item with one unit on the
shelf can never record a two-unit day. Any rule that sizes a decision from an
observed peak is reading the stock position back to itself and calling it
evidence.

**Stock is a position; sales are a flow.** The gap between them is the entire
finding. Anything that derives one from the other erases it.

Everything else — the models, the tiers, the placement rule — is downstream of
taking those five facts seriously.

---

## 2. How it's built

```
ERPNext  ──nightly──▶  pipeline  ──▶  Supabase Postgres  ──▶  FastAPI on Cloud Run  ──▶  React SPA
          (Actions)     pulls,          raw mirror +           ~30 endpoints,            Vite build on
                        loads,          precomputed             Firebase ID token         Firebase Hosting
                        rebuilds        rollups                 verified per request
```

Roughly 9,700 lines of Python and SQL behind the interface: the request-path API,
the shared domain modules both sides run, the nightly pipeline, the schema, and
the test suite.

**Three tiers of computation, chosen per question rather than uniformly.**

- *Precomputed nightly* — anything that touches the whole catalogue and is read
  constantly. The all-brands ordering view and the brand-level stock-health
  rollup are built by the batch job and read back as a table, because the
  aggregation underneath is far too slow for a request someone is waiting on.
- *Live per request* — anything small and bounded, or anything that must be true
  *now*. Stock placement is read in order to act on it today, so a figure
  computed overnight would already be the wrong one by the time it is used.
- *On demand, explicitly* — the whole-catalogue forecast at an arbitrary horizon.
  Seconds of computation for a question asked a few times a year, so it is a
  button rather than a job: no storage, no staleness, no polling.

**Freshness is a fact, not an inference.** The pipeline's steps fail
independently, so each stamps its own completion marker. The web app reads those
markers both to label what it is showing and to decide whether its cached
forecasts are still valid. It never reasons from the clock — a scheduled run
drifts, retries, and can be dispatched by hand, so "it is past 02:00" says
nothing about whether data landed.

**One vocabulary, written down.** The repository carries a domain glossary that
defines every loaded term — net order, demand, forecast, velocity, run rate,
basket, priced line, data floor — and says what each is *not* to be called.
This is not documentation housekeeping. Three different things were all being
called "turn" in different corners of the system, and two of them were wrong;
naming them is what made the disagreement visible.

**Decisions are recorded.** Architecture decision records cover the choices that
are expensive to revisit — which forecast method applies at which horizon, how
pre-cutover history is isolated, what makes a basket a basket, and where a tier
may not be asserted at all.

---

## 3. The tools

| Page | What it answers |
|---|---|
| **Overview** | The state of the operation in one screen — what is waiting, what it is costing, what moved. |
| **Demand Glance** | The fast pass: every SKU that needs ordering in the next three months, grouped by brand. |
| **Forecast Analytics** | One brand in full, where the buying decision gets made. Override the model per SKU and commit the result as a snapshot. |
| **Forecast Accuracy** | Whether those overrides *helped*. Scores committed snapshots against what actually sold. |
| **Demand Forecast** | The whole catalogue at a horizon you choose. Deliberately a manual run. |
| **Stock Analysis** | Health tiers, stock turn, GMROI and sell-through by brand and market. |
| **UAE Stock Placement** | Stock at the warehouse that should be at the showroom, sized by each item's busiest three days. |
| **Sales Analytics** / **Sales Extended** | Value and volume — two pages, for the reason given above. |
| **Baskets** | What sells together, re-cut live as you change what counts as one shopping session. |
| **Requests** | Purchase requests raised but not yet ordered, against current stock in every market. |

### Worth clicking in the demo

- **Demand Forecast → 12mo → Run.** The method mix under the headline reports
  roughly **1,135 WMA** against **72 Holt**. The tier is named for a trend model
  the data earns about 6% of the time, and the page says so rather than letting
  you assume otherwise.
- **Sales Extended.** The live feed reports *100% of units priced*; the
  pre-cutover export reports about *28%*. That one fact is why there are two
  sales pages.
- **UAE Stock Placement.** Most movers hold most of their units offsite. The
  recommended move covers each item's busiest three-day run of *customer* sales.
- **Stock Analysis.** GMROI spans roughly 0.2 to 1.5 across brands while stock
  turn barely moves. That gap is the reason to measure both.

---

## 4. What was measured rather than assumed

The useful parts of this system are mostly corrections. Each of these looked
right, rendered plausibly, and was wrong.

**A ratio that divided retail by cost.** Stock turn was computed as revenue over
stock value — retail on top, cost underneath. It does not report turn; it reports
turn multiplied by the margin multiple, and it is wrong in the flattering
direction. The home page and another page were each showing a different
definition of "turn", disagreeing by about a factor of two in plain sight, with
nothing on screen saying which was which. Fixed by putting cost on both sides,
and by writing down in the glossary what each of the three live meanings of the
word was allowed to be called.

**A cost rate applied to the wrong mix.** GMROI was built from a brand-wide
blended cost rate. A blended rate costs the mix still sitting on the shelf, not
the mix that actually sold — and those are different mixes, in both directions.
Costing each sales line at its own item's rate moved individual brands from
negative to near-break-even and vice versa. Same inputs, same formula, different
answer, because the aggregation happened at the wrong grain.

**A peak that confirmed itself.** The stock placement rule originally sized a
move from each item's busiest single day. But a shelf holding one unit cannot
record a two-unit day — the observed peak is partly a measurement of the stock
position it is supposed to be correcting. It also counted distribution orders,
which are an order of magnitude larger and are never served from the showroom
floor, and promotional days, where a handful of dates set the peak for most of
the catalogue. The rule now uses the busiest *three-day run* of *customer* sales
with promotional windows excluded: three days because a week's worth of cover is
more stock than the problem calls for, and the peak day is inside the window
anyway, so the figure can never be smaller than the day it replaced.

**A tier that withheld a verdict it had the evidence for.** An "undetermined"
bucket had grown to a quarter of stock value. It turned out to be three separate
problems wearing one label: receipts were being treated as the only proof an item
had ever arrived, when a month-end balance is better evidence and more complete;
the never-sold ladder collapsed three-to-twelve months into a single rung; and a
market was refused a grade over a gap in its record rather than being graded on
the window that *could* be checked. All three were observations already in hand.
The bucket is now empty and stays defined only for the case that genuinely has no
answer — a market on its opening day.

**A deploy that succeeded at every step and shipped nothing.** A shared module
imported a helper that lived in the pipeline directory, which the API's container
image does not copy. It resolved locally and in CI, where the whole repository is
checked out, and failed only inside the image. The container crashed on startup,
the platform correctly kept the previous revision serving, and the new endpoint
returned 404 for half an hour while the push, the build and the hosting deploy
all reported success. There was no failure anywhere to alert on. It is now a test
that reads the Dockerfile, works out which directories actually reach the image,
and fails the build if request-path code imports anything outside them.

**An error reported at the wrong layer.** A filtered endpoint began returning
what the browser called a CORS failure. CORS was configured correctly. The query
referenced columns that had been normalised into another table, so every filtered
request raised a database error and died *before* the middleware could attach a
response header — and a response with no headers is indistinguishable, from the
browser's side, from a rejected origin. The unfiltered path kept working, which
is why it went unnoticed. The lesson that stuck: a missing header means the
response died early, and the thing to read is the server log, not the CORS
config.

---

## 5. What this build actually is

The front end here is the product's own — all twelve pages, every pure-logic
module, every chart and table — with **three files swapped**:

| File | In the product | Here |
|---|---|---|
| `src/lib/api.js` | `fetch` against ~30 authenticated endpoints | The same ~30 functions, same names, same arguments, same response shapes — answered from a generated world |
| `src/firebase.js` | Firebase app + Google auth | A local session. Nothing transmitted, nothing verified |
| `src/main.jsx` | `BrowserRouter` | `HashRouter`, so deep links survive a static host with no rewrite rules |

Keeping the real pages is the point. A demo rebuilt as a separate mockup stops
being evidence about the product.

### Be clear about what is and isn't reproduced

The **interface and its reasoning are real and running**. The **data layer is
substituted**, and the substitute is much smaller than what it stands in for:
about 2,200 lines of JavaScript in place of roughly 9,700 lines of Python and
SQL.

Specifically, `src/demo/forecast.js` is a **faithful interface and a simplified
engine**. It reproduces the horizon tiers and the honest fallback when a tier's
own method cannot be supported by the record — which is the behaviour worth
demonstrating, since the fallback fires far more often than the tier names
suggest. It does *not* reproduce the full channel-weighting model, promotional-day
exclusion, per-country earliest-date handling, or the inactive-row economics that
the production module carries.

The **nightly pipeline has no counterpart here at all.** Section 2 describes it;
this build does not run it.

### The generated world

```
src/demo/world.js       the synthetic business: catalogue, customers, invoices, stock
src/demo/forecast.js    the horizon-tiered forecast model
src/lib/api.js          every endpoint, derived from the above
```

`world.js` builds a **single invoice ledger**, and every aggregate is summed back
out of it — the sales cube, the item tables, the customer panel, the health
tiers, the basket tuples. Nothing is a canned per-page fixture. That matters
because the pages in the real system agree with each other by construction, since
they read one database; fixtures would drift the moment you opened two pages and
compared them, which is exactly what a demo gets looked at for.

It is seeded, so the catalogue and the pattern of trade are identical on every
machine and every reload. The **clock** is not fixed: the 773-day record is
anchored to the day you open the page, so the demo still reads as a live system
in a year rather than one whose newest data point has gone stale.

The world carries the awkward properties from section 1 on purpose, because they
are what the tool exists to handle — staggered floors and cutovers, partially
priced history, a long tail, promotional windows, returns as negative ledger
rows, and stock generated *independently* of sales so that overstocked slow
movers and stocked-out fast movers both exist.

### What is not here

- No backend, database, ERP connection or pipeline.
- **Refresh database** deliberately reports that there is nothing to refresh
  rather than silently doing nothing.
- Forecast snapshots, drafts and overrides are **in-memory**. You can start a
  review, override the model, commit it and see it scored — and a reload puts it
  back. A demo where one visitor's edits changed what the next one saw would be a
  shared mutable deployment.
- Everything runs in your browser. Nothing is sent anywhere; nothing is stored
  beyond your own tab.

---

## Deploying

`npm run build` produces a self-contained `dist/`. Paths are relative and routing
is hash-based, so it needs no server configuration and no `404.html` redirect —
verified serving the production build from a project subpath.

- **GitHub Pages** — publish `dist/`. A project site under `/<repo>/` works as-is.
- **Netlify / Cloudflare Pages / S3** — build command `npm run build`, publish
  directory `dist`.

---

## Scope

This is a demonstration of an interface and a set of ideas, published with
invented data. It is not the production system and is not intended to be run
against real data.
