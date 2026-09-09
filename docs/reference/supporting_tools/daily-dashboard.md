---
title: "Daily Dashboard"
description: "Automation workflows, package status values, excluded repositories, and version constants for the Garden Linux Daily Dashboard."
github_org: gardenlinux
github_repo: daily
github_source_path: docs/reference/supporting_tools/daily-dashboard.md
github_target_path: docs/reference/supporting_tools/daily-dashboard.md
related_topics:
    - /explanation/daily-dashboard
    - /explanation/github-workflows
    - /how-to/daily-dashboard
    - /reference/supporting_tools/daily-dashboard
    - /reference/releases/release-lifecycle
---

# Daily Dashboard Reference

## Automation workflows

| Workflow                        | Schedule                                                                        | Purpose                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `aggregate_package_states.yml`  | Daily 03:00 UTC                                                                 | Runs `cronjob.sh`; writes `packages/{glDays}.json` to the `packages` branch                                             |
| `archive_historic_releases.yml` | Daily 05:00 UTC                                                                 | Runs `collect-historic.js --days 14 --start-from-yesterday`; writes `historic/*.json` to the `historic-releases` branch |
| `build.yml`                     | After `aggregate_package_states.yml` succeeds; push to `gh-pages` or `packages` | Builds the JavaScript bundle; fetches branch data; deploys to GitHub Pages                                              |
| `test.yml`                      | All pushes and pull requests                                                    | Runs ESLint and Prettier checks                                                                                         |

## Package status values

The Go binary in `package-aggregator/` assigns one of the following status values to each `gardenlinux/package-*` repository.

:::info
Workflow status is only reported for `main` and `master` branches. As these are used to build packages for nightly releases.
:::

| Status             | Meaning                                                        |
| ------------------ | -------------------------------------------------------------- |
| `success`          | Last `build.yml` run succeeded and is not stale                |
| `failure`          | Last run failed                                                |
| `progress`         | A run is currently in progress                                 |
| `stale`            | Last successful run is older than 24 hours                     |
| `noRunFound`       | No workflow runs found for the repository                      |
| `workFlowNotFound` | The `build.yml` workflow file does not exist in the repository |
| `brokenTimestamp`  | Run timestamp could not be parsed                              |

The dashboard shows only packages with a problematic status (`failure`, `progress`, `stale`, `noRunFound`, `workFlowNotFound`, `brokenTimestamp`). `success` is not displayed; an empty Stage 1 table means all packages are healthy.

## Related Topics

<RelatedTopics />
