# Public release manifest

## Provenance

- Source commit: `075315230b72709e5e0d86fbdea3d36ff091a628`
- Snapshot date: 2026-08-10
- History model: orphan commit with no source-history parent
- Existing public asset source: `fe51e6d10760f037e5a2685e190545355de88345`

The source commit itself is not published because its reachable Git history contains material outside the public-release authorization. This manifest binds the snapshot to that exact source commit without exposing its ancestors.

## Included allowlist

- application source: `app/`, `components/`, `lib/`;
- schema and migrations: `drizzle/`;
- source tools and tests: `scripts/`, `tools/`, `tests/`;
- pinned third-party notices and licenses: `third_party/`;
- project configuration and lockfiles required to review the source;
- `public/` assets already present on the repository's public default branch.

## Excluded

- all `data/` content, including course originals, derived corpora, runtime indexes, evaluation outputs, and local databases;
- all source-tree `docs/`, reports, pilot artifacts, screenshots, OCR output, and internal handoff files;
- user attachments, private media, office documents, archives, logs, caches, build outputs, dependencies, local agent configuration, and environment secrets;
- generated retrieval-quality results and an unverified binary test fixture.

## Validation boundary

The snapshot is intended for source review. It is not asserted to be a deployable production mirror because excluded private data and documentation are intentionally absent. No deployment, production mutation, or real-account access was performed while creating it.
