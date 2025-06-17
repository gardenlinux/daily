/**
 * ========================================
 * GARDEN LINUX DASHBOARD - UTILITY FUNCTIONS
 * ========================================
 *
 * This file contains shared utility functions for:
 * - Date and GL version calculations
 * - GitHub API authentication
 * - UI state helpers
 * - Data formatting utilities
 */

import { GL_INITIAL_DATE } from "./constants.js";

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
        console.error("Failed to get trigger info:", error);
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
    if (!element) return;

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
}

/**
 * Generic toggle function for collapsible sections
 * @param {string} contentId - ID of content element to toggle
 * @param {string} iconId - ID of toggle icon element
 * @param {Function} onExpand - Optional callback when section expands
 */
export function toggleSection(contentId, iconId, onExpand = null) {
    const content = document.getElementById(contentId);
    const icon = document.getElementById(iconId);

    if (!content || !icon) return;

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
            onExpand();
            content.dataset.loaded = "true";
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
}

/**
 * Bulk update status classes on multiple elements
 * @param {Array} updates - Array of {element, status, prefix} objects
 */
export function bulkSetElementStatus(updates) {
    updates.forEach(({ element, status, prefix = "" }) => {
        setElementStatus(element, status, prefix);
    });
}

// Helper function to calculate overall pipeline duration
export function calculatePipelineDuration(
    stageStatuses,
    pipelineStatus,
    workflowRunData,
    WORKFLOW_IDS
) {
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

    // Find latest Stage 4 end time
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
    return targetDate;
}

export function calculateHistoricPipelineDuration(
    workflowRunData,
    WORKFLOW_IDS
) {
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
