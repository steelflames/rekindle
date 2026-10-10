# Rekindle

**Restore the magic.**

Rekindle is a personal, noncommercial reading application for public Reddit discussions and the articles they link to. It is a local Windows application with a browser interface and a Firefox companion extension. Its purpose is to make a small, varied reading list and make it easy to return to the original discussion.

This is a working local prototype. Reddit API approval has not been established by this repository. The proposed initial integration is limited to read-only access, with a target maximum of 100 Reddit requests per day and no transfer of Reddit user-generated content to AI services without separate authorization. Those restrictions require implementation work described below.

## What the application currently does

- Collects a bounded selection of posts from user-selected communities and ranks them with local, editable rules. Re-selecting cached candidates does not fetch a new feed.
- Opens captured post content and available comments, with source links and capture-coverage notes. A Firefox extension can capture the selected discussion from its rendered page.
- Saves post records and selected comments to local collections, with search and reading-position persistence.
- Retains both an external article URL and a Reddit discussion permalink when the source supplies them. Saving a linked post is currently a bookmark to that article and discussion, not an offline copy of the article text.
- Offers optional AI comment curation, with generated interpretation kept separate from captured text and accepted excerpts checked against that text.

Rekindle does not post, vote, comment, moderate, or change Reddit subscriptions. Local saves are not Reddit account saves. The current application accepts an existing Reddit access token; it does not implement a complete OAuth authorization or token-refresh flow.

## Reddit data and access

The current token-authenticated code uses `https://oauth.reddit.com` for community `new` and `top` listings and selected thread JSON. The implemented request shapes are:

```text
GET /r/{community}/new?limit={bounded_count}
GET /r/{community}/top?limit={bounded_count}&t=year
GET /r/{community}/comments/{post_id}/{slug}.json?limit=100&depth=8&sort=new
```

Captured post data can include the post identifier, title, self-text, community, author, discussion permalink, destination URL, timestamp, score, comment count, flair, NSFW/spoiler flags and media URLs. Comment captures can include identifiers, parent relationships, text, author, permalink, timestamp, score and flair. Missing source fields remain unknown. Public RSS and explicit Firefox capture are also supported by the current prototype; approval and permitted acquisition methods must be settled before approved API operation.

Public-only access is the intended scope, not yet an enforced content-visibility check. Current validation checks Reddit hosts and discussion paths. A supplied token or an already-open browser page could expose nonpublic content, so the approved integration needs an explicit public-content boundary.

## AI behavior and the proposed permission boundary

When AI curation is enabled and configured, opening a captured discussion with comments can automatically submit it for curation. The request includes the post title, up to 12,000 characters of post body, community name, sampled comment bodies and their identifiers/parent identifiers, capture-coverage information, and the reader's editorial instructions. Separate author fields, vote totals and source URLs are not added to this payload, although the source text itself can contain identifying information or links.

The implementation calls OpenAI's Responses API or an allowlisted OpenAI-compatible endpoint. It has no dedicated Gemini client. A compatible provider can route the configured model, so the model/provider configuration matters. The OpenAI request sets `store: false`; this is not a claim of zero provider retention or permission to transfer Reddit content.

For the initial Reddit permission request, a proposed server-enforced mode must block Reddit-origin content from every inference entry point, including imported and extension-captured copies. The existing AI toggle and default-off setting do not establish that authorization boundary. No existing feature has been silently disabled for this application.

## Local data and current safeguards

The service binds to `127.0.0.1`, checks the local host and request origin, uses local sessions, and scopes extension access. Stored credentials use Windows DPAPI for the current Windows user. The local SQLite library is not encrypted by Rekindle; exported backups contain reading data and captured source text, but exclude stored credentials.

Source media may load from external hosts. Clicking an article or original-discussion link opens that destination. The optional outside-source search sends the first 220 characters of a comment to Google Search when clicked. That is a separate external disclosure, not an automatic AI API call; the application does not claim that all source text stays local.

Reddit requests are serialized, spaced at least three seconds apart, and paused after HTTP 429 responses. Captures are cached locally until removed through the available controls. Cache clearing can retain saved captures; refreshing creates a new capture and does not automatically purge older copies. Manual snapshot and library deletion exist, but automatic synchronization of Reddit edits/deletions and a retention deadline are not implemented. Rekindle does not claim that deleting a record securely erases SQLite storage or external backups.

Before operating under the proposed permission, implement and test a persistent maximum of 100 Reddit requests per day, Reddit rate-header handling, approved OAuth and public-only access, the server-side no-AI restriction, and a deletion/retention policy that covers cached records, derived content and retained backups. These are proposed safeguards, not current guarantees.

## Run the synthetic demonstration

Requirements: Node.js 24 or later and npm. Windows is required to save credentials with DPAPI. No Reddit token or AI key is needed to build, run or try the synthetic discussion.

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm start
```

Open `http://127.0.0.1:47831` and choose the synthetic sample discussion. The initial community roster, profiles and reading library are empty; AI is off and no model is selected. `resources/sample-thread.txt` is invented demonstration text. The source roster in `tests/fixtures/seeds.json` is also fictional and is used only by tests. Tests use synthetic keys and mocked Reddit/inference responses; they do not need service credentials.

If another Rekindle instance already uses port 47831, run the demonstration on a separate port and data directory instead of using the Windows launcher:

```powershell
$env:REKINDLE_PORT = '47835'
$env:REKINDLE_DATA_DIR = Join-Path $PWD 'data/public-demo'
Remove-Item Env:REKINDLE_AI_KEY, Env:OPENAI_API_KEY, Env:REKINDLE_REDDIT_TOKEN -ErrorAction SilentlyContinue
npm start
```

Then open `http://127.0.0.1:47835`. These environment changes affect the current shell and its children. The Firefox extension expects port 47831; use the browser interface for this alternate-port demonstration. `Setup-Rekindle.cmd` installs and builds, then opens the normal Windows launcher. A launcher on the default port can open an already-running instance.

Build output is written to `dist/`. For temporary Firefox development installation, open `about:debugging`, choose **This Firefox**, choose **Load Temporary Add-on**, and select `dist/extension/manifest.json`. Pairing and capturing a real discussion are separate opt-in actions and are not needed for the synthetic demonstration.

## Source layout and development

`web/` contains the React interface; `server/` contains the local Node service, storage, retrieval and inference; `shared/` contains schemas and local ranking; `extension/` contains the Firefox integration; and `tests/` contains regression checks.

This source-review edition contains the real application and integration, with generic editorial defaults, an empty initial roster and synthetic test material. It omits private libraries, credentials, personal source rosters, captured discussions, screenshots, browser profiles and prior handoff material. Runtime data, generated builds and installed dependencies are ignored by Git. Ignore rules are an aid, not a substitute for reviewing every published file.

See [PUBLIC_SOURCE.md](PUBLIC_SOURCE.md) for the sanitization scope and the code paths a reviewer can inspect, and [SECURITY.md](SECURITY.md) for the current privacy and security limitations. There is no project-wide open-source license grant in this review copy. Dependency licenses remain applicable; the owner can select a project license before publication.

The extension is a development build. Permanent Firefox installation requires Mozilla signing. Third-party notices are provided in `THIRD-PARTY-NOTICES.txt`.
