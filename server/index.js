const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3001;

// Servir les fichiers du dossier public
app.use(express.static(path.join(__dirname, "..", "public")));

// ------------------ Données en mémoire ------------------

const rooms = {};
createRoom("room-1", "Serveur #1");

function createRoom(id, name) {
  rooms[id] = {
    id,
    name,
    phase: "avatar", // avatar -> secrets -> vote -> results
    players: new Map(), // socketId -> {id, avatarId, submitted}
    secrets: [], // [{secretId,text,ownerSocketId,ownerAvatarId}]
    votes: new Map(), // voterSocketId -> Map(secretId -> guessedSocketId)
    scores: new Map(), // socketId -> points
  };
}

function roomsList() {
  return Object.values(rooms).map((r) => {
    const playersCount = r.players.size;
    const submitted = Array.from(r.players.values()).filter((p) => p.submitted).length;
    return {
      id: r.id,
      name: r.name,
      playersCount,
      capacity: 10,
      submitted,
      phase: r.phase,
    };
  });
}

function publicState(room) {
  const players = Array.from(room.players.values()).map((p) => ({
    id: p.id,
    avatarId: p.avatarId || null,
    submitted: !!p.submitted,
    score: Number(room.scores.get(p.id) || 0),
  }));

  const takenAvatars = players.filter((p) => p.avatarId).map((p) => p.avatarId);

  // ✅ On envoie ownerSocketId (pour empêcher de voter pour son propre secret côté client)
  // (on ne l’affiche pas à l’écran, c’est juste pour la logique)
  const secrets = room.secrets.map((s) => ({
    secretId: s.secretId,
    text: s.text,
    ownerSocketId: s.ownerSocketId,
  }));

  return {
    roomId: room.id,
    roomName: room.name,
    phase: room.phase,
    players,
    takenAvatars,
    secrets,
  };
}

function broadcastRoom(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  io.to(roomId).emit("room:state", publicState(room));
  io.emit("rooms:list", roomsList()); // lobby en temps réel
}

function allSecretsSubmitted(room) {
  if (room.players.size === 0) return false;
  return Array.from(room.players.values()).every((p) => p.submitted);
}

function requiredVotesForVoter(room, voterId) {
  // ✅ Tu votes pour tous les secrets SAUF le tien
  return room.secrets.filter((s) => s.ownerSocketId !== voterId).length;
}

function allVotesSubmitted(room) {
  if (room.players.size === 0) return false;
  if (room.secrets.length === 0) return false;

  for (const voterId of room.players.keys()) {
    const perVoter = room.votes.get(voterId);
    const need = requiredVotesForVoter(room, voterId);
    const have = perVoter ? perVoter.size : 0;
    if (have < need) return false;
  }
  return true;
}

function computeScores(room) {
  // reset
  for (const pid of room.players.keys()) room.scores.set(pid, 0);

  // +1 point pour chaque vote correct
  for (const [voterId, perVoter] of room.votes.entries()) {
    for (const s of room.secrets) {
      if (s.ownerSocketId === voterId) continue; // pas de vote sur son secret
      const guess = perVoter.get(s.secretId);
      if (!guess) continue;
      if (guess === s.ownerSocketId) {
        room.scores.set(voterId, (room.scores.get(voterId) || 0) + 1);
      }
    }
  }
}

function resetRound(room) {
  room.phase = "avatar";
  room.secrets = [];
  room.votes = new Map();
  // on garde les scores ? -> là on garde pour la session
  // si tu veux reset score à chaque partie, dis-moi
  for (const pid of room.players.keys()) {
    room.votes.set(pid, new Map());
  }
}

// ------------------ Socket.io ------------------

io.on("connection", (socket) => {
  // Lobby: compat rooms:list + rooms:get
  socket.on("rooms:list", () => socket.emit("rooms:list", roomsList()));
  socket.on("rooms:get", () => socket.emit("rooms:list", roomsList()));

  socket.on("rooms:create", ({ name }) => {
    const id = "room-" + Math.random().toString(36).slice(2, 8);
    createRoom(id, (name || "Nouveau serveur").trim());
    io.emit("rooms:list", roomsList());
  });

  socket.on("room:join", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit("error:msg", "Salle introuvable.");
      return;
    }

    socket.join(roomId);

    room.players.set(socket.id, {
      id: socket.id,
      avatarId: null,
      submitted: false,
    });

    if (!room.votes.has(socket.id)) room.votes.set(socket.id, new Map());
    if (!room.scores.has(socket.id)) room.scores.set(socket.id, 0);

    socket.emit("room:joined", { roomId, roomName: room.name });
    broadcastRoom(roomId);
  });

  socket.on("avatar:pick", ({ roomId, avatarId }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    // unique avatar
    for (const [, p] of room.players.entries()) {
      if (p.avatarId === avatarId && p.id !== socket.id) {
        socket.emit("error:msg", "Avatar déjà pris.");
        return;
      }
    }

    player.avatarId = avatarId;

    // si tout le monde a un avatar, on passe à secrets
    const allHaveAvatar =
      room.players.size > 0 &&
      Array.from(room.players.values()).every((p) => !!p.avatarId);

    if (allHaveAvatar && room.phase === "avatar") room.phase = "secrets";

    broadcastRoom(roomId);
  });

  socket.on("secret:submit", ({ roomId, secretText }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    if (!player.avatarId) {
      socket.emit("error:msg", "Choisis un avatar d'abord.");
      return;
    }

    // ✅ Bloque si déjà envoyé (tu voulais 1 seule fois)
    if (player.submitted) {
      socket.emit("error:msg", "Secret déjà envoyé.");
      return;
    }

    // ✅ Interdit hors phase secrets
    if (room.phase !== "secrets" && room.phase !== "avatar") {
      socket.emit("error:msg", "Tu ne peux plus envoyer de secret maintenant.");
      return;
    }

    const text = (secretText || "").trim();
    if (text.length < 3) {
      socket.emit("error:msg", "Écris un secret (min 3 caractères).");
      return;
    }

    player.submitted = true;

    room.secrets.push({
      secretId: "s_" + Math.random().toString(36).slice(2, 9),
      text,
      ownerSocketId: socket.id,
      ownerAvatarId: player.avatarId,
    });

    // ✅ si tous les secrets envoyés => vote
    if (allSecretsSubmitted(room)) {
      room.phase = "vote";
      // init votes maps
      for (const pid of room.players.keys()) {
        if (!room.votes.has(pid)) room.votes.set(pid, new Map());
      }
    } else {
      room.phase = "secrets";
    }

    socket.emit("secret:ok");
    broadcastRoom(roomId);
  });

  socket.on("vote:cast", ({ roomId, secretId, guessedSocketId }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.phase !== "vote") {
      socket.emit("error:msg", "Le vote n'est pas actif.");
      return;
    }

    const voter = room.players.get(socket.id);
    if (!voter) return;

    const secret = room.secrets.find((s) => s.secretId === secretId);
    if (!secret) return;

    // ✅ pas voter sur son propre secret
    if (secret.ownerSocketId === socket.id) {
      socket.emit("error:msg", "Tu ne peux pas voter pour ton propre secret.");
      return;
    }

    // guessedSocketId doit être un joueur
    if (!room.players.has(guessedSocketId)) {
      socket.emit("error:msg", "Joueur invalide.");
      return;
    }

    const perVoter = room.votes.get(socket.id) || new Map();
    perVoter.set(secretId, guessedSocketId);
    room.votes.set(socket.id, perVoter);

    socket.emit("vote:ok");

    // ✅ fin automatique quand tout le monde a voté
    if (allVotesSubmitted(room)) {
      computeScores(room);
      room.phase = "results";

      // ✅ les secrets disparaissent après vote (comme tu veux)
      // (on ne supprime pas l'historique côté serveur si tu veux le réafficher plus tard)
      // Ici on le cache juste côté client via la phase results.

      io.to(roomId).emit("results:scoreboard", {
        scores: Array.from(room.players.values()).map((p) => ({
          id: p.id,
          avatarId: p.avatarId,
          score: Number(room.scores.get(p.id) || 0),
        })),
      });
    }

    broadcastRoom(roomId);
  });

  socket.on("disconnect", () => {
    for (const roomId of Object.keys(rooms)) {
      const room = rooms[roomId];
      if (room.players.has(socket.id)) {
        room.players.delete(socket.id);
        room.votes.delete(socket.id);
        room.scores.delete(socket.id);
        room.secrets = room.secrets.filter((s) => s.ownerSocketId !== socket.id);
        broadcastRoom(roomId);
      }
    }
  });
});

// ================== START SERVER ==================
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});