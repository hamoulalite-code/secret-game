const socket = io();
const qs = new URLSearchParams(location.search);
const roomId = qs.get("roomId") || qs.get("room");

const roomTitle = document.getElementById("roomTitle");
const phaseText = document.getElementById("phaseText");

const panelAvatar = document.getElementById("panelAvatar");
const panelSecret = document.getElementById("panelSecret");
const panelVote = document.getElementById("panelVote");
const panelResults = document.getElementById("panelResults");

const scoreBar = document.getElementById("scoreBar");
const scoreHint = document.getElementById("scoreHint");

const avatarGrid = document.getElementById("avatarGrid");
const secretInput = document.getElementById("secretInput");
const sendSecretBtn = document.getElementById("sendSecretBtn");
const msg = document.getElementById("msg");

const secretGrid = document.getElementById("secretGrid");
const resultsList = document.getElementById("resultsList");

const modal = document.getElementById("modal");
const voteAvatarGrid = document.getElementById("voteAvatarGrid");
const closeModalBtn = document.getElementById("closeModalBtn");
const cancelVoteBtn = document.getElementById("cancelVoteBtn");
const modalTitle = document.getElementById("modalTitle");

let state = null;
let myAvatarId = null;
let mySubmitted = false;
let selectedSecretIdForVote = null;

// 12 avatars
const AVATARS = Array.from({ length: 12 }, (_, i) => {
  const id = `a${i + 1}`;
  return { id, src: `/assets/avatars/${id}.png`, label: `Avatar ${i + 1}` };
});

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

function setPanelsByPhase(phase) {
  if (panelAvatar) panelAvatar.style.display = (phase === "avatar") ? "" : "none";
  if (panelSecret) panelSecret.style.display = (phase === "secrets") ? "" : "none";
  if (panelVote) panelVote.style.display = (phase === "vote") ? "" : "none";
  if (panelResults) panelResults.style.display = (phase === "results") ? "" : "none";
}

function hideSecretComposer(hidden) {
  if (!panelSecret) return;
  if (secretInput) secretInput.style.display = hidden ? "none" : "";
  if (sendSecretBtn) sendSecretBtn.style.display = hidden ? "none" : "";
}

function renderAvatarGrid(container, takenAvatars, onPick) {
  if (!container) return;
  container.innerHTML = "";

  AVATARS.forEach((a) => {
    const taken = (takenAvatars || []).includes(a.id) && a.id !== myAvatarId;
    const card = document.createElement("div");
    card.className = "avatar-card" + (taken ? " taken" : "") + (a.id === myAvatarId ? " selected" : "");
    card.innerHTML = `
      <img class="avatar-img" src="${a.src}" alt="${escapeHtml(a.label)}" />
      <div class="small">${escapeHtml(a.label)}</div>
      ${taken ? `<div class="badge">Pris</div>` : ``}
    `;
    if (!taken) card.addEventListener("click", () => onPick(a.id));
    container.appendChild(card);
  });
}

function renderSecrets(secrets) {
  if (!secretGrid) return;
  secretGrid.innerHTML = "";

  (secrets || []).forEach((s) => {
    // on ne vote pas sur son propre secret
    if (s.ownerSocketId === socket.id) return;

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
        guessedSocketId: p.id,
      });
      closeVoteModal();
      if (msg) msg.textContent = "Vote enregistré ✅";
    });

    voteAvatarGrid.appendChild(card);
  });
}

// ✅ SCOREBOARD PRO (en haut)
function renderScoreBar(players) {
  if (!scoreBar) return;
  const list = (players || [])
    .filter(p => p.avatarId)
    .map(p => ({ ...p, score: Number(p.score || 0) }))
    .sort((a, b) => b.score - a.score);

  scoreBar.innerHTML = "";

  if (!list.length) {
    scoreBar.innerHTML = `<div class="muted">En attente des joueurs…</div>`;
    return;
  }

  for (const p of list) {
    const av = AVATARS.find(a => a.id === p.avatarId);
    const el = document.createElement("div");
    el.className = "score-pill" + (p.id === socket.id ? " me" : "");
    el.innerHTML = `
      <img class="score-avatar" src="${av ? av.src : ""}" alt="" />
      <div class="score-name">${escapeHtml(av ? av.label : "Joueur")}</div>
      <div class="score-points">${p.score}</div>
    `;
    scoreBar.appendChild(el);
  }

  if (scoreHint) {
    const me = list.find(x => x.id === socket.id);
    scoreHint.textContent = me ? `Toi : ${me.score} point(s)` : "Temps réel";
  }
}

function renderResults(players) {
  if (!resultsList) return;
  resultsList.innerHTML = "";
  const sorted = (players || [])
    .filter(p => p.avatarId)
    .map(p => ({ ...p, score: Number(p.score || 0) }))
    .sort((a, b) => b.score - a.score);

  sorted.forEach((p, idx) => {
    const av = AVATARS.find(a => a.id === p.avatarId);
    const item = document.createElement("div");
    item.className = "result-item";
    item.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="badge">#${idx + 1}</div>
        <img class="avatar-img" src="${av ? av.src : ""}" style="width:44px;height:44px;border-radius:12px;" />
        <div style="font-weight:800;">${escapeHtml(av ? av.label : "Joueur")}</div>
        <div style="margin-left:auto" class="badge">${p.score} point(s)</div>
      </div>
    `;
    resultsList.appendChild(item);
  });
}

// UI events
if (sendSecretBtn) {
  sendSecretBtn.addEventListener("click", () => {
    if (!secretInput) return;
    if (msg) msg.textContent = "";
    socket.emit("secret:submit", { roomId, secretText: secretInput.value });
  });
}

if (closeModalBtn) closeModalBtn.addEventListener("click", closeVoteModal);
if (cancelVoteBtn) cancelVoteBtn.addEventListener("click", closeVoteModal);

// Socket
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

socket.on("secret:ok", () => {
  mySubmitted = true;
  if (secretInput) secretInput.value = "";
  hideSecretComposer(true);
  if (msg) msg.textContent = "Secret enregistré ✅";
});

socket.on("vote:ok", () => {
  // optionnel
});

socket.on("room:state", (s) => {
  state = s;

  if (phaseText) phaseText.textContent = `Phase : ${phaseLabel(state.phase)}`;

  const me = (state.players || []).find((p) => p.id === socket.id);
  myAvatarId = me?.avatarId || null;
  mySubmitted = !!me?.submitted;

  // ✅ Scoreboard en temps réel
  renderScoreBar(state.players || []);

  setPanelsByPhase(state.phase);

  // avatars
  renderAvatarGrid(avatarGrid, state.takenAvatars || [], (avatarId) => {
    if (msg) msg.textContent = "";
    socket.emit("avatar:pick", { roomId, avatarId });
  });

  // secrets : disparaît après submit
  if (state.phase === "secrets") {
    hideSecretComposer(mySubmitted);
    if (!mySubmitted && msg) msg.textContent = "Écris ton secret (une seule fois).";
  }

  // vote: afficher secrets
  if (state.phase === "vote") {
    if (msg) msg.textContent = "";
    renderSecrets(state.secrets || []);
  } else {
    if (secretGrid) secretGrid.innerHTML = "";
  }

  // results : secrets disparus + classement
  if (state.phase === "results") {
    if (secretGrid) secretGrid.innerHTML = "";
    renderResults(state.players || []);
  }
});

socket.on("error:msg", (t) => {
  if (msg) msg.textContent = t;
});