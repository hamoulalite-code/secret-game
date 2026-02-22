(() => {
  const els = {
    tbody: document.getElementById("rooms-tbody"),
    roomsCount: document.getElementById("rooms-count"),
    lastUpdate: document.getElementById("last-update"),
    empty: document.getElementById("empty"),
    search: document.getElementById("search"),
    sort: document.getElementById("sort"),
    status: document.getElementById("status"),
    joinId: document.getElementById("join-id"),
    btnJoin: document.getElementById("btn-join"),
    btnQuick: document.getElementById("btn-quick"),
    btnRefresh: document.getElementById("btn-refresh"),
    connState: document.getElementById("conn-state"),
  };

  let rooms = [];
  let socket = null;

  const nowLabel = () => {
    const d = new Date();
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const normalize = (s) => (s || "").toString().toLowerCase().trim();

  const calcStatus = (r) => {
    const cap = Number(r.capacity ?? 10);
    const count = Number(r.playersCount ?? r.players ?? 0);
    return count >= cap ? "full" : "open";
  };

  const pingServer = async () => {
    const t0 = performance.now();
    try {
      await fetch("/", { cache: "no-store" });
      const t1 = performance.now();
      return Math.round(t1 - t0);
    } catch {
      return null;
    }
  };

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
  function escapeAttr(str) {
    return escapeHtml(str).replaceAll(" ", "");
  }

  const setConn = (ok, msg) => {
    if (els.connState) els.connState.textContent = msg || (ok ? "Connecté" : "Déconnecté");
  };

  // RENDER
  const render = () => {
    const q = normalize(els.search?.value);
    const statusFilter = els.status?.value || "all";

    let data = rooms.slice();

    if (q) {
      data = data.filter((r) => {
        const hay = `${r.name || ""} ${r.id || ""}`.toLowerCase();
        return hay.includes(q);
      });
    }
    if (statusFilter !== "all") {
      data = data.filter((r) => calcStatus(r) === statusFilter);
    }

    const s = els.sort?.value || "players_desc";
    const byName = (a, b) => (a.name || "").localeCompare(b.name || "");
    const byPlayers = (a, b) => Number(a.playersCount || 0) - Number(b.playersCount || 0);
    const byPing = (a, b) => Number(a.pingMs ?? 9999) - Number(b.pingMs ?? 9999);

    if (s === "name_asc") data.sort(byName);
    if (s === "name_desc") data.sort((a, b) => byName(b, a));
    if (s === "players_asc") data.sort(byPlayers);
    if (s === "players_desc") data.sort((a, b) => byPlayers(b, a));
    if (s === "ping_asc") data.sort(byPing);
    if (s === "ping_desc") data.sort((a, b) => byPing(b, a));

    if (!els.tbody) return;
    els.tbody.innerHTML = "";

    for (const r of data) {
      const id = r.id ?? "—";
      const name = r.name ?? id;
      const count = Number(r.playersCount ?? r.players ?? 0);
      const cap = Number(r.capacity ?? 10);
      const ping = r.pingMs == null ? "—" : `${r.pingMs} ms`;
      const st = calcStatus(r);
      const isFull = st === "full";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${escapeHtml(name)}</strong></td>
        <td class="hide-sm">${escapeHtml(id)}</td>
        <td>${count}/${cap}</td>
        <td class="hide-sm">${ping}</td>
        <td>
          <span class="badge">
            <span class="${isFull ? "dot-offline" : "dot-online"}"></span>
            ${isFull ? "Complet" : "Ouvert"}
          </span>
        </td>
        <td class="right">
          <button class="action-btn ${isFull ? "" : "primary"}" ${isFull ? "disabled" : ""} data-join="${escapeAttr(id)}">
            ${isFull ? "Complet" : "Rejoindre"}
          </button>
        </td>
      `;
      els.tbody.appendChild(tr);
    }

    if (els.roomsCount) els.roomsCount.textContent = String(data.length);
    if (els.empty) els.empty.classList.toggle("hidden", data.length !== 0);
  };

  // LOAD rooms from API OR socket
  const loadRooms = async () => {
    if (els.lastUpdate) els.lastUpdate.textContent = "…";

    // 1) Try API
    try {
      const res = await fetch("/api/rooms", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        rooms = Array.isArray(json) ? json : json.rooms || [];
        const p = await pingServer();
        rooms = rooms.map((r) => ({ ...r, pingMs: p }));
        if (els.lastUpdate) els.lastUpdate.textContent = nowLabel();
        render();
        return;
      }
    } catch {}

    // 2) Try socket list
    try {
      if (!socket && window.io) {
        socket = io();
        socket.on("connect", () => setConn(true));
        socket.on("disconnect", () => setConn(false));

        socket.on("rooms:list", async (list) => {
          const p = await pingServer();
          rooms = (list || []).map((r) => ({ ...r, pingMs: p }));
          if (els.lastUpdate) els.lastUpdate.textContent = nowLabel();
          render();
        });

        socket.on("room:update", async (room) => {
          const idx = rooms.findIndex((x) => x.id === room.id);
          const p = await pingServer();
          const updated = { ...room, pingMs: p };
          if (idx >= 0) rooms[idx] = updated;
          else rooms.push(updated);
          if (els.lastUpdate) els.lastUpdate.textContent = nowLabel();
          render();
        });
      }

      if (socket) {
        socket.emit("rooms:get");
        setTimeout(() => {
          if (!rooms.length) mockRooms();
        }, 600);
        return;
      }
    } catch {}

    // 3) fallback
    mockRooms();
  };

  const mockRooms = () => {
    rooms = [
      { id: "room-1", name: "Serveur #1", playersCount: 0, capacity: 10, pingMs: 22 },
      { id: "room-2", name: "Serveur #2", playersCount: 0, capacity: 10, pingMs: 34 },
      { id: "room-3", name: "Serveur #3", playersCount: 0, capacity: 10, pingMs: 48 },
    ];
    if (els.lastUpdate) els.lastUpdate.textContent = nowLabel();
    render();
    setConn(true, "Mode démo (pas de liste live)");
  };

  // ✅ JOIN (corrigé pour TON jeu : roomId)
  const joinRoom = async (roomId) => {
    const id = normalize(roomId).replaceAll(" ", "");
    if (!id) return;

    // rejoindre côté serveur (optionnel mais utile)
    try {
      if (!socket && window.io) socket = io();
      if (socket) socket.emit("room:join", { roomId: id });
    } catch {}

    // Ta page de jeu lit ?roomId=
    // On tente game.html puis index.html
    const candidates = [
      `/game.html?roomId=${encodeURIComponent(id)}`,
      `/index.html?roomId=${encodeURIComponent(id)}`,
    ];

    for (const url of candidates) {
      const path = url.split("?")[0];
      try {
        const res = await fetch(path, { method: "HEAD", cache: "no-store" });
        if (res.ok) {
          window.location.href = url;
          return;
        }
      } catch {}
    }

    // fallback (au cas où HEAD est bloqué)
    window.location.href = candidates[0];
  };

  // EVENTS
  if (els.search) els.search.addEventListener("input", render);
  if (els.sort) els.sort.addEventListener("change", render);
  if (els.status) els.status.addEventListener("change", render);

  if (els.btnRefresh) els.btnRefresh.addEventListener("click", loadRooms);

  if (els.btnJoin) els.btnJoin.addEventListener("click", () => joinRoom(els.joinId?.value));
  if (els.btnQuick) {
    els.btnQuick.addEventListener("click", () => {
      const open = rooms.filter((r) => Number(r.playersCount || 0) < Number(r.capacity || 10));
      if (!open.length) return;
      open.sort((a, b) => Number(b.playersCount || 0) - Number(a.playersCount || 0));
      joinRoom(open[0].id);
    });
  }

  if (els.tbody) {
    els.tbody.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-join]");
      if (!btn) return;
      joinRoom(btn.getAttribute("data-join"));
    });
  }

  // INIT
  setConn(false, "Connexion…");
  loadRooms();
})();