---
title: "Daily Dashboard"
description: "How to view the Garden Linux Daily Dashboard and how to re-run automation workflows to refresh stale or missing pipeline data."
order: 10
github_org: gardenlinux
github_repo: daily
github_source_path: docs/how-to/daily-dashboard.md
github_target_path: docs/how-to/daily-dashboard.md
related_topics:
    - /explanation/daily-dashboard
    - /explanation/github-workflows
    - /how-to/daily-dashboard
    - /reference/supporting_tools/daily-dashboard
    - /reference/releases/release-lifecycle
---

# Use the Daily Dashboard

## View the dashboard

1. Open <https://gardenlinux.github.io/daily/> in a browser. The dashboard displays the current Garden Linux (GL) day by default.
2. To view a historic day, append `?gl=<number>` to the URL. For example: `https://gardenlinux.github.io/daily/?gl=2353`. You can also use the settings menu to select a day.
3. To avoid the GitHub API rate limit of 60 unauthenticated requests per hour, click the settings icon in the dashboard header, enter a Classic (`ghp_`) or Fine-grained (`github_pat_`) personal access token, and save. The token is stored only in your browser's `localStorage` and is never sent to any server other than `api.github.com`.
4. Read the stage status indicators and the status legend to get an idea which stages succeeded or have issues.

![A screenshot of the dashboard page for version 2347. The nightly release processed without issues and all three boxes (current daily release, current daily release details and release monitoring) arranged from top to bottom are green. The current daily release stage is unfolded showing a box which says "All packages are OK 6h 19m release successful."](./assets/daily-dashboard-1.png)

::: details
![A screenshot of the dashboard page for version 2347. The daily release processed without issues and all three boxes (current daily release, current daily release details and release monitoring) arranged from top to bottom are green. All three stages are unfolded. Focus is set to the daily release details box which shows the three stages from top to bottom stage 3 "Build & Release Image" which is green without the rebuild-on-error step triggered, stage 2 "Repo" which itself is split into repo build and repo update which are green with no issues and lastly stage 1 "Package Builds" green with the message "No Packages need attention. Continue doing awesome work."](./assets/daily-dashboard-2.png)
:::

The [nightly workflow](/explanation/github-workflows#nightly-yml) has to be successful to create a valid [nightly release](/reference/releases/release-lifecycle#nightly-releases). Such a "nightly" is a usual Garden Linux release but constructed from the latest Debian Testing upstream packages and the latest Garden Linux self-published packages. Have a look at [Release Hierarchy](/explanation/release-hierarchy) and related docs to get an idea how this all plays together.

## Re-run workflows to refresh stale or missing data

When the dashboard shows stale or missing data for a GL day, re-run the workflows in the order below.

### 1. Re-collect historic release data

Perform this step if pipeline summary data for past GL days is missing or stale.

#### GitHub UI

1. Go to the [archive_historic_releases.yml actions page](https://github.com/gardenlinux/daily/actions/workflows/archive_historic_releases.yml).
2. Click **Run workflow**, select branch `gh-pages`, then click **Run workflow**.

#### GitHub CLI

```bash
gh workflow run "Archive Historic Releases" \
  --repo gardenlinux/daily \
  --ref gh-pages
```

::: info
Wait for the run to complete (approximately 1 minutes). Updated `historic/*.json` files for the last 14 GL days are committed to the `historic-releases` branch.
:::

### 2. Re-collect package states

Perform this step if Stage 1 data is missing or stale for the current day.

#### GitHub UI

1. Go to the [aggregate_package_states.yml actions page](https://github.com/gardenlinux/daily/actions/workflows/aggregate_package_states.yml).
2. Click **Run workflow**, select branch `gh-pages`, then click **Run workflow**.

#### GitHub CLI

```bash
gh workflow run "aggregate_package_states.yml" \
  --repo gardenlinux/daily \
  --ref gh-pages
```

::: info
Wait for the run to complete (approximately 3 minutes). A fresh `packages/{glDays}.json` file is committed to the `packages` branch.
:::

### 3. Rebuild and redeploy the dashboard

Perform this step to make updated data visible on the live site after completing steps 1 or 2 above.

:::info
`build.yml` runs automatically after a successful `aggregate_package_states.yml` run. Step 3 is only required when you ran steps 1 or 2 in isolation, or when the automatic trigger did not fire.
:::

#### GitHub UI

1. Go to the [build.yml actions page](https://github.com/gardenlinux/daily/actions/workflows/build.yml).
2. Click **Run workflow**, select branch `gh-pages`, then click **Run workflow**.

#### GitHub CLI

```bash
gh workflow run " Build and Deploy Dashboard" \
  --repo gardenlinux/daily \
  --ref gh-pages
```

:::info
Wait for the deploy job to complete. The live dashboard at <https://gardenlinux.github.io/daily/> reflects the updated data.
:::

## Related Topics

<RelatedTopics />
