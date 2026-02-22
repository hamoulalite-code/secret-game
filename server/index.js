const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3001;

app.use(express.static(path.join(__dirname, "..", "public")));

// ------------------ Données en mémoire ------------------
const rooms = {};
createRoom("room-1", "Serveur #1");

function createRoom(id, name) {
  rooms[id] = {
    id,
    name,
    phase: "avatar", // avatar -> secrets -> vote -> results
    players: new Map(), // socketId -> { id, avatarId, secret, submitted }
    secrets: [], // { secretId, text, ownerSocketId, ownerAvatarId }
    votes: new Map() // voterSocketId -> Map(secretId -> guessedSocketId)
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
    submitted: !!p.submitted
  }));

  const takenAvatars = players.filter(p => p.avatarId).map(p => p.avatarId);

  const secrets = room.secrets.map((s) => ({
    secretId: s.secretId,
    text: s.text
  }));

  return {
    roomId: room.id,
    roomName: room.name,
    phase: room.phase,
    players,
    takenAvatars,
    secrets
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

function computeResults(room) {
  // Pour chaque secret, compter votes par joueur (avatar)
  return room.secrets.map((s) => {
    const counts = new Map(); // guessedSocketId -> count

    for (const [, perVoter] of room.votes.entries()) {
      const guess = perVoter.get(s.secretId);
      if (!guess) continue;
      counts.set(guess, (counts.get(guess) || 0) + 1);
    }

    const votes = Array.from(counts.entries())
      .map(([guessedSocketId, count]) => {
        const pl = room.players.get(guessedSocketId);
        return {
          guessedSocketId,
          avatarId: pl?.avatarId || null,
          count
        };
      })
      .sort((a, b) => b.count - a.count);

    return {
      secretId: s.secretId,
      secretText: s.text,
      ownerSocketId: s.ownerSocketId,
      ownerAvatarId: s.ownerAvatarId,
      votes
    };
  });
}

// ------------------ Socket.io ------------------
io.on("connection", (socket) => {
  socket.on("rooms:list", () => {
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

    // quitter une autre salle si besoin
    for (const rId of Object.keys(rooms)) {
      if (rooms[rId].players.has(socket.id)) {
        socket.leave(rId);
        rooms[rId].players.delete(socket.id);
        rooms[rId].votes.delete(socket.id);
        broadcastRoom(rId);
      }
    }

    socket.join(roomId);

    room.players.set(socket.id, {
      id: socket.id,
      avatarId: null,
      secret: "",
      submitted: false
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

    // avatar déjà pris ?
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

    // mettre/mettre à jour le secret dans la liste
    const existing = room.secrets.find((s) => s.ownerSocketId === socket.id);
    if (existing) {
      existing.text = text;
      existing.ownerAvatarId = player.avatarId;
    } else {
      room.secrets.push({
        secretId: "s_" + Math.random().toString(36).slice(2, 9),
        text,
        ownerSocketId: socket.id,
        ownerAvatarId: player.avatarId
      });
    }

    // Auto: si tout le monde a envoyé -> phase vote
    if (allSecretsSubmitted(room)) {
      room.phase = "vote";
    } else {
      room.phase = "secrets";
    }

    broadcastRoom(roomId);
  });

  socket.on("vote:cast", ({ roomId, secretId, guessedSocketId }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.phase !== "vote") return;

    const voter = room.players.get(socket.id);
    if (!voter) return;

    // on empêche de voter si pas d'avatar
    if (!voter.avatarId) return;

    // secret existe ?
    const secret = room.secrets.find((s) => s.secretId === secretId);
    if (!secret) return;

    // guessed existe ?
    if (!room.players.has(guessedSocketId)) return;

    const perVoter = room.votes.get(socket.id);
    if (!perVoter) return;

    perVoter.set(secretId, guessedSocketId);

    // On renvoie juste au voter une confirmation (option)
    socket.emit("vote:ok", { secretId, guessedSocketId });
  });

  socket.on("phase:set", ({ roomId, phase }) => {
    // Simple : tout le monde peut changer (si tu veux, après on met host)
    const room = rooms[roomId];
    if (!room) return;
    if (!["avatar", "secrets", "vote", "results"].includes(phase)) return;

    room.phase = phase;

    if (phase === "results") {
      io.to(roomId).emit("results:data", computeResults(room));
    }

    broadcastRoom(roomId);
  });

  socket.on("results:get", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    socket.emit("results:data", computeResults(room));
  });

  socket.on("disconnect", () => {
    for (const roomId of Object.keys(rooms)) {
      const room = rooms[roomId];
      if (room.players.has(socket.id)) {
        room.players.delete(socket.id);
        room.votes.delete(socket.id);

        // enlever son secret aussi
        room.secrets = room.secrets.filter((s) => s.ownerSocketId !== socket.id);

        // enlever les votes qui pointaient vers lui
        for (const [, perVoter] of room.votes.entries()) {
          for (const [secretId, guessId] of perVoter.entries()) {
            if (guessId === socket.id) perVoter.delete(secretId);
          }
        }

        broadcastRoom(roomId);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});