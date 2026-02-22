(() => {
  const socket = io();

  const els = {
    tbody: document.getElementById("rooms-tbody"),
    roomsCount: document.getElementById("rooms-count"),
    lastUpdate: document.getElementById("last-update"),
    empty: document.getElementById("empty"),
    connState: document.getElementById("conn-state"),

    // create
    playerName: document.getElementById("playerName"),
    serverName: document.getElementById("serverName"),
    requiredPlayers: document.getElementById("requiredPlayers"),
    btnCreate: document.getElementById("btnCreate"),
  };

  let rooms = [];

  const nowLabel = () => new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function render() {
    els.tbody.innerHTML = "";

    for (const r of rooms) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${escapeHtml(r.name)}</strong></td>
        <td class="hide-sm">${escapeHtml(r.id)}</td>
        <td>${r.playersCount}/${r.requiredPlayers}</td>
        <td>${escapeHtml(r.phase)}</td>
        <td class="right">
          <button class="action-btn primary" data-join="${escapeHtml(r.id)}">Rejoindre</button>
        </td>
      `;
      els.tbody.appendChild(tr);
    }

    els.roomsCount.textContent = String(rooms.length);
    els.empty.classList.toggle("hidden", rooms.length !== 0);
  }

  function setConn(ok, msg) {
    els.connState.textContent = msg || (ok ? "Connecté" : "Déconnecté");
  }

  function joinRoom(roomId) {
    const name = (els.playerName?.value || "").trim() || "Joueur";
    // on passe le pseudo en query pour la page game aussi (utile)
    window.location.href = `/game.html?roomId=${encodeURIComponent(roomId)}&name=${encodeURIComponent(name)}`;
  }

  // Socket events
  socket.on("connect", () => {
    setConn(true, "Connecté");
    socket.emit("rooms:get");
  });

  socket.on("disconnect", () => setConn(false, "Déconnecté"));

  socket.on("rooms:list", (list) => {
    rooms = Array.isArray(list) ? list : [];
    els.lastUpdate.textContent = nowLabel();
    render();
  });

  socket.on("rooms:created", ({ roomId }) => {
    // auto join après création
    joinRoom(roomId);
  });

  // Create
  els.btnCreate?.addEventListener("click", () => {
    const name = (els.serverName?.value || "Nouveau serveur").trim();
    const requiredPlayers = Number(els.requiredPlayers?.value || 2);
    socket.emit("rooms:create", { name, requiredPlayers });
  });

  // Join click
  els.tbody.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-join]");
    if (!btn) return;
    const id = btn.getAttribute("data-join");
    joinRoom(id);
  });
})();