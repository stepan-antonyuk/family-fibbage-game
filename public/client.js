'use strict';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function $id(id) { return document.getElementById(id); }
function mainEl() { return $id('main'); }
function headerEl() { return $id('player-header'); }

function showError(msg) {
  const el = $id('error-msg');
  if (el) { el.textContent = msg; el.style.display = ''; }
}
function clearError() {
  const el = $id('error-msg');
  if (el) { el.style.display = 'none'; el.textContent = ''; }
}

function rankEmoji(i) {
  return i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1) + '.';
}
function rankClass(i) {
  return i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
}

function nameChips(names, cls) {
  if (!names || names.length === 0) return '<em style="color:#9ca3af">—</em>';
  return names.map(n => `<span class="name-chip ${esc(cls)}">${esc(n)}</span>`).join('');
}

function scoreboardHtml(players, pointsByName) {
  if (!players || players.length === 0) return '';
  return `<ul class="scoreboard">${players.map((p, i) => {
    const gained = pointsByName && pointsByName[p.name] ? pointsByName[p.name] : 0;
    return `<li>
      <span class="score-rank ${rankClass(i)}">${rankEmoji(i)}</span>
      <span class="score-name">${esc(p.name)}</span>
      ${gained ? `<span class="score-gained">+${gained}</span>` : ''}
      <span class="score-pts">${p.score}</span>
    </li>`;
  }).join('')}</ul>`;
}

function revealItemsHtml(items) {
  if (!items || items.length === 0) return '';
  return items.map(item => {
    if (item.type === 'fake') {
      // Build safe HTML: static text + escaped user names
      const chooserNames = item.choosers.map(esc).join(', ');
      const authorName = esc(item.authorName);
      const detail = item.choosers.length > 0
        ? `Выбрали: ${chooserNames}. Это была ложь от ${authorName}.`
        : `Никто не выбрал. Ложь от ${authorName}.`;
      return `<div class="reveal-item fake">
        <div class="reveal-answer-text">«${esc(item.text)}»</div>
        <div class="reveal-detail">${detail}</div>
      </div>`;
    } else {
      const chooserNames = item.choosers.map(esc).join(', ');
      const answererName = esc(item.answererName);
      const detail = item.choosers.length > 0
        ? `Выбрали: ${chooserNames}. Это правильный ответ! Так ответил(а) ${answererName}.`
        : `Никто не угадал! Правильный ответ — так ответил(а) ${answererName}.`;
      return `<div class="reveal-item real">
        <div class="reveal-answer-text">«${esc(item.text)}»</div>
        <div class="reveal-detail">${detail}</div>
      </div>`;
    }
  }).join('');
}

// ─── Socket Setup ─────────────────────────────────────────────────────────────

const sessionId = localStorage.getItem('sessionId') || null;
const lastName = localStorage.getItem('lastName') || '';

const prefix = window.location.pathname.replace(/\/[^/]*$/, '') || '';
const socket = io({ path: prefix + '/socket.io', auth: { sessionId } });

socket.on('reconnected', ({ name }) => {
  localStorage.setItem('lastName', name);
});

socket.on('joined', ({ sessionId: sid, name }) => {
  localStorage.setItem('sessionId', sid);
  localStorage.setItem('lastName', name);
});

socket.on('needJoin', ({ phase, playerCount }) => {
  renderJoinOrWait(phase, playerCount);
});

socket.on('playerState', (state) => {
  clearError();
  renderHeader(state);
  renderPhase(state);
});

socket.on('gameError', (msg) => {
  showError(msg);
});

// ─── Header ───────────────────────────────────────────────────────────────────

function renderHeader(state) {
  if (!state) {
    headerEl().innerHTML = `<div class="header-row"><span class="game-title-small">Семейный Фиббаж</span></div>`;
    return;
  }
  headerEl().innerHTML = `
    <div class="header-row">
      <span class="game-title-small">Семейный Фиббаж</span>
      <div class="player-badge">
        <span class="player-name-badge">${esc(state.me.name)}</span>
        <span class="player-score-badge">${state.me.score}&nbsp;очк.</span>
      </div>
    </div>
  `;
}

// ─── Phase Router ─────────────────────────────────────────────────────────────

function renderPhase(state) {
  switch (state.phase) {
    case 'lobby':            return renderLobby(state);
    case 'questionWriting':  return renderQuestionWriting(state);
    case 'answerWriting':    return renderAnswerWriting(state);
    case 'fakeWriting':      return renderFakeWriting(state);
    case 'voting':           return renderVoting(state);
    case 'revealing':        return renderRevealing(state);
    case 'questionComplete': return renderQuestionComplete(state);
    case 'roundComplete':    return renderRoundComplete(state);
    case 'gameComplete':     return renderGameComplete(state);
    default: mainEl().innerHTML = `<div class="card"><p>Загрузка...</p></div>`;
  }
}

// ─── Join / Wait ──────────────────────────────────────────────────────────────

function renderJoinOrWait(phase, _playerCount) {
  headerEl().innerHTML = `<div class="header-row"><span class="game-title-small">Семейный Фиббаж</span></div>`;

  if (phase !== 'lobby') {
    mainEl().innerHTML = `
      <div class="card">
        <h2>Игра уже идёт</h2>
        <p style="color:#6b7280;margin-top:8px">Дождитесь следующей игры или попросите сбросить.</p>
      </div>
    `;
    return;
  }

  mainEl().innerHTML = `
    <div class="card">
      <h2>Войти в игру</h2>
      <form id="join-form">
        <input type="text" id="name-input" maxlength="20" placeholder="Ваше имя"
               value="${esc(lastName)}" autocomplete="off" autocapitalize="words" />
        <div style="margin-top:12px">
          <button type="submit" class="btn btn-primary">Войти</button>
        </div>
      </form>
      <div id="error-msg" class="error-msg" style="display:none"></div>
    </div>
  `;

  const input = $id('name-input');
  input.focus();
  input.select();

  $id('join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) { showError('Введите имя.'); return; }
    socket.emit('join', { name });
  });
}

// ─── Lobby ────────────────────────────────────────────────────────────────────

function renderLobby(state) {
  const { playerNames, canStart } = state.phaseData;
  const listRows = playerNames.length
    ? playerNames.map(n => `<li><span class="score-name">${esc(n)}</span></li>`).join('')
    : '<li><em style="color:#9ca3af">Нет игроков</em></li>';

  mainEl().innerHTML = `
    <div class="card">
      <h2>Зал ожидания</h2>
      <p style="color:#6b7280;margin-bottom:12px">Игроков: ${playerNames.length} / 10</p>
      <ul class="scoreboard" style="margin-bottom:16px">${listRows}</ul>
      ${canStart
        ? `<button class="btn btn-primary" id="start-btn">▶ Начать игру</button>`
        : `<div class="info-box" style="margin-bottom:12px">Нужно минимум 4 игрока</div>`}
      <button class="btn btn-danger" id="reset-btn">Сбросить</button>
      <div id="error-msg" class="error-msg" style="display:none"></div>
    </div>
  `;

  $id('start-btn')?.addEventListener('click', () => socket.emit('startGame'));
  $id('reset-btn').addEventListener('click', () => {
    if (confirm('Вы уверены? Все данные будут удалены.')) socket.emit('resetGame');
  });
}

// ─── Question Writing ─────────────────────────────────────────────────────────

function renderQuestionWriting(state) {
  const { submitted, pending } = state.phaseData;

  // Textarea already in DOM and player hasn't submitted: only refresh the pending list
  if (!submitted && $id('q-input')) {
    $id('q-pending').innerHTML = pending.length > 0
      ? `Ждём: ${nameChips(pending, 'pending')}` : '';
    return;
  }

  mainEl().innerHTML = `
    <div class="card">
      <h2>Раунд ${state.roundNum}: придумайте вопрос</h2>
      ${submitted
        ? `<div class="info-box success-box">✓ Ваш вопрос принят! Ждём остальных...</div>`
        : `<form id="q-form">
            <textarea id="q-input" maxlength="200" placeholder="Введите вопрос..." rows="3"></textarea>
            <div class="char-count"><span id="q-count">0</span> / 200</div>
            <button type="submit" class="btn btn-primary">Отправить вопрос</button>
           </form>`}
      <div id="q-pending" class="pending-row">${pending.length > 0
        ? `Ждём: ${nameChips(pending, 'pending')}` : ''}</div>
      <div id="error-msg" class="error-msg" style="display:none"></div>
    </div>
    <div class="card">
      <button class="btn btn-danger" id="reset-btn">Сбросить игру</button>
    </div>
  `;

  if (!submitted) {
    const ta = $id('q-input');
    const cnt = $id('q-count');
    ta.addEventListener('input', () => {
      cnt.textContent = ta.value.length;
      cnt.parentElement.classList.toggle('warn', ta.value.length > 180);
    });
    $id('q-form').addEventListener('submit', (e) => {
      e.preventDefault();
      socket.emit('submitQuestion', { text: ta.value });
    });
    ta.focus();
  }
  $id('reset-btn').addEventListener('click', () => {
    if (confirm('Вы уверены? Все данные будут удалены.')) socket.emit('resetGame');
  });
}

// ─── Answer Writing ───────────────────────────────────────────────────────────

function renderAnswerWriting(state) {
  const { questionText, submitted, pending } = state.phaseData;

  // Textarea already in DOM and player hasn't submitted: only refresh the pending list
  if (!submitted && $id('a-input')) {
    $id('a-pending').innerHTML = pending.length > 0
      ? `Ждём: ${nameChips(pending, 'pending')}` : '';
    return;
  }

  mainEl().innerHTML = `
    <div class="card">
      <h2>Раунд ${state.roundNum}: ответьте на вопрос</h2>
      <div class="question-display">${esc(questionText)}</div>
      ${submitted
        ? `<div class="info-box success-box">✓ Ваш ответ принят! Ждём остальных...</div>`
        : `<form id="a-form">
            <textarea id="a-input" maxlength="120" placeholder="Введите ответ..." rows="2"></textarea>
            <div class="char-count"><span id="a-count">0</span> / 120</div>
            <button type="submit" class="btn btn-primary">Отправить ответ</button>
           </form>`}
      <div id="a-pending" class="pending-row">${pending.length > 0
        ? `Ждём: ${nameChips(pending, 'pending')}` : ''}</div>
      <div id="error-msg" class="error-msg" style="display:none"></div>
    </div>
    <div class="card">
      <button class="btn btn-danger" id="reset-btn">Сбросить игру</button>
    </div>
  `;

  if (!submitted) {
    const ta = $id('a-input');
    const cnt = $id('a-count');
    ta.addEventListener('input', () => {
      cnt.textContent = ta.value.length;
      cnt.parentElement.classList.toggle('warn', ta.value.length > 100);
    });
    $id('a-form').addEventListener('submit', (e) => {
      e.preventDefault();
      socket.emit('submitAnswer', { text: ta.value });
    });
    ta.focus();
  }
  $id('reset-btn').addEventListener('click', () => {
    if (confirm('Вы уверены? Все данные будут удалены.')) socket.emit('resetGame');
  });
}

// ─── Fake Writing ─────────────────────────────────────────────────────────────

function renderFakeWriting(state) {
  const { role, questionText, realAnswer, submitted, pending, qNum, qTotal } = state.phaseData;
  const progress = `Вопрос ${qNum} из ${qTotal}`;

  if (role === 'answerer') {
    // Only refresh the pending list if the card is already rendered
    if ($id('f-pending')) {
      $id('f-pending').innerHTML = pending.length > 0
        ? `Ждём: ${nameChips(pending, 'pending')}` : '';
      return;
    }
    mainEl().innerHTML = `
      <div class="card">
        <div class="progress-label">${esc(progress)}</div>
        <h2>Это ваш вопрос!</h2>
        <div class="question-display">${esc(questionText)}</div>
        <div class="info-box gold-box"><strong>Ваш ответ:</strong> ${esc(realAnswer)}</div>
        <div class="info-box" style="margin-top:8px">Остальные придумывают ложные ответы...</div>
        <div id="f-pending" class="pending-row">${pending.length > 0
          ? `Ждём: ${nameChips(pending, 'pending')}` : ''}</div>
        <div id="error-msg" class="error-msg" style="display:none"></div>
      </div>
      <div class="card"><button class="btn btn-danger" id="reset-btn">Сбросить игру</button></div>
    `;
  } else {
    // Textarea already in DOM and player hasn't submitted: only refresh the pending list
    if (!submitted && $id('f-input')) {
      $id('f-pending').innerHTML = pending.length > 0
        ? `Ждём: ${nameChips(pending, 'pending')}` : '';
      return;
    }
    mainEl().innerHTML = `
      <div class="card">
        <div class="progress-label">${esc(progress)}</div>
        <h2>Придумайте ложный ответ!</h2>
        <div class="question-display">${esc(questionText)}</div>
        ${submitted
          ? `<div class="info-box success-box">✓ Ваш ответ принят! Ждём остальных...</div>`
          : `<form id="f-form">
              <textarea id="f-input" maxlength="120" placeholder="Введите ложный ответ..." rows="2"></textarea>
              <div class="char-count"><span id="f-count">0</span> / 120</div>
              <button type="submit" class="btn btn-primary">Отправить</button>
             </form>`}
        <div id="f-pending" class="pending-row">${pending.length > 0
          ? `Ждём: ${nameChips(pending, 'pending')}` : ''}</div>
        <div id="error-msg" class="error-msg" style="display:none"></div>
      </div>
      <div class="card"><button class="btn btn-danger" id="reset-btn">Сбросить игру</button></div>
    `;

    if (!submitted) {
      const ta = $id('f-input');
      const cnt = $id('f-count');
      ta.addEventListener('input', () => {
        cnt.textContent = ta.value.length;
        cnt.parentElement.classList.toggle('warn', ta.value.length > 100);
      });
      $id('f-form').addEventListener('submit', (e) => {
        e.preventDefault();
        socket.emit('submitFakeAnswer', { text: ta.value });
      });
      ta.focus();
    }
  }

  $id('reset-btn').addEventListener('click', () => {
    if (confirm('Вы уверены? Все данные будут удалены.')) socket.emit('resetGame');
  });
}

// ─── Voting ───────────────────────────────────────────────────────────────────

function renderVoting(state) {
  const { role, questionText, answerTexts, myFakeIdx, myVoteIdx, whoVoted, whoPending, qNum, qTotal } = state.phaseData;
  const progress = `Вопрос ${qNum} из ${qTotal}`;
  const voted = myVoteIdx !== null;

  const choicesHtml = answerTexts.map((text, i) => {
    const isMyFake = role === 'voter' && myFakeIdx === i;
    const isSelected = role === 'voter' && myVoteIdx === i;
    const disabled = role === 'answerer' || isMyFake || voted;
    return `<button class="answer-btn${isMyFake ? ' my-answer' : ''}${isSelected ? ' selected' : ''}"
      data-idx="${i}" ${disabled ? 'disabled' : ''}>${esc(text)}</button>`;
  }).join('');

  let roleNote;
  if (role === 'answerer') {
    roleNote = `<div class="info-box" style="margin-bottom:12px">Это ваш ответ — вы не голосуете.</div>`;
  } else if (voted) {
    roleNote = `<div class="info-box success-box" style="margin-bottom:12px">✓ Ваш голос принят!</div>`;
  } else {
    roleNote = `<div class="info-box" style="margin-bottom:12px">Выберите правильный ответ. Нельзя голосовать за свой.</div>`;
  }

  mainEl().innerHTML = `
    <div class="card">
      <div class="progress-label">${esc(progress)}</div>
      <h2>Голосование</h2>
      <div class="question-display">${esc(questionText)}</div>
      ${roleNote}
      <div class="answer-list">${choicesHtml}</div>
      ${whoPending.length > 0
        ? `<div class="pending-row">Ещё не голосовали: ${nameChips(whoPending, 'pending')}</div>` : ''}
      <div id="error-msg" class="error-msg" style="display:none"></div>
    </div>
    <div class="card"><button class="btn btn-danger" id="reset-btn">Сбросить игру</button></div>
  `;

  if (role === 'voter' && !voted) {
    mainEl().querySelectorAll('.answer-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        socket.emit('submitVote', { voteIdx: idx });
      });
    });
  }

  $id('reset-btn').addEventListener('click', () => {
    if (confirm('Вы уверены? Все данные будут удалены.')) socket.emit('resetGame');
  });
}

// ─── Revealing ────────────────────────────────────────────────────────────────

function renderRevealing(state) {
  const { questionText, revealItems, answererName, qNum, qTotal } = state.phaseData;
  const progress = `Вопрос ${qNum} из ${qTotal}`;

  mainEl().innerHTML = `
    <div class="card">
      <div class="progress-label">${esc(progress)}</div>
      <h2>Раскрытие ответов</h2>
      <div class="question-display">${esc(questionText)}</div>
      <p style="color:#6b7280;margin-bottom:12px;font-size:0.9rem">Отвечал(а): ${esc(answererName)}</p>
      ${revealItemsHtml(revealItems)}
    </div>
  `;
}

// ─── Question Complete ────────────────────────────────────────────────────────

function renderQuestionComplete(state) {
  const { questionText, revealItems, answererName, pointsByName, qNum, qTotal, isLastOfRound, isLastRound } = state.phaseData;
  const progress = `Вопрос ${qNum} из ${qTotal}`;

  let nextLabel;
  if (isLastOfRound && isLastRound) {
    nextLabel = '🏆 Финальные результаты';
  } else if (isLastOfRound) {
    nextLabel = 'Следующий раунд →';
  } else {
    nextLabel = 'Следующий вопрос →';
  }

  const pointsRows = Object.entries(pointsByName || {})
    .sort(([, a], [, b]) => b - a)
    .map(([name, pts]) =>
      `<li><span class="score-name">${esc(name)}</span><span class="score-gained">+${pts}</span></li>`)
    .join('');

  mainEl().innerHTML = `
    <div class="card">
      <div class="progress-label">${esc(progress)}</div>
      <h2>Итог вопроса</h2>
      <div class="question-display">${esc(questionText)}</div>
      <p style="color:#6b7280;margin-bottom:12px;font-size:0.9rem">Отвечал(а): ${esc(answererName)}</p>
      ${revealItemsHtml(revealItems)}
      ${pointsRows
        ? `<h3 style="margin-top:16px;margin-bottom:8px">Очки за этот вопрос</h3>
           <ul class="scoreboard">${pointsRows}</ul>` : ''}
    </div>
    <div class="card">
      <h3 style="margin-bottom:8px">Счёт</h3>
      ${scoreboardHtml(state.players)}
    </div>
    <div class="card">
      <button class="btn btn-primary" id="next-btn">${nextLabel}</button>
      <button class="btn btn-danger" id="reset-btn" style="margin-top:8px">Сбросить игру</button>
      <div id="error-msg" class="error-msg" style="display:none"></div>
    </div>
  `;

  // Always emit nextQuestion from questionComplete; server routes to fakeWriting/roundComplete/gameComplete
  $id('next-btn').addEventListener('click', () => socket.emit('nextQuestion'));
  $id('reset-btn').addEventListener('click', () => {
    if (confirm('Вы уверены? Все данные будут удалены.')) socket.emit('resetGame');
  });
}

// ─── Round Complete ───────────────────────────────────────────────────────────

function renderRoundComplete(state) {
  const { players } = state.phaseData;

  mainEl().innerHTML = `
    <div class="card">
      <h2>Раунд ${state.roundNum} завершён!</h2>
      <h3 style="margin:16px 0 8px">Счёт</h3>
      ${scoreboardHtml(players)}
    </div>
    <div class="card">
      <button class="btn btn-primary" id="next-btn">Следующий раунд →</button>
      <button class="btn btn-danger" id="reset-btn" style="margin-top:8px">Сбросить игру</button>
      <div id="error-msg" class="error-msg" style="display:none"></div>
    </div>
  `;

  $id('next-btn').addEventListener('click', () => socket.emit('nextRound'));
  $id('reset-btn').addEventListener('click', () => {
    if (confirm('Вы уверены? Все данные будут удалены.')) socket.emit('resetGame');
  });
}

// ─── Game Complete ────────────────────────────────────────────────────────────

function renderGameComplete(state) {
  const { players } = state.phaseData;
  const winner = players[0];

  mainEl().innerHTML = `
    <div class="card">
      <h2>Игра завершена!</h2>
      <div class="winner-banner">
        <div class="crown">🏆</div>
        <div class="winner-name">${winner ? esc(winner.name) : '—'}</div>
        <div class="winner-score">${winner ? winner.score + ' очков' : ''}</div>
      </div>
      <h3 style="margin-bottom:8px">Итоговый счёт</h3>
      ${scoreboardHtml(players)}
    </div>
    <div class="card">
      <button class="btn btn-danger" id="reset-btn">Новая игра / Сбросить</button>
      <div id="error-msg" class="error-msg" style="display:none"></div>
    </div>
  `;

  $id('reset-btn').addEventListener('click', () => {
    if (confirm('Вы уверены? Все данные будут удалены.')) socket.emit('resetGame');
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

renderHeader(null);
mainEl().innerHTML = `<div class="card"><p style="text-align:center;color:#6b7280">Подключение...</p></div>`;
