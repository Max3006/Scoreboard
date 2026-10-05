(() => {
  'use strict';

  const STORAGE_KEY = 'rundenheld.game.v1';
  const MAX_PLAYERS = 12;
  const MAX_POINTS = 999999999;
  const $ = (selector, root = document) => root.querySelector(selector);
  const views = ['setup-view', 'game-view', 'round-view', 'review-view'].map((id) => document.getElementById(id));

  const makeId = () => globalThis.crypto?.randomUUID?.() || `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const cleanName = (value, fallback) => {
    const name = String(value ?? '').trim().slice(0, 32);
    return name || fallback;
  };
  const safeInteger = (value, fallback = 0, min = 0, max = MAX_POINTS) => {
    const number = Number(value);
    return Number.isSafeInteger(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };
  const defaultPlayers = () => Array.from({ length: 4 }, (_, index) => ({ id: makeId(), name: `Spieler ${index + 1}`, autoName: true, total: 0 }));

  function loadGame() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.players) || saved.players.length < 2 || saved.players.length > MAX_PLAYERS) return null;
      const ids = new Set();
      const players = saved.players.map((player, index) => {
        const id = typeof player?.id === 'string' && player.id.length <= 80 && !ids.has(player.id) ? player.id : makeId();
        ids.add(id);
        const name = cleanName(player?.name, `Spieler ${index + 1}`);
        const autoName = typeof player?.autoName === 'boolean' ? player.autoName : /^Spieler \d+$/.test(name);
        return { id, name, autoName, total: safeInteger(player?.total) };
      });
      const endMode = ['free', 'rounds', 'score'].includes(saved.endMode) ? saved.endMode : 'free';
      const winnerRule = saved.winnerRule === 'low' ? 'low' : 'high';
      const limit = safeInteger(saved.limit, endMode === 'score' ? 500 : 7, 1, 999999);
      const history = Array.isArray(saved.history) ? saved.history.slice(-500).map((round, index) => ({
        round: safeInteger(round?.round, index + 1, 1, 999999),
        scores: Array.isArray(round?.scores) ? round.scores.filter((item) => players.some((player) => player.id === item?.id)).map((item) => ({ id: item.id, points: safeInteger(item.points) })) : [],
      })) : [];
      const finished = saved.finished === true;
      const inferredReason = endMode === 'rounds' ? 'rounds' : endMode === 'score' && players.some((player) => player.total >= limit) ? 'score' : 'manual';
      const finishReason = ['rounds', 'score', 'manual'].includes(saved.finishReason) ? saved.finishReason : (finished ? inferredReason : null);
      return { players, endMode, winnerRule, limit, roundNumber: safeInteger(saved.roundNumber, history.length + 1, 1, 1000000), history, finished, finishReason };
    } catch {
      return null;
    }
  }

  let game = loadGame();
  let pendingScores = [];
  let entryIndex = 0;
  let entryValue = '';
  let editDraft = null;

  function saveGame() {
    if (!game) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(game)); } catch { /* The app still works if storage is unavailable. */ }
  }

  function showView(viewId) {
    views.forEach((view) => {
      const active = view.id === viewId;
      view.hidden = !active;
      view.classList.toggle('active', active);
    });
    $('#new-game-button').hidden = viewId === 'setup-view';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function makePlayerRow(player, index, onRemove, canRemove = true) {
    const row = document.createElement('div');
    row.className = 'player-row';
    const number = document.createElement('span');
    number.className = 'player-number';
    number.textContent = String(index + 1).padStart(2, '0');
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 32;
    input.autocomplete = 'off';
    input.value = player.name;
    input.setAttribute('aria-label', `Name für Spieler ${index + 1}`);
    input.addEventListener('input', () => { player.name = input.value.slice(0, 32); player.autoName = input.value.trim() === ''; });
    const remove = document.createElement('button');
    remove.className = 'remove-player';
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `${player.name || `Spieler ${index + 1}`} entfernen`);
    remove.disabled = !canRemove;
    remove.addEventListener('click', () => onRemove(index));
    row.append(number, input, remove);
    return row;
  }

  function renumberDefaultPlayers(players) {
    players.forEach((player, index) => {
      if (player.autoName) player.name = `Spieler ${index + 1}`;
    });
  }

  function renderSetupPlayers() {
    const list = $('#player-list');
    list.replaceChildren();
    setupPlayers.forEach((player, index) => list.append(makePlayerRow(player, index, (removeIndex) => {
      if (setupPlayers.length <= 2) return;
      setupPlayers.splice(removeIndex, 1);
      renumberDefaultPlayers(setupPlayers);
      renderSetupPlayers();
    }, setupPlayers.length > 2)));
    $('#player-count').textContent = `${setupPlayers.length} ${setupPlayers.length === 1 ? 'Spieler' : 'Spieler'}`;
    $('#add-player').disabled = setupPlayers.length >= MAX_PLAYERS;
  }

  let setupPlayers = defaultPlayers();

  function renderGame() {
    if (!game) return;
    $('#round-label').textContent = game.endMode === 'rounds' ? `RUNDE ${Math.min(game.roundNumber, game.limit)} VON ${game.limit}` : `RUNDE ${game.roundNumber}`;
    $('#round-card-title').textContent = game.finished ? 'Spiel beendet' : game.history.length ? `Bereit für Runde ${game.roundNumber}?` : 'Bereit für die erste Runde?';
    $('#begin-round').disabled = game.finished;
    const beginButton = $('#begin-round');
    beginButton.replaceChildren(document.createTextNode(game.finished ? 'Spiel abgeschlossen' : 'Runde zählen'));
    if (!game.finished) {
      const arrow = document.createElement('span'); arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '→'; beginButton.append(arrow);
    }
    const scores = $('#score-grid');
    scores.replaceChildren();
    game.players.forEach((player, index) => {
      const card = document.createElement('article');
      card.className = 'score-card';
      card.classList.add(`player-color-${index % 12}`);
      const top = document.createElement('div'); top.className = 'score-card-top';
      const dot = document.createElement('span'); dot.className = 'score-dot'; dot.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span'); name.className = 'score-name'; name.textContent = player.name;
      top.append(dot, name);
      const total = document.createElement('div'); total.className = 'score-value'; total.textContent = player.total.toLocaleString('de-DE');
      const bottom = document.createElement('div'); bottom.className = 'score-card-bottom'; bottom.textContent = game.history.length ? `${game.history.length} ${game.history.length === 1 ? 'Runde' : 'Runden'} gespielt` : 'Noch keine Punkte';
      card.append(top, total, bottom); scores.append(card);
    });
    const banner = $('#winner-banner');
    banner.hidden = !game.finished;
    $('#end-game-button').hidden = game.finished;
    if (game.finished) renderStandings();
    renderHistory();
    if (!$('#live-standings').hidden) renderLiveStandings();
    saveGame();
  }

  function rankedPlayers() {
    return [...game.players].sort((a, b) => game.winnerRule === 'low' ? a.total - b.total : b.total - a.total);
  }

  function getLiveRanking() {
    const ranked = rankedPlayers();
    const leadingScore = ranked[0]?.total ?? 0;
    let previousScore;
    let previousRank = 0;
    return ranked.map((player, index) => {
      const rank = index > 0 && player.total === previousScore ? previousRank : index + 1;
      previousScore = player.total;
      previousRank = rank;
      return { player, rank, gap: Math.abs(player.total - leadingScore) };
    });
  }

  function renderLiveStandings() {
    const list = $('#live-standings-list');
    list.replaceChildren();
    const ranking = getLiveRanking();
    const tiedFirst = ranking.filter((entry) => entry.rank === 1).length > 1;
    ranking.forEach(({ player, rank, gap }) => {
      const row = document.createElement('li'); row.className = 'standings-row';
      const place = document.createElement('span'); place.className = 'standing-place'; place.textContent = `${rank}. Platz`;
      const name = document.createElement('span'); name.className = 'standing-name'; name.textContent = player.name;
      const points = document.createElement('span'); points.className = 'standing-points'; points.textContent = `${player.total.toLocaleString('de-DE')} P.`;
      const distance = document.createElement('span'); distance.className = 'standing-gap';
      distance.textContent = rank === 1 ? (tiedFirst ? 'geteilt' : 'vorn') : `${gap.toLocaleString('de-DE')} P. zurück`;
      row.append(place, name, points, distance); list.append(row);
    });
    $('#ranking-note').textContent = `Abstand zum ersten Platz · ${game.winnerRule === 'low' ? 'wenigste Punkte gewinnen' : 'meiste Punkte gewinnen'}`;
  }

  function toggleLiveStandings(open) {
    $('#live-standings').hidden = !open;
    $('#show-standings-button').textContent = open ? 'Rangliste aktualisieren' : 'Rangliste anzeigen';
    if (open) renderLiveStandings();
  }

  function renderStandings() {
    const ranked = rankedPlayers();
    const bestScore = ranked[0]?.total;
    const winners = ranked.filter((player) => player.total === bestScore);
    $('#winner-title').textContent = winners.length > 1 ? 'Gleichstand!' : `${winners[0]?.name || 'Niemand'} gewinnt!`;
    const ending = game.finishReason === 'rounds' ? `${game.limit} Runden gespielt.` : game.finishReason === 'score' ? `Das Punktziel von ${game.limit.toLocaleString('de-DE')} wurde erreicht.` : 'Das Spiel wurde beendet.';
    $('#winner-subtitle').textContent = `${game.winnerRule === 'low' ? 'Die wenigsten' : 'Die meisten'} Punkte gewinnen. ${ending}`;
    const list = $('#standings-list'); list.replaceChildren();
    let priorScore;
    let priorRank = 0;
    ranked.forEach((player, index) => {
      const rank = index > 0 && player.total === priorScore ? priorRank : index + 1;
      priorScore = player.total; priorRank = rank;
      const row = document.createElement('li'); row.className = 'standings-row';
      const place = document.createElement('span'); place.className = 'standing-place'; place.textContent = `${rank}. Platz`;
      const name = document.createElement('span'); name.className = 'standing-name'; name.textContent = player.name;
      const points = document.createElement('span'); points.className = 'standing-points'; points.textContent = `${player.total.toLocaleString('de-DE')} P.`;
      row.append(place, name, points); list.append(row);
    });
  }

  function renderHistory() {
    const panel = $('#history-panel');
    const list = $('#history-list');
    panel.hidden = game.history.length === 0;
    list.replaceChildren();
    [...game.history].reverse().forEach((round) => {
      const item = document.createElement('div'); item.className = 'history-item';
      const label = document.createElement('span'); label.className = 'history-round'; label.textContent = `Runde ${round.round}`;
      const row = document.createElement('div'); row.className = 'history-scores';
      round.scores.forEach((score) => {
        const player = game.players.find((candidate) => candidate.id === score.id);
        if (!player) return;
        const chip = document.createElement('span'); chip.className = 'history-chip'; chip.textContent = `${player.name}: +${score.points.toLocaleString('de-DE')}`; row.append(chip);
      });
      item.append(label, row); list.append(item);
    });
  }

  function beginRound() {
    if (!game || game.finished) return;
    pendingScores = game.players.map((player) => ({ id: player.id, points: 0 }));
    entryIndex = 0;
    entryValue = '';
    renderEntry();
    showView('round-view');
  }

  function renderEntry() {
    const player = game.players[entryIndex];
    if (!player) return renderReview();
    $('#round-step').textContent = `SPIELER ${entryIndex + 1} VON ${game.players.length}`;
    $('#entry-round-label').textContent = `RUNDE ${game.roundNumber}`;
    $('#round-title').textContent = player.name;
    $('#score-entry').textContent = entryValue || '0';
    $('#progress-bar').value = (entryIndex / game.players.length) * 100;
    $('#skip-player').textContent = `Überspringen`;
  }

  function finishPlayer() {
    if (!game || entryIndex >= game.players.length) return;
    pendingScores[entryIndex].points = safeInteger(entryValue, 0);
    entryIndex += 1;
    entryValue = pendingScores[entryIndex] ? String(pendingScores[entryIndex].points || '') : '';
    if (entryIndex >= game.players.length) renderReview(); else renderEntry();
  }

  function renderReview() {
    $('#review-round-label').textContent = `RUNDE ${game.roundNumber} · ÜBERSICHT`;
    const list = $('#review-list'); list.replaceChildren();
    game.players.forEach((player, index) => {
      const row = document.createElement('label'); row.className = 'review-row';
      const name = document.createElement('strong'); name.textContent = player.name;
      const input = document.createElement('input'); input.type = 'number'; input.inputMode = 'numeric'; input.min = '0'; input.max = String(MAX_POINTS); input.step = '1'; input.value = String(pendingScores[index]?.points ?? 0); input.dataset.playerId = player.id; input.setAttribute('aria-label', `Punkte für ${player.name}`);
      const unit = document.createElement('span'); unit.className = 'review-unit'; unit.textContent = 'Punkte';
      row.append(name, input, unit); list.append(row);
    });
    showView('review-view');
  }

  function confirmRound() {
    const inputs = [...$('#review-list').querySelectorAll('input')];
    if (inputs.some((input) => !input.validity.valid || input.value.trim() === '')) {
      inputs.find((input) => !input.validity.valid || input.value.trim() === '')?.focus();
      return;
    }
    const scores = inputs.map((input) => ({ id: input.dataset.playerId, points: safeInteger(input.value) }));
    scores.forEach((score) => {
      const player = game.players.find((candidate) => candidate.id === score.id);
      if (player) player.total = safeInteger(player.total + score.points);
    });
    game.history.push({ round: game.roundNumber, scores });
    const justFinishedRound = game.roundNumber;
    game.roundNumber += 1;
    if (game.endMode === 'rounds' && justFinishedRound >= game.limit) { game.finished = true; game.finishReason = 'rounds'; }
    if (game.endMode === 'score' && game.players.some((player) => player.total >= game.limit)) { game.finished = true; game.finishReason = 'score'; }
    pendingScores = [];
    renderGame();
    showView('game-view');
  }

  function renderEditList() {
    const list = $('#edit-player-list'); list.replaceChildren();
    editDraft.forEach((player, index) => list.append(makePlayerRow(player, index, (removeIndex) => {
      if (editDraft.length <= 2) return;
      editDraft.splice(removeIndex, 1); renumberDefaultPlayers(editDraft); renderEditList();
    }, editDraft.length > 2)));
    $('#edit-add-player').disabled = editDraft.length >= MAX_PLAYERS;
  }

  function saveEdit(event) {
    event.preventDefault();
    if (!editDraft || editDraft.length < 2) return;
    const oldIds = new Set(game.players.map((player) => player.id));
    game.players = editDraft.map((player, index) => ({ ...player, name: cleanName(player.name, `Spieler ${index + 1}`), total: safeInteger(player.total) }));
    const newIds = new Set(game.players.map((player) => player.id));
    game.history.forEach((round) => {
      round.scores = round.scores.filter((score) => newIds.has(score.id));
      game.players.forEach((player) => { if (!oldIds.has(player.id) && !round.scores.some((score) => score.id === player.id)) round.scores.push({ id: player.id, points: 0 }); });
    });
    $('#edit-dialog').close();
    editDraft = null;
    renderGame();
  }

  function startNewGame() {
    if (game) setupPlayers = game.players.map((player) => ({ id: makeId(), name: player.name, autoName: player.autoName === true, total: 0 }));
    if (game) document.querySelector(`input[name="winner-rule"][value="${game.winnerRule}"]`).checked = true;
    toggleLiveStandings(false);
    renderSetupPlayers();
    showView('setup-view');
  }

  $('#add-player').addEventListener('click', () => {
    if (setupPlayers.length >= MAX_PLAYERS) return;
    setupPlayers.push({ id: makeId(), name: `Spieler ${setupPlayers.length + 1}`, autoName: true, total: 0 }); renderSetupPlayers();
    $('#player-list').lastElementChild?.querySelector('input')?.focus();
  });
  document.querySelectorAll('input[name="end-mode"]').forEach((input) => input.addEventListener('change', () => {
    $('#rounds-detail').hidden = input.value !== 'rounds' || !input.checked;
    $('#score-detail').hidden = input.value !== 'score' || !input.checked;
  }));
  $('#setup-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (setupPlayers.length < 2) return;
    const mode = $('input[name="end-mode"]:checked').value;
    const limitInput = mode === 'rounds' ? $('#round-limit') : $('#score-limit');
    if (mode !== 'free' && !limitInput.validity.valid) { limitInput.focus(); return; }
    const winnerRule = $('input[name="winner-rule"]:checked').value;
    game = { players: setupPlayers.map((player, index) => ({ id: player.id, name: cleanName(player.name, `Spieler ${index + 1}`), autoName: player.autoName === true, total: 0 })), endMode: mode, winnerRule, limit: mode === 'free' ? 0 : safeInteger(limitInput.value, 1, 1, 999999), roundNumber: 1, history: [], finished: false, finishReason: null };
    renderGame(); showView('game-view');
  });
  $('#begin-round').addEventListener('click', beginRound);
  $('#show-standings-button').addEventListener('click', () => toggleLiveStandings(true));
  $('#close-ranking').addEventListener('click', () => toggleLiveStandings(false));
  $('#end-game-button').addEventListener('click', () => { if (!game || game.finished) return; game.finished = true; game.finishReason = 'manual'; renderGame(); });
  $('#continue-game').addEventListener('click', () => {
    const roundsInput = $('#continue-round-limit');
    const scoreInput = $('#continue-score-limit');
    roundsInput.value = '3';
    scoreInput.value = String(Math.min(MAX_POINTS, Math.max(...game.players.map((player) => player.total), 0) + 100));
    document.querySelector('input[name="continue-mode"][value="free"]').checked = true;
    $('#continue-rounds-detail').hidden = true;
    $('#continue-score-detail').hidden = true;
    $('#continue-dialog').showModal();
  });
  document.querySelectorAll('input[name="continue-mode"]').forEach((input) => input.addEventListener('change', () => {
    $('#continue-rounds-detail').hidden = input.value !== 'rounds' || !input.checked;
    $('#continue-score-detail').hidden = input.value !== 'score' || !input.checked;
  }));
  $('#continue-form').addEventListener('submit', (event) => {
    if (event.submitter?.id !== 'confirm-continue') return;
    event.preventDefault();
    const mode = $('input[name="continue-mode"]:checked').value;
    if (mode === 'rounds' && !$('#continue-round-limit').validity.valid) { $('#continue-round-limit').focus(); return; }
    if (mode === 'score' && !$('#continue-score-limit').validity.valid) { $('#continue-score-limit').focus(); return; }
    game.endMode = mode;
    if (mode === 'free') game.limit = 0;
    if (mode === 'rounds') game.limit = game.roundNumber - 1 + safeInteger($('#continue-round-limit').value, 3, 1, 999);
    if (mode === 'score') game.limit = safeInteger($('#continue-score-limit').value, 500, 1, MAX_POINTS);
    game.finished = false;
    game.finishReason = null;
    $('#continue-dialog').close();
    renderGame();
  });
  $('#finish-player').addEventListener('click', finishPlayer);
  $('#skip-player').addEventListener('click', finishPlayer);
  $('#cancel-round').addEventListener('click', () => { pendingScores = []; renderGame(); showView('game-view'); });
  $('#clear-entry').addEventListener('click', () => { entryValue = ''; renderEntry(); });
  $('#keypad').addEventListener('click', (event) => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.digit !== undefined) {
      if (entryValue.length < String(MAX_POINTS).length) entryValue = `${entryValue}${button.dataset.digit}`.replace(/^0+(?=\d)/, '');
    } else if (button.dataset.action === 'backspace') entryValue = entryValue.slice(0, -1);
    else if (button.dataset.action === 'clear') entryValue = '';
    renderEntry();
  });
  document.addEventListener('keydown', (event) => {
    if ($('#round-view').hidden) return;
    if (/^\d$/.test(event.key) && entryValue.length < String(MAX_POINTS).length) { entryValue = `${entryValue}${event.key}`.replace(/^0+(?=\d)/, ''); renderEntry(); }
    else if (event.key === 'Backspace') { entryValue = entryValue.slice(0, -1); renderEntry(); }
    else if (event.key === 'Enter') finishPlayer();
    else if (event.key === 'Escape') { pendingScores = []; renderGame(); showView('game-view'); }
  });
  $('#confirm-round').addEventListener('click', confirmRound);
  $('#back-to-entry').addEventListener('click', () => { entryIndex = 0; entryValue = String(pendingScores[0]?.points || ''); renderEntry(); showView('round-view'); });
  $('#new-game-button').addEventListener('click', startNewGame);
  $('#edit-game-button').addEventListener('click', () => {
    editDraft = game.players.map((player) => ({ ...player })); renderEditList(); $('#edit-dialog').showModal();
  });
  $('#edit-add-player').addEventListener('click', () => {
    if (editDraft.length >= MAX_PLAYERS) return;
    editDraft.push({ id: makeId(), name: `Spieler ${editDraft.length + 1}`, autoName: true, total: 0 }); renderEditList();
    $('#edit-player-list').lastElementChild?.querySelector('input')?.focus();
  });
  $('#edit-form').addEventListener('submit', (event) => { if (event.submitter?.id === 'save-edit') saveEdit(event); });

  let installPrompt;
  window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); installPrompt = event; $('#install-button').hidden = false; });
  $('#install-button').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $('#install-button').hidden = true;
  });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }

  renderSetupPlayers();
  if (game) { renderGame(); showView('game-view'); }
})();
