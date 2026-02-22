const socket = io();

const qs = new URLSearchParams(location.search);

// ✅ accepte roomId OU room
const roomId = qs.get("roomId") || qs.get("room");

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

// ✅ Affiche la salle direct (même si room:joined n'arrive pas)
if (roomTitle) roomTitle.textContent = roomId ? `Salle : ${roomId}` : "Salle";

// ----------- avatars disponibles (12)
const AVATARS = Array.from({ length: 12 }, (_, i) => {
  const id = `a${i + 1}`;
  return { id, src: `/assets/avatars/${id}.png`, label: `Avatar ${i + 1}` };
});

function setPanelsByPhase(phase) {
  if (!panelAvatar || !panelSecret || !panelVote || !panelResults) return;

  panelAvatar.style.display = (phase === "avatar") ? "" : "none";

  panelSecret.style.display =
    (phase === "secrets" || phase === "vote" || phase === "results" || phase === "avatar")
      ? ""
      : "none";

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
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[m]);
}

function renderAvatarGrid(container, takenAvatars, clickable, onPick) {
  if (!container) return;
  container.innerHTML = "";

  AVATARS.forEach((a) => {
    const taken = (takenAvatars || []).includes(a.id) && a.id !== myAvatarId;
    const card = document.createElement("div");
    card.className =
      "avatar-card" +
      (taken ? " taken" : "") +
      (a.id === myAvatarId ? " selected" : "");

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
  if (!secretGrid) return;
  secretGrid.innerHTML = "";

  (secrets || []).forEach((s) => {
    const card = document.createElement("div");
    card.className = "secret-card";
    card.innerHTML = `<div>${escapeHtml(s.text)}</div>`;
    card.addEventListener("click", () => openVoteModal(s.secretId));
    secretGrid.appendChild(card);
  });
}

function openVoteModal(secretId) {
  if (!state || state.phase !== "vote") {
    if (msg) msg.textContent = "Le vote n'est pas encore actif.";
    return;
  }
  selectedSecretIdForVote = secretId;
  if (modalTitle) modalTitle.textContent = "Choisis l’avatar correspondant";
  renderVoteAvatars();
  if (modal) modal.classList.add("open");
}

function closeVoteModal() {
  selectedSecretIdForVote = null;
  if (modal) modal.classList.remove("open");
}

function renderVoteAvatars() {
  if (!voteAvatarGrid) return;
  voteAvatarGrid.innerHTML = "";

  const players = (state?.players || []).filter((p) => p.avatarId);

  players.forEach((p) => {
    const avatar = AVATARS.find((a) => a.id === p.avatarId);
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
      if (msg) msg.textContent = "Vote enregistré ✅";
    });

    voteAvatarGrid.appendChild(card);
  });
}

function renderResults(results) {
  if (!resultsList) return;
  resultsList.innerHTML = "";

  (results || []).forEach((r) => {
    const ownerAvatar = AVATARS.find((a) => a.id === r.ownerAvatarId);

    const topVotes = (r.votes || [])
      .slice(0, 3)
      .map((v) => {
        const av = AVATARS.find((a) => a.id === v.avatarId);
        const label = av ? av.label : "??";
        return `<span class="badge">${escapeHtml(label)} : ${v.count}</span>`;
      })
      .join(" ");

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
if (sendSecretBtn) {
  sendSecretBtn.addEventListener("click", () => {
    if (msg) msg.textContent = "";
    socket.emit("secret:submit", { roomId, secretText: secretInput ? secretInput.value : "" });
  });
}

if (goVoteBtn) {
  goVoteBtn.addEventListener("click", () => {
    if (msg) msg.textContent = "";
    socket.emit("phase:set", { roomId, phase: "vote" });
  });
}

if (showResultsBtn) {
  showResultsBtn.addEventListener("click", () => {
    socket.emit("phase:set", { roomId, phase: "results" });
    socket.emit("results:get", { roomId });
  });
}

if (closeModalBtn) closeModalBtn.addEventListener("click", closeVoteModal);
if (cancelVoteBtn) cancelVoteBtn.addEventListener("click", closeVoteModal);

// ----------- Socket events -----------
socket.on("connect", () => {
  if (!roomId) {
    location.href = "./lobby.html";
    return;
  }
  socket.emit("room:join", { roomId });
});

socket.on("room:joined", ({ roomName }) => {
  if (roomTitle) roomTitle.textContent = roomName ? `Salle : ${roomName}` : `Salle : ${roomId}`;
});

socket.on("room:state", (s) => {
  state = s;

  if (phaseText) phaseText.textContent = `Phase : ${phaseLabel(state.phase)}`;

  // retrouver mon avatar
  const me = (state.players || []).find((p) => p.id === socket.id);
  myAvatarId = me?.avatarId || null;

  setPanelsByPhase(state.phase);

  // afficher grille avatar
  renderAvatarGrid(avatarGrid, state.takenAvatars || [], true, (avatarId) => {
    if (msg) msg.textContent = "";
    socket.emit("avatar:pick", { roomId, avatarId });
  });

  // afficher secrets
  renderSecrets(state.secrets || []);

  // modal vote
  if (modal && modal.classList.contains("open")) renderVoteAvatars();

  // ✅ UX : bloque tant que pas d’avatar
  const hasAvatar = !!myAvatarId;
  if (sendSecretBtn) sendSecretBtn.disabled = !hasAvatar;
  if (goVoteBtn) goVoteBtn.disabled = !hasAvatar;

  if (!hasAvatar && msg) {
    msg.textContent = "Choisis un avatar d'abord.";
  } else if (hasAvatar && msg && msg.textContent === "Choisis un avatar d'abord.") {
    msg.textContent = "";
  }
});

socket.on("results:data", (results) => {
  if (state) {
    state.phase = "results";
    setPanelsByPhase("results");
    if (phaseText) phaseText.textContent = `Phase : ${phaseLabel("results")}`;
  }
  renderResults(results || []);
});

socket.on("error:msg", (t) => {
  if (msg) msg.textContent = t;
});