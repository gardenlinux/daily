/**
 * ========================================
 * GARDEN LINUX DASHBOARD - GLOBAL ERROR BANNER
 * ========================================
 *
 * Displays a single dismissible banner pinned to the very top of the page when
 * a GitHub API request is denied. Handles two broad cases:
 *   - Rate limiting (HTTP 403 with X-RateLimit-Remaining: 0, or 403/429 with
 *     Retry-After) -> shows a live countdown until access is expected back.
 *   - Access denied / authentication required (HTTP 401 or other 403) -> prompts
 *     the user to check their token in Settings.
 *
 * The banner is created dynamically as the first child of <body> so it always
 * renders above the header. It can be dismissed manually and auto-clears on the
 * next successful GitHub API response.
 */

const BANNER_ID = "global-error-banner";

// Grace period after an access-denied response during which a successful
// response will NOT auto-clear the banner. The dashboard fires many GitHub
// requests in parallel, so a sibling 200 can resolve microseconds after a
// legitimate 403; without this window that success would wipe the banner
// before the user ever sees it.
const AUTO_CLEAR_GRACE_MS = 1500;

// Tracks whether the user manually dismissed the current banner instance so we
// don't immediately re-show an identical message on the next failing request.
let dismissedSignature = null;
let countdownIntervalId = null;
// Timestamp of the most recent access-denied response, used to debounce
// auto-clear against concurrent successful responses.
let lastDenialAt = 0;

/**
 * Inspect a fetch Response and, if it indicates an access-denied condition,
 * show the global banner. Any successful GitHub response clears an existing
 * banner. Returns the same response for convenient pass-through.
 *
 * @param {Response} response
 * @returns {Response}
 */
export function reportApiResponse(response) {
    try {
        if (!response) {
            return response;
        }

        if (response.ok) {
            // Don't let a success that resolves alongside a concurrent
            // access-denied response immediately clear the banner.
            if (Date.now() - lastDenialAt > AUTO_CLEAR_GRACE_MS) {
                hideErrorBanner();
            }
            return response;
        }

        const status = response.status;
        if (status !== 401 && status !== 403 && status !== 429) {
            // Not an access-denied class of error; leave any existing banner as-is.
            return response;
        }

        lastDenialAt = Date.now();
        const classification = classifyResponse(response);
        showErrorBanner(classification);
    } catch (error) {
        console.error("[ErrorBanner] Failed to report API response:", {
            error: error && error.message,
        });
    }
    return response;
}

/**
 * Report a network-level failure (fetch threw before a response was produced).
 * @param {Error} error
 */
export function reportNetworkError(error) {
    // AbortError is an intentional timeout cancellation, not a connectivity issue.
    if (error && error.name === "AbortError") {
        return;
    }
    showErrorBanner({
        type: "network",
        message:
            "Could not reach the GitHub API. Check your network connection and try again.",
        resetAt: null,
    });
}

/**
 * Classify an access-denied response into a banner descriptor.
 * @param {Response} response
 * @returns {{type: string, message: string, resetAt: number|null}}
 */
function classifyResponse(response) {
    const status = response.status;
    const headers = response.headers;
    const hasToken = Boolean(getStoredToken());

    const rateRemaining = headers && headers.get("X-RateLimit-Remaining");
    const retryAfter = headers && headers.get("Retry-After");
    const rateReset = headers && headers.get("X-RateLimit-Reset");

    const isPrimaryRateLimit =
        status === 403 && rateRemaining !== null && Number(rateRemaining) === 0;
    const isSecondaryRateLimit =
        (status === 403 || status === 429) && retryAfter !== null;

    if (isPrimaryRateLimit || isSecondaryRateLimit) {
        const resetAt = computeResetAt(rateReset, retryAfter);
        const base = "GitHub API rate limit exceeded.";
        const advice = hasToken
            ? ""
            : " Add a Personal Access Token in Settings (\u2699\uFE0F) to raise the limit.";
        return {
            type: "rate-limit",
            message: `${base}${advice}`,
            resetAt,
        };
    }

    // Remaining 401 / 403 cases: authentication or permission problem.
    const message = hasToken
        ? `GitHub access denied (${status}). Check that your token has the required permissions in Settings (\u2699\uFE0F).`
        : `GitHub access denied (${status}). Add a Personal Access Token in Settings (\u2699\uFE0F) to access this data.`;
    return {
        type: "access-denied",
        message,
        resetAt: null,
    };
}

/**
 * Compute the epoch-milliseconds timestamp when access should return.
 * @param {string|null} rateReset X-RateLimit-Reset (epoch seconds)
 * @param {string|null} retryAfter Retry-After (seconds or HTTP date)
 * @returns {number|null}
 */
function computeResetAt(rateReset, retryAfter) {
    if (rateReset) {
        const epochSeconds = Number(rateReset);
        if (!Number.isNaN(epochSeconds) && epochSeconds > 0) {
            return epochSeconds * 1000;
        }
    }
    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (!Number.isNaN(seconds) && seconds >= 0) {
            return Date.now() + seconds * 1000;
        }
        const asDate = Date.parse(retryAfter);
        if (!Number.isNaN(asDate)) {
            return asDate;
        }
    }
    return null;
}

/**
 * Create or update the banner element.
 * @param {{type: string, message: string, resetAt: number|null}} descriptor
 */
export function showErrorBanner(descriptor) {
    if (typeof document === "undefined" || !document.body) {
        return;
    }

    const signature = `${descriptor.type}|${descriptor.message}`;
    if (signature === dismissedSignature) {
        // User dismissed this exact message; respect that until it changes.
        return;
    }

    let banner = document.getElementById(BANNER_ID);
    if (banner && banner.dataset.signature === signature) {
        // Same banner already shown; avoid rebuilding the subtree and resetting
        // the countdown on every concurrent failing request.
        return;
    }
    if (!banner) {
        banner = document.createElement("div");
        banner.id = BANNER_ID;
        banner.className = "global-error-banner";
        banner.setAttribute("role", "alert");
        document.body.insertBefore(banner, document.body.firstChild);
    }

    banner.dataset.signature = signature;

    const text = document.createElement("span");
    text.className = "global-error-banner__text";
    text.textContent = descriptor.message;

    const countdown = document.createElement("span");
    countdown.className = "global-error-banner__countdown";

    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.className = "global-error-banner__dismiss";
    dismissBtn.setAttribute("aria-label", "Dismiss");
    dismissBtn.textContent = "\u00D7";
    dismissBtn.addEventListener("click", () => {
        dismissedSignature = signature;
        lastDenialAt = 0;
        hideErrorBanner();
    });

    banner.replaceChildren(text, countdown, dismissBtn);

    stopCountdown();
    if (descriptor.resetAt) {
        startCountdown(countdown, descriptor.resetAt);
    }
}

/**
 * Remove the banner and stop any running countdown.
 */
export function hideErrorBanner() {
    stopCountdown();
    if (typeof document === "undefined") {
        return;
    }
    const banner = document.getElementById(BANNER_ID);
    if (banner && banner.parentNode) {
        banner.parentNode.removeChild(banner);
    }
}

function startCountdown(element, resetAt) {
    const render = () => {
        const remainingMs = resetAt - Date.now();
        if (remainingMs <= 0) {
            element.textContent =
                " Access should be available now \u2014 retrying shortly.";
            stopCountdown();
            return;
        }
        element.textContent = ` Resets in ${formatDuration(remainingMs)} (at ${formatClockTime(resetAt)}).`;
    };
    render();
    countdownIntervalId = setInterval(render, 1000);
}

function stopCountdown() {
    if (countdownIntervalId !== null) {
        clearInterval(countdownIntervalId);
        countdownIntervalId = null;
    }
}

function formatDuration(ms) {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes <= 0) {
        return `${seconds}s`;
    }
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function formatClockTime(epochMs) {
    try {
        return new Date(epochMs).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return new Date(epochMs).toISOString();
    }
}

function getStoredToken() {
    try {
        if (typeof localStorage === "undefined") {
            return null;
        }
        return localStorage.getItem("github_token");
    } catch {
        return null;
    }
}
