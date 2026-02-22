const socket = io();

const qs = new URLSearchParams(location.search);
const roomId = qs.get("roomId");

const roomTitle = document.getElementById("roomTitle");
const phaseText = document.getElementById("phaseText");

const panelAvatar = document.getElementById("panelAvatar");
const panelSecret = document.getElementById("panelSecret");
const panelVote = document.getElementById("panelVote");
const panelResults = document.getElementById("panelResults");

const avatarGrid = document.getElementById("avatarGrid");
const secretInput = document.getElementById("secretInput");
const sendSecretBtn = document.getElementById("sendSecretBtn");
const goVoteBtn = document.getElementById("goVoteBtn");
const msg = document.getElementById("msg");

const secretGrid = document.getElementById("secretGrid");
const showResultsBtn = document.getElementById("showResultsBtn");
const resultsList = document.getElementById("resultsList");

const modal = document.getElementById("modal");
const voteAvatarGrid = document.getElementById("voteAvatarGrid");
const closeModalBtn = document.getElementById("closeModalBtn");
const cancelVoteBtn = document.getElementById("cancelVoteBtn");
const modalTitle = document.getElementById("modalTitle");

let state = null;
let myAvatarId = null;
let selectedSecretIdForVote = null;

// ----------- avatars disponibles (12)
const AVATARS = Array.from({ length: 12 }, (_, i) => {
  const id = `a${i + 1}`;
  return { id, src: `/assets/avatars/${id}.png`, label: `Avatar ${i + 1}` };
});

function setPanelsByPhase(phase) {
  // On montre tout mais on guide selon phase
  panelAvatar.style.display = (phase === "avatar") ? "" : "none";

  // secret phase visible si avatar choisi ou si phase secrets/vote/results
  panelSecret.style.display = (phase === "secrets" || phase === "vote" || phase === "results" || phase === "avatar") ? "" : "none";

  panelVote.style.display = (phase === "vote" || phase === "results") ? "" : "none";
  panelResults.style.display = (phase === "results") ? "" : "none";
}

function phaseLabel(p) {
  if (p === "avatar") return "Choix avatars";
  if (p === "secrets") return "Écriture des secrets";
  if (p === "vote") return "Vote";
  if (p === "results") return "Résultats";
  return p;
}

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[m]);
}

function renderAvatarGrid(container, takenAvatars, clickable, onPick) {
  container.innerHTML = "";

  AVATARS.forEach((a) => {
    const taken = takenAvatars.includes(a.id) && a.id !== myAvatarId; // moi je peux garder le mien
    const card = document.createElement("div");
    card.className = "avatar-card" + (taken ? " taken" : "") + (a.id === myAvatarId ? " selected" : "");
    card.innerHTML = `
      <img class="avatar-img" src="${a.src}" alt="${escapeHtml(a.label)}" />
      <div class="small">${escapeHtml(a.label)}</div>
      ${taken ? `<div class="badge">Pris</div>` : ``}
    `;

    if (clickable && !taken) {
      card.addEventListener("click", () => onPick(a.id));
    }
    container.appendChild(card);
  });
}

function renderSecrets(secrets) {
  secretGrid.innerHTML = "";
  secrets.forEach((s) => {
    const card = document.createElement("div");
    card.className = "secret-card";
    card.innerHTML = `<div>${escapeHtml(s.text)}</div>`;
    card.addEventListener("click", () => openVoteModal(s.secretId));
    secretGrid.appendChild(card);
  });
}

function openVoteModal(secretId) {
  if (!state || state.phase !== "vote") {
    msg.textContent = "Le vote n'est pas encore actif.";
    return;
  }
  selectedSecretIdForVote = secretId;
  modalTitle.textContent = "Choisis l’avatar correspondant";
  renderVoteAvatars();
  modal.classList.add("open");
}

function closeVoteModal() {
  selectedSecretIdForVote = null;
  modal.classList.remove("open");
}

function renderVoteAvatars() {
  // On affiche seulement les joueurs présents avec avatar
  voteAvatarGrid.innerHTML = "";

  const players = (state?.players || []).filter(p => p.avatarId);

  players.forEach((p) => {
    const avatar = AVATARS.find(a => a.id === p.avatarId);
    if (!avatar) return;

    const card = document.createElement("div");
    card.className = "avatar-card";
    card.innerHTML = `
      <img class="avatar-img" src="${avatar.src}" alt="${escapeHtml(avatar.label)}" />
      <div class="small">${escapeHtml(avatar.label)}</div>
    `;
    card.addEventListener("click", () => {
      socket.emit("vote:cast", {
        roomId,
        secretId: selectedSecretIdForVote,
        guessedSocketId: p.id
      });
      closeVoteModal();
      msg.textContent = "Vote enregistré ✅";
    });

    voteAvatarGrid.appendChild(card);
  });
}

function renderResults(results) {
  resultsList.innerHTML = "";

  results.forEach((r) => {
    const ownerAvatar = AVATARS.find(a => a.id === r.ownerAvatarId);

    const topVotes = (r.votes || []).slice(0, 3).map(v => {
      const av = AVATARS.find(a => a.id === v.avatarId);
      const label = av ? av.label : "??";
      return `<span class="badge">${escapeHtml(label)} : ${v.count}</span>`;
    }).join(" ");

    const item = document.createElement("div");
    item.className = "result-item";
    item.innerHTML = `
      <div style="opacity:.75; margin-bottom:6px;">Secret :</div>
      <div style="margin-bottom:10px;">${escapeHtml(r.secretText)}</div>

      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:8px;">
        <div class="badge">Vrai : ${escapeHtml(ownerAvatar ? ownerAvatar.label : "??")}</div>
        <div style="opacity:.8;">Top votes:</div>
        ${topVotes || `<span class="badge">Aucun vote</span>`}
      </div>
    `;
    resultsList.appendChild(item);
  });
}

// ----------- Events UI -----------
sendSecretBtn.addEventListener("click", () => {
  msg.textContent = "";
  socket.emit("secret:submit", { roomId, secretText: secretInput.value });
});

goVoteBtn.addEventListener("click", () => {
  msg.textContent = "";
  socket.emit("phase:set", { roomId, phase: "vote" });
});

showResultsBtn.addEventListener("click", () => {
  socket.emit("phase:set", { roomId, phase: "results" });
  socket.emit("results:get", { roomId });
});

closeModalBtn.addEventListener("click", closeVoteModal);
cancelVoteBtn.addEventListener("click", closeVoteModal);

// ----------- Socket events -----------
socket.on("connect", () => {
  if (!roomId) {
    location.href = "./lobby.html";
    return;
  }
  socket.emit("room:join", { roomId });
});

socket.on("room:joined", ({ roomName }) => {
  roomTitle.textContent = roomName ? `Salle : ${roomName}` : "Salle";
});

socket.on("room:state", (s) => {
  state = s;
  phaseText.textContent = `Phase : ${phaseLabel(state.phase)}`;

  // retrouver mon avatar
  const me = (state.players || []).find(p => p.id === socket.id);
  myAvatarId = me?.avatarId || null;

  setPanelsByPhase(state.phase);

  // afficher grille avatar (phase avatar)
  renderAvatarGrid(avatarGrid, state.takenAvatars || [], true, (avatarId) => {
    msg.textContent = "";
    socket.emit("avatar:pick", { roomId, avatarId });
  });

  // afficher secrets quand disponibles
  renderSecrets(state.secrets || []);

  // pendant vote : le modal doit se mettre à jour si ouvert
  if (modal.classList.contains("open")) renderVoteAvatars();
});

socket.on("results:data", (results) => {
  // passer en results si besoin
  if (state) {
    state.phase = "results";
    setPanelsByPhase("results");
    phaseText.textContent = `Phase : ${phaseLabel("results")}`;
  }
  renderResults(results || []);
});

socket.on("error:msg", (t) => {
  msg.textContent = t;
});

socket.on("vote:ok", () => {
  // optionnel
});