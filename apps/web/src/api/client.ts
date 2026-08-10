/**
 * Thin fetch wrapper.
 *
 * The server and the frontend are served from the same origin, so requests are
 * same-origin relative URLs and there is no base URL to configure.
 */

/** An error carrying the server's status and message. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** True when the resource is simply gone, which callers often treat as empty. */
  get isNotFound() {
    return this.status === 404;
  }
}

async function toError(response: Response): Promise<ApiError> {
  // The server always sends {"error": "..."} for API failures, but a proxy or a
  // crash can still produce HTML, so this must not itself throw.
  let message = response.statusText || `Request failed (${response.status})`;
  try {
    const body = await response.json();
    if (body && typeof body.error === "string") message = body.error;
  } catch {
    // Leave the status-derived message in place.
  }
  return new ApiError(response.status, message);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const error = await toError(response);
    // A session can expire mid-session; tell the app once rather than letting
    // every caller invent its own handling.
    if (error.status === 401) {
      window.dispatchEvent(new CustomEvent("kintara-unauthorized"));
    }
    throw error;
  }

  // 204 No Content is the normal reply to writes and has no body to parse.
  if (response.status === 204) return undefined as T;

  // A 200 that is not JSON means something answered instead of the API — a dev
  // server with no proxy, or a captive portal. Left alone this surfaces as an
  // opaque "Unexpected token '<'" from deep inside a component.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new ApiError(
      response.status,
      "The server did not return JSON. Is the Kintara API running and reachable?",
    );
  }

  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),

  patch: <T>(path: string, body: unknown) =>
    request<T>(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  put: <T>(path: string, body: unknown) =>
    request<T>(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),

  /** Multipart upload. The browser sets the boundary, so no Content-Type here. */
  upload: <T>(path: string, form: FormData) =>
    request<T>(path, { method: "POST", body: form }),
};

/** Builds a query string, dropping undefined values rather than sending "undefined". */
export function queryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const rendered = search.toString();
  return rendered ? `?${rendered}` : "";
}
