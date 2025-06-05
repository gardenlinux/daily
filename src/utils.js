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
