/**
 * ========================================
 * GARDEN LINUX DASHBOARD - UTILITY FUNCTIONS & HELPERS
 * ========================================
 *
 * Comprehensive utility library containing shared functions for:
 * - Date and GL version calculations and URL parameter parsing
 * - GitHub API authentication and request headers
 * - UI state management and historic view detection
 * - DOM manipulation utilities and element status management
 * - Data formatting for dates, times, and durations
 * - Pipeline duration calculations for current and historic data
 * - Stage 4 workflow validation and parent run ID collection
 * - Branch search configuration and settings management
 * - Collapsible section toggling and bulk status updates
 * - Helper functions for workflow access and HTML generation
 *
 * Core support library used across all dashboard components.
 */

import {
    GL_INITIAL_DATE,
    WORKFLOWS,
    hasStage4,
    SCHEMA_V2_CUTOFF,
} from "./constants.js";

// ========================================
// DATE AND GL VERSION CALCULATIONS
// ========================================
// URL parameter parsing
export function getUrlParameter(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

export function getGlDaysFromUrl() {
    const glParam = getUrlParameter("gl");
    if (glParam) {
        const glNumber = parseInt(glParam, 10);
        if (!isNaN(glNumber) && glNumber > 0) {
            return glNumber;
        }
    }
    return null;
}

export function getHistoricReleasesCount() {
    const countParam = getUrlParameter("historic_count");
    if (countParam) {
        const count = parseInt(countParam, 10);
        if (!isNaN(count) && count > 0 && count <= 100) {
            return count;
        }
    }
    return 14; // Default value
}

export function getCurrentGlDays() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const initialDay = new Date(GL_INITIAL_DATE);

    const todayTime = today.getTime();
    const initialTime = initialDay.getTime();

    return Math.round((todayTime - initialTime) / (1000 * 60 * 60 * 24));
}

export function getGlDays() {
    // Check for gl parameter in URL first
    const urlParams = new URLSearchParams(window.location.search);
    const glParam = urlParams.get("gl");

    if (glParam && !isNaN(glParam)) {
        return parseInt(glParam, 10);
    }

    // Fall back to current GL days
    return getCurrentGlDays();
}

// Date formatting helpers
export function formatGLDate(glDays) {
    const initialDay = new Date(GL_INITIAL_DATE);
    const targetDate = new Date(initialDay);
    targetDate.setDate(targetDate.getDate() + glDays);

    const options = {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
    };
    return targetDate.toLocaleDateString("en-US", options);
}

export function formatDailyDate(date) {
    const options = {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
    };
    return date.toLocaleDateString("en-US", options);
}

// New format: "Tue, 2025-12-31" for current/historic release details
export function formatDetailedDate(glDays) {
    const initialDay = new Date(GL_INITIAL_DATE);
    const targetDate = new Date(initialDay);
    targetDate.setDate(targetDate.getDate() + glDays);

    const options = {
        weekday: "short",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    };

    // Get the formatted date and adjust the format to match "Tue, 2025-12-31"
    const formatted = targetDate.toLocaleDateString("en-US", options);
    const parts = formatted.split(", ");
    const weekday = parts[0]; // "Tue"
    const datePart = parts[1]; // "12/31/2025"

    // Convert MM/DD/YYYY to YYYY-MM-DD
    const [month, day, year] = datePart.split("/");
    return `${weekday}, ${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

// Format a Date object to "2025-12-31 18:31:45" format
export function formatDetailedDateFromDate(date) {
    const options = {
        weekday: "short",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    };

    // Get the formatted date and adjust the format to match "Tue, 2025-12-31"
    const formatted = date.toLocaleDateString("en-US", options);
    const parts = formatted.split(", ");
    const weekday = parts[0]; // "Tue"
    const datePart = parts[1]; // "12/31/2025"

    // Convert MM/DD/YYYY to YYYY-MM-DD
    const [month, day, year] = datePart.split("/");
    return `${weekday}, ${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

// Format a Date object to "2025-12-31 18:31:45" format for time displays
export function formatDateTimeDetailed(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function updateGLDateInfo(glDays) {
    const dateInfoElement = document.getElementById("gl-date-info");
    if (!dateInfoElement) return;

    const formattedDate = formatGLDate(glDays);
    const currentGL = getCurrentGlDays();
    const isToday = glDays === currentGL;
    const isFuture = glDays > currentGL;

    let statusText = "";
    if (isToday) {
        statusText = " (Today)";
    } else if (isFuture) {
        statusText = ` (${glDays - currentGL} days in future)`;
    } else {
        statusText = ` (${currentGL - glDays} days ago)`;
    }

    dateInfoElement.textContent = `${formattedDate}${statusText}`;
}

// ========================================
// UI STATE HELPERS
// ========================================
export function isHistoricView() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.has("gl");
}

export function shouldLoadHistoricReleases() {
    const urlParams = new URLSearchParams(window.location.search);
    return !urlParams.has("no_historic_releases");
}

// Branch search configuration
export function getBranchParameter() {
    const searchAllBranches = shouldSearchAllBranches();
    return searchAllBranches ? "" : "&branch=main";
}

// Repository workflows run on GL version branches (like 1904.0), not main branch
// So they need to fetch from all branches to find the appropriate runs
export function getRepoBranchParameter() {
    // Always search all branches for repository workflows since they run on GL version branches
    return "";
}

export function shouldSearchAllBranches() {
    // Check URL parameter only
    const urlParams = new URLSearchParams(window.location.search);
    const branchParam = urlParams.get("all_branches");
    return branchParam === "true" || branchParam === "1";
}

// ========================================
// GITHUB API UTILITIES
// ========================================
export function getAuthHeaders() {
    const token = localStorage.getItem("github_token");

    if (token) {
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
    } else {
        return {
            Accept: "application/vnd.github.v3+json",
            "X-GitHub-Api-Version": "2022-11-28",
        };
    }
}

export async function getTriggerInfo(owner, repo, runData) {
    try {
        const event = runData.event;

        switch (event) {
            case "workflow_dispatch":
                return "workflow_dispatch (manual or bot)";
            case "workflow_run":
                return "workflow_run (by workflow)";
            case "schedule":
                return "schedule";
            case "push":
                return "push";
            case "pull_request":
                return "pull_request";
            default:
                return event;
        }
    } catch (error) {
        console.error("[Utils] Failed to get trigger info:", {
            error: error.message,
            stack: error.stack,
            owner,
            repo,
            runData: runData ? { id: runData.id, event: runData.event } : null,
        });
        return "unknown";
    }
}

// ========================================
// DOM UTILITY FUNCTIONS
// ========================================

/**
 * Sets the status class on an element, removing previous status classes
 * @param {HTMLElement} element - Target element
 * @param {string} status - Status to apply (success, failure, progress, warning, unknown)
 * @param {string} prefix - Optional prefix (e.g. 'status-', 'stage-', etc.)
 */
export function setElementStatus(element, status, prefix = "") {
    try {
        if (!element) {
            console.warn(
                "[Utils] setElementStatus called with null/undefined element"
            );
            return;
        }

        const statusClasses = [
            "success",
            "failure",
            "progress",
            "warning",
            "unknown",
            "error",
            "api-error",
            "no-runs",
            "queued",
        ];

        // Remove all existing status classes with prefix
        statusClasses.forEach((cls) => {
            element.classList.remove(`${prefix}${cls}`);
        });

        // Add new status class
        if (status) {
            element.classList.add(`${prefix}${status}`);
        }
    } catch (error) {
        console.error("[Utils] Error setting element status:", {
            error: error.message,
            stack: error.stack,
            elementId: element?.id,
            elementTagName: element?.tagName,
            status,
            prefix,
        });
    }
}

/**
 * Generic toggle function for collapsible sections
 * @param {string} contentId - ID of content element to toggle
 * @param {string} iconId - ID of toggle icon element
 * @param {Function} onExpand - Optional callback when section expands
 */
export function toggleSection(contentId, iconId, onExpand = null) {
    try {
        const content = document.getElementById(contentId);
        const icon = document.getElementById(iconId);

        if (!content || !icon) {
            console.warn(
                "[Utils] toggleSection called with missing elements:",
                {
                    contentId,
                    iconId,
                    contentFound: !!content,
                    iconFound: !!icon,
                }
            );
            return;
        }

        if (
            content.style.display === "none" ||
            !content.classList.contains("expanded")
        ) {
            // Expand section
            content.style.display = "block";
            content.classList.add("expanded");
            icon.classList.add("expanded");
            icon.textContent = "▲";

            // Execute callback if provided
            if (onExpand && !content.dataset.loaded) {
                try {
                    onExpand();
                    content.dataset.loaded = "true";
                } catch (callbackError) {
                    console.error(
                        "[Utils] Error executing toggleSection callback:",
                        {
                            error: callbackError.message,
                            stack: callbackError.stack,
                            contentId,
                            iconId,
                        }
                    );
                }
            }
        } else {
            // Collapse section
            content.classList.remove("expanded");
            icon.classList.remove("expanded");
            icon.textContent = "▼";
            setTimeout(() => {
                if (!content.classList.contains("expanded")) {
                    content.style.display = "none";
                }
            }, 400);
        }
    } catch (error) {
        console.error("[Utils] Error in toggleSection:", {
            error: error.message,
            stack: error.stack,
            contentId,
            iconId,
        });
    }
}

/**
 * Bulk update status classes on multiple elements
 * @param {Array} updates - Array of {element, status, prefix} objects
 */
export function bulkSetElementStatus(updates) {
    try {
        if (!Array.isArray(updates)) {
            console.warn(
                "[Utils] bulkSetElementStatus called with non-array:",
                {
                    updates,
                    type: typeof updates,
                }
            );
            return;
        }

        updates.forEach(({ element, status, prefix = "" }, index) => {
            try {
                setElementStatus(element, status, prefix);
            } catch (itemError) {
                console.error(
                    `[Utils] Error in bulkSetElementStatus item ${index}:`,
                    {
                        error: itemError.message,
                        stack: itemError.stack,
                        elementId: element?.id,
                        status,
                        prefix,
                    }
                );
            }
        });
    } catch (error) {
        console.error("[Utils] Error in bulkSetElementStatus:", {
            error: error.message,
            stack: error.stack,
            updatesLength: updates?.length,
        });
    }
}

// Helper function to calculate overall pipeline duration
export function calculatePipelineDuration(
    stageStatuses,
    pipelineStatus,
    workflowRunData,
    WORKFLOW_IDS,
    glDays
) {
    const stage3Workflows = [WORKFLOW_IDS.NIGHTLY, WORKFLOW_IDS.MANUAL_RELEASE];
    let earliestStage3Start = null;
    let latestEndTime = null;
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

    // Schema v2 (GL >= 2174): Duration is Stage 3 only
    // Schema v1 (GL < 2174): Duration is Stage 3 start → Stage 4 end
    if (hasStage4(glDays)) {
        // v1: Find latest Stage 4 end time
        const stage4Workflows = [
            WORKFLOW_IDS.PUBLISH_GHCR,
            WORKFLOW_IDS.PUBLISH_S3,
        ];
        for (const workflowId of stage4Workflows) {
            if (workflowRunData && workflowRunData[workflowId]) {
                const runData = workflowRunData[workflowId];
                if (runData.status === "completed") {
                    const endTime = new Date(runData.updated_at);
                    if (!latestEndTime || endTime > latestEndTime) {
                        latestEndTime = endTime;
                    }
                }
            }
        }
    } else {
        // v2: Find latest Stage 3 end time
        for (const workflowId of stage3Workflows) {
            if (workflowRunData && workflowRunData[workflowId]) {
                const runData = workflowRunData[workflowId];
                if (runData.status === "completed") {
                    const endTime = new Date(runData.updated_at);
                    if (!latestEndTime || endTime > latestEndTime) {
                        latestEndTime = endTime;
                    }
                }
            }
        }
    }

    // Calculate duration if we have both start and end times
    if (earliestStage3Start && latestEndTime) {
        const durationMs = latestEndTime - earliestStage3Start;
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

    // If any workflow is in progress, show 'in progress'
    if (hasInProgressWorkflows) {
        return "In progress...";
    }

    // Return null if duration can't be calculated
    return null;
}

export function calculateTargetDate(glDays, GL_INITIAL_DATE) {
    const initialDay = new Date(GL_INITIAL_DATE);
    const targetDate = new Date(initialDay);
    targetDate.setDate(targetDate.getDate() + glDays);
    targetDate.setHours(0, 0, 0, 0);

    // Debug GL date calculation
    console.log(`[GL DATE DEBUG] GL${glDays}:`);
    console.log(`  - Initial date: ${GL_INITIAL_DATE}`);
    console.log(`  - Adding ${glDays} days`);
    console.log(`  - Target date: ${targetDate.toISOString().split("T")[0]}`);

    return targetDate;
}

export function calculateHistoricPipelineDuration(
    workflowRunData,
    WORKFLOW_IDS,
    glDays
) {
    const stage3Workflows = [WORKFLOW_IDS.NIGHTLY, WORKFLOW_IDS.MANUAL_RELEASE];
    let earliestStage3Start = null;
    let latestEndTime = null;

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

    // Schema v2 (GL >= 2174): Duration is Stage 3 only
    // Schema v1 (GL < 2174): Duration is Stage 3 start → Stage 4 end
    if (hasStage4(glDays)) {
        // v1: Find latest Stage 4 end time (only from completed workflows for historic data)
        const stage4Workflows = [
            WORKFLOW_IDS.PUBLISH_GHCR,
            WORKFLOW_IDS.PUBLISH_S3,
        ];
        for (const workflowId of stage4Workflows) {
            if (workflowRunData && workflowRunData[workflowId]) {
                const runData = workflowRunData[workflowId];
                if (runData.status === "completed") {
                    const endTime = new Date(runData.updated_at);
                    if (!latestEndTime || endTime > latestEndTime) {
                        latestEndTime = endTime;
                    }
                }
            }
        }
    } else {
        // v2: Find latest Stage 3 end time
        for (const workflowId of stage3Workflows) {
            if (workflowRunData && workflowRunData[workflowId]) {
                const runData = workflowRunData[workflowId];
                if (runData.status === "completed") {
                    const endTime = new Date(runData.updated_at);
                    if (!latestEndTime || endTime > latestEndTime) {
                        latestEndTime = endTime;
                    }
                }
            }
        }
    }

    // Calculate duration if we have both start and end times
    if (earliestStage3Start && latestEndTime) {
        const durationMs = latestEndTime - earliestStage3Start;
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

// ========================================
// STAGE 4 VALIDATION UTILITIES
// ========================================

/**
 * Validates Stage 4 runs based on date and parent criteria
 * @param {Array} runs - Array of Stage 4 runs to validate
 * @param {Date} targetDate - GL target date
 * @param {Date} nextDay - Day after GL target date
 * @param {Date} extendedNextDay - GL target date + 7 days
 * @param {Set} stage3RunIds - Set of valid Stage 3 run IDs
 * @param {string} glDays - GL version for logging
 * @param {Object} workflow - Workflow configuration
 * @returns {Array} Array of valid runs sorted by date (newest first)
 */
export async function validateStage4Runs(
    runs,
    targetDate,
    nextDay,
    extendedNextDay,
    stage3RunIds,
    glDays,
    workflow
) {
    const { getParentWorkflowInfo } = await import("./parentWorkflow.js");
    const { API_CONFIG } = await import("./constants.js");

    const validRuns = [];

    for (const run of runs) {
        console.log(
            `[DEBUG] [Historic Stage 4] GL${glDays} - ${workflow.name} (${workflow.id}) - Pre-filter Run ${run.id}: created_at=${run.created_at}`
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

            // Case 1: Same date validation - only valid if no parent info OR parent matches Stage 3
            if (isBaseDate) {
                // If there's no parent info, include the run (manual run or no parent data)
                if (!parentInfo || !parentInfo.parentRunId) {
                    validRuns.push(run);
                    console.log(
                        `🔍 [Historic Stage 4] GL${glDays} - ${workflow.name} (${workflow.id}) - Run ${run.id}: Added (GL date, no parent)`
                    );
                    continue;
                }

                // If there's a parent ID, it must match a Stage 3 run
                if (stage3RunIds.has(parentInfo.parentRunId.toString())) {
                    validRuns.push(run);
                    console.log(
                        `🔍 [Historic Stage 4] GL${glDays} - ${workflow.name} (${workflow.id}) - Run ${run.id}: Added (GL date, matching parent ${parentInfo.parentRunId})`
                    );
                    continue;
                }

                // Skip runs with parent IDs that don't match Stage 3
                console.log(
                    `🔍 [Historic Stage 4] GL${glDays} - ${workflow.name} (${workflow.id}) - Run ${run.id}: Skipped (GL date, parent ${parentInfo.parentRunId} doesn't match Stage 3)`
                );
                continue;
            }

            // Case 2: Later date validation (+1 to +7 days) - only valid if parent run matches Stage 3
            if (
                isExtendedDate &&
                !isBaseDate &&
                parentInfo &&
                parentInfo.parentRunId &&
                stage3RunIds.has(parentInfo.parentRunId.toString())
            ) {
                validRuns.push(run);
                console.log(
                    `🔍 [Historic Stage 4] GL${glDays} - ${workflow.name} (${workflow.id}) - Run ${run.id}: Added (later date, matching parent ${parentInfo.parentRunId})`
                );
                continue;
            }

            console.log(
                `🔍 [Historic Stage 4] GL${glDays} - ${workflow.name} (${workflow.id}) - Run ${run.id}: Skipped (doesn't match validation criteria)`
            );
        } catch (error) {
            console.log(
                `🔍 [Historic Stage 4] GL${glDays} - ${workflow.name} (${workflow.id}) - Failed to get parent info for run ${run.id}:`,
                error.message
            );
        }
    }

    // Sort all valid runs by date (newest first) and remove duplicates
    const sortedValidRuns = validRuns.sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    const uniqueRuns = [];
    const seenIds = new Set();
    for (const run of sortedValidRuns) {
        if (!seenIds.has(run.id)) {
            seenIds.add(run.id);
            uniqueRuns.push(run);
        }
    }

    return uniqueRuns;
}

/**
 * Collects Stage 3 run IDs for a specific GL date
 * @param {Array} stage3Workflows - Array of Stage 3 workflow configurations
 * @param {Date} targetDate - GL target date
 * @param {Date} nextDay - Day after GL target date
 * @param {string} glDays - GL version for logging
 * @returns {Set} Set of Stage 3 run IDs
 */
export async function collectStage3RunIds(
    stage3Workflows,
    targetDate,
    nextDay,
    glDays
) {
    try {
        const { getAuthHeaders, getBranchParameter, getRepoBranchParameter } =
            await import("./utils.js");
        const { API_CONFIG } = await import("./constants.js");

        const stage3RunIds = new Set();

        for (const workflow of stage3Workflows) {
            try {
                const response = await fetch(
                    `${API_CONFIG.GITHUB_API_BASE}/repos/${API_CONFIG.GARDENLINUX_ORG}/${workflow.repo}/actions/workflows/${workflow.id}/runs?per_page=${API_CONFIG.HISTORIC_RUNS_PER_PAGE}${workflow.repo === "repo" ? getRepoBranchParameter() : getBranchParameter()}`,
                    { headers: getAuthHeaders() }
                );

                if (!response.ok) {
                    console.warn(
                        `[Utils] Failed to fetch Stage 3 runs for ${workflow.name} (${workflow.id}):`,
                        {
                            status: response.status,
                            statusText: response.statusText,
                            workflowId: workflow.id,
                            workflowName: workflow.name,
                            repo: workflow.repo,
                            glDays,
                        }
                    );
                    continue;
                }

                const data = await response.json();
                const runs = data.workflow_runs || [];

                // Use base date range for Stage 3 run collection (GL date only, not extended)
                const dayRuns = runs.filter((run) => {
                    const runDate = new Date(run.created_at);
                    return runDate >= targetDate && runDate < nextDay;
                });

                console.log(
                    `🔍 [Historic Stage 3] GL${glDays} - ${workflow.name}: Found ${dayRuns.length} runs in date range ${targetDate.toISOString().split("T")[0]} (GL date only)`
                );

                for (const run of dayRuns) {
                    stage3RunIds.add(String(run.id));
                    console.log(
                        `🔍 [Historic Stage 3] GL${glDays} - ${workflow.name}: Collected run ID ${run.id} (created: ${run.created_at})`
                    );
                }
            } catch (workflowError) {
                console.error(
                    `[Utils] Error collecting Stage 3 runs for ${workflow.name} (${workflow.id}):`,
                    {
                        error: workflowError.message,
                        stack: workflowError.stack,
                        workflowId: workflow.id,
                        workflowName: workflow.name,
                        repo: workflow.repo,
                        glDays,
                    }
                );
            }
        }

        console.log(
            `[DEBUG] GL${glDays} - Stage 3 run IDs collected:`,
            Array.from(stage3RunIds)
        );

        return stage3RunIds;
    } catch (error) {
        console.error(
            `[Utils] Error in collectStage3RunIds for GL ${glDays}:`,
            {
                error: error.message,
                stack: error.stack,
                glDays,
                workflowsCount: stage3Workflows?.length,
            }
        );
        return new Set();
    }
}

// ========================================
// HELPER FUNCTIONS FOR WORKFLOW ACCESS
// ========================================
export function getAllWorkflowConfigs(glDays = null) {
    const allWorkflows = Object.values(WORKFLOWS);

    // If no GL version specified, return all workflows (backward compatible)
    if (glDays === null) {
        return allWorkflows;
    }

    // Filter out stage-4 workflows for schema v2
    if (!hasStage4(glDays)) {
        return allWorkflows.filter((w) => w.stage !== "stage-4");
    }

    return allWorkflows;
}

export function getWorkflowsByStage(stageId) {
    return Object.values(WORKFLOWS).filter(
        (workflow) => workflow.stage === stageId
    );
}

// ========================================
// SHARED STATUS CALCULATION UTILITIES
// ========================================

/**
 * Calculates stage statuses from workflow statuses using the same logic as current view
 * @param {Object} workflowStatuses - Object mapping workflow IDs to their statuses
 * @param {string} packageStatus - Package status (success, warning, failure, etc.)
 * @param {Object} STAGE_WORKFLOWS - Stage to workflow ID mappings (version-aware)
 * @returns {Object} Stage statuses object
 */
export function calculateStageStatuses(
    workflowStatuses,
    packageStatus,
    STAGE_WORKFLOWS
) {
    // Note: STAGE_WORKFLOWS should already be version-aware from getStageWorkflows(glDays)
    // This function works with whatever stages are passed in
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
            // Standard logic for other stages: prioritize failures and require ALL success
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

    return stageStatuses;
}

/**
 * Calculates overall pipeline status from stage statuses using the same logic as current view
 * @param {Object} stageStatuses - Stage statuses object
 * @returns {string} Overall pipeline status
 */
export function calculatePipelineStatus(stageStatuses) {
    const allStatuses = Object.values(stageStatuses);
    let pipelineStatus = "unknown";

    // Priority order: failure > warning > progress > success > error > no-data > unknown
    // NOTE: Using the same logic as current view - failures take priority
    // regardless of whether all workflows are fully loaded
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
    } else if (allStatuses.some((status) => status === "success")) {
        // Show success if at least one stage is successful - consistent with historic view
        pipelineStatus = "success";
    } else if (allStatuses.some((status) => status === "no-data")) {
        pipelineStatus = "unknown";
    } else {
        pipelineStatus = "unknown";
    }

    return pipelineStatus;
}

/**
 * Processes workflow runs for a specific GL date and returns status
 * Shared logic for both current and historic views
 * @param {Object} workflow - Workflow configuration
 * @param {Array} runs - Array of workflow runs
 * @param {Date} targetDate - GL target date
 * @param {Date} nextDay - Day after GL target date
 * @param {Date} extendedNextDay - GL target date + 7 days
 * @param {Set} stage3RunIds - Set of valid Stage 3 run IDs
 * @param {string} glDays - GL version for logging
 * @returns {Object} { status, runData } object
 */
export async function processWorkflowRuns(
    workflow,
    runs,
    targetDate,
    nextDay,
    extendedNextDay,
    stage3RunIds,
    glDays
) {
    // Check if this is a Stage 4 workflow
    const isStage4Workflow = workflow.stage === "stage-4";

    let targetRuns = [];

    if (isStage4Workflow && hasStage4(glDays)) {
        // For Stage 4 in schema v1: Use the shared validation logic
        targetRuns = await validateStage4Runs(
            runs,
            targetDate,
            nextDay,
            extendedNextDay,
            stage3RunIds,
            glDays,
            workflow
        );
    } else {
        // Standard date filtering for non-Stage 4 workflows
        targetRuns = runs.filter((run) => {
            const runDate = new Date(run.created_at);
            return runDate >= targetDate && runDate < nextDay;
        });
    }

    // Debug repo build workflow specifically (current AND historic)
    if (workflow.id === "84300233") {
        console.log(`[REPO BUILD DEBUG] GL${glDays} - ${workflow.name}:`);
        console.log(`  - Total runs: ${runs.length}`);
        console.log(
            `  - Target date: ${targetDate.toISOString().split("T")[0]}`
        );
        console.log(`  - Next day: ${nextDay.toISOString().split("T")[0]}`);
        console.log(`  - GL days: ${glDays}`);
        console.log(
            `  - Current date: ${new Date().toISOString().split("T")[0]}`
        );
        console.log(`  - Filtered runs: ${targetRuns.length}`);
        if (targetRuns.length > 0) {
            console.log(`  - Most recent run:`, targetRuns[0]);
            console.log(
                `  - Run dates:`,
                targetRuns.slice(0, 3).map((r) => r.created_at)
            );
        }
        // Show some recent runs regardless of filtering
        console.log(
            `  - Latest API runs:`,
            runs
                .slice(0, 5)
                .map((r) => ({ id: r.id, created_at: r.created_at }))
        );

        // Show the filtering logic in action
        const debugRuns = runs.slice(0, 3);
        debugRuns.forEach((run) => {
            const runDate = new Date(run.created_at);
            const isInRange = runDate >= targetDate && runDate < nextDay;
            console.log(
                `    - Run ${run.id}: ${run.created_at} → ${isInRange ? "INCLUDED" : "EXCLUDED"}`
            );
        });
    }

    if (targetRuns.length === 0) {
        if (workflow.id === "84300233") {
            console.log(`  - Returning: unknown (no runs found)`);
        }
        return { status: "unknown", runData: null };
    }

    // Sort by creation date (newest first) and get most recent
    const sortedRuns = targetRuns.sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );
    const mostRecentRun = sortedRuns[0];

    // Determine status from most recent run
    let status = "unknown";
    if (
        mostRecentRun.status === "in_progress" ||
        mostRecentRun.status === "queued"
    ) {
        status = "progress";
    } else if (mostRecentRun.status === "completed") {
        status = mostRecentRun.conclusion === "success" ? "success" : "failure";
    }

    if (workflow.id === "84300233") {
        console.log(
            `  - Most recent run status: ${mostRecentRun.status}, conclusion: ${mostRecentRun.conclusion}`
        );
        console.log(`  - Returning: ${status}`);
    }

    return { status, runData: mostRecentRun };
}
