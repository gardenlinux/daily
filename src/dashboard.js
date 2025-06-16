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
    getTriggerInfo,
    isHistoricView,
    getGlDays,
    formatGLDate,
    formatDetailedDate,
    formatDateTimeDetailed,
    shouldLoadHistoricReleases,
    setElementStatus,
    bulkSetElementStatus,
    getBranchParameter,
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

    for await (const workflow of reposWorkflows) {
        let apiUrl;
        let isPlatformCleanup =
            workflow.id === WORKFLOW_IDS.PLATFORM_TEST_CLEANUP;

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
            continue;
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
            continue;
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

            // If we have Stage 3 run IDs, filter extended runs by parent ID matching
            if (stage3RunIds.size > 0) {
                const parentMatchedRuns = [];

                for (const run of extendedRuns) {
                    try {
                        // Get parent workflow info for this run
                        const parentInfo = await getParentWorkflowInfo(
                            API_CONFIG.GARDENLINUX_ORG,
                            workflow.repo,
                            run.id
                        );

                        if (
                            parentInfo &&
                            parentInfo.parentRunId &&
                            stage3RunIds.has(parentInfo.parentRunId.toString())
                        ) {
                            parentMatchedRuns.push(run);
                            console.log(
                                `🔍 [Stage 4] Found matching parent run ${parentInfo.parentRunId} for Stage 4 run ${run.id}`
                            );
                        } else {
                            console.log(
                                `🔍 [Stage 4] Run ${run.id}: No matching parent found. Parent info:`,
                                parentInfo
                            );
                        }
                    } catch (error) {
                        console.log(
                            `🔍 [Stage 4] Failed to get parent info for run ${run.id}:`,
                            error.message
                        );
                    }
                }

                // Combine base runs (from GL date) with parent-matched runs from extended period
                targetRunsUnsorted = [...baseRuns, ...parentMatchedRuns];

                // Remove duplicates based on run ID
                const uniqueRuns = [];
                const seenIds = new Set();
                for (const run of targetRunsUnsorted) {
                    if (!seenIds.has(run.id)) {
                        seenIds.add(run.id);
                        uniqueRuns.push(run);
                    }
                }
                targetRunsUnsorted = uniqueRuns;

                console.log(
                    `🔍 [Stage 4] ${workflow.name}: Found ${baseRuns.length} base runs + ${parentMatchedRuns.length} parent-matched runs = ${targetRunsUnsorted.length} total`
                );
            } else {
                // No Stage 3 runs yet collected - include ALL runs from extended period for debugging
                // This allows us to see Stage 4 runs even when Stage 3 hasn't run yet
                console.log(
                    `🔍 [Stage 4] ${workflow.name}: No Stage 3 runs collected yet, including all extended runs for debugging`
                );

                // Include all extended runs, but log which ones might be relevant
                for (const run of extendedRuns) {
                    console.log(
                        `🔍 [Stage 4] Extended run ${run.id} created at ${run.created_at} (${run.status}/${run.conclusion})`
                    );

                    // Try to get parent info for debugging
                    try {
                        const parentInfo = await getParentWorkflowInfo(
                            API_CONFIG.GARDENLINUX_ORG,
                            workflow.repo,
                            run.id
                        );
                        if (parentInfo && parentInfo.found) {
                            console.log(
                                `🔍 [Stage 4] Run ${run.id} parent info:`,
                                parentInfo
                            );
                        }
                    } catch (error) {
                        // Ignore errors during debugging
                    }
                }

                targetRunsUnsorted = extendedRuns; // Include all extended runs when no Stage 3 runs
                console.log(
                    `🔍 [Stage 4] ${workflow.name}: Using all ${extendedRuns.length} extended runs (no Stage 3 filter applied)`
                );
            }
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
            continue;
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
            continue;
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

    // Update pipeline hierarchy and colors after all workflow data is loaded
    updatePipelineHierarchy();
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
function getRunStatus(run) {
    let statusClass = "";
    let statusText = "";

    if (run.status === "in_progress") {
        statusClass = "progress";
        statusText = "In Progress";
    } else if (run.status === "queued") {
        statusClass = "queued";
        statusText = "Queued";
    } else if (run.status === "completed") {
        if (run.conclusion === "success") {
            statusClass = "success";
            statusText = "Success";
        } else {
            statusClass = "failure";
            statusText = run.conclusion || "Failed";
        }
    } else {
        statusClass = "queued";
        statusText = run.status;
    }

    return { statusClass, statusText };
}

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

async function createRunItemHTML(run, workflow, useFullDate = false) {
    const { statusClass, statusText } = getRunStatus(run);

    // Check if this is a Stage 4 workflow or platform cleanup
    const isStage4Workflow = [
        WORKFLOW_IDS.PUBLISH_GHCR,
        WORKFLOW_IDS.PUBLISH_S3,
    ].includes(workflow.id);
    const isPlatformCleanup =
        workflow.id === WORKFLOW_IDS.PLATFORM_TEST_CLEANUP;

    // Use detailed date/time format for all stages and platform cleanup
    const useDetailedDateTime = true; // Always use detailed format now

    const createdTime = useDetailedDateTime
        ? formatDateTimeDetailed(new Date(run.created_at))
        : new Date(run.created_at).toLocaleTimeString();
    const updatedTime = useDetailedDateTime
        ? formatDateTimeDetailed(new Date(run.updated_at))
        : new Date(run.updated_at).toLocaleTimeString();

    const durationText = calculateDuration(run);
    const branch = run.head_branch || "main";
    const commitSha = run.head_sha ? run.head_sha.substring(0, 7) : "unknown";

    const triggerInfo = await getTriggerInfo(
        API_CONFIG.GARDENLINUX_ORG,
        workflow.repo,
        run
    );

    let timeDisplay = `Start: ${createdTime}`;
    let durationDisplay = "";

    if (run.status === "completed") {
        timeDisplay += ` | End: ${updatedTime}`;
        if (durationText) {
            durationDisplay = `Duration: ${durationText}`;
        }
    } else if (run.status === "in_progress") {
        timeDisplay += ` | Running...`;
    }

    // Check if this is a Stage 4 workflow and attempt to get parent run information
    let parentRunInfo = null;

    if (isStage4Workflow) {
        try {
            console.log(
                `🔍 [Stage 4] Checking for parent run in workflow ${workflow.name} (${run.id})`
            );
            parentRunInfo = await getParentWorkflowInfo(
                API_CONFIG.GARDENLINUX_ORG,
                workflow.repo,
                run.id
            );
            if (parentRunInfo && parentRunInfo.parentRunId) {
                console.log(
                    `🔍 [Stage 4] Found parent run ID: ${parentRunInfo.parentRunId} for run ${run.id}`
                );
            }
        } catch (error) {
            console.log(
                `🔍 [Stage 4] Error getting parent info for run ${run.id}:`,
                error.message
            );
        }
    }

    // Build the parent run display
    let parentRunDisplay = "";
    if (parentRunInfo && parentRunInfo.parentRunId) {
        parentRunDisplay = `
            <div class="parent-run-info">
                parent run: <a href="https://github.com/gardenlinux/gardenlinux/actions/runs/${parentRunInfo.parentRunId}"
                   target="_blank"
                   class="parent-run-link"
                   title="View parent workflow run that triggered this">${parentRunInfo.parentRunId}</a>
            </div>
        `;
    } else if (isStage4Workflow) {
        // Always show parent run info for Stage 4 workflows, even if not found
        parentRunDisplay = `
            <div class="parent-run-info">
                <span class="parent-run-unavailable" title="${parentRunInfo?.message || "No parent run information available"}">parent run: Not found</span>
            </div>
        `;
    }

    return `
        <a href="${run.html_url}" target="_blank" class="run-item-link">
            <div class="run-status-line">
                <strong class="status-${statusClass}">${statusText}</strong>
            </div>
            <div class="run-timing-line">
                ${timeDisplay}
            </div>
            ${durationDisplay ? `<div class="run-duration-line">${durationDisplay}</div>` : ""}
            <div class="run-meta">
                <span>Branch: ${branch}</span> |
                <span>Commit: ${commitSha}</span> |
                <span>Run: ${run.id}</span> |
                <span>Trigger: ${triggerInfo}</span>
            </div>
            ${parentRunDisplay}
        </a>
    `;
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
    updateCurrentReleaseSummary(stageStatuses, pipelineStatus);

    console.log("Stage statuses:", stageStatuses);
    console.log("Overall pipeline status:", pipelineStatus);
}

function updateCurrentReleaseHeaderColors(status) {
    const releaseHeader = document.getElementById("current-release-header");
    const detailsHeader = document.getElementById("current-details-header");

    // Update headers with status
    setElementStatus(releaseHeader, status, "status-");
    setElementStatus(detailsHeader, status, "status-");
}

function updateCurrentReleaseSummary(stageStatuses, pipelineStatus) {
    const glDays = getGlDays();
    const formattedDate = formatDetailedDate(glDays);

    // Update GL version and date
    const currentGlVersionElement =
        document.getElementById("current-gl-version");
    const currentDateElement = document.getElementById("current-date");

    if (currentGlVersionElement) {
        currentGlVersionElement.textContent = `GL ${glDays}`;
        // Add status class to GL version badge
        setElementStatus(currentGlVersionElement, pipelineStatus);
    }

    if (currentDateElement) {
        currentDateElement.textContent = formattedDate;
    }

    // Update overall status indicator
    const currentStatusIndicator = document.getElementById(
        "current-status-indicator"
    );
    if (currentStatusIndicator) {
        setElementStatus(currentStatusIndicator, pipelineStatus);
        currentStatusIndicator.title = `Overall Status: ${pipelineStatus}`;
    }

    // Update stage dots
    for (let i = 1; i <= 4; i++) {
        const stageDot = document.getElementById(`current-stage-${i}`);
        if (stageDot) {
            const stageStatus = stageStatuses[`stage-${i}`] || "unknown";
            setElementStatus(stageDot, stageStatus);
        }
    }

    // Update summary text
    const currentSummaryElement = document.getElementById("current-summary");
    if (currentSummaryElement) {
        if (pipelineStatus === "success") {
            currentSummaryElement.textContent = "Release successful";
        } else if (pipelineStatus === "progress") {
            currentSummaryElement.textContent = "Pipeline in progress";
        } else if (pipelineStatus === "failure") {
            currentSummaryElement.textContent = "Pipeline failures";
        } else if (pipelineStatus === "warning") {
            currentSummaryElement.textContent = "Issues detected";
        } else {
            currentSummaryElement.textContent = "Status loading...";
        }
    }

    // Update package status
    const currentPackageStatusElement = document.getElementById(
        "current-package-status"
    );
    if (currentPackageStatusElement) {
        if (packageStatus === "warning") {
            const packageStatusElement =
                document.getElementById("package-status");
            const packageText = packageStatusElement
                ? packageStatusElement.textContent
                : "Package issues detected";
            currentPackageStatusElement.textContent = packageText.replace(
                "packages need attention",
                "pkg issues"
            );
        } else if (packageStatus === "success") {
            currentPackageStatusElement.textContent = "All packages OK";
        } else if (packageStatus === "no-data") {
            currentPackageStatusElement.textContent = "No package data";
        } else if (packageStatus === "api-error") {
            currentPackageStatusElement.textContent = "Package data error";
        } else {
            currentPackageStatusElement.textContent = "Loading packages...";
        }
    }

    // Update duration with calculated pipeline duration
    const currentDurationElement = document.getElementById("current-duration");
    if (currentDurationElement) {
        const duration = calculatePipelineDuration(
            stageStatuses,
            pipelineStatus
        );
        currentDurationElement.textContent = duration;
        currentDurationElement.title = "Duration of stages 3 and 4";
    }
}

// Helper function to calculate overall pipeline duration
function calculatePipelineDuration(stageStatuses, pipelineStatus) {
    // Always try to calculate actual duration from Stage 3 to Stage 4 first
    const stage3Workflows = [WORKFLOW_IDS.NIGHTLY, WORKFLOW_IDS.MANUAL_RELEASE];
    const stage4Workflows = [
        WORKFLOW_IDS.PUBLISH_GHCR,
        WORKFLOW_IDS.PUBLISH_S3,
    ];
    let earliestStage3Start = null;
    let latestStage4End = null;
    let hasInProgressWorkflows = false;

    // Find earliest Stage 3 start time and check for in-progress workflows
    for (const workflowId of stage3Workflows) {
        if (workflowRunData && workflowRunData[workflowId]) {
            const runData = workflowRunData[workflowId];

            // Check if workflow is in progress
            if (
                runData.status === "in_progress" ||
                runData.status === "queued"
            ) {
                hasInProgressWorkflows = true;
            }

            // Get start time from completed or in-progress workflows
            if (
                runData.status === "completed" ||
                runData.status === "in_progress" ||
                runData.status === "queued"
            ) {
                const startTime = new Date(runData.created_at);
                if (!earliestStage3Start || startTime < earliestStage3Start) {
                    earliestStage3Start = startTime;
                }
            }
        }
    }

    // Find latest Stage 4 end time and check for in-progress workflows
    for (const workflowId of stage4Workflows) {
        if (workflowRunData && workflowRunData[workflowId]) {
            const runData = workflowRunData[workflowId];

            // Check if workflow is in progress
            if (
                runData.status === "in_progress" ||
                runData.status === "queued"
            ) {
                hasInProgressWorkflows = true;
            }

            // Only use end time from completed workflows
            if (runData.status === "completed") {
                const endTime = new Date(runData.updated_at);
                if (!latestStage4End || endTime > latestStage4End) {
                    latestStage4End = endTime;
                }
            }
        }
    }

    // If we have a start time, calculate duration
    if (earliestStage3Start) {
        let endTime;
        let isRunning = false;

        // If there are in-progress workflows or no completed Stage 4, use current time
        if (hasInProgressWorkflows || !latestStage4End) {
            endTime = new Date(); // Current time
            isRunning = true;
        } else {
            endTime = latestStage4End; // Completed pipeline
        }

        const durationMs = endTime - earliestStage3Start;
        if (durationMs > 0) {
            const durationHours = Math.floor(durationMs / 3600000);
            const durationMinutes = Math.floor((durationMs % 3600000) / 60000);

            let durationText;
            if (durationHours > 0) {
                durationText = `${durationHours}h ${durationMinutes}m`;
            } else {
                durationText = `${durationMinutes}m`;
            }

            // Add "(running)" indicator if pipeline is still in progress
            if (isRunning) {
                durationText += " (running)";
            }

            return durationText;
        }
    }

    // Fallback to status-based messages only if duration calculation isn't possible
    if (pipelineStatus === "progress" || pipelineStatus === "unknown") {
        return "In progress...";
    } else if (pipelineStatus === "failure") {
        return "Pipeline failed";
    } else if (pipelineStatus === "warning") {
        return "Issues detected";
    }

    return "Completed";
}

// ========================================
// COLOR MANAGEMENT & VISUAL UPDATES
// ========================================
function updateStageColor(stageId, status) {
    const stage = document.getElementById(stageId);
    setElementStatus(stage, status, "stage-");
}

function updatePipelineColor(status) {
    const pipelineContainer = document.getElementById("pipeline-container");
    setElementStatus(pipelineContainer, status, "pipeline-");
}

export function updateHeaderColor(status) {
    const headerElement = document.getElementById("gl-days");
    if (!headerElement) return;

    // Remove existing header status classes
    headerElement.classList.remove(
        "header-success",
        "header-failure",
        "header-progress",
        "header-warning",
        "header-unknown"
    );

    // Map statuses to header classes
    const statusMap = {
        success: "header-success",
        failure: "header-failure",
        progress: "header-progress",
        warning: "header-warning",
        unknown: "header-unknown",
        error: "header-failure", // Map error to failure for header
        "no-data": "header-unknown",
    };

    const headerClass = statusMap[status];
    if (headerClass) {
        headerElement.classList.add(headerClass);
    }
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
            <div style="text-align: center; padding: 20px; color: var(--text-secondary);">
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

function calculateTargetDate(glDays) {
    const initialDay = new Date(GL_INITIAL_DATE);
    const targetDate = new Date(initialDay);
    targetDate.setDate(targetDate.getDate() + glDays);
    targetDate.setHours(0, 0, 0, 0);
    return targetDate;
}

// Helper function to calculate historic pipeline duration
function calculateHistoricPipelineDuration(workflowRunData) {
    const stage3Workflows = [WORKFLOW_IDS.NIGHTLY, WORKFLOW_IDS.MANUAL_RELEASE];
    const stage4Workflows = [
        WORKFLOW_IDS.PUBLISH_GHCR,
        WORKFLOW_IDS.PUBLISH_S3,
    ];
    let earliestStage3Start = null;
    let latestStage4End = null;

    // Find earliest Stage 3 start time
    for (const workflowId of stage3Workflows) {
        if (workflowRunData && workflowRunData[workflowId]) {
            const runData = workflowRunData[workflowId];
            if (
                runData.status === "completed" ||
                runData.status === "in_progress" ||
                runData.status === "queued"
            ) {
                const startTime = new Date(runData.created_at);
                if (!earliestStage3Start || startTime < earliestStage3Start) {
                    earliestStage3Start = startTime;
                }
            }
        }
    }

    // Find latest Stage 4 end time (only from completed workflows for historic data)
    for (const workflowId of stage4Workflows) {
        if (workflowRunData && workflowRunData[workflowId]) {
            const runData = workflowRunData[workflowId];
            if (runData.status === "completed") {
                const endTime = new Date(runData.updated_at);
                if (!latestStage4End || endTime > latestStage4End) {
                    latestStage4End = endTime;
                }
            }
        }
    }

    // Calculate duration if we have both start and end times
    if (earliestStage3Start && latestStage4End) {
        const durationMs = latestStage4End - earliestStage3Start;
        if (durationMs > 0) {
            const durationHours = Math.floor(durationMs / 3600000);
            const durationMinutes = Math.floor((durationMs % 3600000) / 60000);

            if (durationHours > 0) {
                return `${durationHours}h ${durationMinutes}m`;
            } else {
                return `${durationMinutes}m`;
            }
        }
    }

    // Return null if duration can't be calculated
    return null;
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

        // Calculate pipeline duration
        const duration = calculateHistoricPipelineDuration(workflowRunData);

        return {
            glDays,
            date: glDate,
            packageStatus,
            workflowStatus,
            duration, // Add duration to the historic data
            overallStatus: calculateOverallStatus(
                packageStatus,
                workflowStatus
            ),
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

    const targetDate = calculateTargetDate(glDays);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // Expand date range slightly to catch runs that might be on boundary
    const prevDay = new Date(targetDate);
    prevDay.setDate(prevDay.getDate() - 1);
    prevDay.setHours(20, 0, 0, 0); // Start from 8 PM previous day

    const nextDayExpanded = new Date(nextDay);
    nextDayExpanded.setHours(4, 0, 0, 0); // End at 4 AM next day

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

                // Filter runs for the expanded target date range
                const dayRuns = runs.filter((run) => {
                    const runDate = new Date(run.created_at);
                    return runDate >= prevDay && runDate < nextDayExpanded;
                });

                if (dayRuns.length > 0) {
                    // Sort by creation date (newest first) and take the latest
                    const sortedRuns = dayRuns.sort(
                        (a, b) =>
                            new Date(b.created_at) - new Date(a.created_at)
                    );
                    const latestRun = sortedRuns[0];

                    let status = "unknown";
                    if (latestRun.status === "in_progress") {
                        status = "progress";
                    } else if (latestRun.status === "completed") {
                        status =
                            latestRun.conclusion === "success"
                                ? "success"
                                : "failure";
                    } else if (latestRun.status === "queued") {
                        status = "progress";
                    }

                    console.log(
                        `Historic ${workflow.name} GL${glDays}: ${status} (${dayRuns.length} runs found)`
                    );
                    return {
                        workflow,
                        status,
                        reason: `Found ${dayRuns.length} runs`,
                        runData: latestRun, // Store the actual run data
                    };
                } else {
                    console.log(
                        `Historic ${workflow.name} GL${glDays}: unknown (no runs found)`
                    );
                    return {
                        workflow,
                        status: "unknown",
                        reason: "No runs found",
                        runData: null,
                    };
                }
            } catch (error) {
                if (error.name === "AbortError") {
                    console.warn(
                        `Historic ${workflow.name} (${workflow.id}) timed out`
                    );
                    return {
                        workflow,
                        status: "unknown",
                        reason: "Timeout",
                        runData: null,
                    };
                } else {
                    console.warn(
                        `Historic ${workflow.name} (${workflow.id}) failed:`,
                        error.message
                    );
                    return {
                        workflow,
                        status: "unknown",
                        reason: error.message,
                        runData: null,
                    };
                }
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

function calculateOverallStatus(packageStatus, workflowStatus) {
    // Priority: failure > warning > progress > unknown > success
    // Use computed stage statuses for stages 2-4 only (stage-1 comes from packageStatus)
    const workflowStageStatuses = [
        workflowStatus["stage-2"],
        workflowStatus["stage-3"],
        workflowStatus["stage-4"],
    ].filter((status) => status !== undefined);

    // Check for any failures (highest priority)
    if (
        packageStatus.status === "error" ||
        workflowStageStatuses.includes("failure")
    ) {
        return "failure";
    }

    // Check for warning states (second priority)
    if (packageStatus.status === "warning") {
        return "warning";
    }

    // Check for progress states (third priority)
    if (workflowStageStatuses.includes("progress")) {
        return "progress";
    }

    // Check for unknown states (fourth priority) - if any workflow stage is unknown, overall is unknown
    if (workflowStageStatuses.includes("unknown")) {
        return "unknown";
    }

    // Check for success (fifth priority) - package must be successful and at least one workflow stage successful
    if (
        packageStatus.status === "success" &&
        workflowStageStatuses.includes("success") &&
        !workflowStageStatuses.includes("unknown")
    ) {
        return "success";
    }

    // Default to unknown for any other combination
    return "unknown";
}

function renderHistoricReleases(historicData) {
    const historicList = document.getElementById("historic-releases-list");

    if (historicData.length === 0) {
        historicList.innerHTML = `
            <div class="historic-loading">
                No historic data available for the last 14 days.
            </div>
        `;
        return;
    }

    historicList.innerHTML = historicData
        .map(
            (day) => `
        <a href="?gl=${day.glDays}&no_historic_releases=true" target="_blank" class="historic-release-row" title="View detailed dashboard for GL ${day.glDays}">
            <div class="historic-gl-version ${day.overallStatus}">GL ${day.glDays}</div>
            <div class="historic-date">${day.date}</div>

            <div class="historic-overall-status">
                <span class="historic-status-indicator ${day.overallStatus}"
                      title="Overall Status: ${day.overallStatus}"></span>
            </div>

            <div class="historic-stages" title="Stages: Package | Repo | Build | Publish">
                <span class="historic-stage-dot ${getStageColorClass(day.packageStatus)}" title="Package Builds"></span>
                <span class="historic-stage-dot ${day.workflowStatus?.["stage-2"] || "unknown"}" title="Repository"></span>
                <span class="historic-stage-dot ${day.workflowStatus?.["stage-3"] || "unknown"}" title="Build & Release"></span>
                <span class="historic-stage-dot ${day.workflowStatus?.["stage-4"] || "unknown"}" title="Publish"></span>
            </div>

            <div class="historic-package-status">
                ${
                    day.packageStatus.status === "success"
                        ? "All packages OK"
                        : day.packageStatus.status === "warning"
                          ? `${day.packageStatus.issueCount || 0} pkg issues`
                          : day.packageStatus.status === "error"
                            ? "Package data error"
                            : day.packageStatus.status === "loading"
                              ? "Loading packages..."
                              : "No package data"
                }
            </div>

            <div class="historic-duration" title="Duration of stages 3 and 4">
                ${day.duration || "No data"}
            </div>

            <div class="historic-summary">
                ${
                    day.overallStatus === "success"
                        ? "Release successful"
                        : day.overallStatus === "progress"
                          ? "Pipeline in progress"
                          : day.overallStatus === "failure"
                            ? "Pipeline failures"
                            : day.overallStatus === "warning"
                              ? "Issues detected"
                              : "Status loading..."
                }
            </div>
        </a>
    `
        )
        .join("");
}

// Helper function to convert package status to stage color class
function getStageColorClass(packageStatus) {
    switch (packageStatus.status) {
        case "success":
            return "success";
        case "warning":
            return "warning";
        case "error":
            return "failure";
        case "no-data":
            return "unknown";
        default:
            return "unknown";
    }
}

// ========================================
// PARENT WORKFLOW UTILITIES
// ========================================

/**
 * Download and extract artifact data to find parent workflow information
 */
async function downloadAndExtractArtifact(owner, repo, artifact) {
    try {
        console.log(
            `🔍 [DEBUG] Attempting to download artifact ${artifact.name} (ID: ${artifact.id})...`
        );

        // Check if artifact name is in allowed list
        const isAllowed = ALLOWED_ARTIFACT_NAMES.some((allowedName) =>
            artifact.name.toLowerCase().includes(allowedName.toLowerCase())
        );

        if (!isAllowed) {
            console.log(
                `🔍 [DEBUG] Artifact ${artifact.name} not in allowed list, skipping download`
            );
            return {
                success: false,
                reason: "not_allowed",
                message: `Artifact name '${artifact.name}' not in allowed list: ${ALLOWED_ARTIFACT_NAMES.join(", ")}`,
            };
        }

        const downloadResponse = await fetch(
            `${API_CONFIG.GITHUB_API_BASE}/repos/${owner}/${repo}/actions/artifacts/${artifact.id}/zip`,
            {
                headers: getAuthHeaders(),
            }
        );

        if (!downloadResponse.ok) {
            const status = downloadResponse.status;
            if (status === 401 || status === 403) {
                return {
                    success: false,
                    reason: "auth_required",
                    message: `${status}: Authentication required`,
                    status: status,
                };
            } else {
                return {
                    success: false,
                    reason: "download_failed",
                    message: `${status}: ${downloadResponse.statusText}`,
                    status: status,
                };
            }
        }

        console.log(
            `🔍 [DEBUG] Successfully downloaded artifact ${artifact.name}`
        );

        const arrayBuffer = await downloadResponse.arrayBuffer();
        const zip = new JSZip();
        const loadedZip = await zip.loadAsync(arrayBuffer);

        console.log(
            `🔍 [DEBUG] ZIP file loaded, contains ${Object.keys(loadedZip.files).length} files`
        );

        // Extract and parse files
        const extractedData = {};
        let jobId = null;
        let parentRunId = null;

        for (const [filename, file] of Object.entries(loadedZip.files)) {
            if (!file.dir) {
                console.log(`🔍 [DEBUG] Extracting file: ${filename}`);
                const content = await file.async("text");
                extractedData[filename] = content;

                // Try to parse as JSON if possible
                try {
                    if (filename.toLowerCase().endsWith(".json")) {
                        const jsonData = JSON.parse(content);
                        extractedData[filename + "_parsed"] = jsonData;

                        // Look for id in the JSON data
                        if (jsonData.id && !parentRunId) {
                            parentRunId = jsonData.id;
                            console.log(
                                `🔍 [DEBUG] Found parent run id in ${filename}: ${parentRunId}`
                            );
                        }
                    }
                } catch (parseError) {
                    console.log(
                        `🔍 [DEBUG] Could not parse ${filename} as JSON`
                    );
                }
            }
        }

        return {
            success: true,
            extractedData: extractedData,
            jobId: jobId,
            parentRunId: parentRunId,
            fileCount: Object.keys(extractedData).length,
            message: `Successfully extracted ${Object.keys(extractedData).length} files`,
        };
    } catch (error) {
        console.error(
            `🔍 [DEBUG] Error downloading/extracting artifact:`,
            error
        );
        return {
            success: false,
            reason: "extraction_error",
            message: error.message,
            error: error,
        };
    }
}

/**
 * Get parent workflow information and artifacts
 */
async function getParentWorkflowInfo(owner, repo, runId) {
    try {
        console.log(`🔍 [DEBUG] Fetching artifacts for run ${runId}...`);

        const artifactsResponse = await fetch(
            `${API_CONFIG.GITHUB_API_BASE}/repos/${owner}/${repo}/actions/runs/${runId}/artifacts`,
            {
                headers: getAuthHeaders(),
            }
        );

        if (!artifactsResponse.ok) {
            return {
                found: false,
                message: `Failed to fetch artifacts: ${artifactsResponse.status} ${artifactsResponse.statusText}`,
                error: `API Error: ${artifactsResponse.status}`,
            };
        }

        const artifactsData = await artifactsResponse.json();
        const artifacts = artifactsData.artifacts || [];

        console.log(
            `🔍 [DEBUG] Found ${artifacts.length} artifacts for run ${runId}`
        );

        if (artifacts.length === 0) {
            return {
                found: false,
                message: "No artifacts found for this run",
            };
        }

        // Enhanced parent workflow artifact detection
        // Look for artifacts that likely contain parent workflow information
        const parentWorkflowArtifacts = artifacts.filter(
            (artifact) =>
                artifact.name &&
                // Check if artifact name is in allowed list for download
                ALLOWED_ARTIFACT_NAMES.some((allowedName) =>
                    artifact.name
                        .toLowerCase()
                        .includes(allowedName.toLowerCase())
                )
        );

        console.log(
            `🔍 [DEBUG] Found ${parentWorkflowArtifacts.length} allowed parent workflow artifacts:`,
            parentWorkflowArtifacts.map((a) => a.name)
        );

        // Try to download and extract allowed artifacts first
        if (parentWorkflowArtifacts.length > 0) {
            for (const artifact of parentWorkflowArtifacts) {
                const extractionResult = await downloadAndExtractArtifact(
                    owner,
                    repo,
                    artifact
                );

                if (extractionResult.success && extractionResult.parentRunId) {
                    return {
                        found: true,
                        message:
                            "Parent run ID extracted from downloaded artifact",
                        artifactId: artifact.id,
                        artifactName: artifact.name,
                        parentRunId: extractionResult.parentRunId.toString(),
                        jobId: extractionResult.jobId,
                        extractionMethod: "artifact_download_extraction",
                        extractedData: extractionResult.extractedData,
                        fileCount: extractionResult.fileCount,
                    };
                } else if (extractionResult.success) {
                    // Downloaded successfully but no parent run ID found
                    console.log(
                        `🔍 [DEBUG] Downloaded ${artifact.name} but no parent run ID found in content`
                    );
                } else {
                    // Download failed
                    console.log(
                        `🔍 [DEBUG] Failed to download ${artifact.name}: ${extractionResult.message}`
                    );
                }
            }
        }

        // Enhanced detection for all artifacts that might contain parent workflow information
        const allParentWorkflowArtifacts = artifacts.filter(
            (artifact) =>
                artifact.name && artifact.name === "parent-workflow-data"
        );

        if (allParentWorkflowArtifacts.length > 0) {
            for (const artifact of allParentWorkflowArtifacts) {
                const extractionResult = await downloadAndExtractArtifact(
                    owner,
                    repo,
                    artifact
                );

                if (extractionResult.success && extractionResult.parentRunId) {
                    return {
                        found: true,
                        message:
                            "Parent run ID extracted from downloaded artifact",
                        artifactId: artifact.id,
                        artifactName: artifact.name,
                        parentRunId: extractionResult.parentRunId.toString(),
                        jobId: extractionResult.jobId,
                        extractionMethod: "artifact_download_extraction",
                        extractedData: extractionResult.extractedData,
                        fileCount: extractionResult.fileCount,
                    };
                } else if (extractionResult.success) {
                    // Downloaded successfully but no parent run ID found
                    console.log(
                        `🔍 [DEBUG] Downloaded ${artifact.name} but no parent run ID found in content`
                    );
                } else {
                    // Download failed
                    console.log(
                        `🔍 [DEBUG] Failed to download ${artifact.name}: ${extractionResult.message}`
                    );
                }
            }

            return {
                found: false,
                message: `Found no allowed artifacts`,
                artifactCount: artifacts.length,
                availableArtifacts: artifacts.slice(0, 10).map((a) => a.name), // Show first 10 artifact names
                extractionMethod: "no_parent_indicators",
            };
        }
    } catch (error) {
        console.error(`🔍 [DEBUG] Error fetching parent workflow info:`, error);
        return {
            found: false,
            message: "Error fetching artifact information",
            error: error.message,
            extractionMethod: "error",
        };
    }
}
