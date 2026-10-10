# Security and privacy notes

This document describes the source-review edition. It is not a security certification or a claim that the proposed Reddit permission conditions are already enforced.

## Current safeguards

- The service listens on IPv4 loopback. It checks the HTTP Host and Origin, requires a local session or capability for protected routes, and limits extension pairing tokens to capture-related routes. Request and response sizes are bounded.
- Reddit transport uses explicit Reddit origins, rejects redirects and restricts request paths. Inference endpoints are restricted to the named HTTPS providers in `server/inference.ts` or two explicit loopback endpoints.
- Saved credentials are protected using Windows DPAPI CurrentUser. They are kept outside exported application state. Environment credentials are also supported. DPAPI does not protect against programs already running as the same Windows user.
- Source text is rendered through React. The inference system prompt treats source material as untrusted input. Accepted quotes and contextual relationships are checked against captured source data. These controls do not make model output factual or eliminate prompt-injection risk.
- Reddit requests are queued and spaced by at least three seconds. HTTP 429 responses start an in-memory cooldown. Inference records attempts and does not automatically retry a failed paid request.
- The demonstration starts with empty sources and profiles, an empty library and AI disabled. All bundled discussions and test rosters are synthetic.

## Data that may leave the computer

When the user enables and configures AI, the existing curation flow sends post title/body/community, sampled comment bodies and identifiers, capture limits and both editable editorial prompts to the selected inference endpoint. Opening a discussion can start that curation automatically. Separate source-author fields are not included, but bodies and prompts can contain personal information. OpenAI `store: false` is a request parameter, not a guarantee about all provider retention.

Reddit retrieval discloses requests and, when supplied, the access token to Reddit. Browser capture reads the selected page and sends it to the local service. Source images/videos may load from Reddit media hosts. Clicking an external article or discussion opens its destination. The outside-source search link sends up to 220 characters of the selected comment to Google Search on click. The application does not claim that every reading action is local-only.

## Important limitations

- There is no server-enforced authorization gate preventing Reddit-origin text from reaching inference. Default-off AI and a user's intended usage are not such a gate.
- There is no persistent 100-requests-per-day limit or full Reddit rate-header accounting. The process-local queue resets on restart.
- The AI setting named "Maximum calls per run" rejects zero but does not count a positive aggregate limit across repeated curation actions. Each invocation makes at most one request and active duplicate jobs are deduplicated; repeated actions can still incur further provider charges. It is not a durable spending cap.
- A full OAuth authorization/refresh flow, approved scopes and a verified public-content-only boundary remain to be implemented. Access-token input alone does not prove authorization or content visibility.
- Local SQLite state, inference usage metadata, exports and retained restore state are not encrypted by Rekindle. Avoid syncing or publishing them unintentionally.
- Deleting a snapshot does not necessarily remove its candidate record or every retained copy. Refreshing captures does not synchronize upstream edits/deletions. There is no retention deadline, automatic deletion reconciliation or secure erasure of SQLite pages, journal files, backups or provider copies.
- The extension has persistent permissions to read Reddit pages and contact loopback. Pair only with a local instance you trust. Development installation is temporary; this source copy is not a signed Mozilla release.
- The normal Windows launcher uses port 47831 and may open another Rekindle instance already running there. Use the separate-port demonstration instructions when comparing this copy with a personal installation.

## Before publishing changes

Review the exact Git tree and every reachable commit, including author/email metadata. Exclude runtime data, credentials, local environment files, personal prompts, private rosters, captured discussions, screenshots and browser profiles. Ignore rules can be bypassed and cannot redact existing commits. A clean history and content review are required if private material was ever committed.

Do not attach credentials, personal exports or real captured discussions to a public issue. Use a small synthetic reproduction with secret values removed. A private vulnerability-reporting channel has not been configured for this local review repository.
