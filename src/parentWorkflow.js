/**
 * ========================================
 * GARDEN LINUX DASHBOARD - PARENT WORKFLOW TRACKER
 * ========================================
 *
 * This file handles parent workflow relationship tracking for Stage 4 workflows:
 * - Downloads and extracts artifacts from workflow runs
 * - Parses parent workflow information from artifact data
 * - Validates allowed artifact names for security
 * - Provides parent run ID mapping for Stage 4 publishing workflows
 *
 * Used to track which Stage 3 build triggered each Stage 4 publish workflow.
 */

import { ALLOWED_ARTIFACT_NAMES, API_CONFIG } from "./constants.js";
import { githubFetch } from "./utils.js";
import JSZip from "jszip";

/**
 * Download and extract artifact data to find parent workflow information
 */
export async function downloadAndExtractArtifact(owner, repo, artifact) {
    try {
        // Check if artifact name is in allowed list
        const isAllowed = ALLOWED_ARTIFACT_NAMES.some((allowedName) =>
            artifact.name.toLowerCase().includes(allowedName.toLowerCase())
        );
        if (!isAllowed) {
            return {
                success: false,
                reason: "not_allowed",
                message: `Artifact name '${artifact.name}' not in allowed list: ${ALLOWED_ARTIFACT_NAMES.join(", ")}`,
            };
        }
        // A 401/403 here is an expected outcome for anonymous users and is
        // handled locally below, so don't raise the global error banner.
        const downloadResponse = await githubFetch(
            `${API_CONFIG.GITHUB_API_BASE}/repos/${owner}/${repo}/actions/artifacts/${artifact.id}/zip`,
            { reportErrors: false }
        );
        if (!downloadResponse.ok) {
            const status = downloadResponse.status;
            console.error(
                `[ParentWorkflow] Failed to download artifact ${artifact.name} (ID: ${artifact.id}):`,
                {
                    status,
                    statusText: downloadResponse.statusText,
                    url: downloadResponse.url,
                }
            );

            if (status === 401 || status === 403) {
                return {
                    success: false,
                    reason: "auth_required",
                    message: `${status}: Authentication required`,
                    status,
                };
            } else {
                return {
                    success: false,
                    reason: "download_failed",
                    message: `${status}: ${downloadResponse.statusText}`,
                    status,
                };
            }
        }
        const arrayBuffer = await downloadResponse.arrayBuffer();
        const zip = new JSZip();
        const loadedZip = await zip.loadAsync(arrayBuffer);
        // Extract and parse files
        const extractedData = {};
        const jobId = null;
        let parentRunId = null;
        for (const [filename, file] of Object.entries(loadedZip.files)) {
            if (!file.dir) {
                const content = await file.async("text");
                extractedData[filename] = content;
                // Try to parse as JSON if possible
                try {
                    if (filename.toLowerCase().endsWith(".json")) {
                        const jsonData = JSON.parse(content);
                        extractedData[`${filename}_parsed`] = jsonData;
                        // Look for id in the JSON data
                        if (jsonData.id && !parentRunId) {
                            parentRunId = jsonData.id;
                        }
                    }
                } catch (parseError) {
                    // Log JSON parse errors for debugging
                    console.warn(
                        `[ParentWorkflow] Failed to parse JSON file ${filename}:`,
                        parseError.message
                    );
                }
            }
        }
        return {
            success: true,
            extractedData,
            jobId,
            parentRunId,
            fileCount: Object.keys(extractedData).length,
            message: `Successfully extracted ${Object.keys(extractedData).length} files`,
        };
    } catch (error) {
        console.error(
            `[ParentWorkflow] Error in downloadAndExtractArtifact for artifact ${artifact.name} (ID: ${artifact.id}):`,
            {
                error: error.message,
                stack: error.stack,
                artifactName: artifact.name,
                artifactId: artifact.id,
                owner,
                repo,
            }
        );
        return {
            success: false,
            reason: "extraction_error",
            message: error.message,
            error,
        };
    }
}

/**
 * Get parent workflow information and artifacts
 */
export async function getParentWorkflowInfo(owner, repo, runId) {
    try {
        // First, try to get parent workflow info from the workflow_run event
        // This is more reliable and doesn't require downloading artifacts
        const runResponse = await githubFetch(
            `${API_CONFIG.GITHUB_API_BASE}/repos/${owner}/${repo}/actions/runs/${runId}`
        );

        if (runResponse.ok) {
            const run = await runResponse.json();

            // Check for parent workflow run ID in workflow_run event
            if (run.event === "workflow_run" && run.workflow_run?.id) {
                return {
                    found: true,
                    message: "Parent run ID detected from workflow_run event",
                    parentRunId: run.workflow_run.id.toString(),
                    extractionMethod: "workflow_run_event",
                };
            }
        }

        // Fall back to artifact-based detection if workflow_run event doesn't provide parent info
        const artifactsResponse = await githubFetch(
            `${API_CONFIG.GITHUB_API_BASE}/repos/${owner}/${repo}/actions/runs/${runId}/artifacts`
        );
        if (!artifactsResponse.ok) {
            console.error(
                `[ParentWorkflow] Failed to fetch artifacts for run ${runId}:`,
                {
                    status: artifactsResponse.status,
                    statusText: artifactsResponse.statusText,
                    url: artifactsResponse.url,
                    runId,
                    owner,
                    repo,
                }
            );
            return {
                found: false,
                message: `Failed to fetch artifacts: ${artifactsResponse.status} ${artifactsResponse.statusText}`,
                error: `API Error: ${artifactsResponse.status}`,
            };
        }
        const artifactsData = await artifactsResponse.json();
        const artifacts = artifactsData.artifacts || [];
        const parentWorkflowArtifacts = artifacts.filter(
            (artifact) =>
                artifact.name &&
                ALLOWED_ARTIFACT_NAMES.some((allowedName) =>
                    artifact.name
                        .toLowerCase()
                        .includes(allowedName.toLowerCase())
                )
        );
        // Try to download and extract allowed artifacts first
        if (parentWorkflowArtifacts.length > 0) {
            for (const artifact of parentWorkflowArtifacts) {
                const extractionResult = await downloadAndExtractArtifact(
                    owner,
                    repo,
                    artifact
                );
                if (extractionResult.success && extractionResult.parentRunId) {
                    return {
                        found: true,
                        message:
                            "Parent run ID extracted from downloaded artifact",
                        artifactId: artifact.id,
                        artifactName: artifact.name,
                        parentRunId: extractionResult.parentRunId.toString(),
                        jobId: extractionResult.jobId,
                        extractionMethod: "artifact_download_extraction",
                        extractedData: extractionResult.extractedData,
                        fileCount: extractionResult.fileCount,
                    };
                }
            }
        }
        // Detection for all artifacts that might contain parent workflow information
        const allParentWorkflowArtifacts = artifacts.filter(
            (artifact) =>
                artifact.name && artifact.name === "parent-workflow-data"
        );
        if (allParentWorkflowArtifacts.length > 0) {
            for (const artifact of allParentWorkflowArtifacts) {
                const extractionResult = await downloadAndExtractArtifact(
                    owner,
                    repo,
                    artifact
                );
                if (extractionResult.success && extractionResult.parentRunId) {
                    return {
                        found: true,
                        message:
                            "Parent run ID extracted from downloaded artifact",
                        artifactId: artifact.id,
                        artifactName: artifact.name,
                        parentRunId: extractionResult.parentRunId.toString(),
                        jobId: extractionResult.jobId,
                        extractionMethod: "artifact_download_extraction",
                        extractedData: extractionResult.extractedData,
                        fileCount: extractionResult.fileCount,
                    };
                }
            }
            return {
                found: false,
                message: `Found no allowed artifacts`,
                artifactCount: artifacts.length,
                availableArtifacts: artifacts.slice(0, 10).map((a) => a.name),
                extractionMethod: "no_parent_indicators",
            };
        }
    } catch (error) {
        console.error(
            `[ParentWorkflow] Error in getParentWorkflowInfo for run ${runId}:`,
            {
                error: error.message,
                stack: error.stack,
                runId,
                owner,
                repo,
            }
        );
        return {
            found: false,
            message: "Error fetching artifact information",
            error: error.message,
            extractionMethod: "error",
        };
    }
}
