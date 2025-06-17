/**
 * ========================================
 * GARDEN LINUX DASHBOARD - MAIN LOGIC
 * ========================================
 *
 * This file contains the core dashboard functionality including:
 * - GitHub API interactions for workflow data
 * - Package status monitoring
 * - Pipeline hierarchy management
 * - Historic releases functionality
 * - UI state management and color coding
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
    validateStage4Runs,
    collectStage3RunIds,
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
    ALLOWED_ARTIFACT_NAMES,
    getAllWorkflowConfigs,
} from "./constants.js";

// Import JSZip for artifact extraction
import JSZip from "jszip";
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
// WORKFLOW STATUS MANAGEMENT
// ========================================
export async function getRun() {
    // Use workflow configurations from constants
    const reposWorkflows = getAllWorkflowConfigs();

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
    isStage3Phase
) {
    let apiUrl;
    let isPlatformCleanup = workflow.id === WORKFLOW_IDS.PLATFORM_TEST_CLEANUP;

    // Special handling for Platform Test Cleanup - get more runs for date filtering
    if (isPlatformCleanup) {
        apiUrl = `${API_CONFIG.GITHUB_API_BASE}/repos/${API_CONFIG.GARDENLINUX_ORG}/${workflow.repo}/actions/workflows/${workflow.id}/runs?per_page=50${getBranchParameter()}`;
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
        } catch (error) {
            apiUrl = `${API_CONFIG.GITHUB_API_BASE}/repos/${API_CONFIG.GARDENLINUX_ORG}/${workflow.repo}/actions/workflows/${workflow.id}/runs?per_page=50${getBranchParameter()}`;
        }
    } else {
        apiUrl = `${API_CONFIG.GITHUB_API_BASE}/repos/${API_CONFIG.GARDENLINUX_ORG}/${workflow.repo}/actions/workflows/${workflow.id}/runs?per_page=50${getBranchParameter()}`;
    }

    const response = await fetch(apiUrl, {
        headers: getAuthHeaders(),
    });

    if (!response.ok) {
        console.error(
            `API Error for workflow ${workflow.id}:`,
            response.status,
            response.statusText
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

        // Update Platform Test Cleanup header if it's that workflow
        if (isPlatformCleanup) {
            const headerElement = document.getElementById(
                "platform-cleanup-header"
            );
            setElementStatus(headerElement, "failure", "status-");
        }
        return;
    }

    const runs = await response.json();
    const workflowRuns = runs.workflow_runs;

    if (!workflowRuns) {
        console.error(
            `No workflow_runs in response for workflow ${workflow.id}:`,
            runs
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

        // Update Platform Test Cleanup header if it's that workflow
        if (isPlatformCleanup) {
            const headerElement = document.getElementById(
                "platform-cleanup-header"
            );
            setElementStatus(headerElement, "failure", "status-");
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

                // Case 1: Day matches and parent ID does not exist in artifact
                if (isBaseDate && (!parentInfo || !parentInfo.parentRunId)) {
                    validRuns.push(run);
                    console.log(
                        `🔍 [Stage 4] Run ${run.id}: Added (base date, no parent)`
                    );
                    continue;
                }

                // Case 2: Day matches (or 7 days into future) and parent ID matches any Stage 3 workflow
                if (
                    isExtendedDate &&
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
                console.log(
                    `🔍 [Stage 4] Failed to get parent info for run ${run.id}:`,
                    error.message
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

    // Reset Platform Test Cleanup header classes
    if (isPlatformCleanup) {
        const headerElement = document.getElementById(
            "platform-cleanup-header"
        );
        setElementStatus(headerElement, null, "status-");
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

        // Update Platform Test Cleanup header
        if (isPlatformCleanup) {
            const headerElement = document.getElementById(
                "platform-cleanup-header"
            );
            setElementStatus(headerElement, "unknown", "status-");
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

        // Update Platform Test Cleanup header
        if (isPlatformCleanup) {
            const headerElement = document.getElementById(
                "platform-cleanup-header"
            );
            setElementStatus(headerElement, "unknown", "status-");
        }
        return;
    }

    let workflowStatus = "unknown";
    const { statusClass } = getRunStatus(mostRecentRun);
    workflowStatus = statusClass;

    setElementStatus(workflowDomElement, statusClass);

    // Update Platform Test Cleanup header color
    if (isPlatformCleanup) {
        const headerElement = document.getElementById(
            "platform-cleanup-header"
        );
        let headerStatus = statusClass;
        if (statusClass === "queued") headerStatus = "progress";
        setElementStatus(headerElement, headerStatus, "status-");
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

        // Use full date for Platform Test Cleanup, time only for others
        runDiv.innerHTML = await createRunItemHTML(
            run,
            workflow,
            isPlatformCleanup
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
                hasIssues = true;
                issueCount += packageByStatus[status].length;

                for (const pkg of packageByStatus[status]) {
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
        console.error("Failed to load package data:", error);

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
}

// ========================================
// SHARED WORKFLOW UTILITIES
// ========================================
function calculateDuration(run) {
    if (run.status !== "completed") return "";

    const startTime = new Date(run.created_at);
    const endTime = new Date(run.updated_at);
    const durationMs = endTime - startTime;

    // Handle negative durations (shouldn't happen but just in case)
    if (durationMs < 0) return "Invalid duration";

    const durationHours = Math.floor(durationMs / 3600000);
    const durationMinutes = Math.floor((durationMs % 3600000) / 60000);
    const durationSeconds = Math.floor((durationMs % 60000) / 1000);

    // Format duration cleanly without parentheses since it's now on its own line
    if (durationHours > 0) {
        return `${durationHours}h ${durationMinutes}m ${durationSeconds}s`;
    } else if (durationMinutes > 0) {
        return `${durationMinutes}m ${durationSeconds}s`;
    } else {
        return `${durationSeconds}s`;
    }
}

// ========================================
// PIPELINE HIERARCHY & UI STATE MANAGEMENT
// ========================================
// Complete pipeline status evaluation and color update system
export function updatePipelineHierarchy() {
    console.log("Updating pipeline hierarchy and colors...");
    console.log("Workflow statuses:", workflowStatuses);
    console.log("Package status:", packageStatus);

    // Evaluate each stage status
    const stageStatuses = {};

    // Stage 1: Package status (map package status values to stage dot CSS classes)
    let stage1Status = packageStatus;
    if (packageStatus === "no-data") {
        stage1Status = "unknown"; // Map no-data to unknown for stage dots
    } else if (packageStatus === "api-error") {
        stage1Status = "failure"; // Map api-error to failure for stage dots
    }
    stageStatuses["stage-1"] = stage1Status;

    // Stages 2-4: Based on workflow statuses using constants
    for (const [stageId, workflowIds] of Object.entries(STAGE_WORKFLOWS)) {
        if (stageId === "stage-1") continue; // Already handled above

        const relevantStatuses = workflowIds.map(
            (id) => workflowStatuses[id] || "unknown"
        );

        // Special logic for Stage 3 (Build & Release):
        // If ANY workflow is successful, make the whole stage successful
        if (stageId === "stage-3") {
            if (relevantStatuses.some((status) => status === "success")) {
                stageStatuses[stageId] = "success";
            } else if (
                relevantStatuses.some(
                    (status) => status === "progress" || status === "queued"
                )
            ) {
                stageStatuses[stageId] = "progress";
            } else if (
                relevantStatuses.some((status) => status === "failure")
            ) {
                stageStatuses[stageId] = "failure";
            } else if (
                relevantStatuses.some((status) => status === "api-error")
            ) {
                stageStatuses[stageId] = "error";
            } else {
                stageStatuses[stageId] = "unknown";
            }
        } else {
            // Standard logic for other stages: prioritize failures
            if (relevantStatuses.some((status) => status === "failure")) {
                stageStatuses[stageId] = "failure";
            } else if (
                relevantStatuses.some((status) => status === "api-error")
            ) {
                stageStatuses[stageId] = "error";
            } else if (
                relevantStatuses.some(
                    (status) => status === "progress" || status === "queued"
                )
            ) {
                stageStatuses[stageId] = "progress";
            } else if (
                relevantStatuses.every((status) => status === "success")
            ) {
                stageStatuses[stageId] = "success";
            } else {
                stageStatuses[stageId] = "unknown";
            }
        }
    }

    // Update stage colors
    for (const [stageId, status] of Object.entries(stageStatuses)) {
        updateStageColor(stageId, status);
    }

    // Evaluate overall pipeline status
    const allStatuses = Object.values(stageStatuses);
    let pipelineStatus = "unknown";

    // Count expected vs actual workflow statuses to avoid premature success
    const loadedWorkflowStatuses = EXPECTED_WORKFLOW_IDS.filter(
        (id) => workflowStatuses[id] && workflowStatuses[id] !== "unknown"
    );
    const allWorkflowsLoaded =
        loadedWorkflowStatuses.length === EXPECTED_WORKFLOW_IDS.length;

    console.log("Pipeline status evaluation:");
    console.log("- Expected workflows:", EXPECTED_WORKFLOW_IDS.length);
    console.log("- Loaded workflows:", loadedWorkflowStatuses.length);
    console.log("- All workflows loaded:", allWorkflowsLoaded);
    console.log("- Stage statuses:", allStatuses);

    // Priority order: failure > warning > progress > success > error > no-data > unknown
    // Any failure should immediately mark the entire pipeline as failed
    if (
        allStatuses.some(
            (status) => status === "failure" || status === "api-error"
        )
    ) {
        pipelineStatus = "failure";
    } else if (allStatuses.some((status) => status === "warning")) {
        pipelineStatus = "warning";
    } else if (allStatuses.some((status) => status === "progress")) {
        pipelineStatus = "progress";
    } else if (allStatuses.some((status) => status === "unknown")) {
        // If any stage is unknown, overall status should be unknown
        pipelineStatus = "unknown";
    } else if (
        allStatuses.some((status) => status === "success") &&
        allWorkflowsLoaded
    ) {
        // Only show success if all workflows are loaded and at least one stage is successful
        pipelineStatus = "success";
    } else if (allStatuses.some((status) => status === "no-data")) {
        pipelineStatus = "unknown";
    } else {
        pipelineStatus = "unknown";
    }

    // Update pipeline container and header colors
    updatePipelineColor(pipelineStatus);
    updateHeaderColor(pipelineStatus);

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
        console.error("Failed to load historic releases:", error);
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

        // Load workflow statuses for this day (now returns both statuses and run data)
        const workflowResult = await getHistoricWorkflowStatus(glDays);
        const workflowStatus = workflowResult.stageStatuses;
        const workflowRunData = workflowResult.workflowRunData;

        // --- Use the same logic as updatePipelineHierarchy to compute stageStatuses and pipelineStatus ---
        const stageStatuses = { ...workflowStatus };
        // Stage 1: Package status (map package status values to stage dot CSS classes)
        let stage1Status = packageStatus.status;
        if (packageStatus.status === "no-data") {
            stage1Status = "unknown";
        } else if (packageStatus.status === "api-error") {
            stage1Status = "failure";
        }
        stageStatuses["stage-1"] = stage1Status;

        // Evaluate overall pipeline status
        const allStatuses = Object.values(stageStatuses);
        let pipelineStatus = "unknown";
        if (
            allStatuses.some(
                (status) => status === "failure" || status === "api-error"
            )
        ) {
            pipelineStatus = "failure";
        } else if (allStatuses.some((status) => status === "warning")) {
            pipelineStatus = "warning";
        } else if (allStatuses.some((status) => status === "progress")) {
            pipelineStatus = "progress";
        } else if (allStatuses.some((status) => status === "unknown")) {
            pipelineStatus = "unknown";
        } else if (allStatuses.some((status) => status === "success")) {
            pipelineStatus = "success";
        } else if (allStatuses.some((status) => status === "no-data")) {
            pipelineStatus = "unknown";
        } else {
            pipelineStatus = "unknown";
        }

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
        console.warn(`Failed to load data for GL ${glDays}:`, error);
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
        return { status: "error", issueCount: 0 };
    }
}

async function getHistoricWorkflowStatus(glDays) {
    // More robust workflow status check for historic data
    const stageStatuses = {
        "stage-1": "unknown", // Package status is handled separately
        "stage-2": "unknown",
        "stage-3": "unknown",
        "stage-4": "unknown",
    };

    // Store actual run data for duration calculation
    const workflowRunData = {};

    const targetDate = calculateTargetDate(glDays, GL_INITIAL_DATE);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // For Stage 4 extended date range: GL day + 7
    const extendedDate = new Date(targetDate);
    extendedDate.setDate(extendedDate.getDate() + 7);
    const extendedNextDay = new Date(extendedDate);
    extendedNextDay.setDate(extendedNextDay.getDate() + 1);

    // Expand date range slightly to catch runs that might be on boundary (for Stage 3 and others)
    const prevDay = new Date(targetDate);
    prevDay.setDate(prevDay.getDate() - 1);
    prevDay.setHours(20, 0, 0, 0); // Start from 8 PM previous day

    const extendedRangeEnd = new Date(extendedNextDay);
    extendedRangeEnd.setHours(4, 0, 0, 0); // End at 4 AM GL date + 7

    console.log(
        `[DEBUG] [Stage 4] Date range for GL ${glDays}: prevDay=${prevDay.toISOString()}, extendedRangeEnd=${extendedRangeEnd.toISOString()}`
    );

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

        // Collect all Stage 3 run IDs first using the utility function
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
                // Check if this is a Stage 3 workflow to collect run IDs
                const isStage3Workflow = [
                    WORKFLOW_IDS.NIGHTLY,
                    WORKFLOW_IDS.MANUAL_RELEASE,
                ].includes(workflow.id);

                // eslint-disable-next-line no-undef
                const controller = new AbortController();
                const timeoutId = setTimeout(
                    () => controller.abort(),
                    API_CONFIG.TIMEOUT
                );

                const response = await fetch(
                    `${API_CONFIG.GITHUB_API_BASE}/repos/${API_CONFIG.GARDENLINUX_ORG}/${workflow.repo}/actions/workflows/${workflow.id}/runs?per_page=${API_CONFIG.HISTORIC_RUNS_PER_PAGE}${getBranchParameter()}`,
                    {
                        headers: getAuthHeaders(),
                        signal: controller.signal,
                    }
                );

                clearTimeout(timeoutId);

                if (!response.ok) {
                    console.warn(
                        `Historic API error for ${workflow.name} (${workflow.id}): ${response.status}`
                    );
                    return {
                        workflow,
                        status: "unknown",
                        reason: `API Error ${response.status}`,
                        runData: null,
                    };
                }

                const data = await response.json();
                const runs = data.workflow_runs || [];

                // Filter runs for the target date range - use extended range only for Stage 4
                let dayRuns;
                if (workflow.stage === "stage-4") {
                    // Use the exact same Stage 4 logic as detail view
                    const baseRuns = runs.filter((run) => {
                        const runDate = new Date(run.created_at);
                        return runDate >= targetDate && runDate < nextDay;
                    });

                    const extendedRuns = runs.filter((run) => {
                        const runDate = new Date(run.created_at);
                        return (
                            runDate >= targetDate && runDate < extendedNextDay
                        );
                    });

                    console.log(
                        `🔍 [Historic Stage 4] ${workflow.name}: Found ${baseRuns.length} base runs (GL date: ${targetDate.toISOString().split("T")[0]})`
                    );
                    console.log(
                        `🔍 [Historic Stage 4] ${workflow.name}: Found ${extendedRuns.length} extended runs (GL date to GL+7: ${targetDate.toISOString().split("T")[0]} to ${extendedDate.toISOString().split("T")[0]})`
                    );

                    // Use the utility function to validate Stage 4 runs
                    const uniqueRuns = await validateStage4Runs(
                        extendedRuns,
                        targetDate,
                        nextDay,
                        extendedNextDay,
                        stage3RunIds,
                        glDays,
                        workflow
                    );

                    dayRuns = uniqueRuns;
                    console.log(
                        `🔍 [Historic Stage 4] GL${glDays} - ${workflow.name} (${workflow.id}): Found ${uniqueRuns.length} valid runs, latest run: ${uniqueRuns.length > 0 ? uniqueRuns[0].id + " (" + uniqueRuns[0].created_at + ")" : "none"}`
                    );
                    if (uniqueRuns.length > 0) {
                        console.log(
                            `🔍 [Historic Stage 4] GL${glDays} - ${workflow.name} (${workflow.id}): All valid runs: [${uniqueRuns.map((r) => r.id).join(", ")}]`
                        );
                    }
                } else {
                    // For other stages, use the standard date range (GL + 1 day)
                    dayRuns = runs.filter((run) => {
                        const runDate = new Date(run.created_at);
                        return runDate >= targetDate && runDate < nextDay;
                    });
                }

                // Collect Stage 3 run IDs for later Stage 4 matching
                if (isStage3Workflow && dayRuns.length > 0) {
                    dayRuns.forEach((run) => {
                        stage3RunIds.add(run.id.toString());
                        console.log(
                            `🔍 [Stage 3] Collected run ID ${run.id} from ${workflow.name}`
                        );
                    });
                }

                // Status determination logic
                if (dayRuns.length > 0) {
                    // For historic data, use the most recent run regardless of completion status
                    // This ensures that in-progress runs are shown even if there are completed runs
                    const sortedRuns = dayRuns.sort(
                        (a, b) =>
                            new Date(b.created_at) - new Date(a.created_at)
                    );
                    const latestRun = sortedRuns[0];

                    let status = "unknown";
                    if (
                        latestRun.status === "in_progress" ||
                        latestRun.status === "queued"
                    ) {
                        status = "progress";
                    } else if (latestRun.status === "completed") {
                        status =
                            latestRun.conclusion === "success"
                                ? "success"
                                : "failure";
                    }
                    return {
                        workflow,
                        status,
                        reason: `Found ${dayRuns.length} runs`,
                        runData: latestRun,
                    };
                } else {
                    return {
                        workflow,
                        status: "unknown",
                        reason: "No runs found",
                        runData: null,
                    };
                }
            } catch (error) {
                return {
                    workflow,
                    status: "unknown",
                    reason: error.message,
                    runData: null,
                };
            }
        });

        // Wait for all API calls to complete
        const results = await Promise.allSettled(promises);

        // Process results with stage-specific logic and collect run data
        const stageResults = {
            "stage-2": [],
            "stage-3": [],
            "stage-4": [],
        };

        for (const result of results) {
            if (result.status === "fulfilled" && result.value) {
                const { workflow, status, runData } = result.value;
                stageResults[workflow.stage].push(status);

                // Store run data for duration calculation
                if (runData) {
                    workflowRunData[workflow.id] = runData;
                }
            }
        }

        // Determine stage statuses - only use actual data, no assumptions
        for (const [stageId, statuses] of Object.entries(stageResults)) {
            if (statuses.length === 0) {
                // No data for this stage - keep as unknown
                stageStatuses[stageId] = "unknown";
                continue;
            }

            // Filter out unknown statuses to work with actual data
            const knownStatuses = statuses.filter(
                (status) => status !== "unknown"
            );

            if (knownStatuses.length === 0) {
                // All statuses are unknown - keep stage as unknown
                stageStatuses[stageId] = "unknown";
                continue;
            }

            // Stage 3 special rule: ANY success makes stage successful
            if (stageId === "stage-3") {
                if (knownStatuses.includes("success")) {
                    stageStatuses[stageId] = "success";
                } else if (knownStatuses.includes("progress")) {
                    stageStatuses[stageId] = "progress";
                } else if (knownStatuses.includes("failure")) {
                    stageStatuses[stageId] = "failure";
                } else {
                    stageStatuses[stageId] = "unknown";
                }
            } else {
                // Standard priority logic for other stages
                if (knownStatuses.includes("failure")) {
                    stageStatuses[stageId] = "failure";
                } else if (knownStatuses.includes("progress")) {
                    stageStatuses[stageId] = "progress";
                } else if (knownStatuses.includes("success")) {
                    stageStatuses[stageId] = "success";
                } else {
                    stageStatuses[stageId] = "unknown";
                }
            }
        }

        console.log(`Historic GL${glDays} workflow statuses:`, stageStatuses);

        // Return both stage statuses and run data for duration calculation
        return {
            stageStatuses,
            workflowRunData,
        };
    } catch (error) {
        console.warn(
            `Failed to load historic workflow status for GL ${glDays}:`,
            error
        );
        // On error, all stages remain unknown - no assumptions
        return {
            stageStatuses,
            workflowRunData: {},
        };
    }
}
