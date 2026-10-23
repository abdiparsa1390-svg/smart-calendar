export const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
const SAME_ORIGIN_API = import.meta.env.VITE_API_SAME_ORIGIN === "true";
export const API_AVAILABLE = Boolean(import.meta.env.DEV || API_BASE_URL || SAME_ORIGIN_API);

export async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body != null && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response;
  try {
    response = await fetch(API_BASE_URL + path, {
      ...options,
      headers,
      credentials: "include"
    });
  } catch {
    throw new Error("Could not reach the account server. Check the backend URL and that the server is running.");
  }
  const type = response.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await response.json().catch(() => ({})) : {};
  if (!response.ok) {
    const error = new Error(data?.error || data?.message || ("Request failed (" + response.status + ")."));
    error.status = response.status;
    throw error;
  }
  return data;
}
