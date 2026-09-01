# Signal AI Digest

Signal is a static web app backed by an incremental weekly data pipeline. It collects selected X accounts through Apify, reconstructs available thread context, preserves quote and media metadata, asks Gemini for a source-cited weekly digest, and commits generated JSON. Vercel deploys each commit.

No application server or database is required.

## Product views

- `index.html` and its `latest.html` alias show the 300 newest AI posts with media, quotes, context links, filters, bookmarks, and read markers.
- `topics.html` contains nine topic digests and their supporting posts.
- `weekly.html` contains weekly editorial digests.
- `thread.html?id=<conversation-id>` reconstructs available tracked-account context.
- `search.html` searches monthly archive shards across the full corpus.

Bookmarks, read state, and saved searches use browser `localStorage`.

## Update schedule

`.github/workflows/update-feed.yml` runs every Monday at 08:30 Asia/Kolkata. GitHub's Actions page also exposes a manual **Run workflow** button.

The job:

1. Requests only the overlap window since the previous successful collection.
2. Merges posts by immutable X post ID.
3. Preserves replies, quotes, media, links, and conversation IDs.
4. Classifies high-confidence AI posts.
5. Rebuilds the latest feed, thread index, topics, weekly digests, archive shards, and manifest.
6. Uses Gemini to rewrite the latest weekly digest from supplied source posts.
7. Rejects invalid editorial source IDs.
8. Runs unit, integrity, and static smoke tests.
9. Commits generated data to `main`, which triggers Vercel.

A failed run does not commit partial output. The workflow opens a GitHub issue linking to its logs.

## Required repository secrets

Add these in **Settings → Secrets and variables → Actions**:

- `APIFY_TOKEN`
- `GEMINI_API_KEY`

The pipeline defaults to `gemini-3.6-flash`. Override `GEMINI_MODEL` in the workflow if the free model changes.

Do not put API keys in `.env` files committed to Git.

## Cost controls

`config/accounts.json` and `scripts/pipeline.py` enforce:

- At most 2,500 Apify results per run.
- At most $0.50 in Apify charges per run.
- A two-day overlap to recover late-indexed posts without repeatedly scraping the full archive.
- One Gemini synthesis for the newest week rather than regenerating every historical digest.

These values are intended to remain within free monthly allowances. Free plans can change, so inspect the Actions run report and Apify usage page periodically.

## Local development

```bash
python3 -m http.server 4173
```

Open <http://127.0.0.1:4173/latest.html>.

## Pipeline commands

```bash
# Rebuild static data without network calls
python3 scripts/pipeline.py build

# Validate IDs, counts, citations, and archive shards
python3 scripts/pipeline.py validate

# Run unit tests
python3 -m unittest discover -s tests -v

# Collect and publish locally. Requires both environment variables.
APIFY_TOKEN=... GEMINI_API_KEY=... python3 scripts/pipeline.py update
```

The one-time historical import used:

```bash
python3 scripts/pipeline.py bootstrap --raw-dir ../raw
```

Canonical source records live in monthly gzip files under `source-data/`. Browser-facing archive shards live under `data/archive/`.

## Recovery

If a scheduled run fails:

1. Open the GitHub issue created by the workflow.
2. Inspect the linked Actions log.
3. Fix authentication, model availability, actor output, or validation failures.
4. Rerun the workflow manually.

Because state advances only after a successful build, the next run repeats the overlap window and recovers missed posts.
