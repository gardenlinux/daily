#!/usr/bin/env node
/**
 * Historic Release Data Collector
 *
 * Collects historic release data for Garden Linux dashboard caching.
 * References packages/{glDays}.json instead of duplicating package data.
 * Archives for yesterday when run in GitHub Actions context.
 */

import {
    readFileSync,
    writeFileSync,
    mkdirSync,
    existsSync,
    readdirSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

// Import constants from shared module
import {
    GL_INITIAL_DATE,
    MIN_GL_VERSION,
    WORKFLOWS,
    WORKFLOW_IDS,
    getStageWorkflows,
    API_CONFIG,
    HISTORIC_CACHE_SCHEMA_VERSION,
    PACKAGE_STATUSES,
} from "../src/constants.js";

// Import date and status calculation functions from shared module
import {
    formatDetailedDate,
    calculateDateRanges,
    getAllWorkflowConfigs,
    getStage3CommitSha,
} from "../src/utils.js";
import {
    calculateStageStatuses,
    calculatePipelineStatus,
    calculateHistoricPipelineDuration,
} from "../src/utils.js";

// Import Node.js-specific utilities
import {
    getAuthHeadersNode,
    getGlDaysFromDate,
    collectStage3RunIdsNode,
    processWorkflowRunsNode,
    fetchWorkflowRunsPaginatedNode,
} from "./utils-node.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, "..");

// Use constants from shared module
const GARDENLINUX_ORG = API_CONFIG.GARDENLINUX_ORG;
const GITHUB_API_BASE = API_CONFIG.GITHUB_API_BASE;

// Shared rate limit state to coordinate parallel requests
const rateLimitState = {
    resetTime: 0,
    waiting: false,
    waitPromise: null,
};

// API response cache to avoid duplicate requests
const apiCache = new Map();

// Cache directory for persisting API responses
const CACHE_DIR = join(ROOT_DIR, ".cache", "api");

// Initialize cache directory
function initCacheDir() {
    if (!existsSync(CACHE_DIR)) {
        mkdirSync(CACHE_DIR, { recursive: true });
    }
}

// Generate safe filename from URL
function urlToCacheFilename(url) {
    const hash = createHash("sha256").update(url).digest("hex");
    return `${hash}.json`;
}

// Load API cache from filesystem
function loadApiCache() {
    initCacheDir();
    const cacheFiles = [];
    try {
        const files = readdirSync(CACHE_DIR, { withFileTypes: true });
        for (const file of files) {
            if (file.isFile() && file.name.endsWith(".json")) {
                cacheFiles.push(file.name);
            }
        }
    } catch (error) {
        // Directory might not exist or be empty, that's okay
        return;
    }

    let loadedCount = 0;
    for (const filename of cacheFiles) {
        try {
            const filePath = join(CACHE_DIR, filename);
            const cacheEntry = JSON.parse(readFileSync(filePath, "utf-8"));
            // Reconstruct URL from cache entry metadata if available
            // Otherwise, we'll need to store URL in the cache entry
            if (cacheEntry.url) {
                apiCache.set(cacheEntry.url, {
                    data: cacheEntry.data,
                    status: cacheEntry.status,
                    statusText: cacheEntry.statusText,
                    headers: cacheEntry.headers,
                });
                loadedCount++;
            }
        } catch (error) {
            // Skip corrupted cache files
            console.warn(`  ⚠️  Skipping corrupted cache file: ${filename}`);
        }
    }
    if (loadedCount > 0) {
        console.log(`  📦 Loaded ${loadedCount} API responses from cache`);
    }
}

// Save API cache entry to filesystem
function saveApiCacheEntry(url, cacheData) {
    try {
        initCacheDir();
        const filename = urlToCacheFilename(url);
        const filePath = join(CACHE_DIR, filename);
        const cacheEntry = {
            url, // Store URL for reconstruction on load
            data: cacheData.data,
            status: cacheData.status,
            statusText: cacheData.statusText,
            headers: cacheData.headers,
            cachedAt: new Date().toISOString(),
        };
        writeFileSync(filePath, JSON.stringify(cacheEntry, null, 2));
    } catch (error) {
        // Don't fail if cache write fails, just log warning
        console.warn(`  ⚠️  Failed to save API cache entry: ${error.message}`);
    }
}

// Print help information and exit
function printHelp() {
    console.log(`
Historic Release Data Collector

Collects historic release data for Garden Linux dashboard caching.
References packages/{glDays}.json instead of duplicating package data.
Archives for yesterday when run in GitHub Actions context.

USAGE:
    node scripts/collect-historic.js [OPTIONS]

OPTIONS:
    --help, -h, -?              Show this help message and exit

    --days <number>             Number of historic releases to collect (default: 14)
                                Collects N releases going backwards from the start point

    --gl <number>               Collect specific GL version only (overrides other options)
                                When specified, only this single version is collected

    --start-from-gl <number>    Start collection from specific GL version and collect
                                N days backwards (overrides --start-from-yesterday/today)
                                Example: --start-from-gl 2000 --days 7 collects GL 2000-1994

    --output-dir <path>         Output directory for JSON files (default: "historic")
                                Files are saved as {glDays}.json in this directory

    --batch-size <number>       Number of GL days to process in parallel (default: 3)
                                Workflows within each day are processed sequentially
                                Higher values = faster but more API rate limit pressure

    --start-from-yesterday      Start from yesterday (default behavior)
                                Today's data is still being generated, so yesterday is
                                the most recent complete day

    --start-from-today          Start from today instead of yesterday
                                Note: Today's data may still be incomplete

    --force                     Force re-collection even if output files already exist
                                By default, existing files are skipped to avoid duplicate
                                API calls. Use this flag to re-fetch and overwrite.

EXAMPLES:
    # Collect last 14 days (default)
    node scripts/collect-historic.js

    # Collect last 7 days
    node scripts/collect-historic.js --days 7

    # Collect from specific GL version backwards
    node scripts/collect-historic.js --start-from-gl 2000 --days 7

    # Collect single specific GL version
    node scripts/collect-historic.js --gl 2000

    # Collect with custom output directory
    node scripts/collect-historic.js --output-dir custom-historic --days 30

    # Collect with higher parallelism (faster but more rate limit pressure)
    node scripts/collect-historic.js --batch-size 5 --days 14

NOTES:
    - Requires GITHUB_TOKEN environment variable for authenticated API access
      Without token, API calls are rate-limited to 60 requests/hour
      With token, rate limit is 5000 requests/hour

    - The script automatically handles rate limiting and will wait for reset
      if the rate limit is exceeded

    - Workflows are processed sequentially within each GL day to avoid
      overwhelming the API, but multiple GL days can be processed in parallel

    - Package data is read from packages/{glDays}.json files (not duplicated)

    - Output files follow the schema version defined in constants.js

    - Caching: By default, the script skips GL days that already have output files
      in the output directory. Use --force to re-collect everything.
`);
    process.exit(0);
}

// Parse command line arguments
function parseArgs() {
    const args = process.argv.slice(2);

    // Check for help flags first
    if (args.includes("--help") || args.includes("-h") || args.includes("-?")) {
        printHelp();
    }

    const config = {
        days: 14,
        gl: null,
        startFromGl: null,
        outputDir: "historic",
        startFromYesterday: true, // Default to yesterday (today's data is still being generated)
        batchSize: 3, // Default batch size for parallel processing of GL days (workflows are processed sequentially)
        force: false, // Force re-collection even if files exist
    };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--days" && i + 1 < args.length) {
            config.days = parseInt(args[i + 1], 10);
            if (isNaN(config.days) || config.days < 1) {
                console.error("Error: --days must be a positive integer");
                process.exit(1);
            }
            i++;
        } else if (args[i] === "--gl" && i + 1 < args.length) {
            config.gl = parseInt(args[i + 1], 10);
            if (isNaN(config.gl) || config.gl < 1) {
                console.error("Error: --gl must be a positive integer");
                process.exit(1);
            }
            i++;
        } else if (args[i] === "--start-from-gl" && i + 1 < args.length) {
            config.startFromGl = parseInt(args[i + 1], 10);
            if (isNaN(config.startFromGl) || config.startFromGl < 1) {
                console.error(
                    "Error: --start-from-gl must be a positive integer"
                );
                process.exit(1);
            }
            i++;
        } else if (args[i] === "--output-dir" && i + 1 < args.length) {
            config.outputDir = args[i + 1];
            i++;
        } else if (args[i] === "--batch-size" && i + 1 < args.length) {
            config.batchSize = parseInt(args[i + 1], 10);
            if (isNaN(config.batchSize) || config.batchSize < 1) {
                console.error("Error: --batch-size must be a positive integer");
                process.exit(1);
            }
            i++;
        } else if (args[i] === "--start-from-yesterday") {
            config.startFromYesterday = true;
        } else if (args[i] === "--start-from-today") {
            config.startFromYesterday = false;
        } else if (args[i] === "--force") {
            config.force = true;
        } else if (
            args[i] !== "--help" &&
            args[i] !== "-h" &&
            args[i] !== "-?"
        ) {
            console.error(`Error: Unknown option: ${args[i]}`);
            console.error("Use --help to see available options");
            process.exit(1);
        }
    }

    return config;
}

// getAuthHeaders is now imported from utils-node.js as getAuthHeadersNode

/**
 * Reconstructs a Response object from cached data
 * @param {Object} cacheData - Cached response data
 * @returns {Response} Response object that can be used with .json()
 */
function reconstructResponseFromCache(cacheData) {
    return new Response(JSON.stringify(cacheData.data), {
        status: cacheData.status,
        statusText: cacheData.statusText,
        headers: cacheData.headers,
    });
}

// Fetch with rate limit handling and retry, with caching
async function fetchWithRetry(url, options, maxRetries = 3) {
    // Check cache first
    const cacheKey = url; // Use URL as key (options are usually the same for same URL)
    if (apiCache.has(cacheKey)) {
        const cached = apiCache.get(cacheKey);
        return reconstructResponseFromCache(cached);
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        let response;
        try {
            response = await fetch(url, options);
        } catch (error) {
            // Network error (not HTTP error)
            if (attempt < maxRetries - 1) {
                const backoffTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
                console.warn(
                    `    ⚠️  Network error: ${error.message}. Retrying in ${backoffTime / 1000}s... (attempt ${attempt + 1}/${maxRetries})`
                );
                await new Promise((resolve) =>
                    setTimeout(resolve, backoffTime)
                );
                continue;
            }
            // Re-throw on final attempt
            throw error;
        }

        // Check rate limit headers
        const remaining = parseInt(
            response.headers.get("x-ratelimit-remaining") || "0",
            10
        );
        const resetTime = parseInt(
            response.headers.get("x-ratelimit-reset") || "0",
            10
        );

        if (response.status === 403 && remaining === 0 && resetTime > 0) {
            // Rate limited - coordinate waiting across parallel requests
            const now = Math.floor(Date.now() / 1000);
            const waitTime = resetTime - now + 1; // Add 1 second buffer

            if (waitTime > 0 && waitTime < 3600) {
                // Only wait if reasonable (less than 1 hour)
                // Use shared state to ensure only one wait happens
                const currentTime = Math.floor(Date.now() / 1000);

                // Check if we need to wait and if someone else is already waiting
                if (resetTime > rateLimitState.resetTime) {
                    rateLimitState.resetTime = resetTime;
                    rateLimitState.waiting = true;

                    console.warn(
                        `    ⏳ Rate limit exceeded. Waiting ${waitTime}s until reset (${new Date(resetTime * 1000).toLocaleTimeString()})...`
                    );

                    // Create a shared wait promise
                    rateLimitState.waitPromise = new Promise((resolve) =>
                        setTimeout(resolve, waitTime * 1000)
                    );

                    await rateLimitState.waitPromise;
                    rateLimitState.waiting = false;
                    rateLimitState.waitPromise = null;
                } else if (
                    rateLimitState.waiting &&
                    rateLimitState.waitPromise
                ) {
                    // Another request is already waiting, join that wait
                    await rateLimitState.waitPromise;
                }

                continue; // Retry after waiting
            }
        }

        if (response.status === 403 && attempt < maxRetries - 1) {
            // Exponential backoff for 403 errors (when not rate limited)
            const backoffTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
            console.warn(
                `    ⏳ Rate limited (403). Retrying in ${backoffTime / 1000}s... (attempt ${attempt + 1}/${maxRetries})`
            );
            await new Promise((resolve) => setTimeout(resolve, backoffTime));
            continue;
        }

        // Cache successful responses before returning
        if (response.ok) {
            try {
                // Clone response to read body without consuming original
                const clonedResponse = response.clone();
                const data = await clonedResponse.json();
                const headers = {};
                response.headers.forEach((value, key) => {
                    headers[key] = value;
                });
                const cacheData = {
                    data,
                    status: response.status,
                    statusText: response.statusText,
                    headers,
                };
                apiCache.set(cacheKey, cacheData);
                // Persist to filesystem
                saveApiCacheEntry(cacheKey, cacheData);
            } catch (jsonError) {
                // If JSON parsing fails, continue without caching
            }
        }

        return response;
    }

    // Final attempt
    const response = await fetch(url, options);
    // Cache successful final attempt
    if (response.ok) {
        try {
            // Clone response to read body without consuming original
            const clonedResponse = response.clone();
            const data = await clonedResponse.json();
            const headers = {};
            response.headers.forEach((value, key) => {
                headers[key] = value;
            });
            const cacheData = {
                data,
                status: response.status,
                statusText: response.statusText,
                headers,
            };
            apiCache.set(cacheKey, cacheData);
            // Persist to filesystem
            saveApiCacheEntry(cacheKey, cacheData);
        } catch (jsonError) {
            // If JSON parsing fails, continue without caching
        }
    }
    return response;
}

// Date calculation functions are now imported from src/utils.js
// getGlDaysFromDate is imported from utils-node.js

// Get package status summary from packages file
function getPackageStatusSummary(glDays) {
    const packagesPath = join(ROOT_DIR, "packages", `${glDays}.json`);

    if (!existsSync(packagesPath)) {
        return {
            status: "no-data",
            issueCount: 0,
            totalCount: 0,
        };
    }

    try {
        const packagesData = JSON.parse(readFileSync(packagesPath, "utf-8"));
        const packages = Array.isArray(packagesData) ? packagesData : [];

        let issueCount = 0;
        for (const pkg of packages) {
            if (PACKAGE_STATUSES.PROBLEMATIC.includes(pkg.Status)) {
                issueCount++;
            }
        }

        return {
            status: issueCount > 0 ? "warning" : "success",
            issueCount,
            totalCount: packages.length,
        };
    } catch (error) {
        console.warn(`Failed to read packages/${glDays}.json:`, error.message);
        return {
            status: "error",
            issueCount: 0,
            totalCount: 0,
        };
    }
}

// collectStage3RunIds is now imported from utils-node.js as collectStage3RunIdsNode

// Workflow processing functions are now imported from utils-node.js

// Status calculation functions are now imported from src/utils.js

// Collect historic data for a single GL day
async function collectHistoricDay(glDays) {
    // Skip GL versions older than minimum supported version
    if (glDays < MIN_GL_VERSION) {
        throw new Error(
            `GL${glDays} is older than minimum supported version GL${MIN_GL_VERSION} (workflow structure changed before this version)`
        );
    }

    console.log(`\n📦 Collecting data for GL${glDays}...`);

    const glDate = formatDetailedDate(glDays);
    const { targetDate, nextDay, extendedDate, extendedNextDay } =
        calculateDateRanges(glDays, GL_INITIAL_DATE);

    console.log(
        `  📅 Date: ${glDate} (${targetDate.toISOString().split("T")[0]})`
    );

    // Get package status summary (references packages file, doesn't duplicate)
    console.log(`  📦 Loading package status from packages/${glDays}.json...`);
    const packageStatus = getPackageStatusSummary(glDays);
    console.log(
        `  📦 Package status: ${packageStatus.status} (${packageStatus.issueCount} issues, ${packageStatus.totalCount} total)`
    );

    // Collect Stage 3 run IDs
    console.log(`  🔍 Collecting Stage 3 run IDs...`);
    const stage3Workflows = [
        {
            id: WORKFLOW_IDS.NIGHTLY,
            repo: WORKFLOWS.NIGHTLY.repo,
            name: WORKFLOWS.NIGHTLY.name,
        },
        {
            id: WORKFLOW_IDS.MANUAL_RELEASE,
            repo: WORKFLOWS.MANUAL_RELEASE.repo,
            name: WORKFLOWS.MANUAL_RELEASE.name,
        },
    ];
    const stage3RunIds = await collectStage3RunIdsNode(
        stage3Workflows,
        targetDate,
        nextDay,
        glDays,
        fetchWithRetry,
        getAuthHeadersNode
    );
    console.log(`  🔍 Found ${stage3RunIds.size} Stage 3 run IDs`);

    // Collect workflow data using shared utility
    // Version-aware: excludes stage-4 workflows for schema v2 (GL >= SCHEMA_V2_CUTOFF)
    const workflowChecks = getAllWorkflowConfigs(glDays).filter((w) =>
        w.stage.startsWith("stage-")
    );

    console.log(
        `  🔄 Collecting workflow data for ${workflowChecks.length} workflows sequentially...`
    );
    const workflowStatuses = {};
    const workflowRunData = {};
    const workflowRuns = {};
    const workflowMetadata = {};

    // Process workflows sequentially (no parallelization at workflow level)
    for (const workflow of workflowChecks) {
        const startTime = Date.now();
        try {
            console.log(
                `    🔄 Processing ${workflow.name} (${workflow.id})...`
            );
            // Use pagination to fetch all runs
            const runs = await fetchWorkflowRunsPaginatedNode(
                workflow,
                targetDate,
                nextDay,
                fetchWithRetry,
                getAuthHeadersNode
            );
            const fetchTime = Date.now() - startTime;
            console.log(
                `      📊 ${workflow.name}: Found ${runs.length} runs (${fetchTime}ms)`
            );

            const result = await processWorkflowRunsNode(
                workflow,
                runs,
                targetDate,
                nextDay,
                extendedNextDay,
                stage3RunIds,
                glDays,
                fetchWithRetry,
                getAuthHeadersNode
            );

            const totalTime = Date.now() - startTime;
            console.log(
                `      ✓ ${workflow.name}: ${result.status}${result.runData ? ` (run ${result.runData.id})` : ""} (${totalTime}ms)`
            );

            workflowStatuses[workflow.id] = result.status;
            if (result.runData) {
                workflowRunData[workflow.id] = result.runData;
            }
            if (result.allRuns && result.allRuns.length > 0) {
                workflowRuns[workflow.id] = {
                    repo: workflow.repo,
                    workflowFile: workflow.workflowFile,
                    workflowName: workflow.name,
                    runs: result.allRuns.map((run) => ({
                        id: run.id,
                        html_url: run.html_url,
                        status: run.status,
                        conclusion: run.conclusion,
                        created_at: run.created_at,
                        updated_at: run.updated_at,
                        head_branch: run.head_branch,
                        head_sha: run.head_sha,
                        workflow_url:
                            run.workflow_url ||
                            `https://github.com/${GARDENLINUX_ORG}/${workflow.repo}/actions/workflows/${workflow.workflowFile}`,
                    })),
                };
            }

            workflowMetadata[workflow.id] = {
                repo: workflow.repo,
                workflowFile: workflow.workflowFile,
                name: workflow.name,
                workflowUrl: `https://github.com/${GARDENLINUX_ORG}/${workflow.repo}/actions/workflows/${workflow.workflowFile}`,
            };
        } catch (error) {
            const totalTime = Date.now() - startTime;
            console.warn(
                `      ⚠️  Error processing ${workflow.name} (${totalTime}ms):`,
                error.message
            );
            workflowStatuses[workflow.id] = "unknown";
        }
    }

    // Calculate stage and pipeline statuses
    console.log(`  📊 Calculating stage and pipeline statuses...`);
    const stageStatuses = calculateStageStatuses(
        workflowStatuses,
        packageStatus.status,
        getStageWorkflows(glDays)
    );
    const pipelineStatus = calculatePipelineStatus(stageStatuses);
    const duration = calculateHistoricPipelineDuration(
        workflowRunData,
        WORKFLOW_IDS,
        glDays
    );
    console.log(
        `  📊 Pipeline status: ${pipelineStatus}${duration ? ` (duration: ${duration})` : ""}`
    );

    // Stage 3 commit SHA (shown next to the version in the UI)
    const commitSha = getStage3CommitSha(workflowRunData, WORKFLOW_IDS);

    // Build output structure
    const output = {
        schemaVersion: HISTORIC_CACHE_SCHEMA_VERSION,
        glDays,
        date: glDate,
        timestamp: new Date().toISOString(),
        cached: true,

        // Package data reference (not duplicated)
        packageDataPath: `packages/${glDays}.json`,
        packageIssuesPath: `packages/${glDays}.json`,
        packageStatus,

        // Individual workflow statuses
        workflowStatuses,

        // Aggregated stage statuses
        workflowStatus: stageStatuses,

        // Pipeline status
        pipelineStatus,
        duration,

        // Stage 3 commit SHA (full), rendered short in the UI
        commitSha,

        // Workflow run data
        workflowRuns,

        // Workflow metadata
        workflowMetadata,
    };

    return output;
}

// Main function
async function main() {
    const config = parseArgs();

    console.log("🚀 Starting historic release data collection");
    console.log(`📋 Configuration:`);
    console.log(`   - Days: ${config.days}`);
    console.log(`   - Output directory: ${config.outputDir}`);
    console.log(`   - Batch size: ${config.batchSize}`);
    if (config.gl) {
        console.log(`   - Specific GL version: ${config.gl}`);
    } else if (config.startFromGl) {
        console.log(`   - Start from GL version: ${config.startFromGl}`);
    } else {
        console.log(
            `   - Start from: ${config.startFromYesterday ? "yesterday" : "today"}`
        );
    }

    // Determine GL days to collect
    let glDaysList = [];

    if (config.gl) {
        // Priority 1: --gl flag (collects single version, overrides everything)
        glDaysList = [config.gl];
        console.log(`📅 Collecting single GL version: GL${config.gl}`);
    } else if (config.startFromGl) {
        // Priority 2: --start-from-gl flag (starts from specific GL, collects N days backwards)
        console.log(
            `📅 Starting from GL${config.startFromGl}, collecting ${config.days} days backwards`
        );
        for (let i = 0; i < config.days; i++) {
            glDaysList.push(config.startFromGl - i);
        }
    } else {
        // Priority 3: Default behavior (yesterday/today)
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let startGlDays;
        if (config.startFromYesterday) {
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            startGlDays = getGlDaysFromDate(yesterday);
            console.log(`📅 Starting from yesterday (GL${startGlDays})`);
        } else {
            startGlDays = getGlDaysFromDate(today);
            console.log(`📅 Starting from today (GL${startGlDays})`);
        }

        for (let i = 0; i < config.days; i++) {
            glDaysList.push(startGlDays - i);
        }
    }

    // Filter out GL versions older than minimum supported version
    const originalCount = glDaysList.length;
    glDaysList = glDaysList.filter((glDays) => glDays >= MIN_GL_VERSION);
    const filteredCount = originalCount - glDaysList.length;

    if (filteredCount > 0) {
        console.warn(
            `⚠️  Skipping ${filteredCount} GL version(s) older than GL${MIN_GL_VERSION} (workflow structure changed before this version)`
        );
    }

    if (glDaysList.length === 0) {
        console.error(
            `❌ No GL versions to collect (all were filtered out as older than GL${MIN_GL_VERSION})`
        );
        process.exit(1);
    }

    console.log(
        `📋 Will collect data for ${glDaysList.length} GL version(s): ${glDaysList.join(", ")}`
    );

    // Load API cache from filesystem
    console.log("📦 Loading API cache from filesystem...");
    loadApiCache();

    // Create output directory
    const outputDir = join(ROOT_DIR, config.outputDir);
    if (!existsSync(outputDir)) {
        console.log(`📁 Creating output directory: ${outputDir}`);
        mkdirSync(outputDir, { recursive: true });
    } else {
        console.log(`📁 Using output directory: ${outputDir}`);
    }

    // Collect data for each GL day in parallel batches
    let successCount = 0;
    let failCount = 0;
    let cachedCount = 0;

    // Process GL days in batches for parallel processing
    const glDaysBatchSize = config.batchSize; // Use same batch size for GL days
    for (let i = 0; i < glDaysList.length; i += glDaysBatchSize) {
        const glDaysBatch = glDaysList.slice(i, i + glDaysBatchSize);
        const batchNum = Math.floor(i / glDaysBatchSize) + 1;
        const totalBatches = Math.ceil(glDaysList.length / glDaysBatchSize);

        console.log(
            `\n📦 Processing GL days batch ${batchNum}/${totalBatches} (${glDaysBatch.length} releases in parallel)...`
        );
        const batchStartTime = Date.now();

        const glDaysPromises = glDaysBatch.map(async (glDays) => {
            try {
                const outputPath = join(outputDir, `${glDays}.json`);

                // Check if file already exists and we're not forcing
                if (!config.force && existsSync(outputPath)) {
                    try {
                        const cachedData = JSON.parse(
                            readFileSync(outputPath, "utf-8")
                        );
                        console.log(
                            `  ⊙ Using cached data for GL${glDays} (use --force to re-collect)`
                        );
                        return { success: true, glDays, cached: true };
                    } catch (cacheError) {
                        console.warn(
                            `  ⚠️  Failed to read cache for GL${glDays}, re-collecting:`,
                            cacheError.message
                        );
                        // Fall through to re-collect
                    }
                }

                // Collect data (will use API cache for duplicate requests)
                const data = await collectHistoricDay(glDays);
                writeFileSync(outputPath, JSON.stringify(data, null, 2));
                console.log(`  ✓ Saved ${outputPath}`);
                return { success: true, glDays, cached: false };
            } catch (error) {
                console.error(
                    `  ✗ Failed to collect GL${glDays}:`,
                    error.message
                );
                return { success: false, glDays, error: error.message };
            }
        });

        const batchResults = await Promise.all(glDaysPromises);
        const batchTime = Date.now() - batchStartTime;

        for (const result of batchResults) {
            if (result.success) {
                successCount++;
                if (result.cached) {
                    cachedCount++;
                }
            } else {
                failCount++;
            }
        }

        console.log(
            `✅ GL days batch ${batchNum}/${totalBatches} completed in ${batchTime}ms`
        );

        // Small delay between GL day batches to avoid rate limiting (except for last batch)
        if (i + glDaysBatchSize < glDaysList.length) {
            await new Promise((resolve) => setTimeout(resolve, 200)); // 200ms delay
        }
    }

    console.log(`\n✅ Collection complete!`);
    console.log(`   - Successfully collected: ${successCount}`);
    if (cachedCount > 0) {
        console.log(`   - Used cached data: ${cachedCount}`);
    }
    if (failCount > 0) {
        console.log(`   - Failed: ${failCount}`);
    }
    if (apiCache.size > 0) {
        console.log(
            `   - API requests cached: ${apiCache.size} (avoided duplicate requests)`
        );
    }
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
