#!/usr/bin/env node
/**
 * Node.js-specific utilities for collect-historic.js
 *
 * Provides Node.js-compatible versions of browser utilities from src/utils.js
 * and src/parentWorkflow.js
 */

import {
    GL_INITIAL_DATE,
    API_CONFIG,
    WORKFLOW_IDS,
    ALLOWED_ARTIFACT_NAMES,
} from "../src/constants.js";
import {
    calculateExpectedBranch,
    isBranchMatch,
    validateStage4RunCore,
} from "../src/utils.js";

/**
 * Get GitHub authentication headers for Node.js environment
 * Reads token from process.env.GITHUB_TOKEN instead of localStorage
 */
export function getAuthHeadersNode() {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        console.warn(
            "Warning: GITHUB_TOKEN not set. API calls may be rate-limited."
        );
        return {
            Accept: "application/vnd.github.v3+json",
            "X-GitHub-Api-Version": "2022-11-28",
        };
    }

    let authHeader;
    if (token.startsWith("ghp_")) {
        authHeader = `token ${token}`;
    } else if (token.startsWith("github_pat_")) {
        authHeader = `Bearer ${token}`;
    } else {
        authHeader = `token ${token}`;
    }

    return {
        Authorization: authHeader,
        Accept: "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28",
    };
}

/**
 * Calculate GL days from a Date object
 */
export function getGlDaysFromDate(date) {
    const initialDay = new Date(GL_INITIAL_DATE);
    const targetTime = date.getTime();
    const initialTime = initialDay.getTime();
    return Math.round((targetTime - initialTime) / (1000 * 60 * 60 * 24));
}

/**
 * Fetches workflow runs with pagination using GitHub's created date filter (Node.js version)
 * @param {Object} workflow - Workflow configuration object
 * @param {Date} targetDate - Target date to search for
 * @param {Date} nextDay - Day after target date (exclusive boundary)
 * @param {Function} fetchWithRetry - Function to fetch with retry logic
 * @param {Function} getAuthHeadersNode - Function to get auth headers
 * @returns {Promise<Array>} Array of all collected workflow runs
 */
export async function fetchWorkflowRunsPaginatedNode(
    workflow,
    targetDate,
    nextDay,
    fetchWithRetry,
    getAuthHeadersNode
) {
    const allRuns = [];
    const perPage = 100;

    // Format dates for GitHub API (YYYY-MM-DD format, UTC)
    // GitHub's date range is inclusive on both ends
    // To get runs from targetDate (inclusive) to nextDay (exclusive):
    // - fromDate: targetDate (inclusive start)
    // - toDate: nextDay - 1 day (inclusive end, covers the full day of targetDate)
    const fromDate = targetDate.toISOString().split("T")[0];
    const nextDayStr = nextDay.toISOString().split("T")[0];

    // Use nextDay as the end date (inclusive), which effectively makes it exclusive
    // because we filter client-side with < nextDay
    const createdParam = `created=${fromDate}..${nextDayStr}`;

    // Use repository-level endpoint which supports 'created' parameter
    // Then filter by workflow_id client-side
    // According to GitHub API docs, workflow-specific endpoint may not support 'created'
    try {
        // Fetch first page to get total_count using repository-level endpoint
        const firstPageUrl = `${API_CONFIG.GITHUB_API_BASE}/repos/${API_CONFIG.GARDENLINUX_ORG}/${workflow.repo}/actions/runs?per_page=${perPage}&page=1&${createdParam}`;

        const firstResponse = await fetchWithRetry(firstPageUrl, {
            headers: getAuthHeadersNode(),
        });

        if (!firstResponse.ok) {
            console.warn(
                `      ⚠️  [Pagination] Failed to fetch workflow runs for ${workflow.name}: ${firstResponse.status}`
            );
            return [];
        }

        const firstData = await firstResponse.json();
        const firstPageRuns = firstData.workflow_runs || [];

        // Filter by workflow_id and date
        const filteredRuns = firstPageRuns.filter((run) => {
            // Match workflow by workflow_id (can be string or number)
            const runWorkflowId = run.workflow_id?.toString();
            const targetWorkflowId = workflow.id.toString();
            if (runWorkflowId !== targetWorkflowId) return false;

            // Filter by date
            if (!run.created_at) return false;
            const runDate = new Date(run.created_at);
            return runDate >= targetDate && runDate < nextDay;
        });

        allRuns.push(...filteredRuns);

        const totalCount = firstData.total_count || 0;
        const maxResults = 1000; // GitHub API limit for filtered results
        const maxPages = Math.min(
            Math.ceil(totalCount / perPage),
            Math.ceil(maxResults / perPage)
        ); // Cap at 10 pages (1000 results)

        // Warn if results may be truncated
        if (totalCount >= maxResults) {
            console.warn(
                `      ⚠️  [Pagination] ${workflow.name}: Found ${totalCount} runs in date range (API limit: ${maxResults}). Results may be truncated.`
            );
        }

        // Fetch remaining pages if needed
        for (let page = 2; page <= maxPages; page++) {
            const pageUrl = `${API_CONFIG.GITHUB_API_BASE}/repos/${API_CONFIG.GARDENLINUX_ORG}/${workflow.repo}/actions/runs?per_page=${perPage}&page=${page}&${createdParam}`;

            const pageResponse = await fetchWithRetry(pageUrl, {
                headers: getAuthHeadersNode(),
            });

            if (!pageResponse.ok) {
                console.warn(
                    `      ⚠️  [Pagination] Failed to fetch page ${page} for ${workflow.name}: ${pageResponse.status}`
                );
                break;
            }

            const pageData = await pageResponse.json();
            const pageRuns = pageData.workflow_runs || [];

            if (pageRuns.length === 0) {
                break;
            }

            // Filter by workflow_id and date
            const pageFilteredRuns = pageRuns.filter((run) => {
                const runWorkflowId = run.workflow_id?.toString();
                const targetWorkflowId = workflow.id.toString();
                if (runWorkflowId !== targetWorkflowId) return false;

                if (!run.created_at) return false;
                const runDate = new Date(run.created_at);
                return runDate >= targetDate && runDate < nextDay;
            });

            allRuns.push(...pageFilteredRuns);
        }

        const pagesFetched = Math.min(
            maxPages,
            Math.ceil(totalCount / perPage)
        );
        console.log(
            `      📄 [Pagination] ${workflow.name}: Fetched ${pagesFetched} page${pagesFetched !== 1 ? "s" : ""} (${allRuns.length} runs for workflow ${workflow.id} in date range ${fromDate}..${nextDayStr})`
        );

        return allRuns;
    } catch (error) {
        console.warn(
            `      ⚠️  [Pagination] Error fetching workflow runs for ${workflow.name}:`,
            error.message
        );
        return [];
    }
}

/**
 * Collect Stage 3 run IDs for a specific GL date (Node.js version)
 * Uses fetchWithRetry for rate limit handling
 */
export async function collectStage3RunIdsNode(
    stage3Workflows,
    targetDate,
    nextDay,
    glDays,
    fetchWithRetry,
    getAuthHeadersNode
) {
    const stage3RunIds = new Set();

    for (const workflow of stage3Workflows) {
        try {
            console.log(
                `      🔍 Fetching Stage 3 runs for ${workflow.name}...`
            );
            // Use pagination to fetch all runs
            const runs = await fetchWorkflowRunsPaginatedNode(
                workflow,
                targetDate,
                nextDay,
                fetchWithRetry,
                getAuthHeadersNode
            );

            // Runs are already filtered by date in fetchWorkflowRunsPaginatedNode
            const dayRuns = runs;

            console.log(
                `      📊 Found ${dayRuns.length} Stage 3 runs for ${workflow.name} in date range`
            );

            for (const run of dayRuns) {
                stage3RunIds.add(String(run.id));
            }
        } catch (error) {
            console.warn(
                `      ⚠️  Error collecting Stage 3 runs for ${workflow.name}:`,
                error.message
            );
        }
    }

    return stage3RunIds;
}

/**
 * Get parent workflow info (Node.js version)
 * Simplified version that checks run event instead of downloading artifacts
 */
export async function getParentWorkflowInfoNode(
    owner,
    repo,
    runId,
    fetchWithRetry,
    getAuthHeadersNode
) {
    try {
        const url = `${API_CONFIG.GITHUB_API_BASE}/repos/${owner}/${repo}/actions/runs/${runId}`;
        const response = await fetchWithRetry(url, {
            headers: getAuthHeadersNode(),
        });

        if (!response.ok) {
            return null;
        }

        const run = await response.json();

        // Check for parent workflow run ID in workflow_run event
        return {
            parentRunId:
                run.event === "workflow_run" ? run.workflow_run?.id : null,
        };
    } catch (error) {
        return null;
    }
}

/**
 * Validate Stage 4 runs (Node.js version)
 */
export async function validateStage4RunsNode(
    runs,
    targetDate,
    nextDay,
    extendedNextDay,
    stage3RunIds,
    workflow,
    fetchWithRetry,
    getAuthHeadersNode,
    glDays
) {
    // Calculate expected branch using shared utility
    const expectedBranch = calculateExpectedBranch(workflow, glDays);

    const validRuns = [];

    for (const run of runs) {
        // Filter by branch first using shared utility
        const runBranch = run.head_branch || "main";
        const isCorrectBranch = isBranchMatch(
            runBranch,
            expectedBranch,
            workflow,
            glDays
        );

        if (!isCorrectBranch) {
            console.log(
                `      [Branch Filter] GL${glDays} - ${workflow.name} (${workflow.id}) - Run ${run.id}: Excluded (branch "${runBranch}" doesn't match expected branch)`
            );
            continue;
        }

        // Use shared core validation logic (no logging for Node.js version)
        const getParentInfoFn = async () => {
            return await getParentWorkflowInfoNode(
                API_CONFIG.GARDENLINUX_ORG,
                workflow.repo,
                run.id,
                fetchWithRetry,
                getAuthHeadersNode
            );
        };

        const isValid = await validateStage4RunCore(
            run,
            targetDate,
            nextDay,
            extendedNextDay,
            stage3RunIds,
            getParentInfoFn,
            null // No logging for Node.js version
        );

        if (isValid) {
            validRuns.push(run);
        }
    }

    return validRuns.sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );
}

/**
 * Process workflow runs (Node.js version)
 */
export async function processWorkflowRunsNode(
    workflow,
    runs,
    targetDate,
    nextDay,
    extendedNextDay,
    stage3RunIds,
    glDays,
    fetchWithRetry,
    getAuthHeadersNode
) {
    const isStage4Workflow = workflow.stage === "stage-4";

    // Calculate expected branch using shared utility
    const expectedBranch = calculateExpectedBranch(workflow, glDays);

    let targetRuns = [];
    if (isStage4Workflow) {
        targetRuns = await validateStage4RunsNode(
            runs,
            targetDate,
            nextDay,
            extendedNextDay,
            stage3RunIds,
            workflow,
            fetchWithRetry,
            getAuthHeadersNode,
            glDays
        );
    } else {
        targetRuns = runs.filter((run) => {
            const runDate = new Date(run.created_at);
            const isInDateRange = runDate >= targetDate && runDate < nextDay;

            // Filter by branch using shared utility
            const runBranch = run.head_branch || "main";
            const isCorrectBranch = isBranchMatch(
                runBranch,
                expectedBranch,
                workflow,
                glDays
            );

            if (!isCorrectBranch && isInDateRange) {
                console.log(
                    `      [Branch Filter] GL${glDays} - ${workflow.name} (${workflow.id}) - Run ${run.id}: Excluded (branch "${runBranch}" doesn't match expected branch)`
                );
            }

            return isInDateRange && isCorrectBranch;
        });
    }

    if (targetRuns.length === 0) {
        return { status: "unknown", runData: null, allRuns: [] };
    }

    const sortedRuns = targetRuns.sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );
    const mostRecentRun = sortedRuns[0];

    let status = "unknown";
    if (
        mostRecentRun.status === "in_progress" ||
        mostRecentRun.status === "queued"
    ) {
        status = "progress";
    } else if (mostRecentRun.status === "completed") {
        status = mostRecentRun.conclusion === "success" ? "success" : "failure";
    }

    return { status, runData: mostRecentRun, allRuns: sortedRuns };
}
