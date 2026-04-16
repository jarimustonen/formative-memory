/**
 * Shared HTTP helpers for fetch-based provider clients.
 *
 * Kept out of the individual provider modules so that transport behavior
 * (timeout handling, abort semantics) stays consistent across LLM and
 * embedding callers.
 */

/**
 * Detect an AbortError robustly. Not all runtimes preserve the
 * DOMException prototype (Node.js undici typically does, but mocked
 * fetch implementations and proxy wrappers may not). The shape check
 * adds safety without cost.
 */
function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/**
 * fetch with a timeout enforced via AbortController. Throws a clear error
 * on timeout ("<label> timed out after Nms") instead of leaking
 * AbortError to the caller, which is often too generic to act on.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label = "HTTP call",
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
