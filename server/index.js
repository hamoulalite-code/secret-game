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
    phase: "avatar",
    players: new Map(),
    secrets: [],
    votes: new Map(),
  };
}

function roomsList() {
  return Object.values(rooms).map((r) => {
    const players = r.players.size;
    const submitted = Array.from(r.players.values()).filter((p) => p.submitted).length;
    return { id: r.id, name: r.name, players, submitted, phase: r.phase };
  });
}

function publicState(room) {
  const players = Array.from(room.players.values()).map((p) => ({
    id: p.id,
    avatarId: p.avatarId || null,
    submitted: !!p.submitted,
  }));

  const takenAvatars = players.filter((p) => p.avatarId).map((p) => p.avatarId);

  const secrets = room.secrets.map((s) => ({
    secretId: s.secretId,
    text: s.text,
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
  io.emit("rooms:list", roomsList());
}

function allSecretsSubmitted(room) {
  if (room.players.size === 0) return false;
  return Array.from(room.players.values()).every((p) => p.submitted);
}

// ------------------ Socket.io ------------------

io.on("connection", (socket) => {
  // ✅ Compatible: ton lobby écoute "rooms:list"
  socket.on("rooms:list", () => {
    socket.emit("rooms:list", roomsList());
  });

  // ✅ Compatible: ton lobby envoie parfois "rooms:get"
  socket.on("rooms:get", () => {
    socket.emit("rooms:list", roomsList());
  });

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
      secret: "",
      submitted: false,
    });

    room.votes.set(socket.id, new Map());

    socket.emit("room:joined", { roomId, roomName: room.name });
    broadcastRoom(roomId);
  });

  socket.on("avatar:pick", ({ roomId, avatarId }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    for (const [, p] of room.players.entries()) {
      if (p.avatarId === avatarId && p.id !== socket.id) {
        socket.emit("error:msg", "Avatar déjà pris.");
        return;
      }
    }

    player.avatarId = avatarId;
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

    const text = (secretText || "").trim();
    if (text.length < 3) {
      socket.emit("error:msg", "Écris un secret (min 3 caractères).");
      return;
    }

    player.secret = text;
    player.submitted = true;

    room.secrets.push({
      secretId: "s_" + Math.random().toString(36).slice(2, 9),
      text,
      ownerSocketId: socket.id,
      ownerAvatarId: player.avatarId,
    });

    room.phase = allSecretsSubmitted(room) ? "vote" : "secrets";
    broadcastRoom(roomId);
  });

  socket.on("disconnect", () => {
    for (const roomId of Object.keys(rooms)) {
      const room = rooms[roomId];
      if (room.players.has(socket.id)) {
        room.players.delete(socket.id);
        room.votes.delete(socket.id);
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