/**
 * ========================================
 * GARDEN LINUX DASHBOARD - UI RENDERING & DOM MANIPULATION
 * ========================================
 *
 * This file contains all UI rendering and DOM manipulation functions:
 * - Historic releases list rendering and HTML generation
 * - Workflow box HTML generation for pipeline stages
 * - Current release summary updates and status indicators
 * - Pipeline stage color management and status updates
 * - Workflow run item HTML creation with detailed information
 * - Header color updates based on pipeline status
 * - Run status evaluation and duration calculations
 *
 * Handles all visual representation and user interface updates.
 */

import {
    setElementStatus,
    formatDetailedDate,
    calculatePipelineDuration,
    formatDateTimeDetailed,
    getTriggerInfo,
} from "./utils.js";
import { WORKFLOW_IDS, API_CONFIG } from "./constants.js";
import { getParentWorkflowInfo } from "./parentWorkflow.js";

// Render the historic releases section
export function renderHistoricReleases(historicData) {
    const historicList = document.getElementById("historic-releases-list");

    if (historicData.length === 0) {
        historicList.innerHTML = `
            <div class="historic-loading">
                No historic data available for the last 14 days.
            </div>
        `;
        return;
    }

    // Safety: Ensure all days have valid pipeline status before rendering
    const safeHistoricData = historicData.map((day) => ({
        ...day,
        pipelineStatus:
            day.pipelineStatus &&
            typeof day.pipelineStatus === "string" &&
            ["success", "failure", "progress", "warning", "unknown"].includes(
                day.pipelineStatus
            )
                ? day.pipelineStatus
                : "unknown",
    }));

    historicList.innerHTML = safeHistoricData
        .map((day) => {
            // Get individual workflow statuses for stages 2, 3, and 4
            const repoUpdateStatus =
                day.workflowStatuses &&
                day.workflowStatuses[WORKFLOW_IDS.REPO_UPDATE]
                    ? day.workflowStatuses[WORKFLOW_IDS.REPO_UPDATE]
                    : "unknown";
            const repoBuildStatus =
                day.workflowStatuses &&
                day.workflowStatuses[WORKFLOW_IDS.REPO_BUILD]
                    ? day.workflowStatuses[WORKFLOW_IDS.REPO_BUILD]
                    : "unknown";
            const nightlyStatus =
                day.workflowStatuses &&
                day.workflowStatuses[WORKFLOW_IDS.NIGHTLY]
                    ? day.workflowStatuses[WORKFLOW_IDS.NIGHTLY]
                    : "unknown";
            const manualReleaseStatus =
                day.workflowStatuses &&
                day.workflowStatuses[WORKFLOW_IDS.MANUAL_RELEASE]
                    ? day.workflowStatuses[WORKFLOW_IDS.MANUAL_RELEASE]
                    : "unknown";
            const publishGhcrStatus =
                day.workflowStatuses &&
                day.workflowStatuses[WORKFLOW_IDS.PUBLISH_GHCR]
                    ? day.workflowStatuses[WORKFLOW_IDS.PUBLISH_GHCR]
                    : "unknown";
            const publishS3Status =
                day.workflowStatuses &&
                day.workflowStatuses[WORKFLOW_IDS.PUBLISH_S3]
                    ? day.workflowStatuses[WORKFLOW_IDS.PUBLISH_S3]
                    : "unknown";

            return `
        <a href="?gl=${day.glDays}&no_historic_releases=true" target="_blank" class="historic-release-row ${day.pipelineStatus}" title="View detailed dashboard for GL ${day.glDays}">
            <div class="historic-gl-version ${day.pipelineStatus}">GL ${day.glDays}</div>
            <div class="historic-date">${day.date}</div>

            <div class="historic-overall-status">
                <span class="historic-status-indicator ${day.pipelineStatus}"
                      title="Overall Status: ${day.pipelineStatus}"></span>
            </div>

            <div class="historic-stages" title="Stages: Package | Repo | Build | Publish">
                <div class="historic-stage-dot-container" title="Package Builds">
                    <span class="historic-stage-dot ${day.workflowStatus && day.workflowStatus["stage-1"] ? day.workflowStatus["stage-1"] : "unknown"}" title="Package Builds"></span>
                </div>
                <div class="historic-stage-dots-stacked" title="Repository">
                    <span class="historic-stage-dot ${repoUpdateStatus}" title="Repo Update"></span>
                    <span class="historic-stage-dot ${repoBuildStatus}" title="Repo Build"></span>
                </div>
                <div class="historic-stage-dots-stacked" title="Build & Release">
                    <span class="historic-stage-dot ${nightlyStatus}" title="Garden Linux Nightly - Schedule"></span>
                    <span class="historic-stage-dot ${manualReleaseStatus}" title="Build and publish a release - Manual"></span>
                </div>
                <div class="historic-stage-dots-stacked" title="Publish">
                    <span class="historic-stage-dot ${publishGhcrStatus}" title="Publish to ghcr.io"></span>
                    <span class="historic-stage-dot ${publishS3Status}" title="Publish to S3"></span>
                </div>
            </div>

            <div class="historic-package-status">
                ${
                    day.packageStatus && day.packageStatus.status === "success"
                        ? "All packages OK"
                        : day.packageStatus &&
                            day.packageStatus.status === "warning"
                          ? `${day.packageStatus.issueCount || 0} pkg issues`
                          : day.packageStatus &&
                              day.packageStatus.status === "error"
                            ? "Package data error"
                            : day.packageStatus &&
                                day.packageStatus.status === "loading"
                              ? "Loading packages..."
                              : "No package data"
                }
            </div>

            <div class="historic-duration" title="Duration of stages 3 and 4">
                ${day.duration || "No data"}
            </div>

            <div class="historic-summary">
                ${
                    day.pipelineStatus === "success"
                        ? "Release successful"
                        : day.pipelineStatus === "progress"
                          ? "Pipeline in progress"
                          : day.pipelineStatus === "failure"
                            ? "Pipeline failures"
                            : day.pipelineStatus === "warning"
                              ? "Issues detected"
                              : "Status loading..."
                }
            </div>
        </a>
    `;
        })
        .join("");
}

// Generate a workflow box for the dashboard
export function generateWorkflowBoxHTML(workflow, API_CONFIG, _WORKFLOWS) {
    return `
        <div id="daily-info-${workflow.id}" class="workflow-box">
            <a href="${API_CONFIG.GITHUB_BASE}/${API_CONFIG.GARDENLINUX_ORG}/${workflow.repo}/actions/workflows/${workflow.workflowFile}" target="_blank">
                ${workflow.name}
            </a>
        </div>
    `;
}

// Update the header colors for the current release and details
export function updateCurrentReleaseHeaderColors(status) {
    const releaseHeader = document.getElementById("current-release-header");
    const detailsHeader = document.getElementById("current-details-header");
    setElementStatus(releaseHeader, status, "status-");
    setElementStatus(detailsHeader, status, "status-");
}

// Update the summary section for the current release
export function updateCurrentReleaseSummary(
    stageStatuses,
    pipelineStatus,
    packageStatus,
    workflowRunData,
    WORKFLOW_IDS,
    getGlDays,
    workflowStatuses = {}
) {
    const glDays = getGlDays();
    const formattedDate = formatDetailedDate(glDays);

    // Update GL version and date
    const currentGlVersionElement =
        document.getElementById("current-gl-version");
    const currentDateElement = document.getElementById("current-date");

    if (currentGlVersionElement) {
        currentGlVersionElement.textContent = `GL ${glDays}`;
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
    // Stage 1: single dot
    const stage1Dot = document.getElementById("current-stage-1");
    if (stage1Dot) {
        const stageStatus = stageStatuses["stage-1"] || "unknown";
        setElementStatus(stage1Dot, stageStatus);
    }

    // Stage 2: stacked dots for individual workflows
    const stage2TopDot = document.getElementById("current-stage-2-top");
    const stage2BottomDot = document.getElementById("current-stage-2-bottom");
    if (stage2TopDot) {
        const repoUpdateStatus =
            workflowStatuses[WORKFLOW_IDS.REPO_UPDATE] || "unknown";
        setElementStatus(stage2TopDot, repoUpdateStatus);
    }
    if (stage2BottomDot) {
        const repoBuildStatus =
            workflowStatuses[WORKFLOW_IDS.REPO_BUILD] || "unknown";
        setElementStatus(stage2BottomDot, repoBuildStatus);
    }

    // Stage 3: stacked dots for individual workflows
    const stage3TopDot = document.getElementById("current-stage-3-top");
    const stage3BottomDot = document.getElementById("current-stage-3-bottom");
    if (stage3TopDot) {
        const nightlyStatus =
            workflowStatuses[WORKFLOW_IDS.NIGHTLY] || "unknown";
        setElementStatus(stage3TopDot, nightlyStatus);
    }
    if (stage3BottomDot) {
        const manualReleaseStatus =
            workflowStatuses[WORKFLOW_IDS.MANUAL_RELEASE] || "unknown";
        setElementStatus(stage3BottomDot, manualReleaseStatus);
    }

    // Stage 4: stacked dots for individual workflows
    const stage4TopDot = document.getElementById("current-stage-4-top");
    const stage4BottomDot = document.getElementById("current-stage-4-bottom");
    if (stage4TopDot) {
        const publishGhcrStatus =
            workflowStatuses[WORKFLOW_IDS.PUBLISH_GHCR] || "unknown";
        setElementStatus(stage4TopDot, publishGhcrStatus);
    }
    if (stage4BottomDot) {
        const publishS3Status =
            workflowStatuses[WORKFLOW_IDS.PUBLISH_S3] || "unknown";
        setElementStatus(stage4BottomDot, publishS3Status);
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
            pipelineStatus,
            workflowRunData,
            WORKFLOW_IDS
        );
        currentDurationElement.textContent = duration;
        currentDurationElement.title = "Duration of stages 3 and 4";
    }
}

// Update the color of a pipeline stage
export function updateStageColor(stageId, status) {
    const stage = document.getElementById(stageId);
    setElementStatus(stage, status, "stage-");
}

// Update the color of the pipeline container
export function updatePipelineColor(status) {
    const pipelineContainer = document.getElementById("pipeline-container");
    setElementStatus(pipelineContainer, status, "pipeline-");
}

// Create HTML for a workflow run item
export async function createRunItemHTML(run, workflow, _useFullDate = false) {
    const { statusClass, statusText } = getRunStatus(run);

    // Check if this is a Stage 4 workflow or cloud cleanup
    const isStage4Workflow = [
        WORKFLOW_IDS.PUBLISH_GHCR,
        WORKFLOW_IDS.PUBLISH_S3,
    ].includes(workflow.id);

    // Use detailed date/time format for all stages and cloud cleanup
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

    // Build the parent run display as a separate element
    let parentRunDisplay = "";
    if (parentRunInfo && parentRunInfo.parentRunId) {
        parentRunDisplay = `
            <div class="parent-run-info">
                <a href="https://github.com/gardenlinux/gardenlinux/actions/runs/${parentRunInfo.parentRunId}" target="_blank" class="parent-run-link" title="View parent workflow run that triggered this">Parent Run: ${parentRunInfo.parentRunId}</a>
            </div>
        `;
    } else if (isStage4Workflow) {
        // Always show parent run info for Stage 4 workflows, even if not found - use same structure
        parentRunDisplay = `
            <div class="parent-run-info">
                <a class="parent-run-unavailable" title="${parentRunInfo?.message || "No parent run information available"}">Parent Run: Not found</a>
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
        </a>
        ${parentRunDisplay}
    `;
}

// Update the header color based on status
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

// Helper function to get run status
export function getRunStatus(run) {
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

// Helper function to calculate duration
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
