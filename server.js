'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 10;
const MIN_PLAYERS = 4;
const TOTAL_ROUNDS = 3;
const REVEAL_DELAY_MS = 2000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalize(s) {
  return String(s).trim().replace(/\s+/g, ' ').toLowerCase();
}

// ─── Game State ───────────────────────────────────────────────────────────────

const game = {
  phase: 'lobby',   // lobby | questionWriting | answerWriting | fakeWriting |
                    // voting | revealing | questionComplete | roundComplete | gameComplete
  players: {},      // sessionId -> { id, name, score, socketId }
  currentRound: 0,  // 0-indexed (0..TOTAL_ROUNDS-1)
  rounds: [],
  joinUrl: '',
};

function currentRound() { return game.rounds[game.currentRound]; }
function currentQ() { const r = currentRound(); return r ? r.currentQ : null; }
function playerList() { return Object.values(game.players); }
function sortedPlayers() {
  return playerList().slice().sort((a, b) => b.score - a.score).map(p => ({ name: p.name, score: p.score }));
}

// ─── State Broadcast ──────────────────────────────────────────────────────────

function buildPlayerState(player) {
  const phase = game.phase;
  const pid = player.id;
  const r = currentRound();
  const q = currentQ();

  const state = {
    phase,
    roundNum: game.currentRound + 1,
    me: { name: player.name, score: player.score },
    players: sortedPlayers(),
    phaseData: {},
  };

  switch (phase) {
    case 'lobby':
      state.phaseData = {
        playerNames: playerList().map(p => p.name),
        canStart: playerList().length >= MIN_PLAYERS,
      };
      break;

    case 'questionWriting':
      state.phaseData = {
        submitted: pid in r.questions,
        pending: playerList().filter(p => !(p.id in r.questions)).map(p => p.name),
      };
      break;

    case 'answerWriting': {
      const authorId = r.assignments[pid];
      state.phaseData = {
        questionText: r.questions[authorId] || '',
        submitted: pid in r.realAnswers,
        pending: playerList().filter(p => !(p.id in r.realAnswers)).map(p => p.name),
      };
      break;
    }

    case 'fakeWriting':
      if (pid === q.answererId) {
        state.phaseData = {
          role: 'answerer',
          questionText: q.questionText,
          realAnswer: q.realAnswer,
          pending: playerList()
            .filter(p => p.id !== q.answererId && !(p.id in q.fakeAnswers))
            .map(p => p.name),
          qNum: r.currentQIdx + 1,
          qTotal: r.playOrder.length,
        };
      } else {
        state.phaseData = {
          role: 'faker',
          questionText: q.questionText,
          submitted: pid in q.fakeAnswers,
          pending: playerList()
            .filter(p => p.id !== q.answererId && !(p.id in q.fakeAnswers))
            .map(p => p.name),
          qNum: r.currentQIdx + 1,
          qTotal: r.playOrder.length,
        };
      }
      break;

    case 'voting': {
      const voters = playerList().filter(p => p.id !== q.answererId);
      const whoVoted = voters.filter(p => p.id in q.votes).map(p => p.name);
      const whoPending = voters.filter(p => !(p.id in q.votes)).map(p => p.name);

      if (pid === q.answererId) {
        state.phaseData = {
          role: 'answerer',
          questionText: q.questionText,
          answerTexts: q.answerChoices.map(c => c.text),
          whoVoted,
          whoPending,
          qNum: r.currentQIdx + 1,
          qTotal: r.playOrder.length,
        };
      } else {
        const myFakeIdx = q.answerChoices.findIndex(c => c.key === pid);
        const myVoteKey = q.votes[pid] || null;
        const myVoteIdx = myVoteKey !== null ? q.answerChoices.findIndex(c => c.key === myVoteKey) : null;
        state.phaseData = {
          role: 'voter',
          questionText: q.questionText,
          answerTexts: q.answerChoices.map(c => c.text),
          myFakeIdx: myFakeIdx >= 0 ? myFakeIdx : null,
          myVoteIdx,
          whoVoted,
          whoPending,
          qNum: r.currentQIdx + 1,
          qTotal: r.playOrder.length,
        };
      }
      break;
    }

    case 'revealing': {
      const visible = q.revealItems.slice(0, q.revealStep + 1);
      state.phaseData = {
        questionText: q.questionText,
        revealItems: visible,
        answererName: game.players[q.answererId]?.name,
        qNum: r.currentQIdx + 1,
        qTotal: r.playOrder.length,
      };
      break;
    }

    case 'questionComplete': {
      const pointsByName = {};
      Object.entries(q.pointsThisQ).forEach(([id, pts]) => {
        const name = game.players[id]?.name;
        if (name) pointsByName[name] = pts;
      });
      state.phaseData = {
        questionText: q.questionText,
        revealItems: q.revealItems,
        answererName: game.players[q.answererId]?.name,
        pointsByName,
        qNum: r.currentQIdx + 1,
        qTotal: r.playOrder.length,
        isLastOfRound: r.currentQIdx + 1 >= r.playOrder.length,
        isLastRound: game.currentRound >= TOTAL_ROUNDS - 1,
      };
      break;
    }

    case 'roundComplete':
      state.phaseData = {
        players: sortedPlayers(),
        isLastRound: game.currentRound >= TOTAL_ROUNDS - 1,
      };
      break;

    case 'gameComplete':
      state.phaseData = { players: sortedPlayers() };
      break;
  }

  return state;
}

function buildHostState() {
  const phase = game.phase;
  const r = currentRound();
  const q = currentQ();
  const hasQr = fs.existsSync(path.join(__dirname, 'public', 'qr.png'));

  const state = {
    phase,
    roundNum: game.currentRound + 1,
    players: sortedPlayers(),
    joinUrl: game.joinUrl,
    hasQr,
    phaseData: {},
  };

  switch (phase) {
    case 'lobby':
      state.phaseData = { playerNames: playerList().map(p => p.name) };
      break;

    case 'questionWriting':
      state.phaseData = {
        submitted: playerList().filter(p => p.id in r.questions).map(p => p.name),
        pending: playerList().filter(p => !(p.id in r.questions)).map(p => p.name),
      };
      break;

    case 'answerWriting':
      state.phaseData = {
        submitted: playerList().filter(p => p.id in r.realAnswers).map(p => p.name),
        pending: playerList().filter(p => !(p.id in r.realAnswers)).map(p => p.name),
      };
      break;

    case 'fakeWriting':
      state.phaseData = {
        questionText: q.questionText,
        answererName: game.players[q.answererId]?.name,
        submitted: playerList()
          .filter(p => p.id !== q.answererId && p.id in q.fakeAnswers)
          .map(p => p.name),
        pending: playerList()
          .filter(p => p.id !== q.answererId && !(p.id in q.fakeAnswers))
          .map(p => p.name),
        qNum: r.currentQIdx + 1,
        qTotal: r.playOrder.length,
      };
      break;

    case 'voting': {
      const voters = playerList().filter(p => p.id !== q.answererId);
      state.phaseData = {
        questionText: q.questionText,
        answerCount: q.answerChoices.length,
        whoVoted: voters.filter(p => p.id in q.votes).map(p => p.name),
        whoPending: voters.filter(p => !(p.id in q.votes)).map(p => p.name),
        qNum: r.currentQIdx + 1,
        qTotal: r.playOrder.length,
      };
      break;
    }

    case 'revealing': {
      const visible = q.revealItems.slice(0, q.revealStep + 1);
      state.phaseData = {
        questionText: q.questionText,
        revealItems: visible,
        answererName: game.players[q.answererId]?.name,
        qNum: r.currentQIdx + 1,
        qTotal: r.playOrder.length,
      };
      break;
    }

    case 'questionComplete': {
      const pointsByName = {};
      Object.entries(q.pointsThisQ).forEach(([id, pts]) => {
        const name = game.players[id]?.name;
        if (name) pointsByName[name] = pts;
      });
      state.phaseData = {
        questionText: q.questionText,
        revealItems: q.revealItems,
        answererName: game.players[q.answererId]?.name,
        pointsByName,
        qNum: r.currentQIdx + 1,
        qTotal: r.playOrder.length,
      };
      break;
    }

    case 'roundComplete':
      state.phaseData = { players: sortedPlayers() };
      break;

    case 'gameComplete':
      state.phaseData = { players: sortedPlayers() };
      break;
  }

  return state;
}

function broadcastAll() {
  for (const player of playerList()) {
    if (player.socketId) {
      const sock = io.sockets.sockets.get(player.socketId);
      if (sock) sock.emit('playerState', buildPlayerState(player));
    }
  }
  io.to('host').emit('hostState', buildHostState());
}

// ─── Game Logic ───────────────────────────────────────────────────────────────

function assignQuestions(playerIds) {
  const shuffled = shuffle([...playerIds]);
  const assignments = {};
  for (let i = 0; i < shuffled.length; i++) {
    assignments[shuffled[i]] = shuffled[(i + 1) % shuffled.length];
  }
  return assignments; // answererId -> authorId
}

function startRound() {
  game.rounds.push({
    questions: {},
    assignments: {},
    realAnswers: {},
    playOrder: [],
    currentQIdx: 0,
    currentQ: null,
  });
  game.phase = 'questionWriting';
  broadcastAll();
}

function checkQuestionsComplete() {
  const r = currentRound();
  const pids = Object.keys(game.players);
  if (!pids.every(id => id in r.questions)) return;
  r.assignments = assignQuestions(pids);
  r.playOrder = shuffle([...pids]);
  game.phase = 'answerWriting';
  broadcastAll();
}

function checkAnswersComplete() {
  const r = currentRound();
  const pids = Object.keys(game.players);
  if (!pids.every(id => id in r.realAnswers)) return;
  startFakeWriting();
}

function startFakeWriting() {
  const r = currentRound();
  const answererId = r.playOrder[r.currentQIdx];
  const authorId = r.assignments[answererId];
  r.currentQ = {
    answererId,
    authorId,
    questionText: r.questions[authorId],
    realAnswer: r.realAnswers[answererId],
    fakeAnswers: {},
    answerChoices: [],
    votes: {},
    revealItems: [],
    revealStep: -1,
    pointsThisQ: {},
  };
  game.phase = 'fakeWriting';
  broadcastAll();
}

function checkFakesComplete() {
  const q = currentQ();
  const fakers = Object.keys(game.players).filter(id => id !== q.answererId);
  if (!fakers.every(id => id in q.fakeAnswers)) return;
  startVoting();
}

function startVoting() {
  const q = currentQ();
  const choices = [
    { key: 'real', text: q.realAnswer },
    ...Object.entries(q.fakeAnswers).map(([authorId, text]) => ({ key: authorId, text })),
  ];
  shuffle(choices);
  q.answerChoices = choices;
  game.phase = 'voting';
  broadcastAll();
}

function checkVotingComplete() {
  const q = currentQ();
  const voters = Object.keys(game.players).filter(id => id !== q.answererId);
  if (!voters.every(id => id in q.votes)) return;
  calculateScores();
  buildRevealItems();
  game.phase = 'revealing';
  q.revealStep = 0;
  broadcastAll();
  setTimeout(revealNext, REVEAL_DELAY_MS);
}

function calculateScores() {
  const q = currentQ();

  // Find who voted for the real answer
  const realVoterIds = Object.entries(q.votes)
    .filter(([, k]) => k === 'real')
    .map(([id]) => id);

  // Correct guessers get +1000
  realVoterIds.forEach(id => {
    q.pointsThisQ[id] = (q.pointsThisQ[id] || 0) + 1000;
  });

  // Each fake-answer author gets +500 per player fooled
  Object.values(q.votes)
    .filter(k => k !== 'real')
    .forEach(authorId => {
      q.pointsThisQ[authorId] = (q.pointsThisQ[authorId] || 0) + 500;
    });

  // Real answerer gets +1500 if nobody guessed correctly
  if (realVoterIds.length === 0) {
    q.pointsThisQ[q.answererId] = (q.pointsThisQ[q.answererId] || 0) + 1500;
  }
  // NOTE: scores not applied to player.score until applyScores() at questionComplete
}

function applyScores() {
  const q = currentQ();
  Object.entries(q.pointsThisQ).forEach(([id, pts]) => {
    if (game.players[id]) game.players[id].score += pts;
  });
}

function buildRevealItems() {
  const q = currentQ();
  const items = [];

  // Collect fake answers that received at least one vote
  const votedFakeKeys = [...new Set(Object.values(q.votes).filter(k => k !== 'real'))];
  shuffle(votedFakeKeys).forEach(authorId => {
    const choosers = Object.entries(q.votes)
      .filter(([, k]) => k === authorId)
      .map(([id]) => game.players[id]?.name)
      .filter(Boolean);
    items.push({
      type: 'fake',
      text: q.fakeAnswers[authorId],
      authorName: game.players[authorId]?.name || '?',
      choosers,
    });
  });

  // Real answer last
  const realChoosers = Object.entries(q.votes)
    .filter(([, k]) => k === 'real')
    .map(([id]) => game.players[id]?.name)
    .filter(Boolean);
  items.push({
    type: 'real',
    text: q.realAnswer,
    answererName: game.players[q.answererId]?.name || '?',
    choosers: realChoosers,
  });

  q.revealItems = items;
}

function revealNext() {
  if (game.phase !== 'revealing') return;
  const q = currentQ();
  q.revealStep++;
  if (q.revealStep >= q.revealItems.length) {
    applyScores();
    game.phase = 'questionComplete';
    broadcastAll();
  } else {
    broadcastAll();
    setTimeout(revealNext, REVEAL_DELAY_MS);
  }
}

function advanceQuestion() {
  const r = currentRound();
  r.currentQIdx++;
  if (r.currentQIdx < r.playOrder.length) {
    startFakeWriting();
  } else if (game.currentRound < TOTAL_ROUNDS - 1) {
    game.phase = 'roundComplete';
    broadcastAll();
  } else {
    game.phase = 'gameComplete';
    broadcastAll();
  }
}

function fullReset() {
  game.phase = 'lobby';
  game.players = {};
  game.currentRound = 0;
  game.rounds = [];
  broadcastAll();
}

// ─── Express + Socket.IO Setup ────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

app.get('/host', (req, res) => {
  if (!game.joinUrl) {
    const host = req.headers.host || `localhost:${PORT}`;
    game.joinUrl = `http://${host}/`;
  }
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

// ─── Socket.IO Connection Handler ────────────────────────────────────────────

io.on('connection', (socket) => {
  const auth = socket.handshake.auth || {};

  // Host page
  if (auth.role === 'host') {
    socket.join('host');
    if (!game.joinUrl) {
      try {
        const ref = socket.handshake.headers.referer;
        if (ref) {
          const u = new URL(ref);
          game.joinUrl = `http://${u.host}/`;
        }
      } catch (_) {}
    }
    socket.emit('hostState', buildHostState());
    return;
  }

  // Player reconnect
  const sid = auth.sessionId;
  if (sid && game.players[sid]) {
    const player = game.players[sid];
    player.socketId = socket.id;
    socket.emit('reconnected', { name: player.name });
    socket.emit('playerState', buildPlayerState(player));
    registerPlayerHandlers(socket);
    return;
  }

  // New connection — not yet a player
  socket.emit('needJoin', {
    phase: game.phase,
    playerCount: playerList().length,
  });

  let alreadyJoined = false;
  // join handler (only relevant before player exists)
  socket.on('join', ({ name }) => {
    if (alreadyJoined) return;
    if (game.phase !== 'lobby') {
      return socket.emit('gameError', 'Игра уже идёт. Дождитесь следующей.');
    }
    if (playerList().length >= MAX_PLAYERS) {
      return socket.emit('gameError', `Максимум ${MAX_PLAYERS} игроков.`);
    }
    const trimmed = (name || '').trim();
    if (trimmed.length < 1 || trimmed.length > 20) {
      return socket.emit('gameError', 'Имя должно содержать от 1 до 20 символов.');
    }
    const lower = trimmed.toLowerCase();
    if (playerList().some(p => p.name.toLowerCase() === lower)) {
      return socket.emit('gameError', 'Это имя уже занято. Выберите другое.');
    }
    const newSid = crypto.randomUUID();
    alreadyJoined = true;
    game.players[newSid] = { id: newSid, name: trimmed, score: 0, socketId: socket.id };
    socket.emit('joined', { sessionId: newSid, name: trimmed });
    broadcastAll();
    registerPlayerHandlers(socket);
  });
});

function registerPlayerHandlers(socket) {
  function getPlayer() {
    return playerList().find(p => p.socketId === socket.id) || null;
  }
  function err(msg) { socket.emit('gameError', msg); }
  function requirePlayer() {
    const p = getPlayer();
    if (!p) { err('Вы не в игре.'); return null; }
    return p;
  }

  socket.on('startGame', () => {
    if (game.phase !== 'lobby') return err('Игра уже началась.');
    if (!requirePlayer()) return;
    if (playerList().length < MIN_PLAYERS) return err(`Нужно минимум ${MIN_PLAYERS} игрока.`);
    startRound();
  });

  socket.on('submitQuestion', ({ text }) => {
    if (game.phase !== 'questionWriting') return err('Не время для вопросов.');
    const player = requirePlayer(); if (!player) return;
    const r = currentRound();
    if (player.id in r.questions) return err('Вы уже отправили вопрос.');
    const display = String(text || '').trim().replace(/\s+/g, ' ');
    const norm = display.toLowerCase();
    if (norm.length < 2) return err('Вопрос слишком короткий (минимум 2 символа).');
    if (norm.length > 200) return err('Вопрос слишком длинный (максимум 200 символов).');
    r.questions[player.id] = display;
    broadcastAll();
    checkQuestionsComplete();
  });

  socket.on('submitAnswer', ({ text }) => {
    if (game.phase !== 'answerWriting') return err('Не время для ответов.');
    const player = requirePlayer(); if (!player) return;
    const r = currentRound();
    if (player.id in r.realAnswers) return err('Вы уже отправили ответ.');
    const display = String(text || '').trim().replace(/\s+/g, ' ');
    const norm = display.toLowerCase();
    if (norm.length < 2) return err('Ответ слишком короткий (минимум 2 символа).');
    if (norm.length > 120) return err('Ответ слишком длинный (максимум 120 символов).');
    r.realAnswers[player.id] = display;
    broadcastAll();
    checkAnswersComplete();
  });

  socket.on('submitFakeAnswer', ({ text }) => {
    if (game.phase !== 'fakeWriting') return err('Не время для ложных ответов.');
    const player = requirePlayer(); if (!player) return;
    const q = currentQ();
    if (player.id === q.answererId) return err('Вы не можете добавить ложный ответ на свой вопрос.');
    if (player.id in q.fakeAnswers) return err('Вы уже отправили ложный ответ.');
    const display = String(text || '').trim().replace(/\s+/g, ' ');
    const norm = display.toLowerCase();
    if (norm.length < 2) return err('Ответ слишком короткий (минимум 2 символа).');
    if (norm.length > 120) return err('Ответ слишком длинный (максимум 120 символов).');
    if (norm === normalize(q.realAnswer)) return err('Такой ответ уже есть.');
    if (Object.values(q.fakeAnswers).some(f => normalize(f) === norm)) return err('Такой ответ уже есть.');
    q.fakeAnswers[player.id] = display;
    broadcastAll();
    checkFakesComplete();
  });

  socket.on('submitVote', ({ voteIdx }) => {
    if (game.phase !== 'voting') return err('Не время для голосования.');
    const player = requirePlayer(); if (!player) return;
    const q = currentQ();
    if (player.id === q.answererId) return err('Вы не можете голосовать.');
    if (player.id in q.votes) return err('Вы уже проголосовали.');
    if (typeof voteIdx !== 'number' || voteIdx < 0 || voteIdx >= q.answerChoices.length) {
      return err('Недопустимый вариант.');
    }
    const key = q.answerChoices[voteIdx].key;
    if (key === player.id) return err('Нельзя голосовать за свой ответ.');
    q.votes[player.id] = key;
    broadcastAll();
    checkVotingComplete();
  });

  socket.on('nextQuestion', () => {
    if (game.phase !== 'questionComplete') return err('Рано.');
    if (!requirePlayer()) return;
    advanceQuestion();
  });

  socket.on('nextRound', () => {
    if (game.phase !== 'roundComplete') return err('Рано.');
    if (!requirePlayer()) return;
    game.currentRound++;
    startRound();
  });

  socket.on('resetGame', () => {
    fullReset();
  });

  socket.on('disconnect', () => {
    const player = playerList().find(p => p.socketId === socket.id);
    if (player) player.socketId = null;
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`Семейный Фиббаж запущен на http://localhost:${PORT}`);
  console.log(`  Игроки: http://localhost:${PORT}/`);
  console.log(`  Хост/ТВ: http://localhost:${PORT}/host`);
});
