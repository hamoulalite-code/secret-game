const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3001;
app.use(express.static(path.join(__dirname, "..", "public")));

// ------------------ Rooms en mémoire ------------------
const rooms = {};
createRoom("room-1", "Serveur #1", 2);

function clamp(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) n = min;
  return Math.max(min, Math.min(max, n));
}

function createRoom(id, name, requiredPlayers = 2) {
  rooms[id] = {
    id,
    name: (name || id).trim(),
    requiredPlayers: clamp(requiredPlayers, 1, 20),
    phase: "waiting", // waiting -> avatar -> secrets -> vote -> results
    players: new Map(), // socketId -> {id,name,avatarId,submitted}
    secrets: [],
    votes: new Map(), // voterSocketId -> Map(secretId -> guessedSocketId)
    scores: new Map(), // socketId -> number
  };
}

function roomsList() {
  return Object.values(rooms).map((r) => ({
    id: r.id,
    name: r.name,
    playersCount: r.players.size,
    requiredPlayers: r.requiredPlayers,
    capacity: r.requiredPlayers,
    phase: r.phase,
  }));
}

function publicState(room) {
  const players = Array.from(room.players.values()).map((p) => ({
    id: p.id,
    name: p.name || "Joueur",
    avatarId: p.avatarId || null,
    submitted: !!p.submitted,
    score: Number(room.scores.get(p.id) || 0),
  }));

  const takenAvatars = players.filter((p) => p.avatarId).map((p) => p.avatarId);

  const secrets = room.secrets.map((s) => ({
    secretId: s.secretId,
    text: s.text,
    ownerSocketId: s.ownerSocketId, // juste pour éviter vote sur soi-même
  }));

  return {
    roomId: room.id,
    roomName: room.name,
    requiredPlayers: room.requiredPlayers,
    playersCount: room.players.size,
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
  io.emit("rooms:list", roomsList());
}

function allHaveAvatar(room) {
  if (room.players.size === 0) return false;
  return Array.from(room.players.values()).every((p) => !!p.avatarId);
}

function allSecretsSubmitted(room) {
  if (room.players.size === 0) return false;
  return Array.from(room.players.values()).every((p) => p.submitted);
}

function requiredVotesForVoter(room, voterId) {
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
  for (const pid of room.players.keys()) room.scores.set(pid, 0);

  for (const [voterId, perVoter] of room.votes.entries()) {
    for (const s of room.secrets) {
      if (s.ownerSocketId === voterId) continue;
      const guess = perVoter.get(s.secretId);
      if (!guess) continue;
      if (guess === s.ownerSocketId) {
        room.scores.set(voterId, (room.scores.get(voterId) || 0) + 1);
      }
    }
  }
}

// API (optionnelle) - utile si tu veux fetch aussi
app.get("/api/rooms", (req, res) => {
  res.json(roomsList());
});

// ------------------ Socket.io ------------------
io.on("connection", (socket) => {
  // Lobby list
  socket.on("rooms:get", () => socket.emit("rooms:list", roomsList()));
  socket.on("rooms:list", () => socket.emit("rooms:list", roomsList()));

  // ✅ Create room with players number
  socket.on("rooms:create", ({ name, requiredPlayers }) => {
    const id = "room-" + Math.random().toString(36).slice(2, 8);
    createRoom(id, (name || "Nouveau serveur").trim(), requiredPlayers);
    io.emit("rooms:list", roomsList());
    socket.emit("rooms:created", { roomId: id });
  });

  // ✅ Join room with player name
  socket.on("room:join", ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit("error:msg", "Salle introuvable.");
      return;
    }

    socket.join(roomId);

    room.players.set(socket.id, {
      id: socket.id,
      name: (name || "Joueur").toString().trim().slice(0, 20),
      avatarId: null,
      submitted: false,
    });

    if (!room.votes.has(socket.id)) room.votes.set(socket.id, new Map());
    if (!room.scores.has(socket.id)) room.scores.set(socket.id, 0);

    // ✅ phase waiting tant que pas assez de joueurs
    if (room.phase === "waiting" && room.players.size >= room.requiredPlayers) {
      room.phase = "avatar";
    }

    socket.emit("room:joined", { roomId, roomName: room.name });
    broadcastRoom(roomId);
  });

  socket.on("avatar:pick", ({ roomId, avatarId }) => {
    const room = rooms[roomId];
    if (!room) return;

    // blocage si pas assez de joueurs
    if (room.players.size < room.requiredPlayers) {
      socket.emit("error:msg", `Attends les joueurs (${room.players.size}/${room.requiredPlayers})`);
      room.phase = "waiting";
      broadcastRoom(roomId);
      return;
    }

    if (room.phase !== "avatar") return;

    const player = room.players.get(socket.id);
    if (!player) return;

    // avatar unique
    for (const [, p] of room.players.entries()) {
      if (p.avatarId === avatarId && p.id !== socket.id) {
        socket.emit("error:msg", "Avatar déjà pris.");
        return;
      }
    }

    player.avatarId = avatarId;

    if (allHaveAvatar(room)) room.phase = "secrets";
    broadcastRoom(roomId);
  });

  socket.on("secret:submit", ({ roomId, secretText }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.phase !== "secrets") {
      socket.emit("error:msg", "Ce n'est pas le moment d'écrire.");
      return;
    }

    const player = room.players.get(socket.id);
    if (!player) return;

    if (!player.avatarId) {
      socket.emit("error:msg", "Choisis un avatar d'abord.");
      return;
    }

    if (player.submitted) {
      socket.emit("error:msg", "Secret déjà envoyé.");
      return;
    }

    const text = (secretText || "").trim();
    if (text.length < 3) {
      socket.emit("error:msg", "Secret min 3 caractères.");
      return;
    }

    player.submitted = true;

    room.secrets.push({
      secretId: "s_" + Math.random().toString(36).slice(2, 9),
      text,
      ownerSocketId: socket.id,
      ownerAvatarId: player.avatarId,
    });

    if (allSecretsSubmitted(room)) room.phase = "vote";

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

    const secret = room.secrets.find((s) => s.secretId === secretId);
    if (!secret) return;

    if (secret.ownerSocketId === socket.id) {
      socket.emit("error:msg", "Tu ne peux pas voter pour toi-même.");
      return;
    }

    if (!room.players.has(guessedSocketId)) {
      socket.emit("error:msg", "Joueur invalide.");
      return;
    }

    const perVoter = room.votes.get(socket.id) || new Map();
    perVoter.set(secretId, guessedSocketId);
    room.votes.set(socket.id, perVoter);

    socket.emit("vote:ok");

    if (allVotesSubmitted(room)) {
      computeScores(room);
      room.phase = "results";
    }

    broadcastRoom(roomId);
  });

  socket.on("disconnect", () => {
    for (const roomId of Object.keys(rooms)) {
      const room = rooms[roomId];
      if (!room.players.has(socket.id)) continue;

      room.players.delete(socket.id);
      room.votes.delete(socket.id);
      room.scores.delete(socket.id);
      room.secrets = room.secrets.filter((s) => s.ownerSocketId !== socket.id);

      // si on retombe sous requiredPlayers -> waiting
      if (room.players.size < room.requiredPlayers) room.phase = "waiting";

      broadcastRoom(roomId);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});