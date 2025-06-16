/**
 * ========================================
 * GARDEN LINUX DASHBOARD - MAIN ENTRY POINT
 * ========================================
 *
 * This file contains:
 * - Application initialization
 * - Settings panel management
 * - GL version selector functionality
 * - UI event handlers and global functions
 */

import { getRun, fillPackageTable, loadHistoricReleases } from "./dashboard.js";

import {
    getWorkflowsByStageForHTML,
    WORKFLOW_IDS,
    GL_INITIAL_DATE,
    API_CONFIG,
    WORKFLOWS,
} from "./constants.js";

import {
    isHistoricView,
    getGlDays,
    getCurrentGlDays,
    updateGLDateInfo,
    shouldLoadHistoricReleases,
    toggleSection,
    formatDetailedDateFromDate,
    shouldSearchAllBranches,
} from "./utils.js";

import { generateWorkflowBoxHTML as uiGenerateWorkflowBoxHTML } from "./ui.js";

// ========================================
// SETTINGS PANEL MANAGEMENT
// ========================================
// Settings panel functions (need to be global for onclick handlers)
window.toggleSettings = function () {
    const panel = document.getElementById("settings-panel");
    panel.style.display = panel.style.display === "none" ? "block" : "none";
    updateAuthStatus();
};

window.saveToken = function () {
    const tokenInput = document.getElementById("token-input");
    const token = tokenInput.value.trim();

    if (!token) {
        alert("Please enter a token");
        return;
    }

    // Validate token format
    if (!token.startsWith("ghp_") && !token.startsWith("github_pat_")) {
        const confirmSave = confirm(
            "Warning: This doesn't look like a valid GitHub token.\n" +
                'GitHub tokens start with "ghp_" (classic) or "github_pat_" (fine-grained).\n\n' +
                "Do you want to save it anyway?"
        );
        if (!confirmSave) {
            return;
        }
    }

    localStorage.setItem("github_token", token);
    tokenInput.value = "";
    updateAuthStatus();
    alert("Token saved successfully! Refreshing data...");
    location.reload(); // Refresh to use new token
};

window.clearToken = function () {
    localStorage.removeItem("github_token");
    updateAuthStatus();
    alert("Token cleared! Page will reload...");
    location.reload();
};

// ========================================
// BRANCH SEARCH SETTINGS
// ========================================
// Branch search toggle functions
window.toggleBranchSearch = function () {
    const checkbox = document.getElementById("search-all-branches");
    const isEnabled = checkbox.checked;

    // Update URL parameter
    const url = new URL(window.location);
    if (isEnabled) {
        url.searchParams.set("all_branches", "true");
    } else {
        url.searchParams.set("all_branches", "false");
    }

    // Update localStorage as well (for persistence across sessions)
    localStorage.setItem("search_all_branches", isEnabled.toString());

    // Update status display
    updateBranchSearchStatus();

    // Navigate to the new URL
    const message = isEnabled
        ? "Branch search enabled: Now searching all branches. Page will reload..."
        : "Branch search disabled: Now searching default branches only. Page will reload...";
    alert(message);
    window.location.href = url.toString();
};

function updateBranchSearchStatus() {
    const isEnabled = shouldSearchAllBranches(); // This now checks URL first, then localStorage
    const checkbox = document.getElementById("search-all-branches");
    const modeSpan = document.getElementById("branch-mode");

    if (checkbox) {
        checkbox.checked = isEnabled;
    }

    if (modeSpan) {
        modeSpan.textContent = isEnabled
            ? "all branches"
            : "default branches only";
    }
}

function initializeBranchSettings() {
    updateBranchSearchStatus();
}

function updateAuthStatus() {
    const token = localStorage.getItem("github_token");
    const statusElement = document.getElementById("auth-status");

    if (token) {
        statusElement.textContent = "Authenticated ✅";
        statusElement.style.color = "#5cb85c";
    } else {
        statusElement.textContent = "Not authenticated ❌";
        statusElement.style.color = "#d9534f";
    }
}

// ========================================
// GL VERSION SELECTOR FUNCTIONALITY
// ========================================
// GL Version Selector Functions (need to be global for onclick handlers)
function initializeGLSelector() {
    const glInput = document.getElementById("gl-input");
    const currentGL = getGlDays();
    glInput.value = currentGL;
    updateGLDateInfo(currentGL);
}

window.incrementGL = function () {
    const glInput = document.getElementById("gl-input");
    const currentValue = parseInt(glInput.value) || getCurrentGlDays();
    const newValue = currentValue + 1;
    glInput.value = newValue;
    updateGLDateInfo(newValue);
};

window.decrementGL = function () {
    const glInput = document.getElementById("gl-input");
    const currentValue = parseInt(glInput.value) || getCurrentGlDays();
    const newValue = Math.max(1, currentValue - 1);
    glInput.value = newValue;
    updateGLDateInfo(newValue);
};

window.handleGLKeypress = function (event) {
    if (event.key === "Enter") {
        goToGL();
    }
    // Update date info as user types
    setTimeout(() => {
        const glInput = document.getElementById("gl-input");
        const value = parseInt(glInput.value);
        if (!isNaN(value) && value > 0) {
            updateGLDateInfo(value);
        }
    }, 10);
};

window.handleGLInput = function () {
    // Update date info as user types
    const glInput = document.getElementById("gl-input");
    const value = parseInt(glInput.value);
    if (!isNaN(value) && value > 0) {
        updateGLDateInfo(value);
    }
};

window.goToGL = function () {
    const glInput = document.getElementById("gl-input");
    const glValue = parseInt(glInput.value);

    if (isNaN(glValue) || glValue < 1) {
        alert("Please enter a valid GL version (positive number)");
        glInput.value = getCurrentGlDays();
        return;
    }

    // Navigate to the URL with the GL parameter
    const url = new URL(window.location.href);
    url.searchParams.set("gl", glValue);
    window.location.href = url.toString();
};

window.goToToday = function () {
    // Navigate to today's version (remove GL parameter)
    const url = new URL(window.location.href);
    url.searchParams.delete("gl");
    window.location.href = url.toString();
};

// ========================================
// UI EVENT HANDLERS AND GLOBAL FUNCTIONS
// ========================================
// Toggle current details section (pipeline stages)
function toggleCurrentDetails() {
    toggleSection("current-details-content", "current-details-toggle-icon");
}

// Toggle historic releases section
function toggleHistoricReleases() {
    toggleSection(
        "historic-releases-content",
        "historic-toggle-icon",
        loadHistoricReleases
    );
}

// Toggle platform test cleanup section
function togglePlatformCleanup() {
    toggleSection(
        "platform-cleanup-content",
        "platform-cleanup-toggle-icon",
        getRun
    );
}

// ========================================
// DYNAMIC HTML GENERATION
// ========================================
function generateWorkflowHTML() {
    console.log("Generating workflow HTML from constants...");

    // Stage 4: Publish Images
    const stage4Workflows = getWorkflowsByStageForHTML("stage-4");
    const stage4Container = document.querySelector("#stage-4 .stage-workflows");
    if (stage4Container && stage4Workflows.length > 0) {
        stage4Container.innerHTML = stage4Workflows
            .map((workflow) =>
                uiGenerateWorkflowBoxHTML(workflow, API_CONFIG, WORKFLOWS)
            )
            .join("");
    }

    // Stage 3: Build & Release Images
    const stage3Workflows = getWorkflowsByStageForHTML("stage-3");
    const stage3Container = document.querySelector("#stage-3 .stage-workflows");
    if (stage3Container && stage3Workflows.length > 0) {
        stage3Container.innerHTML = stage3Workflows
            .map((workflow) =>
                uiGenerateWorkflowBoxHTML(workflow, API_CONFIG, WORKFLOWS)
            )
            .join("");
    }

    // Stage 2: Repository (special handling for sequential workflows)
    const stage2Workflows = getWorkflowsByStageForHTML("stage-2");
    if (stage2Workflows.length >= 2) {
        // Find repo build and repo update workflows using constants
        const repoBuild = stage2Workflows.find(
            (w) => w.id === WORKFLOW_IDS.REPO_BUILD
        );
        const repoUpdate = stage2Workflows.find(
            (w) => w.id === WORKFLOW_IDS.REPO_UPDATE
        );

        if (repoBuild) {
            const repoBuildContainer = document.querySelector(
                "#sub-stage-repo-build .workflow-box"
            );
            if (repoBuildContainer) {
                repoBuildContainer.outerHTML = uiGenerateWorkflowBoxHTML(
                    repoBuild,
                    API_CONFIG,
                    WORKFLOWS
                );
            }
        }

        if (repoUpdate) {
            const repoUpdateContainer = document.querySelector(
                "#sub-stage-repo-update .workflow-box"
            );
            if (repoUpdateContainer) {
                repoUpdateContainer.outerHTML = uiGenerateWorkflowBoxHTML(
                    repoUpdate,
                    API_CONFIG,
                    WORKFLOWS
                );
            }
        }
    }

    console.log("Workflow HTML generation complete");
}

// ========================================
// APPLICATION INITIALIZATION
// ========================================
// Main initialization
function initDashboard() {
    // Update the display text
    const glDays = getGlDays();
    const glDaysElement = document.getElementById("gl-days");

    // Calculate the date for the GL version using the new detailed format
    const glDate = new Date(GL_INITIAL_DATE);
    glDate.setDate(glDate.getDate() + glDays);
    const formattedDate = formatDetailedDateFromDate(glDate);

    // Apply appropriate styling classes
    glDaysElement.classList.remove("historic", "error");

    if (isHistoricView()) {
        glDaysElement.classList.add("historic");
        glDaysElement.innerText = `Historic - GL ${glDays} \n ${formattedDate}`;

        // Update section headings for historic view
        const currentReleaseHeader = document.querySelector(
            "#current-release-header h2"
        );
        const currentDetailsHeader = document.querySelector(
            "#current-details-header h2"
        );

        if (currentReleaseHeader) {
            currentReleaseHeader.textContent = "🚀 Historic Daily Release";
        }
        if (currentDetailsHeader) {
            currentDetailsHeader.textContent =
                "🔧 Historic Daily Release Details";
        }

        // Update historic releases header for historic view
        const historicReleaseHeader = document.querySelector(
            ".historic-releases-header h2"
        );
        if (historicReleaseHeader) {
            historicReleaseHeader.textContent = `📅 Historic Daily Releases (14 Days Before GL ${glDays})`;
        }
    } else {
        glDaysElement.innerText = `GL ${glDays} \n ${formattedDate}`;

        // Ensure headings are set to "Current" for non-historic view
        const currentReleaseHeader = document.querySelector(
            "#current-release-header h2"
        );
        const currentDetailsHeader = document.querySelector(
            "#current-details-header h2"
        );

        if (currentReleaseHeader) {
            currentReleaseHeader.textContent = "🚀 Current Daily Release";
        }
        if (currentDetailsHeader) {
            currentDetailsHeader.textContent =
                "🔧 Current Daily Release Details";
        }

        // Update historic releases header for current view
        const historicReleaseHeader = document.querySelector(
            ".historic-releases-header h2"
        );
        if (historicReleaseHeader) {
            historicReleaseHeader.textContent = `📅 Historic Daily Releases (14 Days Before Today)`;
        }
    }

    // Current release section is always visible now (no initialization needed)

    // Hide historic releases section if disabled
    const historicContainer = document.getElementById(
        "historic-releases-container"
    );
    if (!shouldLoadHistoricReleases()) {
        historicContainer.style.display = "none";
    }

    // Load data
    getRun();
    fillPackageTable();
    updateAuthStatus(); // Initialize auth status display
    initializeGLSelector(); // Initialize GL version selector
    initializeBranchSettings(); // Initialize branch search settings
    generateWorkflowHTML(); // Generate workflow HTML
}

// Start the application when DOM is ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDashboard);
} else {
    initDashboard();
}

// Make functions globally available
window.toggleCurrentDetails = toggleCurrentDetails;
window.toggleHistoricReleases = toggleHistoricReleases;
window.togglePlatformCleanup = togglePlatformCleanup;
