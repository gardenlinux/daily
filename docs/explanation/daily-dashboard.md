---
title: "Daily Dashboard"
description: "How the Garden Linux Daily Dashboard monitors the build and release pipeline, and how it collects data from GitHub Actions."
order: 160
github_org: gardenlinux
github_repo: daily
github_source_path: docs/explanation/daily-dashboard.md
github_target_path: docs/explanation/daily-dashboard.md
related_topics:
    - /explanation/daily-dashboard
    - /explanation/github-workflows
    - /how-to/daily-dashboard
    - /reference/supporting_tools/daily-dashboard
    - /reference/releases/release-lifecycle
---

# Garden Linux Daily Dashboard

The [Garden Linux Daily Dashboard](https://gardenlinux.github.io/daily/) is a static, browser-based monitoring page for the Garden Linux (GL) build and release pipeline. It displays the real-time health of each pipeline stage and shows historical data for past GL days.

## Pipeline stages

The dashboard monitors four pipeline stages and two auxiliary workflows:

| Stage                            | Repository                                     | Workflows                                   |
| -------------------------------- | ---------------------------------------------- | ------------------------------------------- |
| Stage 1 – Package Builds         | All non-archived `gardenlinux/package-*` repos | `build.yml` on `main` or `master`           |
| Stage 2 – Repository             | `gardenlinux/repo`                             | `build.yml`, `update.yml`                   |
| Stage 3 – Build & Release Images | `gardenlinux/gardenlinux`                      | `nightly.yml` (daily), `manual_release.yml` |
| Auxiliary – Cloud Test Cleanup   | `gardenlinux/gardenlinux`                      | `cloud_test_cleanup.yml`                    |
| Auxiliary – Debian Snapshot      | `gardenlinux/repo-debian-snapshot`             | `snapshot.yml`                              |

Stage 4 only applies to GL versions below 2174. From GL 2174 onwards (schema v2), the dashboard suppresses Stage 4 entirely.

### Deprecations

<details>

| Stage                    | Repository                | Workflows                       |
| ------------------------ | ------------------------- | ------------------------------- |
| Stage 4 – Publish Images | `gardenlinux/gardenlinux` | `publish.yml`, `publish_s3.yml` |

::: info
Stage 4 only applies to GL versions below 2174. From GL 2174 onwards (schema v2), the dashboard suppresses Stage 4 entirely.
:::

</details>

## Data sources

The dashboard combines three data sources.

### Package states (Stage 1)

A Go binary (`package-aggregator/main.go`) runs nightly at 03:00 UTC via the `aggregate_package_states.yml` workflow. It scans every non-archived, non-excluded `gardenlinux/package-*` repository, checks the most recent `build.yml` run on `main` or `master`, and writes the result to `packages/{glDays}.json` on the `packages` branch.

The dashboard fetches this file at build time. The Stage 1 table shows only packages with a non-`success` status. An empty table means all packages are healthy.

### Historic release archive (Stages 2–3)

`scripts/collect-historic.js` runs nightly at 05:00 UTC via the `archive_historic_releases.yml` workflow. It queries the GitHub API for the last 14 GL days and writes per-day pipeline summaries to `historic/{glDays}.json` on the `historic-releases` branch.

For past GL days the dashboard reads these pre-built cache files. It falls back to live GitHub API calls only when the cache is absent for a given day.

### Live GitHub API (current day)

For the current GL day the browser fetches workflow run data directly from the GitHub API at page load time. Unauthenticated requests are subject to a rate limit of 60 requests per hour. You can raise this limit by storing a personal access token in the dashboard settings (see [View the dashboard and re-run workflows](/how-to/daily-dashboard)).

## Branch data model

| Branch              | Content                                                           |
| ------------------- | ----------------------------------------------------------------- |
| `packages`          | `packages/{glDays}.json` — package build states per GL day        |
| `historic-releases` | `historic/{glDays}.json` — full pipeline summary cache per GL day |
| `gh-pages`          | Static dashboard site (`index.html`, `style.css`, `dist/`)        |

## Schema versions

| Condition | Schema | Stage 4    |
| --------- | ------ | ---------- |
| GL < 2174 | v1     | Present    |
| GL ≥ 2174 | v2     | Suppressed |

The schema version affects which workflow IDs the dashboard expects and how it calculates pipeline durations.

## Related Topics

<RelatedTopics />
