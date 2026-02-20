/**
 * ========================================
 * GARDEN LINUX DASHBOARD - APPLICATION ENTRY POINT
 * ========================================
 *
 * Main application entry point and initialization hub containing:
 * - Application bootstrapping and DOM ready event handling
 * - Settings panel management (GitHub token, branch search configuration)
 * - GL version selector functionality and URL parameter handling
 * - Dynamic HTML generation for workflow boxes and pipeline stages
 * - Global UI event handlers and section toggle functionality
 * - Authentication status management and display
 * - Historic vs current view mode detection and UI adaptation
 * - Navigation and URL manipulation for GL version switching
 *
 * Orchestrates application startup and provides global UI interaction handlers.
 */

import { getRun, fillPackageTable, loadHistoricReleases } from "./dashboard.js";

import {
    WORKFLOW_IDS,
    GL_INITIAL_DATE,
    API_CONFIG,
    WORKFLOWS,
} from "./constants.js";

import {
    getGlDays,
    getCurrentGlDays,
    updateGLDateInfo,
    shouldLoadHistoricReleases,
    toggleSection,
    formatDetailedDateFromDate,
    isHistoricView,
    getWorkflowsByStage,
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
    try {
        const tokenInput = document.getElementById("token-input");
        const token = tokenInput.value.trim();

        if (!token) {
            console.warn("[Main] Token save attempted with empty token");
            alert("Please enter a token");
            return;
        }

        // Validate token format
        if (!token.startsWith("ghp_") && !token.startsWith("github_pat_")) {
            console.warn("[Main] Token save attempted with invalid format:", {
                tokenPrefix: token.substring(0, 10) + "...",
                tokenLength: token.length,
            });
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
        console.log("[Main] Token saved successfully");
        alert("Token saved successfully! Refreshing data...");
        location.reload(); // Refresh to use new token
    } catch (error) {
        console.error("[Main] Error saving token:", {
            error: error.message,
            stack: error.stack,
        });
        alert("Failed to save token. Please try again.");
    }
};

window.clearToken = function () {
    try {
        localStorage.removeItem("github_token");
        updateAuthStatus();
        console.log("[Main] Token cleared successfully");
        alert("Token cleared! Page will reload...");
        location.reload();
    } catch (error) {
        console.error("[Main] Error clearing token:", {
            error: error.message,
            stack: error.stack,
        });
        alert("Failed to clear token. Please try again.");
    }
};

// ========================================
// BRANCH SEARCH SETTINGS
// ========================================
// Branch search toggle functions
window.toggleBranchSearch = function () {
    try {
        const checkbox = document.getElementById("search-all-branches");
        const isEnabled = checkbox.checked;

        // Update URL parameter only
        const url = new URL(window.location);
        if (isEnabled) {
            url.searchParams.set("all_branches", "true");
        } else {
            url.searchParams.delete("all_branches");
        }

        // Navigate to the new URL
        const message = isEnabled
            ? "Branch search enabled: Now searching all branches. Page will reload..."
            : "Branch search disabled: Now searching default branches only. Page will reload...";

        console.log("[Main] Branch search setting changed:", {
            enabled: isEnabled,
            newUrl: url.toString(),
        });

        alert(message);
        window.location.href = url.toString();
    } catch (error) {
        console.error("[Main] Error toggling branch search:", {
            error: error.message,
            stack: error.stack,
        });
        alert("Failed to update branch search setting. Please try again.");
    }
};

// On page load, set checkbox state based on URL parameter
function setBranchCheckboxFromUrl() {
    try {
        const checkbox = document.getElementById("search-all-branches");
        if (!checkbox) {
            console.warn("[Main] Branch search checkbox not found in DOM");
            return;
        }
        const urlParams = new URLSearchParams(window.location.search);
        const branchParam = urlParams.get("all_branches");
        checkbox.checked = branchParam === "true" || branchParam === "1";

        console.log("[Main] Branch search checkbox initialized:", {
            checked: checkbox.checked,
            urlParam: branchParam,
        });
    } catch (error) {
        console.error("[Main] Error setting branch checkbox from URL:", {
            error: error.message,
            stack: error.stack,
        });
    }
}

// Call this on DOMContentLoaded or after settings panel is rendered
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setBranchCheckboxFromUrl);
} else {
    setBranchCheckboxFromUrl();
}

function updateAuthStatus() {
    try {
        const token = localStorage.getItem("github_token");
        const statusElement = document.getElementById("auth-status");

        if (!statusElement) {
            console.warn("[Main] Auth status element not found in DOM");
            return;
        }

        if (token) {
            statusElement.textContent = "Authenticated ✅";
            statusElement.style.color = "#5cb85c";
            console.log("[Main] Auth status updated: Authenticated");
        } else {
            statusElement.textContent = "Not authenticated ❌";
            statusElement.style.color = "#d9534f";
            console.log("[Main] Auth status updated: Not authenticated");
        }
    } catch (error) {
        console.error("[Main] Error updating auth status:", {
            error: error.message,
            stack: error.stack,
        });
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
    try {
        const glInput = document.getElementById("gl-input");
        const glValue = parseInt(glInput.value);

        if (isNaN(glValue) || glValue < 1) {
            console.warn("[Main] Invalid GL value entered:", {
                value: glInput.value,
                parsed: glValue,
            });
            alert("Please enter a valid GL version (positive number)");
            glInput.value = getCurrentGlDays();
            return;
        }

        // Navigate to the URL with the GL parameter
        const url = new URL(window.location.href);
        url.searchParams.set("gl", glValue);

        console.log("[Main] Navigating to GL version:", {
            glValue,
            newUrl: url.toString(),
        });

        window.location.href = url.toString();
    } catch (error) {
        console.error("[Main] Error navigating to GL version:", {
            error: error.message,
            stack: error.stack,
            inputValue: document.getElementById("gl-input")?.value,
        });
        alert("Failed to navigate to GL version. Please try again.");
    }
};

window.goToToday = function () {
    try {
        // Navigate to today's version (remove GL parameter)
        const url = new URL(window.location.href);
        url.searchParams.delete("gl");

        console.log("[Main] Navigating to today's GL version:", {
            newUrl: url.toString(),
        });

        window.location.href = url.toString();
    } catch (error) {
        console.error("[Main] Error navigating to today's GL version:", {
            error: error.message,
            stack: error.stack,
        });
        alert("Failed to navigate to today's version. Please try again.");
    }
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

// Toggle workflow monitoring wrapper section
function toggleWorkflowMonitoring() {
    toggleSection(
        "workflow-monitoring-content",
        "workflow-monitoring-toggle-icon"
    );
}

// Toggle Debian Snapshot sub-section
function toggleSnapshot() {
    toggleSection("snapshot-content", "snapshot-toggle-icon", getRun);
}

// Toggle cloud test cleanup section
function toggleCloudCleanup() {
    toggleSection("cloud-cleanup-content", "cloud-cleanup-toggle-icon", getRun);
}

// ========================================
// DYNAMIC HTML GENERATION
// ========================================
function generateWorkflowHTML() {
    console.log("Generating workflow HTML from constants...");

    // Stage 4: Publish Images
    const stage4Workflows = getWorkflowsByStage("stage-4");
    const stage4Container = document.querySelector("#stage-4 .stage-workflows");
    if (stage4Container && stage4Workflows.length > 0) {
        stage4Container.innerHTML = stage4Workflows
            .map((workflow) =>
                uiGenerateWorkflowBoxHTML(workflow, API_CONFIG, WORKFLOWS)
            )
            .join("");
    }

    // Stage 3: Build & Release Images
    const stage3Workflows = getWorkflowsByStage("stage-3");
    const stage3Container = document.querySelector("#stage-3 .stage-workflows");
    if (stage3Container && stage3Workflows.length > 0) {
        stage3Container.innerHTML = stage3Workflows
            .map((workflow) =>
                uiGenerateWorkflowBoxHTML(workflow, API_CONFIG, WORKFLOWS)
            )
            .join("");
    }

    // Cloud Test Cleanup: render from constants into monitoring sub-stage
    const cloudCleanupContainer = document.querySelector(
        "#cloud-cleanup-content .cloud-cleanup-workflow"
    );
    if (cloudCleanupContainer && WORKFLOWS.CLOUD_TEST_CLEANUP) {
        cloudCleanupContainer.innerHTML = uiGenerateWorkflowBoxHTML(
            WORKFLOWS.CLOUD_TEST_CLEANUP,
            API_CONFIG,
            WORKFLOWS
        );
    }

    // Workflow Monitoring: render additional monitoring workflows as sub-stages
    const monitoringSubsections = document.getElementById(
        "monitoring-subsections"
    );
    if (monitoringSubsections && WORKFLOWS.SNAPSHOT) {
        const snapshotSection = document.createElement("div");
        snapshotSection.className = "sub-stage";
        snapshotSection.id = "sub-stage-snapshot";
        snapshotSection.innerHTML = `
            <div class="sub-stage-header" id="snapshot-header" onclick="toggleSnapshot()">
                <span class="sub-stage-icon">📸</span>
                <h4>Debian Snapshot</h4>
                <span id="snapshot-toggle-icon" class="toggle-icon">▼</span>
            </div>
            <div id="snapshot-content" class="cloud-cleanup-content" style="display: none">
                <div class="cloud-cleanup-workflow">
                    ${uiGenerateWorkflowBoxHTML(WORKFLOWS.SNAPSHOT, API_CONFIG, WORKFLOWS)}
                </div>
            </div>
        `;
        monitoringSubsections.appendChild(snapshotSection);

        // Expand Debian Snapshot by default
        const snapContent = document.getElementById("snapshot-content");
        const snapIcon = document.getElementById("snapshot-toggle-icon");
        if (snapContent && snapIcon) {
            snapContent.style.display = "block";
            snapContent.classList.add("expanded");
            snapIcon.classList.add("expanded");
            snapIcon.textContent = "▲";
        }
    }

    // Stage 2: Repository (special handling for sequential workflows)
    const stage2Workflows = getWorkflowsByStage("stage-2");
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
    try {
        // Update the display text
        const glDays = getGlDays();
        const glDaysElement = document.getElementById("gl-days");

        if (!glDaysElement) {
            console.error("[Main] GL days element not found in DOM");
            return;
        }

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

        // Expand monitoring subsections by default
        const cloudContent = document.getElementById("cloud-cleanup-content");
        const cloudIcon = document.getElementById("cloud-cleanup-toggle-icon");
        if (cloudContent && cloudIcon) {
            cloudContent.style.display = "block";
            cloudContent.classList.add("expanded");
            cloudIcon.classList.add("expanded");
            cloudIcon.textContent = "▲";
        }

        console.log("[Main] Dashboard initialization started:", {
            glDays,
            formattedDate,
            isHistoric: isHistoricView(),
            shouldLoadHistoric: shouldLoadHistoricReleases(),
        });

        // Load data
        getRun();
        fillPackageTable();
        updateAuthStatus(); // Initialize auth status display
        initializeGLSelector(); // Initialize GL version selector
        generateWorkflowHTML(); // Generate workflow HTML

        console.log("[Main] Dashboard initialization completed successfully");
    } catch (error) {
        console.error("[Main] Error during dashboard initialization:", {
            error: error.message,
            stack: error.stack,
        });
        // Show user-friendly error message
        const glDaysElement = document.getElementById("gl-days");
        if (glDaysElement) {
            glDaysElement.textContent = "Error initializing dashboard";
            glDaysElement.classList.add("error");
        }
    }
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
window.toggleCloudCleanup = toggleCloudCleanup;
window.toggleWorkflowMonitoring = toggleWorkflowMonitoring;
window.toggleSnapshot = toggleSnapshot;

window.packageAggregatorRefreshNeeded = false;
