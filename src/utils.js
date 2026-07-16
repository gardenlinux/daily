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
    WORKFLOW_IDS,
    hasStage4,
    SCHEMA_V2_CUTOFF,
    formatVersionBranch,
    HISTORIC_CACHE_SCHEMA_VERSION,
    HISTORIC_CACHE_MIN_SUPPORTED_VERSION,
} from "./constants.js";

import { reportApiResponse, reportNetworkError } from "./errorBanner.js";

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
        if (!isNaN(count) && count > 0 && count <= 2000) {
            return count;
        }
    }
    return 14; // Default value
}

/**
 * Checks whether the dashboard should bypass historic cache
 * Uses a URL parameter `force`, similar to the CLI flag `--force`
 * Examples:
 *  - ?force        -> true
 *  - ?force=true   -> true
 *  - ?force=1      -> true
 *  - ?force=false  -> false
 *  - ?force=0      -> false
 */
export function isForceNoCache() {
    const urlParams = new URLSearchParams(window.location.search);
    if (!urlParams.has("force")) {
        return false;
    }

    const value = urlParams.get("force");
    // Treat presence, empty, "true" or "1" as enabled by default
    if (value === null || value === "") {
        return true;
    }

    const normalized = value.toLowerCase();
    if (normalized === "true" || normalized === "1") {
        return true;
    }
    if (normalized === "false" || normalized === "0") {
        return false;
    }

    // Any other non-empty value means force as well
    return true;
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
// BRANCH FILTERING UTILITIES
// ========================================

/**
 * Calculates the expected branch for a workflow based on its type
 * @param {Object} workflow - Workflow configuration object
 * @param {number} glDays - GL version days
 * @returns {string|null} Expected branch name, or null for Repo Build (special handling)
 */
export function calculateExpectedBranch(workflow, glDays) {
    const isRepoWorkflow = workflow.repo === "repo";
    const isRepoUpdate = workflow.id === WORKFLOW_IDS.REPO_UPDATE;
    const isRepoBuild = workflow.id === WORKFLOW_IDS.REPO_BUILD;

    if (isRepoWorkflow) {
        if (isRepoUpdate) {
            // Repo Update always runs on "main" branch
            return "main";
        } else if (isRepoBuild) {
            // Repo Build runs on version branches in format "{glDays}.0" or "{glDays}.0.0"
            // Return null to indicate special handling needed
            return null;
        } else {
            return `${glDays}.0.0`;
        }
    } else {
        // Non-repo workflows run on "main" branch
        return "main";
    }
}

/**
 * Checks if a run's branch matches the expected branch for a workflow
 * @param {string} runBranch - Branch name from the workflow run
 * @param {string|null} expectedBranch - Expected branch (null for Repo Build)
 * @param {Object} workflow - Workflow configuration object
 * @param {number} glDays - GL version days
 * @returns {boolean} True if branch matches
 */
export function isBranchMatch(runBranch, expectedBranch, workflow, glDays) {
    const isRepoBuild = workflow.id === WORKFLOW_IDS.REPO_BUILD;

    if (isRepoBuild && expectedBranch === null) {
        // Repo Build accepts both "{glDays}.0" and "{glDays}.0.0" formats
        return runBranch === `${glDays}.0` || runBranch === `${glDays}.0.0`;
    } else {
        // Exact match for other workflows
        return runBranch === expectedBranch;
    }
}

// ========================================
// DATE RANGE CALCULATION UTILITIES
// ========================================

/**
 * Calculates all date ranges needed for GL version processing
 * @param {number} glDays - GL version days
 * @param {string} initialDate - Initial date string (e.g., "2020-03-31")
 * @returns {Object} Object containing targetDate, nextDay, extendedDate, extendedNextDay
 */
export function calculateDateRanges(glDays, initialDate) {
    const targetDate = calculateTargetDate(glDays, initialDate);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // For Stage 4 extended date range: GL day + 7
    const extendedDate = new Date(targetDate);
    extendedDate.setDate(extendedDate.getDate() + 7);
    const extendedNextDay = new Date(extendedDate);
    extendedNextDay.setDate(extendedNextDay.getDate() + 1);

    return {
        targetDate,
        nextDay,
        extendedDate,
        extendedNextDay,
    };
}

// ========================================
// WORKFLOW LIST UTILITIES
// ========================================

/**
 * Returns the standard list of workflows to check for historic releases
 * @returns {Array} Array of workflow check objects
 */
export function getAllWorkflowChecks() {
    return [
        // Stage 2: Repository workflows
        {
            id: WORKFLOW_IDS.REPO_UPDATE,
            stage: "stage-2",
            repo: WORKFLOWS.REPO_UPDATE.repo,
            name: WORKFLOWS.REPO_UPDATE.name,
            workflowFile: WORKFLOWS.REPO_UPDATE.workflowFile,
        },
        {
            id: WORKFLOW_IDS.REPO_BUILD,
            stage: "stage-2",
            repo: WORKFLOWS.REPO_BUILD.repo,
            name: WORKFLOWS.REPO_BUILD.name,
            workflowFile: WORKFLOWS.REPO_BUILD.workflowFile,
        },
        // Stage 3: Build & Release workflows
        {
            id: WORKFLOW_IDS.NIGHTLY,
            stage: "stage-3",
            repo: WORKFLOWS.NIGHTLY.repo,
            name: WORKFLOWS.NIGHTLY.name,
            workflowFile: WORKFLOWS.NIGHTLY.workflowFile,
        },
        {
            id: WORKFLOW_IDS.MANUAL_RELEASE,
            stage: "stage-3",
            repo: WORKFLOWS.MANUAL_RELEASE.repo,
            name: WORKFLOWS.MANUAL_RELEASE.name,
            workflowFile: WORKFLOWS.MANUAL_RELEASE.workflowFile,
        },
        // Stage 4: Publish workflows
        {
            id: WORKFLOW_IDS.PUBLISH_GHCR,
            stage: "stage-4",
            repo: WORKFLOWS.PUBLISH_GHCR.repo,
            name: WORKFLOWS.PUBLISH_GHCR.name,
            workflowFile: WORKFLOWS.PUBLISH_GHCR.workflowFile,
        },
        {
            id: WORKFLOW_IDS.PUBLISH_S3,
            stage: "stage-4",
            repo: WORKFLOWS.PUBLISH_S3.repo,
            name: WORKFLOWS.PUBLISH_S3.name,
            workflowFile: WORKFLOWS.PUBLISH_S3.workflowFile,
        },
    ];
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

/**
 * Wrapper around fetch() for GitHub API requests.
 *
 * Injects the standard auth headers (unless the caller already supplied
 * headers), routes the response through the global error banner so that
 * access-denied / rate-limit responses are surfaced at the top of the page,
 * and clears the banner on success. Returns the same Response the caller
 * would get from fetch(), so existing per-workflow handling is unaffected.
 *
 * Pass `reportErrors: false` for endpoints where an access-denied response is
 * an expected, locally-handled outcome (e.g. anonymous artifact downloads) so
 * it does not raise a page-level banner.
 *
 * @param {string} url
 * @param {RequestInit & { reportErrors?: boolean }} [options]
 * @returns {Promise<Response>}
 */
export async function githubFetch(url, options = {}) {
    const { reportErrors = true, ...fetchOptions } = options;
    const headers = fetchOptions.headers || getAuthHeaders();
    try {
        const response = await fetch(url, { ...fetchOptions, headers });
        if (reportErrors) {
            reportApiResponse(response);
        }
        return response;
    } catch (error) {
        if (reportErrors) {
            reportNetworkError(error);
        }
        throw error;
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
 * Core Stage 4 run validation logic (shared between browser and Node.js)
 * @param {Object} run - Workflow run to validate
 * @param {Date} targetDate - GL target date
 * @param {Date} nextDay - Day after GL target date
 * @param {Date} extendedNextDay - GL target date + 7 days
 * @param {Set} stage3RunIds - Set of valid Stage 3 run IDs
 * @param {Function} getParentInfoFn - Async function to get parent workflow info
 * @param {Function|null} logFn - Optional logging function (run, message) => void
 * @returns {Promise<boolean>} True if run is valid
 */
export async function validateStage4RunCore(
    run,
    targetDate,
    nextDay,
    extendedNextDay,
    stage3RunIds,
    getParentInfoFn,
    logFn = null
) {
    const runDate = new Date(run.created_at);
    const isBaseDate = runDate >= targetDate && runDate < nextDay;
    const isExtendedDate = runDate >= targetDate && runDate < extendedNextDay;

    try {
        const parentInfo = await getParentInfoFn();

        // Case 1: Same date validation - only valid if no parent info OR parent matches Stage 3
        if (isBaseDate) {
            // If there's no parent info, include the run (manual run or no parent data)
            if (!parentInfo || !parentInfo.parentRunId) {
                if (logFn) {
                    logFn(run, "Added (GL date, no parent)");
                }
                return true;
            }

            // If there's a parent ID, it must match a Stage 3 run
            if (stage3RunIds.has(parentInfo.parentRunId.toString())) {
                if (logFn) {
                    logFn(
                        run,
                        `Added (GL date, matching parent ${parentInfo.parentRunId})`
                    );
                }
                return true;
            }

            // Skip runs with parent IDs that don't match Stage 3
            if (logFn) {
                logFn(
                    run,
                    `Skipped (GL date, parent ${parentInfo.parentRunId} doesn't match Stage 3)`
                );
            }
            return false;
        }

        // Case 2: Later date validation (+1 to +7 days) - only valid if parent run matches Stage 3
        if (
            isExtendedDate &&
            !isBaseDate &&
            parentInfo &&
            parentInfo.parentRunId &&
            stage3RunIds.has(parentInfo.parentRunId.toString())
        ) {
            if (logFn) {
                logFn(
                    run,
                    `Added (later date, matching parent ${parentInfo.parentRunId})`
                );
            }
            return true;
        }

        if (logFn) {
            logFn(run, "Skipped (doesn't match validation criteria)");
        }
        return false;
    } catch (error) {
        if (logFn) {
            logFn(run, `Failed to get parent info: ${error.message}`);
        }
        return false;
    }
}

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

    // Check if user wants to search all branches (respects "Search all branches" setting)
    const searchAllBranches = shouldSearchAllBranches();

    // Calculate expected branch using shared utility
    const expectedBranch = calculateExpectedBranch(workflow, glDays);

    const validRuns = [];

    for (const run of runs) {
        // Calculate runBranch once and reuse
        const runBranch = run.head_branch || "main";

        // Filter by branch only if not searching all branches
        if (!searchAllBranches) {
            const isCorrectBranch = isBranchMatch(
                runBranch,
                expectedBranch,
                workflow,
                glDays
            );

            if (!isCorrectBranch) {
                console.log(
                    `[Branch Filter] [Historic Stage 4] GL${glDays} - ${workflow.name} (${workflow.id}) - Run ${run.id}: Excluded (branch "${runBranch}" doesn't match expected branch)`
                );
                continue;
            }
        }

        console.log(
            `[DEBUG] [Historic Stage 4] GL${glDays} - ${workflow.name} (${workflow.id}) - Pre-filter Run ${run.id}: created_at=${run.created_at}, branch=${runBranch}`
        );

        // Use shared core validation logic
        const getParentInfoFn = async () => {
            return await getParentWorkflowInfo(
                API_CONFIG.GARDENLINUX_ORG,
                workflow.repo,
                run.id
            );
        };

        const logFn = (runToLog, message) => {
            console.log(
                `🔍 [Historic Stage 4] GL${glDays} - ${workflow.name} (${workflow.id}) - Run ${runToLog.id}: ${message}`
            );
        };

        const isValid = await validateStage4RunCore(
            run,
            targetDate,
            nextDay,
            extendedNextDay,
            stage3RunIds,
            getParentInfoFn,
            logFn
        );

        if (isValid) {
            validRuns.push(run);
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
 * Fetches workflow runs with pagination using GitHub's created date filter
 * @param {Object} workflow - Workflow configuration object
 * @param {Date} targetDate - Target date to search for
 * @param {Date} nextDay - Day after target date (exclusive boundary)
 * @param {Function} getAuthHeaders - Function to get auth headers
 * @param {Function} getBranchParameter - Function to get branch parameter
 * @param {Function} getRepoBranchParameter - Function to get repo branch parameter
 * @returns {Promise<Array>} Array of all collected workflow runs
 */
export async function fetchWorkflowRunsPaginated(
    workflow,
    targetDate,
    nextDay,
    getAuthHeaders,
    getBranchParameter,
    getRepoBranchParameter
) {
    const { API_CONFIG } = await import("./constants.js");
    const allRuns = [];
    const perPage = API_CONFIG.HISTORIC_RUNS_PER_PAGE || 100;

    // Format dates for GitHub API (YYYY-MM-DD format, UTC)
    // GitHub's date range is inclusive on both ends
    // To get runs from targetDate (inclusive) to nextDay (exclusive):
    // - fromDate: targetDate (inclusive start)
    // - toDate: nextDay (inclusive end, we filter client-side with < nextDay)
    const fromDate = targetDate.toISOString().split("T")[0];
    const nextDayStr = nextDay.toISOString().split("T")[0];

    // Use nextDay as the end date (inclusive), which effectively makes it exclusive
    // because we filter client-side with < nextDay
    const createdParam = `created=${fromDate}..${nextDayStr}`;

    const branchParam =
        workflow.repo === "repo"
            ? getRepoBranchParameter()
            : getBranchParameter();

    try {
        // Use repository-level endpoint which supports 'created' parameter
        // Then filter by workflow_id client-side
        // According to GitHub API docs, workflow-specific endpoint may not support 'created'
        const firstPageUrl = `${API_CONFIG.GITHUB_API_BASE}/repos/${API_CONFIG.GARDENLINUX_ORG}/${workflow.repo}/actions/runs?per_page=${perPage}&page=1&${createdParam}${branchParam}`;

        const firstResponse = await fetch(firstPageUrl, {
            headers: getAuthHeaders(),
        });

        if (!firstResponse.ok) {
            console.warn(
                `[Pagination] Failed to fetch workflow runs for ${workflow.name}: ${firstResponse.status}`
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
                `[Pagination] ${workflow.name}: Found ${totalCount} runs in date range (API limit: ${maxResults}). Results may be truncated.`
            );
        }

        // Fetch remaining pages if needed
        for (let page = 2; page <= maxPages; page++) {
            const pageUrl = `${API_CONFIG.GITHUB_API_BASE}/repos/${API_CONFIG.GARDENLINUX_ORG}/${workflow.repo}/actions/runs?per_page=${perPage}&page=${page}&${createdParam}${branchParam}`;

            const pageResponse = await fetch(pageUrl, {
                headers: getAuthHeaders(),
            });

            if (!pageResponse.ok) {
                console.warn(
                    `[Pagination] Failed to fetch page ${page} for ${workflow.name}: ${pageResponse.status}`
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
            `📄 [Pagination] ${workflow.name}: Fetched ${pagesFetched} page${pagesFetched !== 1 ? "s" : ""} (${allRuns.length} runs for workflow ${workflow.id} in date range ${fromDate}..${nextDayStr})`
        );

        return allRuns;
    } catch (error) {
        console.warn(
            `[Pagination] Error fetching workflow runs for ${workflow.name}:`,
            error.message
        );
        return [];
    }
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
        const { getBranchParameter, getRepoBranchParameter } =
            await import("./utils.js");

        const stage3RunIds = new Set();

        for (const workflow of stage3Workflows) {
            try {
                // Use pagination to fetch all runs
                const runs = await fetchWorkflowRunsPaginated(
                    workflow,
                    targetDate,
                    nextDay,
                    getAuthHeaders,
                    getBranchParameter,
                    getRepoBranchParameter
                );

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

    // Check if user wants to search all branches (respects "Search all branches" setting)
    const searchAllBranches = shouldSearchAllBranches();

    // Calculate expected branch using shared utility
    const expectedBranch = calculateExpectedBranch(workflow, glDays);

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
            const isInDateRange = runDate >= targetDate && runDate < nextDay;

            // Filter by branch only if not searching all branches
            if (!searchAllBranches) {
                const runBranch = run.head_branch || "main";
                const isCorrectBranch = isBranchMatch(
                    runBranch,
                    expectedBranch,
                    workflow,
                    glDays
                );

                if (!isCorrectBranch && isInDateRange) {
                    console.log(
                        `[Branch Filter] GL${glDays} - ${workflow.name} (${workflow.id}) - Run ${run.id}: Excluded (branch "${runBranch}" doesn't match expected branch)`
                    );
                }

                return isInDateRange && isCorrectBranch;
            }

            // If searching all branches, only filter by date
            return isInDateRange;
        });
    }

    // Filter by branch based on workflow type
    // - Repo workflows: match version branch (e.g., "2179.0" for GL 2179)
    // - Other workflows: only "main" branch
    // - Skip filtering if "search all branches" is enabled
    const isRepoWorkflow =
        workflow.id === WORKFLOW_IDS.REPO_BUILD ||
        workflow.id === WORKFLOW_IDS.REPO_UPDATE;

    if (!shouldSearchAllBranches() && targetRuns.length > 0) {
        const beforeFilter = targetRuns.length;

        const isRepoBuild = workflow.id === WORKFLOW_IDS.REPO_BUILD;
        const isRepoUpdate = workflow.id === WORKFLOW_IDS.REPO_UPDATE;

        if (isRepoBuild) {
            // Repo Build workflow runs on version branches
            // Version format v1 (GL < 2017): "1592.0"
            // Version format v2 (GL >= 2017): "2179.0.0"
            const expectedBranch = formatVersionBranch(glDays);
            targetRuns = targetRuns.filter((run) => {
                const isCorrectBranch = run.head_branch === expectedBranch;
                if (!isCorrectBranch) {
                    console.log(
                        `🔍 [Branch Filter] GL${glDays} ${workflow.name}: Filtered out run #${run.run_number} from branch "${run.head_branch}" (expected "${expectedBranch}")`
                    );
                }
                return isCorrectBranch;
            });
        } else if (isRepoUpdate) {
            // Repo Update workflow always runs on main branch
            targetRuns = targetRuns.filter((run) => {
                const isMainBranch = run.head_branch === "main";
                if (!isMainBranch) {
                    console.log(
                        `🔍 [Branch Filter] GL${glDays} ${workflow.name}: Filtered out run #${run.run_number} from branch "${run.head_branch}" (expected "main")`
                    );
                }
                return isMainBranch;
            });
        } else {
            // Non-repo workflows run on main branch
            targetRuns = targetRuns.filter((run) => {
                const isMainBranch = run.head_branch === "main";
                if (!isMainBranch) {
                    console.log(
                        `🔍 [Branch Filter] GL${glDays} ${workflow.name}: Filtered out run #${run.run_number} from branch "${run.head_branch}" (expected "main")`
                    );
                }
                return isMainBranch;
            });
        }

        const afterFilter = targetRuns.length;
        if (beforeFilter !== afterFilter) {
            console.log(
                `🔍 [Branch Filter] GL${glDays} ${workflow.name}: Filtered ${beforeFilter - afterFilter} runs from incorrect branches (${afterFilter} remaining)`
            );
        }
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

// ========================================
// STAGE 3 COMMIT SHA HELPER
// ========================================
/**
 * Returns the commit SHA for the stage-3 run of a given day.
 * Prefers the Manual Release run (when it has data), falls back to Nightly.
 *
 * @param {Object} workflowRunData - Map of workflow ID → run object
 * @param {Object} WORKFLOW_IDS - Workflow ID constants
 * @returns {string|null} Full commit SHA, or null if unavailable
 */
export function getStage3CommitSha(workflowRunData, WORKFLOW_IDS) {
    if (
        workflowRunData &&
        workflowRunData[WORKFLOW_IDS.MANUAL_RELEASE] &&
        workflowRunData[WORKFLOW_IDS.MANUAL_RELEASE].head_sha
    ) {
        return workflowRunData[WORKFLOW_IDS.MANUAL_RELEASE].head_sha;
    }
    if (
        workflowRunData &&
        workflowRunData[WORKFLOW_IDS.NIGHTLY] &&
        workflowRunData[WORKFLOW_IDS.NIGHTLY].head_sha
    ) {
        return workflowRunData[WORKFLOW_IDS.NIGHTLY].head_sha;
    }
    return null;
}

// ========================================
// HISTORIC CACHE UTILITIES
// ========================================

/**
 * Loads historic release data from cache
 * @param {number} glDays - GL version days
 * @returns {Promise<Object|null>} Cached historic data or null if unavailable/incompatible
 */
export async function loadHistoricFromCache(glDays) {
    // Allow users to bypass cache via force URL parameter
    if (isForceNoCache()) {
        console.log(
            `[Cache] Skipping historic cache for GL${glDays} because force parameter is set`
        );
        return null;
    }

    try {
        console.log(
            `[Cache] Attempting to load cache for GL${glDays} from historic/${glDays}.json`
        );
        const response = await fetch(`historic/${glDays}.json`);
        if (!response.ok) {
            console.log(
                `[Cache] Cache file not found or not accessible for GL${glDays} (HTTP ${response.status})`
            );
            return null;
        }

        const data = await response.json();
        console.log(
            `[Cache] Successfully loaded cache file for GL${glDays}, validating...`
        );

        // Validate schema version
        if (!data.schemaVersion) {
            console.warn(
                `[Cache] Historic cache for GL${glDays} missing schemaVersion, rejecting`
            );
            return null;
        }

        const schemaVersion = data.schemaVersion;

        // Check if version is supported
        if (
            schemaVersion < HISTORIC_CACHE_MIN_SUPPORTED_VERSION ||
            schemaVersion > HISTORIC_CACHE_SCHEMA_VERSION
        ) {
            console.warn(
                `[Cache] Historic cache for GL${glDays} has unsupported schema version ${schemaVersion} (supported: ${HISTORIC_CACHE_MIN_SUPPORTED_VERSION}-${HISTORIC_CACHE_SCHEMA_VERSION}), rejecting`
            );
            return null;
        }

        // Migrate data if needed (for future versions)
        const migratedData = migrateHistoricCache(data, schemaVersion);

        // Validate required fields for current schema version
        if (!validateHistoricCache(migratedData)) {
            console.warn(
                `[Cache] Historic cache for GL${glDays} failed validation, rejecting`
            );
            return null;
        }

        console.log(
            `[Cache] Successfully loaded and validated cache for GL${glDays}`
        );
        return migratedData;
    } catch (error) {
        console.warn(
            `[Cache] Failed to load historic cache for GL${glDays}:`,
            error.message
        );
        return null;
    }
}

/**
 * Migrates historic cache data to current schema version
 * @param {Object} data - Cached data
 * @param {number} fromVersion - Source schema version
 * @returns {Object} Migrated data
 */
function migrateHistoricCache(data, fromVersion) {
    // Currently only version 1 exists, so no migration needed
    // Future: Add migration logic here when schema evolves
    if (fromVersion === HISTORIC_CACHE_SCHEMA_VERSION) {
        return data;
    }

    // Placeholder for future migrations
    console.warn(
        `[Cache] Migration from version ${fromVersion} to ${HISTORIC_CACHE_SCHEMA_VERSION} not implemented`
    );
    return data;
}

/**
 * Validates historic cache data structure
 * @param {Object} data - Cached data to validate
 * @returns {boolean} True if valid
 */
function validateHistoricCache(data) {
    // Required fields for schema version 1
    const requiredFields = [
        "schemaVersion",
        "glDays",
        "date",
        "timestamp",
        "packageDataPath",
        "packageIssuesPath",
        "packageStatus",
        "workflowStatuses",
        "workflowStatus",
        "pipelineStatus",
        "commitSha",
        "workflowRuns",
        "workflowMetadata",
    ];

    for (const field of requiredFields) {
        if (!(field in data)) {
            console.warn(`[Cache] Missing required field: ${field}`);
            return false;
        }
    }

    // Validate packageStatus structure
    if (
        !data.packageStatus ||
        typeof data.packageStatus.status !== "string" ||
        typeof data.packageStatus.issueCount !== "number" ||
        typeof data.packageStatus.totalCount !== "number"
    ) {
        console.warn("[Cache] Invalid packageStatus structure");
        return false;
    }

    // Validate workflowStatuses is an object
    if (!data.workflowStatuses || typeof data.workflowStatuses !== "object") {
        console.warn("[Cache] Invalid workflowStatuses structure");
        return false;
    }

    return true;
}
