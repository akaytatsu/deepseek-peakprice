# DeepSeek Peak Price

A simple static site that shows whether the **DeepSeek API** is currently charging
**Peak Hour** or **Off-Peak** rates — converted to **your browser's timezone**.

Live site: <https://akaytatsu.github.io/deepseek-peakprice/>

## How it works

| Step | What happens |
| --- | --- |
| **Build time** | `scripts/fetch-pricing.mjs` fetches the [DeepSeek pricing page](https://api-docs.deepseek.com/quick_start/pricing/), extracts the peak windows and the off-peak/peak prices per model, and writes them to `src/data/pricing.json` (committed). Runs automatically before `npm run dev` and `npm run build` (`predev` / `prebuild` hooks). |
| **Runtime** | The app checks the current UTC time against the peak windows and renders the result in the user's timezone via the `Intl` API — no backend, no network calls. |

The pricing data is committed to the repository, so the site always works, even
if the DeepSeek page is unreachable during a build (the fetch falls back to the
existing data with a warning). In CI (`STRICT=1`), a fetch/parse failure fails
the build loudly.

## Local development

With Docker:

```sh
make up        # build + start the dev server (http://localhost:5173/deepseek-peakprice/)
make stop      # stop the dev environment
make restart   # restart the dev environment
make logs      # follow the dev server logs
```

Without Docker (needs Node ≥ 18.17):

```sh
npm install
npm run dev    # http://localhost:5173/deepseek-peakprice/
```

## Regenerating the pricing data

```sh
npm run fetch:pricing                         # fetch from the live page
STRICT=1 npm run fetch:pricing                # fail instead of falling back
PRICING_URL=file:///path/to/saved.html npm run fetch:pricing   # test against a saved copy
```

## Deployment

The [GitHub Actions workflow](.github/workflows/deploy.yml) builds the project
and publishes it to GitHub Pages on every push to `main`.

One-time repository setup:

1. Repo **Settings → Pages → Source → GitHub Actions** (required for the
   artifact-based deployment).
2. The repository must be **public** for GitHub Pages.

The site is served at `https://<org>.github.io/deepseek-peakprice/`.

## Data freshness

The prices and peak windows are refreshed on every build (and on every `make up`
/ `npm run dev`). The footer of the page shows when the bundled data was fetched.
