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

function nameChips(names, cls) {
  if (!names || names.length === 0) return '<span style="color:#6b7280">—</span>';
  return names.map(n => `<span class="host-name-chip ${esc(cls)}">${esc(n)}</span>`).join('');
}

function revealItemsHtml(items) {
  if (!items || items.length === 0) return '';
  return items.map(item => {
    if (item.type === 'fake') {
      const chooserNames = item.choosers.map(esc).join(', ');
      const authorName = esc(item.authorName);
      const detail = item.choosers.length > 0
        ? `Выбрали: ${chooserNames}. Это была ложь от ${authorName}.`
        : `Никто не выбрал. Ложь от ${authorName}.`;
      return `<div class="host-reveal-item fake">
        <div class="host-reveal-answer">«${esc(item.text)}»</div>
        <div class="host-reveal-detail">${detail}</div>
      </div>`;
    } else {
      const chooserNames = item.choosers.map(esc).join(', ');
      const answererName = esc(item.answererName);
      const detail = item.choosers.length > 0
        ? `Выбрали: ${chooserNames}. Правильный ответ — так ответил(а) ${answererName}.`
        : `Никто не угадал! Правильный ответ — так ответил(а) ${answererName}.`;
      return `<div class="host-reveal-item real">
        <div class="host-reveal-answer">«${esc(item.text)}»</div>
        <div class="host-reveal-detail">${detail}</div>
      </div>`;
    }
  }).join('');
}

// ─── Socket ───────────────────────────────────────────────────────────────────

const prefix = window.location.pathname.replace(/\/[^/]*$/, '') || '';
const socket = io({ path: prefix + '/socket.io', auth: { role: 'host' } });

socket.on('hostState', (state) => {
  renderHostHeader(state);
  renderHostMain(state);
  renderHostSidebar(state);
});

// ─── Header ───────────────────────────────────────────────────────────────────

function renderHostHeader(state) {
  const roundLabel = (state.phase !== 'lobby' && state.phase !== 'gameComplete')
    ? `<span class="host-round-badge">Раунд ${state.roundNum} / 3</span>`
    : '';

  const joinPart = state.joinUrl
    ? `<span class="join-url-box">${esc(state.joinUrl)}</span>`
    : '';

  const qrPart = state.hasQr && state.joinUrl
    ? `<img src="qr.png" alt="QR" class="host-qr" />`
    : '';

  $id('host-header').innerHTML = `
    <div class="host-title">Семейный Фиббаж</div>
    <div class="host-meta">
      ${roundLabel}
      ${joinPart}
      ${qrPart}
    </div>
  `;
}

// ─── Sidebar (scoreboard) ─────────────────────────────────────────────────────

function renderHostSidebar(state) {
  const players = state.players || [];
  const rows = players.map((p, i) => {
    const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + '.';
    return `<li>
      <span class="host-score-rank">${rank}</span>
      <span class="host-score-name">${esc(p.name)}</span>
      <span class="host-score-pts">${p.score}</span>
    </li>`;
  }).join('');

  $id('host-sidebar').innerHTML = `
    <div class="host-score-title">Счёт</div>
    <ul class="host-score-list">${rows || '<li style="color:#6b7280">Нет игроков</li>'}</ul>
  `;
}

// ─── Main Content ─────────────────────────────────────────────────────────────

function renderHostMain(state) {
  const main = $id('host-main');
  const pd = state.phaseData || {};

  switch (state.phase) {
    case 'lobby':
      renderLobby(main, state, pd);
      break;
    case 'questionWriting':
      renderQuestionWriting(main, state, pd);
      break;
    case 'answerWriting':
      renderAnswerWriting(main, state, pd);
      break;
    case 'fakeWriting':
      renderFakeWriting(main, state, pd);
      break;
    case 'voting':
      renderVoting(main, state, pd);
      break;
    case 'revealing':
      renderRevealing(main, pd);
      break;
    case 'questionComplete':
      renderQuestionComplete(main, pd);
      break;
    case 'roundComplete':
      renderRoundComplete(main, state, pd);
      break;
    case 'gameComplete':
      renderGameComplete(main, pd);
      break;
    default:
      main.innerHTML = `<p style="color:#9ca3af">Загрузка...</p>`;
  }
}

function renderLobby(main, state, pd) {
  const players = pd.playerNames || [];
  const chips = players.length
    ? players.map(n => `<div class="host-lobby-player">${esc(n)}</div>`).join('')
    : '<p style="color:#6b7280;font-size:1.2rem">Пока нет игроков</p>';

  main.innerHTML = `
    <div class="host-phase-label">Зал ожидания</div>
    ${state.joinUrl
      ? `<div class="host-big-url">${esc(state.joinUrl)}</div>`
      : ''}
    ${state.hasQr && state.joinUrl
      ? `<img src="qr.png" alt="QR-код" style="height:160px;border-radius:12px;margin-bottom:24px" />`
      : ''}
    <p style="color:#9ca3af;font-size:1.1rem;margin-bottom:16px">
      Откройте ссылку на телефоне, чтобы войти в игру.
      Нужно минимум 4 игрока.
    </p>
    <div class="host-lobby-player-list">${chips}</div>
  `;
}

function renderQuestionWriting(main, state, pd) {
  main.innerHTML = `
    <div class="host-phase-label">Раунд ${state.roundNum} — придумайте вопросы</div>
    <div class="host-section-label">Готово</div>
    <div class="host-name-grid">${nameChips(pd.submitted, 'done')}</div>
    <div class="host-section-label">Ждём</div>
    <div class="host-name-grid">${nameChips(pd.pending, 'waiting')}</div>
  `;
}

function renderAnswerWriting(main, state, pd) {
  main.innerHTML = `
    <div class="host-phase-label">Раунд ${state.roundNum} — отвечают на вопросы</div>
    <div class="host-section-label">Готово</div>
    <div class="host-name-grid">${nameChips(pd.submitted, 'done')}</div>
    <div class="host-section-label">Ждём</div>
    <div class="host-name-grid">${nameChips(pd.pending, 'waiting')}</div>
  `;
}

function renderFakeWriting(main, state, pd) {
  main.innerHTML = `
    <div class="host-phase-label">Раунд ${state.roundNum} — вопрос ${pd.qNum} из ${pd.qTotal}</div>
    <div class="host-question">${esc(pd.questionText || '')}</div>
    <div class="host-answerer-line">Отвечал(а): <strong>${esc(pd.answererName || '')}</strong></div>
    <div class="host-section-label">Прислали ложный ответ</div>
    <div class="host-name-grid">${nameChips(pd.submitted, 'done')}</div>
    <div class="host-section-label">Ещё придумывают</div>
    <div class="host-name-grid">${nameChips(pd.pending, 'waiting')}</div>
  `;
}

function renderVoting(main, state, pd) {
  main.innerHTML = `
    <div class="host-phase-label">Раунд ${state.roundNum} — вопрос ${pd.qNum} из ${pd.qTotal} — голосование</div>
    <div class="host-question">${esc(pd.questionText || '')}</div>
    <p style="color:#c4b5fd;font-size:1.1rem;margin-bottom:16px">${pd.answerCount || 0} вариантов ответа</p>
    <div class="host-section-label">Проголосовали</div>
    <div class="host-name-grid">${nameChips(pd.whoVoted, 'done')}</div>
    <div class="host-section-label">Ещё думают</div>
    <div class="host-name-grid">${nameChips(pd.whoPending, 'waiting')}</div>
  `;
}

function renderRevealing(main, pd) {
  const items = pd.revealItems || [];
  main.innerHTML = `
    <div class="host-phase-label">Вопрос ${pd.qNum} из ${pd.qTotal} — раскрытие</div>
    <div class="host-question">${esc(pd.questionText || '')}</div>
    <p style="color:#c4b5fd;font-size:1.1rem;margin-bottom:16px">Отвечал(а): ${esc(pd.answererName || '')}</p>
    ${revealItemsHtml(items)}
  `;
}

function renderQuestionComplete(main, pd) {
  const items = pd.revealItems || [];
  const pointsByName = pd.pointsByName || {};
  const pointsRows = Object.entries(pointsByName)
    .sort(([, a], [, b]) => b - a)
    .map(([name, pts]) =>
      `<div class="host-points-gained-item">${esc(name)}: +${pts}</div>`)
    .join('');

  main.innerHTML = `
    <div class="host-phase-label">Вопрос ${pd.qNum} из ${pd.qTotal} — результат</div>
    <div class="host-question">${esc(pd.questionText || '')}</div>
    ${revealItemsHtml(items)}
    ${pointsRows
      ? `<div class="host-points-gained">
          <div class="host-points-gained-title">Очки за этот вопрос</div>
          ${pointsRows}
        </div>` : ''}
    <p style="color:#9ca3af;font-size:1rem;margin-top:16px">
      Игроки, нажмите «Следующий вопрос» на своём устройстве.
    </p>
  `;
}

function renderRoundComplete(main, state, pd) {
  const players = pd.players || [];
  const rows = players.map((p, i) => {
    const rankEmoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + '.';
    return `<div class="host-final-item${i === 0 ? ' first' : ''}">
      <div class="host-final-rank">${rankEmoji}</div>
      <div class="host-final-name">${esc(p.name)}</div>
      <div class="host-final-score">${p.score} очков</div>
    </div>`;
  }).join('');

  main.innerHTML = `
    <div class="host-phase-label">Раунд ${state.roundNum} завершён!</div>
    <div class="host-final-list">${rows}</div>
    <p style="color:#9ca3af;font-size:1rem;margin-top:16px">
      Игроки, нажмите «Следующий раунд» на своём устройстве.
    </p>
  `;
}

function renderGameComplete(main, pd) {
  const players = pd.players || [];
  const winner = players[0];
  const rows = players.map((p, i) => {
    const rankEmoji = i === 0 ? '🏆' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + '.';
    return `<div class="host-final-item${i === 0 ? ' first' : ''}">
      <div class="host-final-rank">${rankEmoji}</div>
      <div class="host-final-name">${esc(p.name)}</div>
      <div class="host-final-score">${p.score} очков</div>
    </div>`;
  }).join('');

  main.innerHTML = `
    <div class="host-phase-label">🎉 Игра завершена!</div>
    ${winner ? `<p style="font-size:2rem;font-weight:800;color:#fbbf24;margin-bottom:24px">
      Победитель: ${esc(winner.name)}!
    </p>` : ''}
    <div class="host-final-list">${rows}</div>
    <p style="color:#9ca3af;font-size:1rem;margin-top:20px">
      Игроки, нажмите «Новая игра / Сбросить» для следующего раунда.
    </p>
  `;
}
