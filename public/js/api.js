// public/js/api.js
async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include"
  });

  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

window.API = {
  health: () => api("/api/health"),
  signup: (username, password) => api("/api/signup", { method: "POST", body: { username, password } }),
  login: (username, password) => api("/api/login", { method: "POST", body: { username, password } }),
  logout: () => api("/api/logout", { method: "POST" }),
  me: () => api("/api/me"),

  roomCreate: () => api("/api/room/create", { method: "POST" }),
  roomJoin: (code) => api("/api/room/join", { method: "POST", body: { code } }),
  roomSecret: (code, secretText) => api("/api/room/secret", { method: "POST", body: { code, secretText } }),
  roomState: (code) => api(`/api/room/state?code=${encodeURIComponent(code)}`),
  guessOwner: (code, secretId, guessedUserId) =>
    api("/api/guess-owner", { method: "POST", body: { code, secretId, guessedUserId } })
};