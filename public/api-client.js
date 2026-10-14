(function (root) {
  "use strict";

  function createApiClient({
    apiBaseUrl = "",
    fetchImpl = root.fetch.bind(root),
    onUnauthorized = () => {},
  } = {}) {
    const baseUrl = String(apiBaseUrl).replace(/\/+$/, "");
    let csrfToken = "";

    async function parsePayload(response) {
      return response.json().catch(() => ({}));
    }

    async function refreshCsrf() {
      const response = await fetchImpl(`${baseUrl}/api/auth/csrf`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = await parsePayload(response);
      if (!response.ok || !payload.csrfToken) {
        throw new Error(
          payload.error || "Sign-in is not available right now. Please try again.",
        );
      }
      csrfToken = payload.csrfToken;
      return csrfToken;
    }

    async function request(path, method = "GET", body) {
      const normalizedMethod = String(method || "GET").toUpperCase();
      const headers = { Accept: "application/json" };
      const hasBody = body !== undefined;
      if (hasBody) headers["Content-Type"] = "application/json";

      if (!["GET", "HEAD", "OPTIONS"].includes(normalizedMethod)) {
        if (!csrfToken) await refreshCsrf();
        headers["X-CSRF-Token"] = csrfToken;
      }

      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: normalizedMethod,
        credentials: "include",
        cache: "no-store",
        headers,
        ...(hasBody ? { body: JSON.stringify(body) } : {}),
      });
      const payload = await parsePayload(response);
      if (response.status === 401) {
        onUnauthorized();
        throw new Error(payload.error || "Please sign in again.");
      }
      if (!response.ok) {
        throw new Error(payload.error || `Request failed (${response.status})`);
      }
      return payload;
    }

    return {
      getSession: () => request("/api/auth/session"),
      logout: () => request("/api/auth/logout", "POST"),
      refreshCsrf,
      request,
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createApiClient };
  }
  if (typeof window !== "undefined") {
    window.RouteNestApi = createApiClient({
      apiBaseUrl: window.RouteNestConfig?.apiBaseUrl || "",
      fetchImpl: window.fetch.bind(window),
      onUnauthorized: () => window.location.replace("/login"),
    });
  }
})(typeof window !== "undefined" ? window : globalThis);
