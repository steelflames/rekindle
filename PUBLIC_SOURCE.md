# About this source-review edition

This is a sanitized copy of Rekindle 0.1.0, prepared for review of a personal, noncommercial Reddit integration. It contains the actual TypeScript application, React interface, local service, Firefox extension, build instructions, dependency lockfile and regression tests. It is not a mock integration or an assertion of Reddit approval.

## Deliberate differences from the personal working copy

- The initial roster and profiles are empty. Personal community mappings are replaced by fictional `Example*` mappings used by the synthetic tests.
- The demonstration discussion, parser-boundary cases and test roster are invented. They do not contain captured Reddit conversations, real subscription exports or the owner's reading history.
- Personal editorial defaults are replaced by newly written generic defaults. The inference implementation and its source-integrity system instructions are retained and inspectable.
- Resource loading uses `resources/` directly. The UI identifies the demonstration as synthetic and does not claim personal interests are preloaded.
- Tests use the synthetic resources and create their temporary directories explicitly. No private handoff folder is required.
- Private distribution/packaging scripts are omitted. The build remains `npm run build`; generated applications, browser profiles, screenshots, local databases and credentials are not source-release inputs.
- Public documentation and ignore rules are added. This repository has independent local history; no personal repository history is imported.

These changes sanitize inputs and documentation. They do not implement a new Reddit authorization policy or remove the existing optional AI feature.

## Relevant implementation paths

| Area | Source | What to inspect |
| --- | --- | --- |
| Reddit transport | `server/network.ts` | GET requests, host/path restrictions, access-token header, serial queue and 429 handling |
| Discovery and capture | `server/jobs.ts` | Community listing requests, cached candidates, selected-thread capture and local jobs |
| Reddit parsing | `server/sources.ts` | Listing/thread JSON and RSS parsing, captured fields, URL checks and text imports |
| Local service | `server/index.ts` | Loopback binding, sessions, extension capabilities, imports, save/export/delete routes |
| Persistence | `server/store.ts`, `server/secrets.ts` | SQLite state, restore behavior, Windows DPAPI and environment credentials |
| AI transfer | `server/inference.ts` | Actual outbound payload, providers, model calls and embedded system prompt |
| Source fidelity | `shared/integrity.ts` | Verbatim excerpt and captured-context validation |
| Firefox integration | `extension/` | Permissions, rendered-page extraction, local pairing and shared reader |
| Reader and prompts | `web/main.tsx`, `shared/seeds.ts` | Automatic/manual curation entry points and generic editable defaults |
| Synthetic verification | `tests/`, `resources/` | Mocked network tests, parser boundaries, state validation and fictional demonstration |

There are no embedded service credentials. Environment variable names and explicitly synthetic test-key literals are retained so credential-handling behavior can be reviewed. Never put real keys into fixture files, screenshots, commits or issue reports.

## Scope of the review copy

The public source demonstrates the existing integration and its limitations. The proposed permission would be read-only, public content, a maximum of 100 Reddit requests per day, and no transfer of Reddit user-generated content to AI services without separate authorization. Those conditions are not all enforced in this version. See `README.md` and `SECURITY.md` before enabling real retrieval or inference.

Synthetic tests establish reproducibility and selected behavior. They do not establish live Reddit access, Mozilla signing, provider privacy guarantees or compliance with an approval that has not yet been granted.
