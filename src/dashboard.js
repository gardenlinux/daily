/**
 * ========================================
 * GARDEN LINUX DASHBOARD - CORE PIPELINE ENGINE
 * ========================================
 *
 * Main dashboard logic engine containing the core functionality:
 * - GitHub API workflow data fetching and processing
 * - Multi-stage pipeline status evaluation and hierarchy management
 * - Package build status monitoring and table population
 * - Stage 3/4 workflow parent-child relationship tracking
 * - Historic releases data loading and processing
 * - Pipeline color coding and status aggregation
 * - Workflow run filtering by date ranges and parent relationships
 * - Global state management for workflow and package statuses
 * - Real-time pipeline status updates and UI synchronization
 *
 * The heart of the dashboard that orchestrates all data collection and processing.
 */

import {
    getAuthHeaders,
    isHistoricView,
    getGlDays,
    formatGLDate,
    formatDetailedDate,
    shouldLoadHistoricReleases,
    setElementStatus,
    getBranchParameter,
    calculateTargetDate,
    calculateHistoricPipelineDuration,
    collectStage3RunIds,
    getAllWorkflowConfigs,
    calculateStageStatuses,
    calculatePipelineStatus,
    processWorkflowRuns,
    getRepoBranchParameter,
    triggerPackageAggregatorWorkflow,
    unstalePackageRepository,
} from "./utils.js";

import {
    GL_INITIAL_DATE,
    WORKFLOWS,
    WORKFLOW_IDS,
    STAGE_WORKFLOWS,
    EXPECTED_WORKFLOW_IDS,
    API_CONFIG,
    PACKAGE_STATUSES,
    UI_CONFIG,
} from "./constants.js";

import {
    renderHistoricReleases,
    updateCurrentReleaseHeaderColors,
    updateCurrentReleaseSummary,
    updateStageColor,
    updatePipelineColor,
    createRunItemHTML,
    updateHeaderColor,
    getRunStatus,
} from "./ui.js";

import { getParentWorkflowInfo } from "./parentWorkflow.js";

// ========================================
// GLOBAL STATE MANAGEMENT
// ========================================
// Global state for tracking workflow and package status
let workflowStatuses = {};
let workflowRunData = {};
let packageStatus = "unknown";

// ========================================
// WORKFLOW MONITORING WRAPPER STATUS
// ========================================
function updateWorkflowMonitoringHeader() {
    const wrapperHeader = document.getElementById("workflow-monitoring-header");
    const wrapperContainer = document.getElementById(
        "workflow-monitoring-content"
    );
    if (!wrapperHeader || !wrapperContainer) return;

    // Find all subsection headers inside the wrapper
    const subsectionHeaders =
        wrapperContainer.querySelectorAll('[id$="-header"]');
    if (subsectionHeaders.length === 0) {
        // Default to unknown if nothing found
        setElementStatus(wrapperHeader, "unknown", "status-");
        return;
    }

    // Determine aggregate status with priority: failure > warning > progress > success > unknown
    let hasFailure = false;
    let hasWarning = false;
    let hasProgress = false;
    let allSuccess = true;

    subsectionHeaders.forEach((el) => {
        const classes = el.classList;
        const isFailure =
            classes.contains("status-failure") ||
            classes.contains("status-api-error");
        const isWarning = classes.contains("status-warning");
        const isProgress = classes.contains("status-progress");
        const isSuccess = classes.contains("status-success");

        if (isFailure) hasFailure = true;
        else if (isWarning) hasWarning = true;
        else if (isProgress) hasProgress = true;

        if (!isSuccess) allSuccess = false;
    });

    if (hasFailure) {
        setElementStatus(wrapperHeader, "failure", "status-");
    } else if (hasWarning) {
        setElementStatus(wrapperHeader, "warning", "status-");
    } else if (hasProgress) {
        setElementStatus(wrapperHeader, "progress", "status-");
    } else if (allSuccess) {
        setElementStatus(wrapperHeader, "success", "status-");
    } else {
        setElementStatus(wrapperHeader, "unknown", "status-");
    }
}

// ========================================
// WORKFLOW STATUS MANAGEMENT
// ========================================
export async function getRun() {
    // Use workflow configurations from constants
    getAllWorkflowConfigs();

    // Reset workflow statuses
    workflowStatuses = {};
    workflowRunData = {};

    // Calculate the target date based on GL version
    const glDays = getGlDays();
    const initialDay = new Date(GL_INITIAL_DATE);
    const targetDate = new Date(initialDay);
    targetDate.setDate(targetDate.getDate() + glDays);
    targetDate.setHours(0, 0, 0, 0);

    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // For Stage 4, extend date range to GL + 7 days
    const extendedDate = new Date(targetDate);
    extendedDate.setDate(extendedDate.getDate() + 7);
    const extendedNextDay = new Date(extendedDate);
    extendedNextDay.setDate(extendedNextDay.getDate() + 1);

    // Collect Stage 3 run IDs for parent matching in Stage 4
    const stage3RunIds = new Set();

    const tagName = `${glDays}.0`;

    // Process workflows in two phases:
    // Phase 1: Process Stage 3 workflows first to collect run IDs
    // Phase 2: Process all other workflows (including Stage 4 with parent matching)

    const stage3WorkflowIds = [
        WORKFLOW_IDS.NIGHTLY,
        WORKFLOW_IDS.MANUAL_RELEASE,
    ];
    const allWorkflows = getAllWorkflowConfigs();
    const stage3Workflows = allWorkflows.filter((w) =>
        stage3WorkflowIds.includes(w.id)
    );
    const otherWorkflows = allWorkflows.filter(
        (w) => !stage3WorkflowIds.includes(w.id)
    );

    console.log(
        `🔍 Processing ${stage3Workflows.length} Stage 3 workflows first to collect run IDs`
    );
    console.log(`🔍 Then processing ${otherWorkflows.length} other workflows`);

    // Phase 1: Process Stage 3 workflows to collect run IDs
    for await (const workflow of stage3Workflows) {
        await processWorkflow(
            workflow,
            targetDate,
            nextDay,
            extendedDate,
            extendedNextDay,
            stage3RunIds,
            tagName,
            true
        );
    }

    console.log(`🔍 Stage 3 run IDs collected: ${Array.from(stage3RunIds)}`);

    // Phase 2: Process all other workflows (including Stage 4 with full parent matching)
    for await (const workflow of otherWorkflows) {
        await processWorkflow(
            workflow,
            targetDate,
            nextDay,
            extendedDate,
            extendedNextDay,
            stage3RunIds,
            tagName,
            false
        );
    }

    // Update pipeline hierarchy and colors after all workflow data is loaded
    updatePipelineHierarchy();
}

// Helper function to process a single workflow
async function processWorkflow(
    workflow,
    targetDate,
    nextDay,
    extendedDate,
    extendedNextDay,
    stage3RunIds,
    tagName,
    _isStage3Phase
) {
    let apiUrl;
    const isCloudCleanup = workflow.id === WORKFLOW_IDS.CLOUD_TEST_CLEANUP;
    const isSnapshot = workflow.id === WORKFLOW_IDS.SNAPSHOT;
    const isRepoBuild = workflow.id === WORKFLOW_IDS.REPO_BUILD;
    const isRepoUpdate = workflow.id === WORKFLOW_IDS.REPO_UPDATE;

    // Special handling for Cloud Test Cleanup - get more runs for date filtering
    if (isCloudCleanup) {
        apiUrl = `${API_CONFIG.GITHUB_API_BASE}/repos/${API_CONFIG.GARDENLINUX_ORG}/${workflow.repo}/actions/workflows/${workflow.id}/runs?per_page=50${workflow.repo === "repo" ? getRepoBranchParameter() : getBranchParameter()}`;
    }
    // Special handling for Debian Snapshot - get runs for daily analysis with pagination
    else if (isSnapshot) {
        const workflowIdentifier = workflow.workflowFile || workflow.id;
        // Base URL for initial fetch (100 runs per page, pagination handles up to 500 total)
        apiUrl = `${API_CONFIG.GITHUB_API_BASE}/repos/${API_CONFIG.GARDENLINUX_ORG}/${workflow.repo}/actions/workflows/${workflowIdentifier}/runs?per_page=100${workflow.repo === "repo" ? getRepoBranchParameter() : getBranchParameter()}`;
    }
    // Only filter by daily tag for the repo build workflow
    else if (workflow.id === WORKFLOW_IDS.REPO_BUILD) {
        try {
            const tagResponse = await fetch(
                `${API_CONFIG.GITHUB_API_BASE}/repos/${API_CONFIG.GARDENLINUX_ORG}/${workflow.repo}/git/ref/tags/${tagName}`,
                {
                    headers: getAuthHeaders(),
                }
            );
            const tagData = await tagResponse.json();
            const commitSha = tagData.object.sha;
            apiUrl = `${API_CONFIG.GITHUB_API_BASE}/repos/${API_CONFIG.GARDENLINUX_ORG}/${workflow.repo}/actions/workflows/${workflow.id}/runs?per_page=50&head_sha=${commitSha}`;
        } catch {
            apiUrl = `${API_CONFIG.GITHUB_API_BASE}/repos/${API_CONFIG.GARDENLINUX_ORG}/${workflow.repo}/actions/workflows/${workflow.id}/runs?per_page=50${workflow.repo === "repo" ? getRepoBranchParameter() : getBranchParameter()}`;
        }
    } else {
        // Default: query by workflow file if available (works across repos), otherwise by ID
        const workflowIdentifier = workflow.workflowFile || workflow.id;
        apiUrl = `${API_CONFIG.GITHUB_API_BASE}/repos/${API_CONFIG.GARDENLINUX_ORG}/${workflow.repo}/actions/workflows/${workflowIdentifier}/runs?per_page=50${workflow.repo === "repo" ? getRepoBranchParameter() : getBranchParameter()}`;
    }

    const response = await fetch(apiUrl, {
        headers: getAuthHeaders(),
    });

    if (!response.ok) {
        console.error(
            `[Dashboard] API Error for workflow ${workflow.id} (${workflow.name}):`,
            {
                status: response.status,
                statusText: response.statusText,
                url: response.url,
                workflowId: workflow.id,
                workflowName: workflow.name,
                repo: workflow.repo,
            }
        );
        const workflowDomElement = document.getElementById(
            `daily-info-${workflow.id}`
        );
        setElementStatus(workflowDomElement, "api-error");
        const detailsDiv = document.createElement("div");
        detailsDiv.className = "workflow-details";
        detailsDiv.innerHTML = `<div class="error-message">API Error: ${response.status} ${response.statusText}</div>`;
        workflowDomElement.appendChild(detailsDiv);

        // Track status for color coding
        workflowStatuses[workflow.id] = "api-error";

        // Update Cloud Test Cleanup header if it's that workflow
        if (isCloudCleanup) {
            const headerElement = document.getElementById(
                "cloud-cleanup-header"
            );
            setElementStatus(headerElement, "failure", "status-");
            updateWorkflowMonitoringHeader();
        }
        if (isSnapshot) {
            const snapshotHeader = document.getElementById("snapshot-header");
            setElementStatus(snapshotHeader, "failure", "status-");
            updateWorkflowMonitoringHeader();
        }
        if (isRepoBuild) {
            const repoBuildHeader = document.querySelector(
                "#sub-stage-repo-build .sub-stage-header"
            );
            if (repoBuildHeader) {
                setElementStatus(repoBuildHeader, "failure", "status-");
            }
        }
        if (isRepoUpdate) {
            const repoUpdateHeader = document.querySelector(
                "#sub-stage-repo-update .sub-stage-header"
            );
            if (repoUpdateHeader) {
                setElementStatus(repoUpdateHeader, "failure", "status-");
            }
        }
        return;
    }

    const runs = await response.json();
    const workflowRuns = runs.workflow_runs;

    // Special handling for Debian Snapshot - analyze all runs for the day
    if (isSnapshot && workflowRuns) {
        let runsToCheck = workflowRuns;

        // Check if we're on current date site (no gl parameter) or historic site
        const urlParams = new URLSearchParams(window.location.search);
        const isCurrentDateSite = !urlParams.get("gl");
        const monitoringDate = isCurrentDateSite ? new Date() : targetDate;

        // Filter runs to only those from the target date (historic) or today's date (current)
        const targetDateStr = monitoringDate.toISOString().split("T")[0]; // YYYY-MM-DD

        // Pagination to collect all runs for the target date (up to 5 pages)
        async function fetchAllSnapshotRunsForDate() {
            const collected = [];
            for (let page = 1; page <= 5; page++) {
                try {
                    const url = `${API_CONFIG.GITHUB_API_BASE}/repos/${API_CONFIG.GARDENLINUX_ORG}/${workflow.repo}/actions/workflows/${workflow.workflowFile || workflow.id}/runs?per_page=100&page=${page}${workflow.repo === "repo" ? getRepoBranchParameter() : getBranchParameter()}`;
                    const resp = await fetch(url, {
                        headers: getAuthHeaders(),
                    });
                    if (!resp.ok) break;
                    const data = await resp.json();
                    const pageRuns = data.workflow_runs || [];
                    if (pageRuns.length === 0) break;

                    const pageDateRuns = pageRuns.filter(
                        (run) => run.created_at.split("T")[0] === targetDateStr
                    );
                    collected.push(...pageDateRuns);

                    // Stop if last run is older than target date
                    const lastRun = pageRuns[pageRuns.length - 1];
                    if (
                        lastRun &&
                        lastRun.created_at.split("T")[0] < targetDateStr
                    )
                        break;
                } catch {
                    break;
                }
            }
            return collected;
        }

        // Filter current page and paginate if needed for complete coverage
        runsToCheck = workflowRuns.filter(
            (run) => run.created_at.split("T")[0] === targetDateStr
        );

        // Paginate for historic dates or if fewer than 24 runs (hourly schedule)
        if (!isCurrentDateSite || runsToCheck.length < 24) {
            const allDateRuns = await fetchAllSnapshotRunsForDate();
            if (allDateRuns.length > runsToCheck.length) {
                runsToCheck = allDateRuns;
            }
        }

        const now = new Date();
        const twentyFourHoursAgo = new Date(
            now.getTime() - 24 * 60 * 60 * 1000
        );

        // Analyze all runs: count failures and check recency
        let allWithin24h = true;
        let failedRuns = 0;
        const totalRuns = runsToCheck.length;
        let oldestRun = null;

        for (const run of runsToCheck) {
            const runDate = new Date(run.created_at);

            // Check if runs are within 24h (current site only)
            if (isCurrentDateSite && runDate < twentyFourHoursAgo) {
                allWithin24h = false;
                if (!oldestRun || runDate < oldestRun) {
                    oldestRun = runDate;
                }
            }

            // Count failed runs
            if (run.conclusion !== "success") {
                failedRuns++;
            }
        }

        // Update header based on conditions
        const snapshotHeader = document.getElementById("snapshot-header");
        if (snapshotHeader) {
            // Color coding: Red > Yellow > Green
            // Red: no runs OR >50% failures
            // Yellow: any failures (≤50%) OR runs too old (current site only)
            // Green: all successful and recent
            const failurePercentage =
                totalRuns > 0 ? (failedRuns / totalRuns) * 100 : 0;
            let headerText = "Debian Snapshot";

            if (totalRuns === 0) {
                headerText = "Debian Snapshot (no runs)";
            } else if (failedRuns > 0) {
                headerText = `Debian Snapshot (${failedRuns}/${totalRuns} runs failed)`;
            } else if (isCurrentDateSite && !allWithin24h) {
                const hoursOld = Math.round(
                    (now - oldestRun) / (1000 * 60 * 60)
                );
                headerText = `Debian Snapshot (${hoursOld}h old)`;
            } else {
                headerText = !isCurrentDateSite
                    ? "Debian Snapshot (historic ✓)"
                    : "Debian Snapshot (24h ✓)";
            }

            // Update the header text
            const headerTitle = snapshotHeader.querySelector("h4");
            if (headerTitle) {
                headerTitle.textContent = headerText;
            }

            // Override status logic: applies custom color coding over normal workflow status
            let overrideStatus = null;
            if (totalRuns === 0) {
                overrideStatus = "failure";
            } else if (failedRuns > 0) {
                overrideStatus = failurePercentage > 50 ? "failure" : "warning";
            } else if (isCurrentDateSite && !allWithin24h) {
                overrideStatus = "warning";
            }

            // Store override status to be applied later
            if (overrideStatus) {
                snapshotHeader.dataset.overrideStatus = overrideStatus;
            }
        }
    }

    if (!workflowRuns) {
        console.error(
            `[Dashboard] No workflow_runs in response for workflow ${workflow.id} (${workflow.name}):`,
            {
                workflowId: workflow.id,
                workflowName: workflow.name,
                repo: workflow.repo,
                responseData: runs,
                apiUrl,
            }
        );
        const workflowDomElement = document.getElementById(
            `daily-info-${workflow.id}`
        );
        setElementStatus(workflowDomElement, "api-error");
        const detailsDiv = document.createElement("div");
        detailsDiv.className = "workflow-details";
        detailsDiv.innerHTML =
            '<div class="error-message">No workflow runs data</div>';
        workflowDomElement.appendChild(detailsDiv);

        // Track status for color coding
        workflowStatuses[workflow.id] = "api-error";

        // Update Cloud Test Cleanup header if it's that workflow
        if (isCloudCleanup) {
            const headerElement = document.getElementById(
                "cloud-cleanup-header"
            );
            setElementStatus(headerElement, "failure", "status-");
            updateWorkflowMonitoringHeader();
        }
        if (isSnapshot) {
            const snapshotHeader = document.getElementById("snapshot-header");
            setElementStatus(snapshotHeader, "failure", "status-");
            updateWorkflowMonitoringHeader();
        }
        if (isRepoBuild) {
            const repoBuildHeader = document.querySelector(
                "#sub-stage-repo-build .sub-stage-header"
            );
            if (repoBuildHeader) {
                setElementStatus(repoBuildHeader, "failure", "status-");
            }
        }
        if (isRepoUpdate) {
            const repoUpdateHeader = document.querySelector(
                "#sub-stage-repo-update .sub-stage-header"
            );
            if (repoUpdateHeader) {
                setElementStatus(repoUpdateHeader, "failure", "status-");
            }
        }
        return;
    }

    // Filter runs for the target date (current day or historic day) - applies to all workflows
    // Check if this is a Stage 4 workflow
    const isStage4Workflow = [
        WORKFLOW_IDS.PUBLISH_GHCR,
        WORKFLOW_IDS.PUBLISH_S3,
    ].includes(workflow.id);

    // Check if this is a Stage 3 workflow to collect run IDs
    const isStage3Workflow = [
        WORKFLOW_IDS.NIGHTLY,
        WORKFLOW_IDS.MANUAL_RELEASE,
    ].includes(workflow.id);

    let targetRunsUnsorted;

    if (isStage4Workflow) {
        // For Stage 4: Look at GL date AND GL+7 days, filter by parent run IDs
        const baseRuns = workflowRuns.filter((run) => {
            const runDate = new Date(run.created_at);
            return runDate >= targetDate && runDate < nextDay;
        });

        const extendedRuns = workflowRuns.filter((run) => {
            const runDate = new Date(run.created_at);
            return runDate >= targetDate && runDate < extendedNextDay;
        });

        console.log(
            `🔍 [Stage 4] ${workflow.name}: Found ${baseRuns.length} base runs (GL date: ${targetDate.toISOString().split("T")[0]})`
        );
        console.log(
            `🔍 [Stage 4] ${workflow.name}: Found ${extendedRuns.length} extended runs (GL date to GL+7: ${targetDate.toISOString().split("T")[0]} to ${extendedDate.toISOString().split("T")[0]})`
        );
        console.log(
            `🔍 [Stage 4] ${workflow.name}: Stage 3 run IDs collected so far:`,
            Array.from(stage3RunIds)
        );

        // Process all runs to check parent information
        const validRuns = [];

        for (const run of extendedRuns) {
            console.log(
                `[DEBUG] [Stage 4] Pre-filter Run ${run.id}: created_at=${run.created_at}`
            );
            try {
                // Get parent workflow info for this run
                const parentInfo = await getParentWorkflowInfo(
                    API_CONFIG.GARDENLINUX_ORG,
                    workflow.repo,
                    run.id
                );

                const runDate = new Date(run.created_at);
                const isBaseDate = runDate >= targetDate && runDate < nextDay;
                const isExtendedDate =
                    runDate >= targetDate && runDate < extendedNextDay;

                // Case 1: Day matches - only valid if no parent info OR parent matches Stage 3
                if (isBaseDate) {
                    // If there's no parent info, include the run (manual run or no parent data)
                    if (!parentInfo || !parentInfo.parentRunId) {
                        validRuns.push(run);
                        console.log(
                            `🔍 [Stage 4] Run ${run.id}: Added (GL date, no parent)`
                        );
                        continue;
                    }

                    // If there's a parent ID, it must match a Stage 3 run
                    if (stage3RunIds.has(parentInfo.parentRunId.toString())) {
                        validRuns.push(run);
                        console.log(
                            `🔍 [Stage 4] Run ${run.id}: Added (GL date, matching parent ${parentInfo.parentRunId})`
                        );
                        continue;
                    }

                    // Skip runs with parent IDs that don't match Stage 3
                    console.log(
                        `🔍 [Stage 4] Run ${run.id}: Skipped (GL date, parent ${parentInfo.parentRunId} doesn't match Stage 3)`
                    );
                    continue;
                }

                // Case 2: Extended date validation (+1 to +7 days) - only valid if parent run matches Stage 3
                if (
                    isExtendedDate &&
                    !isBaseDate &&
                    parentInfo &&
                    parentInfo.parentRunId &&
                    stage3RunIds.has(parentInfo.parentRunId.toString())
                ) {
                    validRuns.push(run);
                    console.log(
                        `🔍 [Stage 4] Run ${run.id}: Added (extended date, matching parent ${parentInfo.parentRunId})`
                    );
                    continue;
                }

                console.log(
                    `🔍 [Stage 4] Run ${run.id}: Skipped (doesn't match criteria)`
                );
            } catch (error) {
                console.error(
                    `[Dashboard] Failed to get parent info for Stage 4 run ${run.id} (${workflow.name}):`,
                    {
                        error: error.message,
                        stack: error.stack,
                        runId: run.id,
                        workflowId: workflow.id,
                        workflowName: workflow.name,
                        repo: workflow.repo,
                        created_at: run.created_at,
                    }
                );
            }
        }

        // Remove duplicates based on run ID
        const uniqueRuns = [];
        const seenIds = new Set();
        for (const run of validRuns) {
            if (!seenIds.has(run.id)) {
                seenIds.add(run.id);
                uniqueRuns.push(run);
            }
        }

        // Use the filtered runs for status determination
        targetRunsUnsorted = uniqueRuns;
        console.log(
            `🔍 [Stage 4] ${workflow.name}: Found ${uniqueRuns.length} valid runs after filtering`
        );
    } else {
        // Standard date filtering for non-Stage 4 workflows
        targetRunsUnsorted = workflowRuns.filter((run) => {
            const runDate = new Date(run.created_at);
            return runDate >= targetDate && runDate < nextDay;
        });
    }

    // Collect Stage 3 run IDs for later Stage 4 matching
    if (isStage3Workflow && targetRunsUnsorted.length > 0) {
        targetRunsUnsorted.forEach((run) => {
            stage3RunIds.add(run.id.toString());
            console.log(
                `🔍 [Stage 3] Collected run ID ${run.id} from ${workflow.name}`
            );
        });
    }

    // Sort target runs by creation date in descending order (newest first)
    const targetRuns = targetRunsUnsorted.sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    const workflowDomElement = document.getElementById(
        `daily-info-${workflow.id}`
    );

    // Clear existing content
    const existingDetails =
        workflowDomElement.querySelector(".workflow-details");
    if (existingDetails) {
        existingDetails.remove();
    }

    // Reset all status classes
    setElementStatus(workflowDomElement, null); // Clear all status classes

    // Reset header classes for subsections
    if (isCloudCleanup) {
        const headerElement = document.getElementById("cloud-cleanup-header");
        setElementStatus(headerElement, null, "status-");
        updateWorkflowMonitoringHeader();
    }
    if (isSnapshot) {
        const snapshotHeader = document.getElementById("snapshot-header");
        setElementStatus(snapshotHeader, null, "status-");
        updateWorkflowMonitoringHeader();
    }
    if (isRepoBuild) {
        const repoBuildHeader = document.querySelector(
            "#sub-stage-repo-build .sub-stage-header"
        );
        if (repoBuildHeader) {
            setElementStatus(repoBuildHeader, null, "status-");
        }
    }
    if (isRepoUpdate) {
        const repoUpdateHeader = document.querySelector(
            "#sub-stage-repo-update .sub-stage-header"
        );
        if (repoUpdateHeader) {
            setElementStatus(repoUpdateHeader, null, "status-");
        }
    }

    if (targetRuns.length === 0) {
        // Handles the case where targetRuns might be empty after filtering
        setElementStatus(workflowDomElement, "no-runs");
        const detailsDiv = document.createElement("div");
        detailsDiv.className = "workflow-details";
        const dateStr = targetDate.toLocaleDateString();
        detailsDiv.innerHTML = `<div class="no-runs-message">No runs found for ${
            isHistoricView() ? `historic date ${dateStr}` : "today"
        }</div>`;
        workflowDomElement.appendChild(detailsDiv);

        // Track status for color coding
        workflowStatuses[workflow.id] = "no-runs";

        // Update subsection headers
        if (isCloudCleanup) {
            const headerElement = document.getElementById(
                "cloud-cleanup-header"
            );
            setElementStatus(headerElement, "unknown", "status-");
            updateWorkflowMonitoringHeader();
        }
        if (isSnapshot) {
            const snapshotHeader = document.getElementById("snapshot-header");
            setElementStatus(snapshotHeader, "unknown", "status-");
            updateWorkflowMonitoringHeader();
        }
        if (isRepoBuild) {
            const repoBuildHeader = document.querySelector(
                "#sub-stage-repo-build .sub-stage-header"
            );
            if (repoBuildHeader) {
                setElementStatus(repoBuildHeader, "unknown", "status-");
            }
        }
        if (isRepoUpdate) {
            const repoUpdateHeader = document.querySelector(
                "#sub-stage-repo-update .sub-stage-header"
            );
            if (repoUpdateHeader) {
                setElementStatus(repoUpdateHeader, "unknown", "status-");
            }
        }
        return;
    }

    // Determine overall status based on the most recent run
    // After sorting by ID descending, the first element is the most recent
    const mostRecentRun = targetRuns.length > 0 ? targetRuns[0] : null;

    if (!mostRecentRun) {
        // Handles the case where targetRuns might be empty after filtering
        setElementStatus(workflowDomElement, "no-runs");
        const detailsDiv = document.createElement("div");
        detailsDiv.className = "workflow-details";
        const dateStr = targetDate.toLocaleDateString();
        detailsDiv.innerHTML = `<div class="no-runs-message">No runs found for ${
            isHistoricView() ? `historic date ${dateStr}` : "today"
        }</div>`;
        workflowDomElement.appendChild(detailsDiv);

        // Track status for color coding
        workflowStatuses[workflow.id] = "no-runs";

        // Update subsection headers
        if (isCloudCleanup) {
            const headerElement = document.getElementById(
                "cloud-cleanup-header"
            );
            setElementStatus(headerElement, "unknown", "status-");
        }
        if (isSnapshot) {
            const snapshotHeader = document.getElementById("snapshot-header");
            setElementStatus(snapshotHeader, "unknown", "status-");
            updateWorkflowMonitoringHeader();
        }
        if (isRepoBuild) {
            const repoBuildHeader = document.querySelector(
                "#sub-stage-repo-build .sub-stage-header"
            );
            if (repoBuildHeader) {
                setElementStatus(repoBuildHeader, "unknown", "status-");
            }
        }
        if (isRepoUpdate) {
            const repoUpdateHeader = document.querySelector(
                "#sub-stage-repo-update .sub-stage-header"
            );
            if (repoUpdateHeader) {
                setElementStatus(repoUpdateHeader, "unknown", "status-");
            }
        }
        return;
    }

    let workflowStatus = "unknown";
    const { statusClass } = getRunStatus(mostRecentRun);
    workflowStatus = statusClass;

    setElementStatus(workflowDomElement, statusClass);

    // Update subsection header colors
    if (isCloudCleanup) {
        const headerElement = document.getElementById("cloud-cleanup-header");
        let headerStatus = statusClass;
        if (statusClass === "queued") headerStatus = "progress";
        setElementStatus(headerElement, headerStatus, "status-");
        updateWorkflowMonitoringHeader();
    }
    if (isSnapshot) {
        const snapshotHeader = document.getElementById("snapshot-header");
        let headerStatus = statusClass;
        if (statusClass === "queued") headerStatus = "progress";

        // Check if we have an override status from our custom logic
        const overrideStatus = snapshotHeader.dataset.overrideStatus;
        console.log(
            "Debian Snapshot: Normal workflow processing - statusClass:",
            statusClass,
            "headerStatus:",
            headerStatus
        );
        console.log(
            "Debian Snapshot: Element classes before:",
            snapshotHeader.className
        );
        console.log("Debian Snapshot: Dataset overrideStatus:", overrideStatus);

        if (overrideStatus) {
            headerStatus = overrideStatus;
            console.log(
                "Debian Snapshot: Using override status",
                overrideStatus,
                "instead of normal status",
                statusClass
            );
        } else {
            console.log(
                "Debian Snapshot: Using normal status",
                statusClass,
                "no override found"
            );
        }

        setElementStatus(snapshotHeader, headerStatus, "status-");
        updateWorkflowMonitoringHeader();
    }
    if (isRepoBuild) {
        const repoBuildHeader = document.querySelector(
            "#sub-stage-repo-build .sub-stage-header"
        );
        if (repoBuildHeader) {
            let headerStatus = statusClass;
            if (statusClass === "queued") headerStatus = "progress";
            setElementStatus(repoBuildHeader, headerStatus, "status-");
        }
    }
    if (isRepoUpdate) {
        const repoUpdateHeader = document.querySelector(
            "#sub-stage-repo-update .sub-stage-header"
        );
        if (repoUpdateHeader) {
            let headerStatus = statusClass;
            if (statusClass === "queued") headerStatus = "progress";
            setElementStatus(repoUpdateHeader, headerStatus, "status-");
        }
    }

    // Track status for color coding
    // Store the most recent run data for duration calculations
    workflowRunData[workflow.id] = mostRecentRun;
    workflowStatuses[workflow.id] = workflowStatus;

    // Create details section for all runs
    const detailsDiv = document.createElement("div");
    detailsDiv.className = "workflow-details";

    // Iterate over the sorted runs (descending by ID - newest first)
    // Use for...of instead of forEach with async to maintain order
    for (const run of targetRuns) {
        const runDiv = document.createElement("div");
        runDiv.className = "run-item";

        // Use full date for Cloud Test Cleanup, time only for others
        runDiv.innerHTML = await createRunItemHTML(
            run,
            workflow,
            isCloudCleanup
        );
        detailsDiv.appendChild(runDiv);
    }

    workflowDomElement.appendChild(detailsDiv);
}

// ========================================
// PACKAGE MANAGEMENT FUNCTIONALITY
// ========================================
export async function fillPackageTable() {
    const table = document.getElementById("packages-table");
    const file = `packages/${getGlDays()}.json`;

    console.log("📦 Package loading debug:");
    console.log("- GL Days:", getGlDays());
    console.log("- File path:", file);
    console.log("- Table element:", table);

    // Calculate formatted date for error messages
    const glDays = getGlDays();
    const formattedDate = formatGLDate(glDays);

    // Update package status in pipeline
    const packageStatusElement = document.getElementById("package-status");
    const packageSummary = document.getElementById("package-summary");

    try {
        const response = await fetch(file);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const packages = await response.json();

        console.log("- Packages loaded:", packages.length);
        console.log("- Sample packages:", packages.slice(0, 3));

        // group by status - manual implementation for better browser compatibility
        const packageByStatus = {};
        for (const pkg of packages) {
            if (!packageByStatus[pkg.Status]) {
                packageByStatus[pkg.Status] = [];
            }
            packageByStatus[pkg.Status].push(pkg);
        }

        console.log("- Packages by status:", packageByStatus);
        console.log("- Status keys:", Object.keys(packageByStatus));

        let hasIssues = false;
        let issueCount = 0;

        // two loops, first by status then iterate over array
        for (const status of PACKAGE_STATUSES.PROBLEMATIC) {
            if (status in packageByStatus) {
                console.log(
                    `- Found ${packageByStatus[status].length} packages with status: ${status}`
                );
                issueCount += packageByStatus[status].length;

                for (const pkg of packageByStatus[status]) {
                    if (status == "stale" && localStorage.getItem("github_token")) {
                      try {
                        await unstalePackageRepository(pkg.Name);
                        console.log(`- Unstalled build workflow for ${pkg.Name}`);

                        issueCount--;
                        window.packageAggregatorRefreshNeeded = true;

                        continue;
                      } catch (err) {
                        console.error(`x Could not unstale build workflow for ${pkg.Name}: ${err}`);
                      }
                    }

                    hasIssues = true;

                    console.log(
                        `- Adding package to table: ${pkg.Name} (${pkg.Status})`
                    );
                    const row = table.insertRow(0);
                    row.classList.add(pkg.Status);

                    const a = document.createElement("a");
                    a.innerHTML = pkg.Name;
                    a.href = `${API_CONFIG.GITHUB_BASE}/${API_CONFIG.GARDENLINUX_ORG}/${pkg.Name}/actions/workflows/build.yml`;
                    a.target = "_blank";

                    const pkgName = row.insertCell(0);
                    pkgName.appendChild(a);

                    const pkgStatusTime = row.insertCell(1);
                    pkgStatusTime.innerHTML = pkg.Time;

                    const pkgStatus = row.insertCell(2);
                    pkgStatus.innerHTML = pkg.Status;
                    pkgStatus.classList.add("package-status-cell");
                }
            }
        }

        console.log("- Has issues:", hasIssues);
        console.log("- Issue count:", issueCount);

        // Update pipeline package status
        if (hasIssues) {
            packageStatusElement.textContent = `${issueCount} packages need attention`;
            setElementStatus(packageSummary, "warning");
            packageStatus = "warning";

            // Show the package issues section in Stage 1
            const packageIssuesSection = document.getElementById(
                "package-issues-section"
            );
            console.log("- Package issues section:", packageIssuesSection);
            packageIssuesSection.style.display = "block";
        } else {
            packageStatusElement.textContent =
                "No package builds need attention. Continue doing awesome work :-)";
            setElementStatus(packageSummary, "success");
            packageStatus = "success";

            // Hide the package issues section in Stage 1
            const packageIssuesSection = document.getElementById(
                "package-issues-section"
            );
            packageIssuesSection.style.display = "none";
        }
    } catch (error) {
        console.error(
            `[Dashboard] Failed to load package data for GL ${glDays}:`,
            {
                error: error.message,
                stack: error.stack,
                glDays,
                file,
                is404: error.message.includes("404"),
            }
        );

        // Enhanced error handling with more details
        const is404 = error.message.includes("404");

        // Show error message in the packages section
        const row = table.insertRow(0);
        row.classList.add("api-error");
        const errorCell = row.insertCell(0);
        errorCell.colSpan = 3; // Updated to span 3 columns

        if (is404) {
            errorCell.innerHTML = `
                <div class="package-error-details">
                    <strong>📄 No Package Data Available</strong>
                    Package data for GL ${glDays} (${formattedDate}) is not available.
                    <br><br>
                    <em>This could mean:</em>
                    <ul style="text-align: left; margin: 10px 0; padding-left: 20px;">
                        <li>The GL version is too far in the past</li>
                        <li>The GL version is in the future</li>
                        <li>Package data hasn't been generated yet</li>
                    </ul>
                </div>
            `;
            packageStatus = "no-data";
        } else {
            errorCell.innerHTML = `
                <div class="package-error-details">
                    <strong>❌ Failed to Load Package Data</strong>
                    GL ${glDays}: ${error.message}
                    <br><br>
                    <em>Please try refreshing the page or check your connection.</em>
                </div>
            `;
            packageStatus = "api-error";
        }

        // Update pipeline package status for error
        if (is404) {
            packageStatusElement.textContent = `No package data available for GL ${glDays}`;
        } else {
            packageStatusElement.textContent = `Failed to load package data: ${error.message}`;
        }

        setElementStatus(packageSummary, "api-error");
    }

    // Update pipeline hierarchy and colors after package status is loaded
    updatePipelineHierarchy();

    // Refresh package repositories status data
    if (window.packageAggregatorRefreshNeeded) {
        try {
            await triggerPackageAggregatorWorkflow();
            console.log("- Successfully triggered package aggregator workflow");

            window.packageAggregatorRefreshNeeded = false;
        } catch (err) {
            console.error(`x Could not trigger package aggregator workflow: ${err}`);
        }
    }
}

// ========================================
// SHARED WORKFLOW UTILITIES
// ========================================

// ========================================
// PIPELINE HIERARCHY & UI STATE MANAGEMENT
// ========================================
// Complete pipeline status evaluation and color update system
export function updatePipelineHierarchy() {
    console.log("Updating pipeline hierarchy and colors...");
    console.log("Workflow statuses:", workflowStatuses);
    console.log("Package status:", packageStatus);

    // Use shared stage status calculation (same as current view)
    const stageStatuses = calculateStageStatuses(
        workflowStatuses,
        packageStatus,
        STAGE_WORKFLOWS
    );

    console.log(`[Current View] Stage statuses:`, stageStatuses);
    console.log(`[Current View] Workflow statuses:`, workflowStatuses);

    // Update stage colors
    for (const [stageId, status] of Object.entries(stageStatuses)) {
        updateStageColor(stageId, status);
    }

    // Use shared pipeline status calculation (same as current view)
    const pipelineStatus = calculatePipelineStatus(stageStatuses);

    // Count expected vs actual workflow statuses for logging
    const loadedWorkflowStatuses = EXPECTED_WORKFLOW_IDS.filter(
        (id) => workflowStatuses[id] && workflowStatuses[id] !== "unknown"
    );
    const allWorkflowsLoaded =
        loadedWorkflowStatuses.length === EXPECTED_WORKFLOW_IDS.length;

    console.log("Pipeline status evaluation:");
    console.log("- Expected workflows:", EXPECTED_WORKFLOW_IDS.length);
    console.log("- Loaded workflows:", loadedWorkflowStatuses.length);
    console.log("- All workflows loaded:", allWorkflowsLoaded);
    console.log("- Stage statuses:", Object.values(stageStatuses));

    // Update pipeline container and header colors
    updatePipelineColor(pipelineStatus);
    updateHeaderColor(pipelineStatus);

    // Apply Debian Snapshot override status if set
    const snapshotHeader = document.getElementById("snapshot-header");
    if (snapshotHeader && snapshotHeader.dataset.overrideStatus) {
        const overrideStatus = snapshotHeader.dataset.overrideStatus;
        console.log(
            "Applying Debian Snapshot override status:",
            overrideStatus
        );
        setElementStatus(snapshotHeader, overrideStatus, "status-");
        updateWorkflowMonitoringHeader();
    }

    // Update current release header colors
    updateCurrentReleaseHeaderColors(pipelineStatus);

    // Update current release summary
    updateCurrentReleaseSummary(
        stageStatuses,
        pipelineStatus,
        packageStatus,
        workflowRunData,
        WORKFLOW_IDS,
        getGlDays
    );

    console.log("Stage statuses:", stageStatuses);
    console.log("Overall pipeline status:", pipelineStatus);
}

// ========================================
// HISTORIC RELEASES FUNCTIONALITY
// ========================================
// Historic Releases Functionality
export async function loadHistoricReleases() {
    const loadingDiv = document.getElementById("historic-releases-loading");

    // Check if historic releases should be loaded
    if (!shouldLoadHistoricReleases()) {
        loadingDiv.innerHTML = `
            <div style="text-align: center; padding: 20px; color: var(--text-unknown);">
                📋 Historic releases loading is disabled for this view.
                <br><br>
                <small>This improves page load performance when viewing individual historic releases.</small>
            </div>
        `;
        return;
    }

    // Use the current GL being viewed as the base for historic releases
    const baseGL = getGlDays(); // This respects the gl= parameter, unlike getCurrentGlDays()

    // Show loading state
    loadingDiv.innerHTML = `
        Loading historic data
        <span class="historic-loading-dot"></span>
        <span class="historic-loading-dot"></span>
        <span class="historic-loading-dot"></span>
    `;
    loadingDiv.style.display = "block";

    try {
        // Load data for the last 14 days (excluding current day)
        const historicPromises = [];
        for (let i = 1; i <= UI_CONFIG.HISTORIC_RELEASES_COUNT; i++) {
            const historicGL = baseGL - i;
            if (historicGL > 0) {
                historicPromises.push(loadHistoricDay(historicGL));
            }
        }

        // Process in smaller batches to avoid rate limiting
        const historicData = [];

        for (
            let i = 0;
            i < historicPromises.length;
            i += UI_CONFIG.BATCH_SIZE
        ) {
            const batch = historicPromises.slice(i, i + UI_CONFIG.BATCH_SIZE);
            const batchResults = await Promise.all(batch);
            historicData.push(...batchResults);

            // Small delay between batches to avoid rate limiting
            if (i + UI_CONFIG.BATCH_SIZE < historicPromises.length) {
                await new Promise((resolve) =>
                    setTimeout(resolve, UI_CONFIG.BATCH_DELAY)
                );
            }
        }

        // Hide loading and show results
        loadingDiv.style.display = "none";
        renderHistoricReleases(historicData.filter((data) => data !== null));
    } catch (error) {
        console.error(
            `[Dashboard] Failed to load historic releases for GL ${baseGL}:`,
            {
                error: error.message,
                stack: error.stack,
                baseGL,
                historicCount: UI_CONFIG.HISTORIC_RELEASES_COUNT,
            }
        );
        loadingDiv.innerHTML =
            "❌ Failed to load historic data. Please try again later.";
    }
}

async function loadHistoricDay(glDays) {
    try {
        // Get basic info
        const glDate = formatDetailedDate(glDays);

        // Load package status for this day
        const packageStatus = await getHistoricPackageStatus(glDays);

        // Use shared workflow status processing
        const { workflowStatuses, workflowRunData } =
            await getHistoricWorkflowStatuses(glDays);

        // Use shared stage status calculation (same as current view)
        const stageStatuses = calculateStageStatuses(
            workflowStatuses,
            packageStatus.status,
            STAGE_WORKFLOWS
        );

        // Use shared pipeline status calculation (same as current view)
        const pipelineStatus = calculatePipelineStatus(stageStatuses);

        // Calculate pipeline duration
        const duration = calculateHistoricPipelineDuration(
            workflowRunData,
            WORKFLOW_IDS
        );

        return {
            glDays,
            date: glDate,
            packageStatus,
            workflowStatus: stageStatuses, // for small dots
            duration,
            pipelineStatus, // for main dot and row coloring
        };
    } catch (error) {
        console.warn(
            `[Dashboard] Failed to load data for historic GL ${glDays}:`,
            {
                error: error.message,
                stack: error.stack,
                glDays,
            }
        );
        return null;
    }
}

async function getHistoricPackageStatus(glDays) {
    try {
        const response = await fetch(`packages/${glDays}.json`);
        if (!response.ok) {
            return { status: "no-data", issueCount: 0 };
        }

        const packages = await response.json();
        const problematicStatuses = [
            "progress",
            "workFlowNotFound",
            "noRunFound",
            "brokenTimestamp",
            "stale",
            "failure",
        ];

        let issueCount = 0;
        for (const pkg of packages) {
            if (problematicStatuses.includes(pkg.Status)) {
                issueCount++;
            }
        }

        return {
            status: issueCount > 0 ? "warning" : "success",
            issueCount,
            totalCount: packages.length,
        };
    } catch (error) {
        console.warn(
            `[Dashboard] Failed to load historic package status for GL ${glDays}:`,
            {
                error: error.message,
                glDays,
            }
        );
        return { status: "error", issueCount: 0 };
    }
}

async function getHistoricWorkflowStatuses(glDays) {
    // Returns workflow statuses and run data for shared status calculation
    const workflowStatuses = {};
    const workflowRunData = {};

    const targetDate = calculateTargetDate(glDays, GL_INITIAL_DATE);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // For Stage 4 extended date range: GL day + 7
    const extendedDate = new Date(targetDate);
    extendedDate.setDate(extendedDate.getDate() + 7);
    const extendedNextDay = new Date(extendedDate);
    extendedNextDay.setDate(extendedNextDay.getDate() + 1);

    try {
        // Check multiple workflows per stage for better coverage using constants
        const workflowChecks = [
            // Stage 2: Repository workflows
            {
                id: WORKFLOW_IDS.REPO_UPDATE,
                stage: "stage-2",
                repo: WORKFLOWS.REPO_UPDATE.repo,
                name: WORKFLOWS.REPO_UPDATE.name,
            },
            {
                id: WORKFLOW_IDS.REPO_BUILD,
                stage: "stage-2",
                repo: WORKFLOWS.REPO_BUILD.repo,
                name: WORKFLOWS.REPO_BUILD.name,
            },

            // Stage 3: Build & Release workflows
            {
                id: WORKFLOW_IDS.NIGHTLY,
                stage: "stage-3",
                repo: WORKFLOWS.NIGHTLY.repo,
                name: WORKFLOWS.NIGHTLY.name,
            },
            {
                id: WORKFLOW_IDS.MANUAL_RELEASE,
                stage: "stage-3",
                repo: WORKFLOWS.MANUAL_RELEASE.repo,
                name: WORKFLOWS.MANUAL_RELEASE.name,
            },

            // Stage 4: Publish workflows
            {
                id: WORKFLOW_IDS.PUBLISH_GHCR,
                stage: "stage-4",
                repo: WORKFLOWS.PUBLISH_GHCR.repo,
                name: WORKFLOWS.PUBLISH_GHCR.name,
            },
            {
                id: WORKFLOW_IDS.PUBLISH_S3,
                stage: "stage-4",
                repo: WORKFLOWS.PUBLISH_S3.repo,
                name: WORKFLOWS.PUBLISH_S3.name,
            },
        ];

        // Collect Stage 3 run IDs first
        const stage3Workflows = workflowChecks.filter(
            (w) => w.stage === "stage-3"
        );
        const stage3RunIds = await collectStage3RunIds(
            stage3Workflows,
            targetDate,
            nextDay,
            glDays
        );

        // Process workflows with timeout and better error handling
        const promises = workflowChecks.map(async (workflow) => {
            try {
                // eslint-disable-next-line no-undef
                const controller = new AbortController();
                const timeoutId = setTimeout(
                    () => controller.abort(),
                    API_CONFIG.TIMEOUT
                );

                const response = await fetch(
                    `${API_CONFIG.GITHUB_API_BASE}/repos/${API_CONFIG.GARDENLINUX_ORG}/${workflow.repo}/actions/workflows/${workflow.id}/runs?per_page=${API_CONFIG.HISTORIC_RUNS_PER_PAGE}${workflow.repo === "repo" ? getRepoBranchParameter() : getBranchParameter()}`,
                    {
                        headers: getAuthHeaders(),
                        signal: controller.signal,
                    }
                );

                clearTimeout(timeoutId);

                if (!response.ok) {
                    console.warn(
                        `[Dashboard] Historic API error for ${workflow.name} (${workflow.id}):`,
                        {
                            status: response.status,
                            statusText: response.statusText,
                            workflowId: workflow.id,
                            workflowName: workflow.name,
                            repo: workflow.repo,
                            glDays,
                        }
                    );
                    return {
                        workflow,
                        status: "unknown",
                        runData: null,
                    };
                }

                const data = await response.json();
                const runs = data.workflow_runs || [];

                // Use shared workflow processing logic (same as current view)
                const result = await processWorkflowRuns(
                    workflow,
                    runs,
                    targetDate,
                    nextDay,
                    extendedNextDay,
                    stage3RunIds,
                    glDays
                );

                return {
                    workflow,
                    status: result.status,
                    runData: result.runData,
                };
            } catch (error) {
                console.warn(
                    `[Dashboard] Historic workflow processing error for ${workflow.name} (${workflow.id}):`,
                    {
                        error: error.message,
                        stack: error.stack,
                        workflowId: workflow.id,
                        workflowName: workflow.name,
                        repo: workflow.repo,
                        glDays,
                    }
                );
                return {
                    workflow,
                    status: "unknown",
                    runData: null,
                };
            }
        });

        // Wait for all API calls to complete
        const results = await Promise.allSettled(promises);

        // Process results and store in workflowStatuses
        for (const result of results) {
            if (result.status === "fulfilled" && result.value) {
                const { workflow, status, runData } = result.value;
                workflowStatuses[workflow.id] = status;

                // Store run data for duration calculation
                if (runData) {
                    workflowRunData[workflow.id] = runData;
                }
            }
        }

        console.log(
            `Historic GL${glDays} workflow statuses:`,
            workflowStatuses
        );

        // Return workflow statuses for shared status calculation
        return {
            workflowStatuses,
            workflowRunData,
        };
    } catch (error) {
        console.error(
            `[Dashboard] Failed to load historic workflow status for GL ${glDays}:`,
            {
                error: error.message,
                stack: error.stack,
                glDays,
            }
        );
        // On error, return empty statuses
        return {
            workflowStatuses: {},
            workflowRunData: {},
        };
    }
}
