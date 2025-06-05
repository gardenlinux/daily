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
    shouldLoadHistoricReleases,
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
    getAllWorkflowConfigs,
} from "./constants.js";

// ========================================
// GLOBAL STATE MANAGEMENT
// ========================================
// Global state for tracking workflow and package status
let workflowStatuses = {};
let packageStatus = "unknown";

// ========================================
// WORKFLOW STATUS MANAGEMENT
// ========================================
export async function getRun() {
    // Use workflow configurations from constants
    const reposWorkflows = getAllWorkflowConfigs();

    // Reset workflow statuses
    workflowStatuses = {};

    // Calculate the target date based on GL version
    const glDays = getGlDays();
    const initialDay = new Date(GL_INITIAL_DATE);
    const targetDate = new Date(initialDay);
    targetDate.setDate(targetDate.getDate() + glDays);
    targetDate.setHours(0, 0, 0, 0);

    // Not used but could be useful for future date range filtering
    // const targetDateStart = targetDate.toISOString();
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);
    // const nextDayStart = nextDay.toISOString();

    const tagName = `${glDays}.0`;

    // First, fetch nightly workflow runs to use for SHA matching
    // Not currently used but may be needed for future SHA-based filtering
    // let nightlyRuns = [];
    try {
        const nightlyResponse = await fetch(
            `${API_CONFIG.GITHUB_API_BASE}/repos/${API_CONFIG.GARDENLINUX_ORG}/gardenlinux/actions/workflows/${WORKFLOW_IDS.NIGHTLY}/runs?per_page=${API_CONFIG.MAX_RUNS_PER_PAGE}&branch=main`,
            {
                headers: getAuthHeaders(),
            }
        );
        if (nightlyResponse.ok) {
            // const nightlyData = await nightlyResponse.json();
            // nightlyRuns = nightlyData.workflow_runs || [];
        }
    } catch (error) {
        console.error("Failed to fetch nightly runs for SHA matching:", error);
    }

    for await (const workflow of reposWorkflows) {
        let apiUrl;

        // Only filter by daily tag for the repo build workflow
        if (workflow.id === WORKFLOW_IDS.REPO_BUILD) {
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
                apiUrl = `${API_CONFIG.GITHUB_API_BASE}/repos/${API_CONFIG.GARDENLINUX_ORG}/${workflow.repo}/actions/workflows/${workflow.id}/runs?per_page=50&branch=main`;
            }
        } else {
            apiUrl = `${API_CONFIG.GITHUB_API_BASE}/repos/${API_CONFIG.GARDENLINUX_ORG}/${workflow.repo}/actions/workflows/${workflow.id}/runs?per_page=50&branch=main`;
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
            workflowDomElement.classList.add("api-error");
            const detailsDiv = document.createElement("div");
            detailsDiv.className = "workflow-details";
            detailsDiv.innerHTML = `<div class="error-message">API Error: ${response.status} ${response.statusText}</div>`;
            workflowDomElement.appendChild(detailsDiv);

            // Track status for color coding
            workflowStatuses[workflow.id] = "api-error";
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
            workflowDomElement.classList.add("api-error");
            const detailsDiv = document.createElement("div");
            detailsDiv.className = "workflow-details";
            detailsDiv.innerHTML =
                '<div class="error-message">No workflow runs data</div>';
            workflowDomElement.appendChild(detailsDiv);

            // Track status for color coding
            workflowStatuses[workflow.id] = "api-error";
            continue;
        }

        // Filter runs for the target date (current day or historic day)
        const targetRunsUnsorted = workflowRuns.filter((run) => {
            const runDate = new Date(run.created_at);
            return runDate >= targetDate && runDate < nextDay;
        });

        // Sort target runs by run.id in descending order (newest first)
        const targetRuns = targetRunsUnsorted.sort((a, b) => b.id - a.id);

        const workflowDomElement = document.getElementById(
            `daily-info-${workflow.id}`
        );

        // Clear existing content
        const existingDetails =
            workflowDomElement.querySelector(".workflow-details");
        if (existingDetails) {
            existingDetails.remove();
        }

        // Reset classes
        workflowDomElement.className = workflowDomElement.className.replace(
            /\b(progress|success|failure|no-runs|api-error)\b/g,
            ""
        );

        if (targetRuns.length === 0) {
            // Handles the case where targetRuns might be empty after filtering
            workflowDomElement.classList.add("no-runs");
            const detailsDiv = document.createElement("div");
            detailsDiv.className = "workflow-details";
            const dateStr = targetDate.toLocaleDateString();
            detailsDiv.innerHTML = `<div class="no-runs-message">No runs found for ${
                isHistoricView() ? `historic date ${dateStr}` : "today"
            }</div>`;
            workflowDomElement.appendChild(detailsDiv);

            // Track status for color coding
            workflowStatuses[workflow.id] = "no-runs";
            continue;
        }

        // Determine overall status based on the most recent run
        // After sorting by ID descending, the first element is the most recent
        const mostRecentRun = targetRuns.length > 0 ? targetRuns[0] : null;

        if (!mostRecentRun) {
            // Handles the case where targetRuns might be empty after filtering
            workflowDomElement.classList.add("no-runs");
            const detailsDiv = document.createElement("div");
            detailsDiv.className = "workflow-details";
            const dateStr = targetDate.toLocaleDateString();
            detailsDiv.innerHTML = `<div class="no-runs-message">No runs found for ${
                isHistoricView() ? `historic date ${dateStr}` : "today"
            }</div>`;
            workflowDomElement.appendChild(detailsDiv);

            // Track status for color coding
            workflowStatuses[workflow.id] = "no-runs";
            continue;
        }

        let workflowStatus = "unknown";
        if (mostRecentRun.status === "in_progress") {
            workflowDomElement.classList.add("progress");
            workflowStatus = "progress";
        } else if (mostRecentRun.status === "queued") {
            workflowDomElement.classList.add("queued");
            workflowStatus = "queued";
        } else if (mostRecentRun.status === "completed") {
            if (mostRecentRun.conclusion === "success") {
                workflowDomElement.classList.add("success");
                workflowStatus = "success";
            } else {
                workflowDomElement.classList.add("failure");
                workflowStatus = "failure";
            }
        } else {
            workflowDomElement.classList.add("queued");
            workflowStatus = "queued";
        }

        // Track status for color coding
        workflowStatuses[workflow.id] = workflowStatus;

        // Create details section for all runs
        const detailsDiv = document.createElement("div");
        detailsDiv.className = "workflow-details";

        // Iterate over the sorted runs (descending by ID - newest first)
        targetRuns.forEach(async (run, _index) => {
            const runDiv = document.createElement("div");
            runDiv.className = "run-item";

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

            const createdTime = new Date(run.created_at).toLocaleTimeString();
            const updatedTime = new Date(run.updated_at).toLocaleTimeString();

            // Calculate duration for completed runs
            let durationText = "";
            if (run.status === "completed") {
                const startTime = new Date(run.created_at);
                const endTime = new Date(run.updated_at);
                const durationMs = endTime - startTime;

                const durationHours = Math.floor(durationMs / 3600000); // 1 hour = 3600000ms
                const durationMinutes = Math.floor(
                    (durationMs % 3600000) / 60000
                );
                const durationSeconds = Math.floor((durationMs % 60000) / 1000);

                if (durationHours > 0) {
                    durationText = ` (${durationHours}h ${durationMinutes}m ${durationSeconds}s)`;
                } else {
                    durationText = ` (${durationMinutes}m ${durationSeconds}s)`;
                }
            }

            const branch = run.head_branch || "main";
            const commitSha = run.head_sha
                ? run.head_sha.substring(0, 7)
                : "unknown";

            // Get trigger information for all workflows
            const triggerInfo = await getTriggerInfo(
                API_CONFIG.GARDENLINUX_ORG,
                workflow.repo,
                run
            );

            let timeDisplay = `Start: ${createdTime}`;
            if (run.status === "completed") {
                timeDisplay += ` | End: ${updatedTime}${durationText}`;
            } else if (run.status === "in_progress") {
                timeDisplay += " | Running...";
            }

            runDiv.innerHTML = `
                <a href="${run.html_url}" target="_blank" class="run-item-link">
                    <div class="run-status-line">
                        <strong class="status-${statusClass}">${statusText}</strong>
                        <span class="run-time">${timeDisplay}</span>
                    </div>
                    <div class="run-meta">
                        <span>Branch: ${branch}</span> |
                        <span>Commit: ${commitSha}</span> |
                        <span>Run: ${run.id}</span> |
                        <span>Trigger: ${triggerInfo}</span>
                    </div>
                </a>
            `;

            detailsDiv.appendChild(runDiv);
        });

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
                    a.href = `${API_CONFIG.GITHUB_API_BASE.replace("/api.github.com", "")}/repos/${API_CONFIG.GARDENLINUX_ORG}/${
                        pkg.Name
                    }/actions/workflows/build.yml`;
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
            packageSummary.classList.remove("success", "api-error");
            packageSummary.classList.add("warning"); // Use warning (orange) instead of progress
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
            packageSummary.classList.remove("warning", "api-error");
            packageSummary.classList.add("success");
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

        packageSummary.classList.remove("success", "progress");
        packageSummary.classList.add("api-error");
    }

    // Update pipeline hierarchy and colors after package status is loaded
    updatePipelineHierarchy();
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

    // Remove all status classes
    const statusClasses = [
        "status-success",
        "status-failure",
        "status-progress",
        "status-warning",
        "status-unknown",
    ];
    statusClasses.forEach((cls) => {
        releaseHeader.classList.remove(cls);
        detailsHeader.classList.remove(cls);
    });

    // Add the current status class
    const statusClass = `status-${status}`;
    releaseHeader.classList.add(statusClass);
    detailsHeader.classList.add(statusClass);
}

function updateCurrentReleaseSummary(stageStatuses, pipelineStatus) {
    const glDays = getGlDays();
    const formattedDate = formatGLDate(glDays);

    // Update GL version and date
    const currentGlVersionElement =
        document.getElementById("current-gl-version");
    const currentDateElement = document.getElementById("current-date");

    if (currentGlVersionElement) {
        currentGlVersionElement.textContent = `GL ${glDays}`;
        // Add status class to GL version badge
        currentGlVersionElement.classList.remove(
            "success",
            "failure",
            "progress",
            "warning",
            "unknown"
        );
        currentGlVersionElement.classList.add(pipelineStatus);
    }

    if (currentDateElement) {
        currentDateElement.textContent = formattedDate;
    }

    // Update overall status indicator
    const currentStatusIndicator = document.getElementById(
        "current-status-indicator"
    );
    if (currentStatusIndicator) {
        currentStatusIndicator.classList.remove(
            "success",
            "failure",
            "progress",
            "warning",
            "unknown"
        );
        currentStatusIndicator.classList.add(pipelineStatus);
        currentStatusIndicator.title = `Overall Status: ${pipelineStatus}`;
    }

    // Update stage dots
    for (let i = 1; i <= 4; i++) {
        const stageDot = document.getElementById(`current-stage-${i}`);
        if (stageDot) {
            const stageStatus = stageStatuses[`stage-${i}`] || "unknown";
            stageDot.classList.remove(
                "success",
                "failure",
                "progress",
                "warning",
                "unknown"
            );
            stageDot.classList.add(stageStatus);
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
}

// ========================================
// COLOR MANAGEMENT & VISUAL UPDATES
// ========================================
function updateStageColor(stageId, status) {
    const stage = document.getElementById(stageId);
    if (!stage) return;

    // Remove all existing stage status classes
    stage.classList.remove(
        "stage-success",
        "stage-failure",
        "stage-progress",
        "stage-warning",
        "stage-unknown",
        "stage-error"
    );

    // Add the appropriate status class
    stage.classList.add(`stage-${status}`);
}

function updatePipelineColor(status) {
    const pipelineContainer = document.getElementById("pipeline-container");
    if (!pipelineContainer) return;

    // Remove all existing pipeline status classes
    pipelineContainer.classList.remove(
        "pipeline-success",
        "pipeline-failure",
        "pipeline-progress",
        "pipeline-warning",
        "pipeline-unknown",
        "pipeline-error"
    );

    // Add the appropriate status class
    pipelineContainer.classList.add(`pipeline-${status}`);
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

async function loadHistoricDay(glDays) {
    try {
        // Get basic info
        const glDate = formatGLDate(glDays);

        // Load package status for this day
        const packageStatus = await getHistoricPackageStatus(glDays);

        // Load workflow statuses for this day (simplified)
        const workflowStatus = await getHistoricWorkflowStatus(glDays);

        return {
            glDays,
            date: glDate,
            packageStatus,
            workflowStatus,
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
                    `${API_CONFIG.GITHUB_API_BASE}/repos/${API_CONFIG.GARDENLINUX_ORG}/${workflow.repo}/actions/workflows/${workflow.id}/runs?per_page=${API_CONFIG.HISTORIC_RUNS_PER_PAGE}&branch=main`,
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
                    };
                } else {
                    console.log(
                        `Historic ${workflow.name} GL${glDays}: unknown (no runs found)`
                    );
                    return {
                        workflow,
                        status: "unknown",
                        reason: "No runs found",
                    };
                }
            } catch (error) {
                if (error.name === "AbortError") {
                    console.warn(
                        `Historic ${workflow.name} (${workflow.id}) timed out`
                    );
                    return { workflow, status: "unknown", reason: "Timeout" };
                } else {
                    console.warn(
                        `Historic ${workflow.name} (${workflow.id}) failed:`,
                        error.message
                    );
                    return {
                        workflow,
                        status: "unknown",
                        reason: error.message,
                    };
                }
            }
        });

        // Wait for all API calls to complete
        const results = await Promise.allSettled(promises);

        // Process results with stage-specific logic
        const stageResults = {
            "stage-2": [],
            "stage-3": [],
            "stage-4": [],
        };

        for (const result of results) {
            if (result.status === "fulfilled" && result.value) {
                const { workflow, status } = result.value;
                stageResults[workflow.stage].push(status);
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
    } catch (error) {
        console.warn(
            `Failed to load historic workflow status for GL ${glDays}:`,
            error
        );
        // On error, all stages remain unknown - no assumptions
    }

    return stageStatuses;
}

function calculateTargetDate(glDays) {
    const initialDay = new Date(GL_INITIAL_DATE);
    const targetDate = new Date(initialDay);
    targetDate.setDate(targetDate.getDate() + glDays);
    targetDate.setHours(0, 0, 0, 0);
    return targetDate;
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
