/**
 * ========================================
 * GARDEN LINUX DASHBOARD - CONFIGURATION & CONSTANTS
 * ========================================
 *
 * Central configuration hub for the Garden Linux Dashboard containing:
 * - GitHub workflow definitions and IDs for all pipeline stages
 * - API endpoints and timeout configurations
 * - Pipeline stage mappings and workflow groupings
 * - Package status definitions and problem indicators
 * - UI configuration settings and batch processing limits
 * - Date/version calculation base settings
 *
 * All hardcoded values and configuration should be defined here for maintainability.
 */

// ========================================
// DATE & VERSION CONFIGURATION
// ========================================
export const GL_INITIAL_DATE = "2020-03-31";

// ========================================
// SCHEMA VERSION CONFIGURATION
// ========================================
// Schema v2 starts at GL 2174 - no more stage 4 (Publish Images)
export const SCHEMA_V2_CUTOFF = 2174;

/**
 * Determines the schema version based on GL days
 * @param {number} glDays - Garden Linux version number
 * @returns {number} Schema version (1 or 2)
 */
export function getSchemaVersion(glDays) {
    return glDays >= SCHEMA_V2_CUTOFF ? 2 : 1;
}

/**
 * Checks if a GL version has stage 4 (Publish Images)
 * @param {number} glDays - Garden Linux version number
 * @returns {boolean} True if this version has stage 4
 */
export function hasStage4(glDays) {
    return glDays < SCHEMA_V2_CUTOFF;
}

// ========================================
// ARTIFACT CONFIGURATION
// ========================================

// List of artifact names that are allowed to be downloaded and analyzed
// for parent workflow information
export const ALLOWED_ARTIFACT_NAMES = ["parent-workflow-data"];

// ========================================
// GITHUB WORKFLOW CONFIGURATION
// ========================================
export const WORKFLOWS = {
    // Garden Linux Main Repository Workflows
    NIGHTLY: {
        id: "28837699",
        repo: "gardenlinux",
        name: "Garden Linux Nightly - Schedule",
        stage: "stage-3",
        workflowFile: "nightly.yml",
    },
    MANUAL_RELEASE: {
        id: "152444842",
        repo: "gardenlinux",
        name: "Build and publish a release - Manual",
        stage: "stage-3",
        workflowFile: "manual_release.yml",
    },
    PUBLISH_GHCR: {
        id: "152444846",
        repo: "gardenlinux",
        name: "Publish to ghcr.io",
        stage: "stage-4",
        workflowFile: "publish.yml",
    },
    PUBLISH_S3: {
        id: "152444850",
        repo: "gardenlinux",
        name: "Publish to S3",
        stage: "stage-4",
        workflowFile: "publish_s3.yml",
    },

    // Repository Workflows
    REPO_UPDATE: {
        id: "84300234",
        repo: "repo",
        name: "Repo Update",
        stage: "stage-2",
        workflowFile: "update.yml",
    },
    REPO_BUILD: {
        id: "84300233",
        repo: "repo",
        name: "Repo Build",
        stage: "stage-2",
        workflowFile: "build.yml",
    },
    // Monitoring Workflows
    CLOUD_TEST_CLEANUP: {
        id: "192338957",
        repo: "gardenlinux",
        name: "Cloud Test Cleanup",
        stage: "cleanup",
        workflowFile: "cloud_test_cleanup.yml",
    },
    SNAPSHOT: {
        id: "84098050",
        repo: "repo-debian-snapshot",
        name: "Debian Snapshot",
        stage: "monitoring",
        workflowFile: "snapshot.yml",
    },
};

// Workflow IDs for easy access
export const WORKFLOW_IDS = {
    NIGHTLY: WORKFLOWS.NIGHTLY.id,
    MANUAL_RELEASE: WORKFLOWS.MANUAL_RELEASE.id,
    PUBLISH_GHCR: WORKFLOWS.PUBLISH_GHCR.id,
    PUBLISH_S3: WORKFLOWS.PUBLISH_S3.id,
    CLOUD_TEST_CLEANUP: WORKFLOWS.CLOUD_TEST_CLEANUP.id,
    REPO_UPDATE: WORKFLOWS.REPO_UPDATE.id,
    REPO_BUILD: WORKFLOWS.REPO_BUILD.id,
    SNAPSHOT: WORKFLOWS.SNAPSHOT.id,
};

// ========================================
// PIPELINE STAGE CONFIGURATION
// ========================================
export const STAGE_WORKFLOWS = {
    "stage-1": [], // Package Builds (handled separately)
    "stage-2": [WORKFLOW_IDS.REPO_UPDATE, WORKFLOW_IDS.REPO_BUILD],
    "stage-3": [WORKFLOW_IDS.NIGHTLY, WORKFLOW_IDS.MANUAL_RELEASE],
    "stage-4": [WORKFLOW_IDS.PUBLISH_GHCR, WORKFLOW_IDS.PUBLISH_S3],
};

/**
 * Gets stage workflows based on schema version
 * @param {number} glDays - Garden Linux version number
 * @returns {Object} Stage to workflow ID mappings
 */
export function getStageWorkflows(glDays) {
    const baseStages = {
        "stage-1": [], // Package Builds (handled separately)
        "stage-2": [WORKFLOW_IDS.REPO_UPDATE, WORKFLOW_IDS.REPO_BUILD],
        "stage-3": [WORKFLOW_IDS.NIGHTLY, WORKFLOW_IDS.MANUAL_RELEASE],
    };

    if (hasStage4(glDays)) {
        baseStages["stage-4"] = [
            WORKFLOW_IDS.PUBLISH_GHCR,
            WORKFLOW_IDS.PUBLISH_S3,
        ];
    }

    return baseStages;
}

// All expected workflow IDs for validation
export const EXPECTED_WORKFLOW_IDS = [
    WORKFLOW_IDS.REPO_UPDATE,
    WORKFLOW_IDS.REPO_BUILD,
    WORKFLOW_IDS.NIGHTLY,
    WORKFLOW_IDS.MANUAL_RELEASE,
    WORKFLOW_IDS.PUBLISH_GHCR,
    WORKFLOW_IDS.PUBLISH_S3,
];

/**
 * Gets expected workflow IDs based on schema version
 * @param {number} glDays - Garden Linux version number
 * @returns {Array<string>} Array of workflow IDs
 */
export function getExpectedWorkflowIds(glDays) {
    const base = [
        WORKFLOW_IDS.REPO_UPDATE,
        WORKFLOW_IDS.REPO_BUILD,
        WORKFLOW_IDS.NIGHTLY,
        WORKFLOW_IDS.MANUAL_RELEASE,
    ];

    if (hasStage4(glDays)) {
        base.push(WORKFLOW_IDS.PUBLISH_GHCR, WORKFLOW_IDS.PUBLISH_S3);
    }

    return base;
}

// ========================================
// API CONFIGURATION
// ========================================
export const API_CONFIG = {
    TIMEOUT: 5000, // 5 second timeout per request
    MAX_RUNS_PER_PAGE: 200,
    HISTORIC_RUNS_PER_PAGE: 100,
    GITHUB_BASE: "https://github.com",
    GITHUB_API_BASE: "https://api.github.com",
    GARDENLINUX_ORG: "gardenlinux",
};

// ========================================
// PACKAGE STATUS CONFIGURATION
// ========================================
export const PACKAGE_STATUSES = {
    PROBLEMATIC: [
        "progress",
        "workFlowNotFound",
        "noRunFound",
        "brokenTimestamp",
        "stale",
        "failure",
    ],
};

// ========================================
// UI CONFIGURATION
// ========================================
export const UI_CONFIG = {
    HISTORIC_RELEASES_COUNT: 14, // Number of historic days to load
    BATCH_SIZE: 3, // API request batch size for rate limiting
    BATCH_DELAY: 200, // Delay between batches in milliseconds
};
