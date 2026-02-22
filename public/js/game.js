const socket = io();

// roomId + pseudo depuis l'URL
const qs = new URLSearchParams(location.search);
const roomId = qs.get("roomId") || qs.get("room");
let myName = (qs.get("name") || "").trim();

// petit fallback (si tu arrives depuis un lien sans name)
if (!myName) {
  myName = (localStorage.getItem("sg_name") || "").trim();
}
if (!myName) myName = "Joueur";
localStorage.setItem("sg_name", myName);

// DOM
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

// state
let state = null;
let myAvatarId = null;
let mySubmitted = false;
let selectedSecretIdForVote = null;

// 12 avatars (images)
const AVATARS = Array.from({ length: 12 }, (_, i) => {
  const id = `a${i + 1}`;
  return { id, src: `/assets/avatars/${id}.png` };
});

function phaseLabel(p) {
  if (p === "waiting") return "Attente des joueurs";
  if (p === "avatar") return "Choix avatars";
  if (p === "secrets") return "Écriture des secrets";
  if (p === "vote") return "Vote";
  if (p === "results") return "Résultats";
  return p;
}

function escapeHtml(str) {
  return (str || "").toString().replace(/[&<>"']/g, (m) => ({
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

/**
 * ✅ AVATAR GRID PRO
 * - affiche le nom du joueur sous l’avatar si pris
 * - montre “Libre” si libre
 * - clique seulement si libre (ou ton propre)
 */
function renderAvatarGrid(container, players, takenAvatars, onPick) {
  if (!container) return;
  container.innerHTML = "";

  // mapping avatarId -> playerName
  const takenMap = new Map();
  (players || []).forEach(p => {
    if (p.avatarId) takenMap.set(p.avatarId, p.name || "Joueur");
  });

  AVATARS.forEach((a, idx) => {
    const takenBy = takenMap.get(a.id) || null;
    const taken = !!takenBy && a.id !== myAvatarId;

    const card = document.createElement("div");
    card.className = "avatar-card" + (taken ? " taken" : "") + (a.id === myAvatarId ? " selected" : "");

    card.innerHTML = `
      <img class="avatar-img" src="${a.src}" alt="Avatar ${idx + 1}" />
      <div class="small" style="font-weight:800;">
        ${takenBy ? escapeHtml(takenBy) : "Libre"}
      </div>
      ${taken ? `<div class="badge">Pris</div>` : ``}
    `;

    if (!taken) {
      card.addEventListener("click", () => onPick(a.id));
    }

    container.appendChild(card);
  });
}

/**
 * ✅ SCOREBOARD PRO
 * - affiche nom + avatar + points
 */
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
      <div class="score-name">${escapeHtml(p.name || "Joueur")}</div>
      <div class="score-points">${p.score}</div>
    `;
    scoreBar.appendChild(el);
  }

  if (scoreHint) {
    const me = list.find(x => x.id === socket.id);
    scoreHint.textContent = me ? `Toi : ${me.score} point(s)` : "Temps réel";
  }
}

/**
 * ✅ SECRETS (vote)
 * - on ne montre pas ton propre secret
 */
function renderSecrets(secrets) {
  if (!secretGrid) return;
  secretGrid.innerHTML = "";

  (secrets || []).forEach((s) => {
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
  if (modalTitle) modalTitle.textContent = "Choisis le joueur correspondant";
  renderVoteAvatars();
  if (modal) modal.classList.add("open");
}

function closeVoteModal() {
  selectedSecretIdForVote = null;
  if (modal) modal.classList.remove("open");
}

/**
 * ✅ MODAL VOTE PRO
 * - affiche avatar + NOM du joueur
 */
function renderVoteAvatars() {
  if (!voteAvatarGrid) return;
  voteAvatarGrid.innerHTML = "";

  const players = (state?.players || []).filter(p => p.avatarId);

  players.forEach((p) => {
    const avatar = AVATARS.find(a => a.id === p.avatarId);
    if (!avatar) return;

    const card = document.createElement("div");
    card.className = "avatar-card";
    card.innerHTML = `
      <img class="avatar-img" src="${avatar.src}" alt="" />
      <div class="small" style="font-weight:800;">${escapeHtml(p.name || "Joueur")}</div>
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

/**
 * ✅ RESULTS = classement final (noms)
 */
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
        <div style="font-weight:900;">${escapeHtml(p.name || "Joueur")}</div>
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

  // ✅ IMPORTANT : on envoie le pseudo au serveur
  socket.emit("room:join", { roomId, name: myName });
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

socket.on("vote:ok", () => {});

socket.on("room:state", (s) => {
  state = s;

  const playersCount = Number(state.playersCount ?? (state.players || []).length);
  const requiredPlayers = Number(state.requiredPlayers || 0);

  if (phaseText) {
    const base = `Phase : ${phaseLabel(state.phase)}`;
    if (state.phase === "waiting" && requiredPlayers) {
      phaseText.textContent = `${base} (${playersCount}/${requiredPlayers})`;
    } else {
      phaseText.textContent = base;
    }
  }

  // me
  const me = (state.players || []).find(p => p.id === socket.id);
  myAvatarId = me?.avatarId || null;
  mySubmitted = !!me?.submitted;

  // scoreboard
  renderScoreBar(state.players || []);

  // panels
  setPanelsByPhase(state.phase);

  // ✅ avatars + noms (pris/libre)
  renderAvatarGrid(avatarGrid, state.players || [], state.takenAvatars || [], (avatarId) => {
    if (msg) msg.textContent = "";
    socket.emit("avatar:pick", { roomId, avatarId });
  });

  // secrets : composer caché si déjà soumis
  if (state.phase === "secrets") {
    hideSecretComposer(mySubmitted);
    if (!mySubmitted && msg) msg.textContent = "Écris ton secret (une seule fois).";
  }

  // vote
  if (state.phase === "vote") {
    if (msg) msg.textContent = "";
    renderSecrets(state.secrets || []);
  } else {
    if (secretGrid) secretGrid.innerHTML = "";
  }

  // results
  if (state.phase === "results") {
    if (secretGrid) secretGrid.innerHTML = "";
    renderResults(state.players || []);
  }

  // si modal ouverte, refresh
  if (modal && modal.classList.contains("open")) renderVoteAvatars();
});

socket.on("error:msg", (t) => {
  if (msg) msg.textContent = t;
});