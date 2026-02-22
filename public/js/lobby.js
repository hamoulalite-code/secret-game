const socket = io();

const serverRowsEl = document.getElementById("serverRows");
const joinBtn = document.getElementById("joinBtn");
const createBtn = document.getElementById("createBtn");
const createName = document.getElementById("createName");
const msg = document.getElementById("msg");

let selectedRoomId = null;

function phaseLabel(p) {
  if (p === "avatar") return "Avatars";
  if (p === "secrets") return "Secrets";
  if (p === "vote") return "Vote";
  if (p === "results") return "Résultats";
  return p;
}

function renderRooms(rooms) {
  serverRowsEl.innerHTML = "";
  selectedRoomId = null;
  joinBtn.disabled = true;

  rooms.forEach((r) => {
    const row = document.createElement("div");
    row.className = "server-row";
    row.innerHTML = `
      <div>${escapeHtml(r.name)} <span style="opacity:.6">(${escapeHtml(r.id)})</span></div>
      <div>${r.players}</div>
      <div>${r.submitted}/${r.players}</div>
      <div>${phaseLabel(r.phase)}</div>
    `;

    row.addEventListener("click", () => {
      document.querySelectorAll(".server-row").forEach(el => el.classList.remove("selected"));
      row.classList.add("selected");
      selectedRoomId = r.id;
      joinBtn.disabled = false;
    });

    serverRowsEl.appendChild(row);
  });
}

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[m]);
}

joinBtn.addEventListener("click", () => {
  if (!selectedRoomId) return;
  socket.emit("room:join", { roomId: selectedRoomId });
});

createBtn.addEventListener("click", () => {
  socket.emit("rooms:create", { name: createName.value });
  createName.value = "";
});

socket.on("connect", () => {
  socket.emit("rooms:list");
});

socket.on("rooms:list", (rooms) => {
  renderRooms(rooms);
});

socket.on("room:joined", ({ roomId }) => {
  // on va sur game avec roomId
  window.location.href = `./game.html?roomId=${encodeURIComponent(roomId)}`;
});

socket.on("error:msg", (t) => {
  msg.textContent = t;
});