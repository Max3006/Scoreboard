(() => {
  'use strict';

  const STORAGE_KEY = 'rundenheld.game.v1';
  const MAX_PLAYERS = 12;
  const MAX_POINTS = 999999999;
  const PLAYER_COLORS = ['#e74c3c', '#2ecc71', '#3b5bdb', '#f1c40f', '#8062b0', '#ed8a49', '#368da6', '#d15f74', '#537f4d', '#ae7d27', '#a14e92', '#617381'];
  const safeColor = (value, fallback = PLAYER_COLORS[0]) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : fallback;
  const BOARD_SEATS = {
    four: [[2, 2], [2, 1], [1, 1], [1, 2]],
    eight: [[3, 3], [3, 2], [3, 1], [2, 1], [1, 1], [1, 2], [1, 3], [2, 3]],
    twelve: [[4, 4], [4, 3], [4, 2], [4, 1], [3, 1], [2, 1], [1, 1], [1, 2], [1, 3], [1, 4], [2, 4], [3, 4]],
  };
  const boardLayout = (count, soloSide = 'left', fifthSide = 'right') => {
    if (count === 2) return { columns: 2, rows: 2, seats: [[1, '1 / 3'], [2, '1 / 3']], center: 'overlay' };
    if (count === 3) return { columns: 2, rows: 2, seats: [[2, 2], [2, 1], [1, soloSide === 'right' ? 2 : 1]], center: 'overlay' };
    if (count === 4) return { columns: 2, rows: 2, seats: BOARD_SEATS.four, center: 'overlay' };
    if (count === 5) {
      const sideColumn = fifthSide === 'left' ? 1 : 3;
      const leftColumn = fifthSide === 'left' ? 2 : 1;
      const rightColumn = fifthSide === 'left' ? 3 : 2;
      return fifthSide === 'left' ? { columns: 3, rows: 2, columnTemplate: 'minmax(0, .62fr) repeat(2, minmax(0, 1fr))', seats: [[2, 3], [2, 2], ['1 / span 2', 1], [1, 2], [1, 3]], center: 'overlay', sideIndexes: [2] } : { columns: 3, rows: 2, columnTemplate: 'repeat(2, minmax(0, 1fr)) minmax(0, .62fr)', seats: [[2, 2], [2, 1], [1, 1], [1, 2], ['1 / span 2', 3]], center: 'overlay', sideIndexes: [4] };
    }
    if (count === 6) return { columns: 4, rows: 2, columnTemplate: 'minmax(0, .62fr) repeat(2, minmax(0, 1fr)) minmax(0, .62fr)', seats: [[2, 3], [2, 2], ['1 / span 2', 1], [1, 2], [1, 3], ['1 / span 2', 4]], center: 'overlay', sideIndexes: [2, 5] };
    if (count <= 8) return { columns: 3, rows: 3, seats: BOARD_SEATS.eight.slice(0, count), center: '2 / 3' };
    return { columns: 4, rows: 4, seats: BOARD_SEATS.twelve.slice(0, count), center: '2 / 4' };
  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const views = ['setup-view', 'game-view', 'round-view', 'review-view', 'continue-games-view', 'gamebox-view', 'ships-game-view'].map((id) => document.getElementById(id));

  const makeId = () => globalThis.crypto?.randomUUID?.() || `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const cleanName = (value, fallback) => {
    const name = String(value ?? '').trim().slice(0, 32);
    return name || fallback;
  };
  const safeInteger = (value, fallback = 0, min = 0, max = MAX_POINTS) => {
    const number = Number(value);
    return Number.isSafeInteger(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };
  const safeSignedInteger = (value, fallback = 0, min = -MAX_POINTS, max = MAX_POINTS) => {
    const number = Number(value);
    return Number.isSafeInteger(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };
  const reachedScoreLimit = (total, limit, winnerRule) => winnerRule === 'low' ? total <= limit : total >= limit;
  const defaultPlayers = () => Array.from({ length: 4 }, (_, index) => ({ id: makeId(), name: `Spieler ${index + 1}`, autoName: true, total: 0, color: PLAYER_COLORS[index % PLAYER_COLORS.length] }));

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
        return { id, name, autoName, total: safeSignedInteger(player?.total), color: (index === 1 && String(player?.color || '').toLowerCase() === '#398b72') ? PLAYER_COLORS[1] : safeColor(player?.color, PLAYER_COLORS[index % PLAYER_COLORS.length]) };
      });
      const endMode = ['free', 'rounds', 'score'].includes(saved.endMode) ? saved.endMode : 'free';
      const winnerRule = saved.winnerRule === 'low' ? 'low' : 'high';
      const savedScoreTarget = safeInteger(Math.abs(Number(saved.limit)), 500, 1, 999999);
      const limit = endMode === 'score' && winnerRule === 'low' ? -savedScoreTarget : safeInteger(saved.limit, 7, 1, 999999);
      const history = Array.isArray(saved.history) ? saved.history.slice(-500).map((round, index) => ({
        round: safeInteger(round?.round, index + 1, 1, 999999),
        scores: Array.isArray(round?.scores) ? round.scores.filter((item) => players.some((player) => player.id === item?.id)).map((item) => ({ id: item.id, points: safeSignedInteger(item.points) })) : [],
      })) : [];
      const finished = saved.finished === true;
      const inferredReason = endMode === 'rounds' ? 'rounds' : endMode === 'score' && players.some((player) => reachedScoreLimit(player.total, limit, winnerRule)) ? 'score' : 'manual';
      const finishReason = ['rounds', 'score', 'manual'].includes(saved.finishReason) ? saved.finishReason : (finished ? inferredReason : null);
      return { players, viewMode: saved.viewMode === 'solo' ? 'solo' : 'table', endMode, winnerRule, limit, roundNumber: safeInteger(saved.roundNumber, history.length + 1, 1, 1000000), history, finished, finishReason, soloSide: saved.soloSide === 'right' ? 'right' : 'left', fifthSide: saved.fifthSide === 'left' ? 'left' : 'right' };
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

  function setPreferredOrientation(viewId) {
    if (!window.matchMedia('(max-width: 900px)').matches || !navigator.maxTouchPoints) return;
    const orientation = screen.orientation;
    if (!orientation || typeof orientation.lock !== 'function') return;
    const target = viewId === 'game-view' && game?.viewMode !== 'solo' ? 'landscape' : 'portrait';
    orientation.lock(target).catch(() => {});
  }

  function showView(viewId) {
    setPreferredOrientation(viewId);
    views.forEach((view) => {
      const active = view.id === viewId;
      view.hidden = !active;
      view.classList.toggle('active', active);
    });
    document.body.classList.toggle('game-open', viewId === 'game-view');
    document.body.classList.toggle('game-solo-open', viewId === 'game-view' && game?.viewMode === 'solo');
    document.body.classList.toggle('entry-open', viewId === 'round-view');
    $('#new-game-button').hidden = viewId !== 'round-view';
    $('#edit-game-button').hidden = viewId !== 'round-view' || !game;
    const navVisible = ['setup-view', 'game-view', 'continue-games-view', 'gamebox-view'].includes(viewId);
    $('#app-nav').hidden = !navVisible;
    document.querySelectorAll('[data-app-view]').forEach((tab) => tab.classList.toggle('active', tab.dataset.appView === (viewId === 'continue-games-view' || viewId === 'gamebox-view' ? viewId : 'setup-view')));
    if (viewId === 'continue-games-view') renderSavedDigitalGames();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }


  const DIGITAL_GAMES_KEY = 'rundenheld.digitalGames.v1';
  function loadSavedDigitalGames() {
    try {
      const value = JSON.parse(localStorage.getItem(DIGITAL_GAMES_KEY) || '[]');
      return Array.isArray(value) ? value.filter((item) => item && typeof item.id === 'string' && typeof item.title === 'string').slice(0, 3) : [];
    } catch { return []; }
  }
  function renderSavedDigitalGames() {
    const list = $('#saved-games-list');
    if (!list) return;
    const saved = loadSavedDigitalGames();
    list.replaceChildren();

    // The main Scoreboard game is saved separately; show it here as a real resumable game.
    const resumableScoreGame = game && !game.finished;
    if (resumableScoreGame) {
      const card = document.createElement('article'); card.className = 'saved-game-card';
      const details = document.createElement('div'); details.className = 'saved-game-details';
      const title = document.createElement('h2'); title.textContent = 'Punktespiel';
      const players = document.createElement('p');
      players.textContent = game.players.map((player) => player.name).join(' · ');
      const progress = document.createElement('p');
      progress.textContent = game.endMode === 'rounds'
        ? `Runde ${Math.min(game.roundNumber, game.limit)} von ${game.limit}`
        : `Runde ${game.roundNumber}`;
      details.append(title, players, progress);
      const resume = document.createElement('button'); resume.type = 'button'; resume.className = 'primary-button'; resume.textContent = 'Fortsetzen';
      resume.addEventListener('click', () => { renderGame(); showView('game-view'); });
      card.append(details, resume); list.append(card);
    }

    saved.forEach((item) => {
      const card = document.createElement('article'); card.className = 'saved-game-card';
      const title = document.createElement('h2'); title.textContent = item.title;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary-button'; remove.textContent = 'Löschen';
      remove.addEventListener('click', () => {
        const next = loadSavedDigitalGames().filter((entry) => entry.id !== item.id);
        try { localStorage.setItem(DIGITAL_GAMES_KEY, JSON.stringify(next)); } catch {}
        renderSavedDigitalGames();
      });
      card.append(title, remove); list.append(card);
    });

    const count = (resumableScoreGame ? 1 : 0) + saved.length;
    const countBadge = $('#saved-game-count');
    if (countBadge) {
      countBadge.hidden = count === 0;
      countBadge.textContent = String(count);
    }
    if (count === 0) {
      const empty = document.createElement('div'); empty.className = 'saved-games-empty';
      const title = document.createElement('h2'); title.textContent = 'Noch keine angefangenen Spiele';
      const copy = document.createElement('p'); copy.textContent = 'Dein laufendes Punktespiel erscheint hier automatisch. Weitere Spiele kommen dazu, sobald sie in der Spielekiste spielbar sind.';
      empty.append(title, copy); list.append(empty);
    }
  }
  document.querySelectorAll('[data-app-view]').forEach((tab) => tab.addEventListener('click', () => {
    const target = tab.dataset.appView;
    if (target === 'setup-view') {
      // The Scoreboard tab always returns to the landing/setup screen.
      // Resume an existing score game explicitly from the Fortfahren tab.
      renderSetupPlayers();
      showView('setup-view');
    } else showView(target);
  }));

  function makePlayerRow(player, index, onRemove, canRemove = true) {
    const row = document.createElement('div');
    row.className = 'player-row';
    const number = document.createElement('span');
    number.className = 'player-number';
    number.textContent = String(index + 1).padStart(2, '0');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'player-name-input';
    input.maxLength = 32;
    input.autocomplete = 'off';
    input.value = player.name;
    input.setAttribute('aria-label', `Name für Spieler ${index + 1}`);
    input.addEventListener('input', () => { player.name = input.value.slice(0, 32); player.autoName = input.value.trim() === ''; });
    const colorLabel = document.createElement('label');
    colorLabel.className = 'player-color-picker';
    colorLabel.title = `Farbe für ${player.name || `Spieler ${index + 1}`}`;
    colorLabel.setAttribute('aria-label', `Farbe für Spieler ${index + 1}`);
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'player-color-input';
    colorInput.value = safeColor(player.color, PLAYER_COLORS[index % PLAYER_COLORS.length]);
    colorInput.setAttribute('aria-label', `Farbe für Spieler ${index + 1}`);
    colorInput.addEventListener('input', () => { player.color = safeColor(colorInput.value, PLAYER_COLORS[index % PLAYER_COLORS.length]); });
    colorLabel.append(colorInput);
    const remove = document.createElement('button');
    remove.className = 'remove-player';
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `${player.name || `Spieler ${index + 1}`} entfernen`);
    remove.disabled = !canRemove;
    remove.addEventListener('click', () => onRemove(index));
    row.append(number, input, colorLabel, remove);
    return row;
  }

  function renumberDefaultPlayers(players) {
    players.forEach((player, index) => {
      // The displayed name is the source of truth: preserve custom names and
      // update generated labels like "Spieler 3" after a deletion.
      if (/^Spieler\s+\d+$/i.test(String(player.name ?? '').trim())) {
        player.name = `Spieler ${index + 1}`;
        player.autoName = true;
      }
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
    syncSetupLayoutOptions();
  }

  let setupPlayers = defaultPlayers();

  function sizeSideScoreCards() {
    document.querySelectorAll('#game-view .score-card-side').forEach((card) => {
      const inner = card.querySelector('.score-card-content-inner');
      if (!inner || !card.clientWidth || !card.clientHeight) return;
      // Give the content the card's dimensions swapped before rotating it.
      // This avoids relying on container query units on mobile browsers.
      inner.style.width = `${card.clientHeight}px`;
      inner.style.height = `${card.clientWidth}px`;
    });
  }

  function renderGame() {
    if (!game) return;
    $('#round-label').textContent = game.endMode === 'rounds' ? `RUNDE ${Math.min(game.roundNumber, game.limit)} VON ${game.limit}` : `RUNDE ${game.roundNumber}`;
    const beginButton = $('#begin-round');
    beginButton.disabled = game.finished;
    beginButton.setAttribute('aria-label', game.finished ? 'Spiel beendet' : `Runde ${game.roundNumber} zählen`);
    $('#round-card-title').textContent = game.finished ? 'Spiel beendet' : 'Zählen beginnen';
    const scores = $('#score-grid');
    const startCard = beginButton;
    scores.replaceChildren();
    const soloView = game.viewMode === 'solo';
    const soloColumns = game.players.length === 2 ? 1 : 2;
    const soloRows = Math.ceil(game.players.length / soloColumns);
    const layout = soloView ? { columns: soloColumns, rows: soloRows, seats: game.players.map((_, index) => [Math.floor(index / soloColumns) + 1, index % soloColumns + 1]), center: 'overlay' } : boardLayout(game.players.length, game.soloSide, game.fifthSide);
    scores.dataset.viewMode = soloView ? 'solo' : 'table';
    scores.dataset.playerCount = String(game.players.length);
    scores.dataset.layout = game.players.length === 3 ? `three-${game.soloSide}` : game.players.length === 5 ? `five-${game.fifthSide}` : String(game.players.length);
    scores.style.gridTemplateColumns = layout.columnTemplate || `repeat(${layout.columns}, minmax(0, 1fr))`;
    scores.style.gridTemplateRows = soloView ? `repeat(${layout.rows}, minmax(0, 1fr)) auto` : `repeat(${layout.rows}, minmax(0, 1fr))`;
    const seatPositions = layout.seats;
    game.players.forEach((player, index) => {
      const card = document.createElement('article');
      card.className = 'score-card';
      card.dataset.playerId = player.id;
      if (rotatedScoreTiles.has(player.id)) card.classList.add('is-rotated');
      card.style.gridRow = String(seatPositions[index][0]);
      card.style.gridColumn = soloView && game.players.length % 2 === 1 && index === game.players.length - 1 && game.players.length > 1 ? '1 / span 2' : String(seatPositions[index][1]);
      if (soloView && game.players.length === 2) card.style.gridColumn = '1';
      if (soloView && game.players.length % 2 === 1 && index === game.players.length - 1 && game.players.length > 1) card.classList.add('score-card-solo-last');
      if (layout.sideIndexes?.includes(index)) card.classList.add('score-card-side');
      card.classList.add(`player-color-${index % 12}`);
      card.style.setProperty('--player', safeColor(player.color, PLAYER_COLORS[index % PLAYER_COLORS.length]));
      const top = document.createElement('div'); top.className = 'score-card-top';
      const dot = document.createElement('span'); dot.className = 'score-dot'; dot.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span'); name.className = 'score-name'; name.textContent = player.name;
      top.append(dot, name);
      const total = document.createElement('div'); total.className = 'score-value'; total.textContent = player.total.toLocaleString('de-DE');
      const bottom = document.createElement('div'); bottom.className = 'score-card-bottom'; bottom.textContent = game.history.length ? `${game.history.length} ${game.history.length === 1 ? 'Runde' : 'Runden'} gespielt` : 'Noch keine Punkte';
      if (layout.sideIndexes?.includes(index)) {
        const side = game.players.length === 5 ? game.fifthSide : (index === 2 ? 'left' : 'right');
        card.classList.add(`score-card-side-${side}`);
        card.style.setProperty('--side-rotation', side === 'left' ? '-90deg' : '90deg');
        const content = document.createElement('div'); content.className = 'score-card-content';
        const inner = document.createElement('div'); inner.className = 'score-card-content-inner';
        inner.append(top, total);
        content.append(inner);
        card.append(content);
      } else {
        card.append(top, total, bottom);
      }
      scores.append(card);
    });
    if (soloView) {
      startCard.style.gridRow = String(layout.rows + 1);
      startCard.style.gridColumn = '1 / -1';
      startCard.style.position = 'static';
      startCard.style.left = '';
      startCard.style.top = '';
      startCard.style.transform = '';
    } else if (layout.center === 'overlay') {
      startCard.style.gridRow = '';
      startCard.style.gridColumn = '';
      startCard.style.position = 'absolute';
      startCard.style.left = '50%';
      startCard.style.top = '50%';
      startCard.style.transform = 'translate(-50%, -50%)';
    } else {
      startCard.style.position = 'static';
      startCard.style.left = '';
      startCard.style.top = '';
      startCard.style.transform = '';
      startCard.style.gridRow = layout.center;
      startCard.style.gridColumn = layout.center;
    }
    scores.append(startCard);
    requestAnimationFrame(sizeSideScoreCards);
    const banner = $('#winner-banner');
    banner.hidden = !game.finished;
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
    panel.hidden = !game.history.some((round) => round.scores.some((score) => score.points !== 0));
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
    $('#score-entry').textContent = entryValue === '-' ? '−0' : entryValue || '0';
    $('#progress-bar').value = (entryIndex / game.players.length) * 100;
    $('#skip-player').textContent = `Überspringen`;
  }

  function finishPlayer() {
    if (!game || entryIndex >= game.players.length) return;
    pendingScores[entryIndex].points = safeSignedInteger(entryValue, 0);
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
      const input = document.createElement('input'); input.type = 'number'; input.inputMode = 'numeric'; input.min = String(-MAX_POINTS); input.max = String(MAX_POINTS); input.step = '1'; input.value = String(pendingScores[index]?.points ?? 0); input.dataset.playerId = player.id; input.setAttribute('aria-label', `Punkte für ${player.name}`);
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
    const scores = inputs.map((input) => ({ id: input.dataset.playerId, points: safeSignedInteger(input.value) }));
    scores.forEach((score) => {
      const player = game.players.find((candidate) => candidate.id === score.id);
      if (player) player.total = safeSignedInteger(player.total + score.points);
    });
    game.history.push({ round: game.roundNumber, scores });
    const justFinishedRound = game.roundNumber;
    game.roundNumber += 1;
    if (game.endMode === 'rounds' && justFinishedRound >= game.limit) { game.finished = true; game.finishReason = 'rounds'; }
    if (game.endMode === 'score' && game.players.some((player) => reachedScoreLimit(player.total, game.limit, game.winnerRule))) { game.finished = true; game.finishReason = 'score'; }
    // Persist the completed round immediately, before any view rendering.
    // On reload, the startup logic restores this game directly to game-view.
    saveGame();
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
    syncEditLayoutOptions();
  }

  function syncSetupLayoutOptions() {
    $('#setup-three-layout').hidden = setupPlayers.length !== 3;
    $('#setup-five-layout').hidden = setupPlayers.length !== 5;
  }

  function syncEditLayoutOptions() {
    $('#edit-three-layout').hidden = !editDraft || editDraft.length !== 3;
    $('#edit-five-layout').hidden = !editDraft || editDraft.length !== 5;
  }

  function saveEdit(event) {
    event.preventDefault();
    if (!editDraft || editDraft.length < 2) return;
    const oldIds = new Set(game.players.map((player) => player.id));
    game.players = editDraft.map((player, index) => ({ ...player, name: cleanName(player.name, `Spieler ${index + 1}`), total: safeSignedInteger(player.total) }));
    game.soloSide = $('#edit-solo-side').value;
    game.fifthSide = $('#edit-fifth-side').value;
    game.viewMode = $('#edit-view-mode').value === 'solo' ? 'solo' : 'table';
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
    if (game) setupPlayers = game.players.map((player) => ({ id: makeId(), name: player.name, autoName: player.autoName === true, total: 0, color: safeColor(player.color) }));
    if (game) {
      document.querySelector(`input[name="winner-rule"][value="${game.winnerRule}"]`).checked = true;
      $('#setup-solo-side').value = game.soloSide || 'left';
      $('#setup-fifth-side').value = game.fifthSide || 'right';
    }
    updateScoreTargetBounds();
    toggleLiveStandings(false);
    renderSetupPlayers();
    showView('setup-view');
  }

  $('#add-player').addEventListener('click', () => {
    if (setupPlayers.length >= MAX_PLAYERS) return;
    setupPlayers.push({ id: makeId(), name: `Spieler ${setupPlayers.length + 1}`, autoName: true, total: 0, color: PLAYER_COLORS[setupPlayers.length % PLAYER_COLORS.length] }); renderSetupPlayers();
    $('#player-list').lastElementChild?.querySelector('input')?.focus();
  });
  document.querySelectorAll('input[name="end-mode"]').forEach((input) => input.addEventListener('change', () => {
    $('#rounds-detail').hidden = input.value !== 'rounds' || !input.checked;
    $('#score-detail').hidden = input.value !== 'score' || !input.checked;
  }));
  function updateScoreTargetBounds() {
    const lowestWins = $('input[name="winner-rule"]:checked').value === 'low';
    const field = $('#score-limit');
    field.min = lowestWins ? '-999999' : '1';
    field.max = lowestWins ? '-1' : '999999';
    const current = Number(field.value);
    if (lowestWins && current >= 0) field.value = String(-(current || 500));
    if (!lowestWins && current <= 0) field.value = String(Math.abs(current) || 500);
    $('#score-detail label').textContent = lowestWins ? 'Negatives Punktziel' : 'Punktziel';
  }
  document.querySelectorAll('input[name="winner-rule"]').forEach((input) => input.addEventListener('change', updateScoreTargetBounds));
  updateScoreTargetBounds();

  $('#setup-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (setupPlayers.length < 2) return;
    const mode = $('input[name="end-mode"]:checked').value;
    const limitInput = mode === 'rounds' ? $('#round-limit') : $('#score-limit');
    if (mode !== 'free' && !limitInput.validity.valid) { limitInput.focus(); return; }
    const winnerRule = $('input[name="winner-rule"]:checked').value;
    game = { viewMode: game?.viewMode === 'solo' ? 'solo' : 'table', players: setupPlayers.map((player, index) => ({ id: player.id, name: cleanName(player.name, `Spieler ${index + 1}`), autoName: player.autoName === true, total: 0, color: safeColor(player.color, PLAYER_COLORS[index % PLAYER_COLORS.length]) })), endMode: mode, winnerRule, limit: mode === 'free' ? 0 : (mode === 'score' && winnerRule === 'low' ? safeSignedInteger(limitInput.value, -500, -999999, -1) : safeInteger(limitInput.value, 1, 1, 999999)), roundNumber: 1, history: [], finished: false, finishReason: null, soloSide: $('#setup-solo-side').value, fifthSide: $('#setup-fifth-side').value };
    renderGame(); showView('game-view');
  });
  const rotatedScoreTiles = new Set();
  $('#score-grid').addEventListener('click', (event) => {
    const card = event.target.closest('.score-card');
    if (!card) return;
    const playerId = card.dataset.playerId;
    if (!playerId) return;
    if (rotatedScoreTiles.has(playerId)) {
      rotatedScoreTiles.delete(playerId);
      card.classList.remove('is-rotated');
    } else {
      rotatedScoreTiles.add(playerId);
      card.classList.add('is-rotated');
    }
  });
  $('#begin-round').addEventListener('click', beginRound);
  $('#show-standings-button').addEventListener('click', () => toggleLiveStandings(true));
  $('#close-ranking').addEventListener('click', () => toggleLiveStandings(false));
  $('#continue-game').addEventListener('click', () => {
    const roundsInput = $('#continue-round-limit');
    const scoreInput = $('#continue-score-limit');
    roundsInput.value = '3';
    scoreInput.min = game.winnerRule === 'low' ? String(-MAX_POINTS) : '1';
    scoreInput.max = game.winnerRule === 'low' ? '-1' : String(MAX_POINTS);
    scoreInput.value = String(game.winnerRule === 'low' ? Math.max(-MAX_POINTS, Math.min(...game.players.map((player) => player.total)) - 100) : Math.min(MAX_POINTS, Math.max(...game.players.map((player) => player.total), 0) + 100));
    document.querySelector('input[name="continue-mode"][value="free"]').checked = true;
    $('#continue-rounds-detail').hidden = true;
    $('#continue-score-detail').hidden = true;
    $('#continue-dialog').showModal();
  });
  document.querySelectorAll('input[name="continue-mode"]').forEach((input) => input.addEventListener('change', () => {
    $('#continue-rounds-detail').hidden = input.value !== 'rounds' || !input.checked;
    $('#continue-score-detail').hidden = input.value !== 'score' || !input.checked;
  }));
  $('#continue-close').addEventListener('click', () => $('#continue-dialog').close());
  $('#continue-cancel').addEventListener('click', () => $('#continue-dialog').close());
  $('#continue-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const mode = $('input[name="continue-mode"]:checked').value;
    if (mode === 'rounds' && !$('#continue-round-limit').validity.valid) { $('#continue-round-limit').focus(); return; }
    if (mode === 'score' && !$('#continue-score-limit').validity.valid) { $('#continue-score-limit').focus(); return; }
    game.endMode = mode;
    if (mode === 'free') game.limit = 0;
    if (mode === 'rounds') game.limit = game.roundNumber - 1 + safeInteger($('#continue-round-limit').value, 3, 1, 999);
    if (mode === 'score') game.limit = game.winnerRule === 'low' ? safeSignedInteger($('#continue-score-limit').value, -100, -MAX_POINTS, -1) : safeInteger($('#continue-score-limit').value, 500, 1, MAX_POINTS);
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
      const digits = entryValue.replace('-', '');
      if (digits.length < String(MAX_POINTS).length) entryValue = `${entryValue}${button.dataset.digit}`.replace(/^-?0+(?=\d)/, (match) => match.startsWith('-') ? '-' : '');
    } else if (button.dataset.action === 'backspace') entryValue = entryValue.slice(0, -1);
    else if (button.dataset.action === 'sign') entryValue = entryValue.startsWith('-') ? entryValue.slice(1) : `-${entryValue}`;
    renderEntry();
  });
  document.addEventListener('keydown', (event) => {
    if ($('#round-view').hidden) return;
    if (/^\d$/.test(event.key) && entryValue.replace('-', '').length < String(MAX_POINTS).length) { entryValue = `${entryValue}${event.key}`.replace(/^-?0+(?=\d)/, (match) => match.startsWith('-') ? '-' : ''); renderEntry(); }
    else if ((event.key === '-' || event.key === '+') && !$('#round-view').hidden) { entryValue = entryValue.startsWith('-') ? entryValue.slice(1) : `-${entryValue}`; renderEntry(); }
    else if (event.key === 'Backspace') { entryValue = entryValue.slice(0, -1); renderEntry(); }
    else if (event.key === 'Enter') finishPlayer();
    else if (event.key === 'Escape') { pendingScores = []; renderGame(); showView('game-view'); }
  });
  $('#confirm-round').addEventListener('click', confirmRound);
  $('#back-to-entry').addEventListener('click', () => { entryIndex = 0; entryValue = String(pendingScores[0]?.points || ''); renderEntry(); showView('round-view'); });
  $('#reset-player-appearance').addEventListener('click', () => {
    if (!window.confirm('Alle Spielernamen und Farben auf Standard zurücksetzen?')) return;
    setupPlayers.forEach((player, index) => {
      player.name = `Spieler ${index + 1}`;
      player.autoName = true;
      player.color = PLAYER_COLORS[index % PLAYER_COLORS.length];
    });
    renderSetupPlayers();
  });
  $('#edit-reset-player-appearance').addEventListener('click', () => {
    if (!editDraft || !window.confirm('Alle Spielernamen und Farben auf Standard zurücksetzen?')) return;
    editDraft.forEach((player, index) => {
      player.name = `Spieler ${index + 1}`;
      player.autoName = true;
      player.color = PLAYER_COLORS[index % PLAYER_COLORS.length];
    });
    renderEditList();
  });
  $('#new-game-button').addEventListener('click', startNewGame);
  $('#edit-game-button').addEventListener('click', () => {
    editDraft = game.players.map((player) => ({ ...player }));
    $('#edit-solo-side').value = game.soloSide || 'left';
    $('#edit-fifth-side').value = game.fifthSide || 'right';
    $('#edit-view-mode').value = game.viewMode === 'solo' ? 'solo' : 'table';
    renderEditList(); syncEditLayoutOptions(); $('#edit-dialog').showModal();
  });
  $('#setup-solo-side').addEventListener('change', () => {});
  $('#setup-fifth-side').addEventListener('change', () => {});
  $('#edit-solo-side').addEventListener('change', () => {});
  $('#edit-fifth-side').addEventListener('change', () => {});
  $('#edit-add-player').addEventListener('click', () => {
    if (editDraft.length >= MAX_PLAYERS) return;
    editDraft.push({ id: makeId(), name: `Spieler ${editDraft.length + 1}`, autoName: true, total: 0 }); renderEditList();
    $('#edit-player-list').lastElementChild?.querySelector('input')?.focus();
  });
  $('#edit-form').addEventListener('submit', (event) => { if (event.submitter?.id === 'save-edit') saveEdit(event); });


  // Schiffe versenken: eigenständiges, lokal gespeichertes Pass-and-Play-Spiel.
  const SHIPS_STORAGE_KEY = 'rundenheld.ships.v1';
  const SHIP_TYPES = [
    { name: 'Flugzeugträger', length: 5 }, { name: 'Schlachtschiff', length: 4 },
    { name: 'Kreuzer', length: 3 }, { name: 'U-Boot', length: 3 }, { name: 'Zerstörer', length: 2 }
  ];
  const SHIP_LETTERS = 'ABCDEFGHIJ';
  let shipsGame = loadShipsGame();
  let shipsOrientation = 'h';
  let selectedShipIndex = 0;
  function newShipsPlayer(name) { return { name, ships: [], shots: Array(100).fill('') }; }
  function loadShipsGame() {
    try {
      const raw = JSON.parse(localStorage.getItem(SHIPS_STORAGE_KEY) || 'null');
      if (!raw || !Array.isArray(raw.players) || raw.players.length !== 2 || !['setup','playing','finished'].includes(raw.phase)) return null;
      return raw;
    } catch { return null; }
  }
  function saveShipsGame() {
    try { if (shipsGame) localStorage.setItem(SHIPS_STORAGE_KEY, JSON.stringify(shipsGame)); } catch {}
  }
  function makeShipsGame() {
    shipsGame = { phase: 'setup', setupPlayer: 0, turn: 0, winner: null, players: [newShipsPlayer('Spieler 1'), newShipsPlayer('Spieler 2')] };
    shipsOrientation = 'h'; selectedShipIndex = 0; saveShipsGame(); renderShipsGame();
  }
  function occupiedCells(ship) {
    return Array.from({ length: ship.length }, (_, i) => ship.orientation === 'h' ? ship.row * 10 + ship.col + i : (ship.row + i) * 10 + ship.col);
  }
  function shipCells(player) {
    const cells = new Map();
    player.ships.forEach((ship, i) => occupiedCells(ship).forEach(cell => cells.set(cell, i)));
    return cells;
  }
  function canPlaceShip(player, row, col, length, orientation) {
    if (orientation === 'h' ? col + length > 10 : row + length > 10) return false;
    const occupied = shipCells(player);
    return Array.from({ length }, (_, i) => orientation === 'h' ? row * 10 + col + i : (row + i) * 10 + col).every(cell => !occupied.has(cell));
  }
  function randomizeFleet(player) {
    player.ships = [];
    for (const type of SHIP_TYPES) {
      let placed = false, tries = 0;
      while (!placed && tries++ < 500) {
        const orientation = Math.random() < .5 ? 'h' : 'v';
        const row = Math.floor(Math.random() * 10), col = Math.floor(Math.random() * 10);
        if (canPlaceShip(player, row, col, type.length, orientation)) {
          player.ships.push({ ...type, row, col, orientation }); placed = true;
        }
      }
    }
  }
  function renderShipsGrid(container, player, mode, playerIndex, displayedShots = player.shots) {
    container.replaceChildren();
    const occupied = shipCells(player);
    for (let row = 0; row < 10; row++) for (let col = 0; col < 10; col++) {
      const index = row * 10 + col, cell = document.createElement('button');
      cell.type = 'button'; cell.className = 'ships-cell'; cell.dataset.cell = String(index);
      cell.setAttribute('aria-label', `${SHIP_LETTERS[col]}${row + 1}`);
      const shipIndex = occupied.get(index);
      // Gegnerische Schiffe bleiben im Zielraster verborgen; Treffer werden trotzdem angezeigt.
      if (shipIndex !== undefined && mode !== 'target') {
        cell.classList.add('has-ship', `ship-kind-${shipIndex}`);
        if (mode === 'placement') cell.dataset.shipIndex = String(shipIndex);
      }
      if (displayedShots[index] === 'hit') { cell.classList.add('shot-hit'); cell.textContent = '✕'; }
      else if (displayedShots[index] === 'miss') { cell.classList.add('shot-miss'); cell.textContent = '•'; }
      if (mode === 'placement') cell.title = `${SHIP_LETTERS[col]}${row + 1} platzieren`;
      else {
        cell.disabled = mode !== 'target' || displayedShots[index] !== '';
        if (displayedShots[index] === '') cell.classList.add('targetable');
      }
      container.append(cell);
    }
    container.dataset.playerIndex = String(playerIndex);
    container.dataset.mode = mode;
  }
  function renderShipsGame() {
    const root = $('#ships-game-view');
    if (!root || !shipsGame) return;
    const status = $('#ships-status'), controls = $('#ships-controls'), boards = $('#ships-boards');
    boards.replaceChildren(); controls.replaceChildren();
    const activePlayer = shipsGame.phase === 'setup' ? shipsGame.setupPlayer : shipsGame.turn;
    if (shipsGame.phase === 'setup') {
      const player = shipsGame.players[activePlayer];
      status.textContent = `${player.name}: Platziere deine Flotte (${player.ships.length}/5 Schiffe)`;
      const help = document.createElement('p'); help.className = 'ships-help';
      help.textContent = player.ships.length === 5
        ? 'Deine Flotte ist vollständig. Du kannst Schiffe oben auswählen und hierher verschieben.'
        : 'Ziehe ein Schiff von oben aufs Raster. Platziere die Schiffe in beliebiger Reihenfolge; bereits platzierte kannst du erneut verschieben.';
      controls.append(help);
      const tray = document.createElement('div'); tray.className = 'ships-tray';
      const trayTitle = document.createElement('div'); trayTitle.className = 'ships-tray-title'; trayTitle.textContent = 'DEINE SCHIFFE · ZIEH EINS AUFS FELD'; tray.append(trayTitle);
      const shipRow = document.createElement('div'); shipRow.className = 'ships-tray-row';
      SHIP_TYPES.forEach((type, typeIndex) => {
        const placed = player.ships.some(ship => ship.name === type.name);
        const shipCard = document.createElement('button'); shipCard.type = 'button';
        shipCard.className = 'ships-tray-ship' + (placed ? ' is-placed' : '') + (selectedShipIndex === typeIndex ? ' is-selected' : '');
        // Auch platzierte Schiffe bleiben auswählbar, damit man sie neu positionieren kann.
        shipCard.disabled = false; shipCard.draggable = false;
        shipCard.dataset.shipIndex = String(typeIndex);
        shipCard.setAttribute('aria-label', placed ? `${type.name}, platziert – auswählen zum Verschieben` : `${type.name}, ${type.length} Felder, ziehen zum Platzieren`);
        const blocks = document.createElement('span'); blocks.className = 'ships-tray-blocks'; blocks.setAttribute('aria-hidden','true');
        for (let i = 0; i < type.length; i++) { const block = document.createElement('i'); blocks.append(block); }
        const label = document.createElement('span'); label.className = 'ships-tray-label'; label.textContent = type.name;
        shipCard.append(blocks, label);
        shipCard.addEventListener('click', () => {
          selectedShipIndex = typeIndex;
          renderShipsGame();
          status.textContent = placed
            ? `${type.name} ausgewählt – tippe auf ein neues Startfeld, um es zu verschieben.`
            : `${type.name} ausgewählt – ziehe es aufs Raster oder tippe auf ein Startfeld.`;
        });
        shipRow.append(shipCard);
      });
      tray.append(shipRow);
      boards.append(tray);
      const orientation = document.createElement('button'); orientation.type = 'button'; orientation.className = 'secondary-button'; orientation.textContent = `Ausrichtung: ${shipsOrientation === 'h' ? 'Waagerecht ↔' : 'Senkrecht ↕'}`;
      orientation.addEventListener('click', () => { shipsOrientation = shipsOrientation === 'h' ? 'v' : 'h'; renderShipsGame(); });
      controls.append(orientation);
      const random = document.createElement('button'); random.type = 'button'; random.className = 'secondary-button'; random.textContent = 'Zufällig platzieren';
      random.addEventListener('click', () => { randomizeFleet(player); selectedShipIndex = SHIP_TYPES.findIndex(type => !player.ships.some(ship => ship.name === type.name)); if (selectedShipIndex < 0) selectedShipIndex = 0; saveShipsGame(); renderShipsGame(); });
      controls.append(random);
      if (player.ships.length) {
        const undo = document.createElement('button'); undo.type = 'button'; undo.className = 'secondary-button'; undo.textContent = 'Letztes Schiff entfernen';
        undo.addEventListener('click', () => { { const removed = player.ships.pop(); selectedShipIndex = Math.max(0, SHIP_TYPES.findIndex(type => type.name === removed?.name)); } saveShipsGame(); renderShipsGame(); }); controls.append(undo);
      }
      const ready = document.createElement('button'); ready.type = 'button'; ready.className = 'primary-button';
      ready.textContent = player.ships.length === 5 ? (activePlayer === 0 ? 'Spieler 1 fertig – weiter zu Spieler 2' : 'Kampf beginnen →') : 'Flotte erst vervollständigen';
      ready.disabled = player.ships.length !== 5;
      ready.addEventListener('click', () => {
        if (activePlayer === 0) shipsGame.setupPlayer = 1;
        else { shipsGame.phase = 'playing'; shipsGame.turn = 0; }
        shipsOrientation = 'h'; selectedShipIndex = 0; saveShipsGame(); renderShipsGame();
      });
      controls.append(ready);
      const gridWrap = document.createElement('section'); gridWrap.className = 'ships-board-wrap';
      const title = document.createElement('h2'); title.textContent = `${player.name}s Flotte`; gridWrap.append(title);
      const grid = document.createElement('div'); grid.className = 'ships-grid';
      renderShipsGrid(grid, player, 'placement', activePlayer);
      const placeAt = index => {
        const type = SHIP_TYPES[selectedShipIndex];
        if (!type) return;
        const existingIndex = player.ships.findIndex(ship => ship.name === type.name);
        if (existingIndex < 0 && player.ships.length >= 5) return;
        const previousShip = existingIndex >= 0 ? player.ships.splice(existingIndex, 1)[0] : null;
        const row = Math.floor(index / 10), col = index % 10;
        if (!canPlaceShip(player, row, col, type.length, shipsOrientation)) {
          if (previousShip) player.ships.splice(existingIndex, 0, previousShip);
          status.textContent = 'Dort passt das Schiff nicht hin. Es bleibt an seiner bisherigen Position.';
          return;
        }
        player.ships.push({ ...type, row, col, orientation: shipsOrientation });
        const nextUnplaced = SHIP_TYPES.findIndex(candidate => !player.ships.some(ship => ship.name === candidate.name));
        selectedShipIndex = nextUnplaced >= 0 ? nextUnplaced : selectedShipIndex;
        saveShipsGame(); renderShipsGame();
      };
      // Echtes Touch-/Maus-Dragging: Das Schiff folgt dem Finger und rastet
      // beim Loslassen auf dem nächstgelegenen Rasterfeld ein.
      let pointerDrag = null;
      const clearPreview = () => grid.querySelectorAll('.ships-cell').forEach(el => el.classList.remove('ship-preview','ship-preview-invalid'));
      const showPointerPreview = (x, y) => {
        clearPreview();
        const rect = grid.getBoundingClientRect();
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) { if (pointerDrag) pointerDrag.targetIndex = null; return; }
        let index = null, nearest = Infinity;
        grid.querySelectorAll('[data-cell]').forEach(cell => {
          const cellRect = cell.getBoundingClientRect();
          const dx = x - (cellRect.left + cellRect.width / 2), dy = y - (cellRect.top + cellRect.height / 2);
          const distance = dx * dx + dy * dy;
          if (distance < nearest) { nearest = distance; index = Number(cell.dataset.cell); }
        });
        if (index === null) { if (pointerDrag) pointerDrag.targetIndex = null; return; }
        const row = Math.floor(index / 10), col = index % 10, type = SHIP_TYPES[selectedShipIndex];
        const selectedPlaced = player.ships.find(ship => ship.name === type.name);
        if (selectedPlaced) player.ships.splice(player.ships.indexOf(selectedPlaced), 1);
        const valid = canPlaceShip(player, row, col, type.length, shipsOrientation);
        if (selectedPlaced) player.ships.push(selectedPlaced);
        pointerDrag.targetIndex = index;
        for (let i = 0; i < type.length; i++) {
          const r = shipsOrientation === 'h' ? row : row + i, c = shipsOrientation === 'h' ? col + i : col;
          if (r < 10 && c < 10) grid.querySelector(`[data-cell="${r * 10 + c}"]`)?.classList.add(valid ? 'ship-preview' : 'ship-preview-invalid');
        }
      };
      shipRow.querySelectorAll('.ships-tray-ship').forEach(shipCard => {
        shipCard.addEventListener('pointerdown', event => {
          if (event.button !== undefined && event.button !== 0) return;
          const typeIndex = Number(shipCard.dataset.shipIndex);
          if (!Number.isInteger(typeIndex)) return;
          selectedShipIndex = typeIndex;
          const existing = player.ships.find(ship => ship.name === SHIP_TYPES[typeIndex].name);
          if (existing) shipsOrientation = existing.orientation || 'h';
          const ghost = document.createElement('div');
          ghost.className = 'ships-drag-ghost';
          const blocks = document.createElement('span'); blocks.className = 'ships-tray-blocks';
          for (let i = 0; i < SHIP_TYPES[typeIndex].length; i++) { const block = document.createElement('i'); blocks.append(block); }
          ghost.append(blocks); document.body.append(ghost);
          pointerDrag = { pointerId: event.pointerId, ghost, targetIndex: null };
          event.preventDefault();
          const moveGhost = (x, y) => { ghost.style.left = `${x}px`; ghost.style.top = `${y}px`; };
          moveGhost(event.clientX, event.clientY);
          showPointerPreview(event.clientX, event.clientY);
          const onMove = moveEvent => {
            if (!pointerDrag || moveEvent.pointerId !== pointerDrag.pointerId) return;
            moveGhost(moveEvent.clientX, moveEvent.clientY);
            showPointerPreview(moveEvent.clientX, moveEvent.clientY);
          };
          const cancel = cancelEvent => {
            if (!pointerDrag || cancelEvent.pointerId !== pointerDrag.pointerId) return;
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', finish);
            document.removeEventListener('pointercancel', cancel);
            pointerDrag.ghost.remove(); pointerDrag = null; clearPreview(); renderShipsGame();
          };
          const finish = upEvent => {
            if (!pointerDrag || upEvent.pointerId !== pointerDrag.pointerId) return;
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', finish);
            document.removeEventListener('pointercancel', cancel);
            const targetIndex = pointerDrag.targetIndex;
            pointerDrag.ghost.remove(); pointerDrag = null; clearPreview();
            if (targetIndex !== null) placeAt(targetIndex);
            else { renderShipsGame(); status.textContent = 'Ziehe das Schiff auf ein Feld des Rasters.'; }
          };
          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', finish);
          document.addEventListener('pointercancel', cancel);
        });
      });
      // Ein platziertes Schiff direkt auf dem Raster greifen und ziehen.
      grid.querySelectorAll('.ships-cell[data-ship-index]').forEach(cell => {
        cell.addEventListener('pointerdown', event => {
          if (event.button !== undefined && event.button !== 0) return;
          const ship = player.ships[Number(cell.dataset.shipIndex)];
          if (!ship) return;
          selectedShipIndex = SHIP_TYPES.findIndex(type => type.name === ship.name);
          shipsOrientation = ship.orientation || 'h';
          const ghost = document.createElement('div');
          ghost.className = 'ships-drag-ghost';
          const blocks = document.createElement('span'); blocks.className = 'ships-tray-blocks';
          for (let i = 0; i < ship.length; i++) { const block = document.createElement('i'); blocks.append(block); }
          ghost.append(blocks); document.body.append(ghost);
          pointerDrag = { pointerId: event.pointerId, ghost, targetIndex: null };
          event.preventDefault();
          const moveGhost = (x, y) => { ghost.style.left = `${x}px`; ghost.style.top = `${y}px`; };
          moveGhost(event.clientX, event.clientY);
          showPointerPreview(event.clientX, event.clientY);
          const onMove = moveEvent => {
            if (!pointerDrag || moveEvent.pointerId !== pointerDrag.pointerId) return;
            moveGhost(moveEvent.clientX, moveEvent.clientY);
            showPointerPreview(moveEvent.clientX, moveEvent.clientY);
          };
          const cancel = cancelEvent => {
            if (!pointerDrag || cancelEvent.pointerId !== pointerDrag.pointerId) return;
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', finish);
            document.removeEventListener('pointercancel', cancel);
            pointerDrag.ghost.remove(); pointerDrag = null; clearPreview(); renderShipsGame();
          };
          const finish = upEvent => {
            if (!pointerDrag || upEvent.pointerId !== pointerDrag.pointerId) return;
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', finish);
            document.removeEventListener('pointercancel', cancel);
            const targetIndex = pointerDrag.targetIndex;
            pointerDrag.ghost.remove(); pointerDrag = null; clearPreview();
            if (targetIndex !== null) placeAt(targetIndex);
            else { renderShipsGame(); status.textContent = 'Ziehe das Schiff auf ein Feld des Rasters.'; }
          };
          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', finish);
          document.addEventListener('pointercancel', cancel);
        });
      });
      grid.addEventListener('click', event => {
        const cell = event.target.closest('[data-cell]');
        if (!cell) return;
        if (cell.dataset.shipIndex !== undefined) return;
        placeAt(Number(cell.dataset.cell));
      });
      grid.addEventListener('dragover', event => {
        const cell = event.target.closest('[data-cell]');
        if (!cell || player.ships.length >= 5) return;
        event.preventDefault();
        const index = Number(cell.dataset.cell), row = Math.floor(index / 10), col = index % 10;
        const type = SHIP_TYPES[Math.min(selectedShipIndex, SHIP_TYPES.length - 1)];
        grid.querySelectorAll('.ships-cell').forEach(el => el.classList.remove('ship-preview','ship-preview-invalid'));
        const selectedPlaced = player.ships.find(ship => ship.name === type.name);
        if (selectedPlaced) player.ships.splice(player.ships.indexOf(selectedPlaced), 1);
        const valid = canPlaceShip(player, row, col, type.length, shipsOrientation);
        if (selectedPlaced) player.ships.push(selectedPlaced);
        for (let i = 0; i < type.length; i++) {
          const r = shipsOrientation === 'h' ? row : row + i, c = shipsOrientation === 'h' ? col + i : col;
          if (r < 10 && c < 10) grid.querySelector(`[data-cell="${r * 10 + c}"]`)?.classList.add(valid ? 'ship-preview' : 'ship-preview-invalid');
        }
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      });
      grid.addEventListener('dragleave', event => { if (!grid.contains(event.relatedTarget)) grid.querySelectorAll('.ships-cell').forEach(el => el.classList.remove('ship-preview','ship-preview-invalid')); });
      grid.addEventListener('drop', event => {
        const cell = event.target.closest('[data-cell]'); if (!cell) return;
        event.preventDefault();
        const dataIndex = Number(event.dataTransfer?.getData('text/plain'));
        if (Number.isInteger(dataIndex) && dataIndex >= 0 && dataIndex < SHIP_TYPES.length) selectedShipIndex = dataIndex;
        placeAt(Number(cell.dataset.cell));
      });
      gridWrap.append(grid); boards.append(gridWrap);
    } else {
      const current = shipsGame.players[shipsGame.turn];
      status.textContent = shipsGame.phase === 'finished' ? `${shipsGame.winner} gewinnt! ⚓` : `${current.name} ist dran – wähle ein Feld auf dem gegnerischen Raster.`;
      shipsGame.players.forEach((player, index) => {
        const wrap = document.createElement('section'); wrap.className = 'ships-board-wrap';
        const title = document.createElement('h2'); title.textContent = index === shipsGame.turn ? `${player.name} · Eigene Flotte` : `${player.name} · Zielraster`;
        wrap.append(title);
        const grid = document.createElement('div'); grid.className = 'ships-grid';
        const isCurrentPlayer = index === shipsGame.turn;
        const shotsToDisplay = isCurrentPlayer ? shipsGame.players[1 - index].shots : shipsGame.players[shipsGame.turn].shots;
        renderShipsGrid(grid, player, isCurrentPlayer ? 'own' : 'target', index, shotsToDisplay);
        if (shipsGame.phase === 'playing' && index !== shipsGame.turn) {
          grid.addEventListener('click', event => {
            const cell = event.target.closest('[data-cell]');
            if (!cell || cell.disabled) return;
            const cellIndex = Number(cell.dataset.cell), actualTarget = shipsGame.players[index], attacker = shipsGame.players[shipsGame.turn];
            attacker.shots[cellIndex] = shipCells(actualTarget).has(cellIndex) ? 'hit' : 'miss';
            if (attacker.shots.filter(value => value === 'hit').length >= 17) { shipsGame.phase = 'finished'; shipsGame.winner = attacker.name; }
            else shipsGame.turn = index;
            saveShipsGame(); renderShipsGame();
          });
        }
        wrap.append(grid); boards.append(wrap);
      });
      const action = document.createElement('button'); action.type = 'button'; action.className = shipsGame.phase === 'finished' ? 'primary-button' : 'secondary-button';
      action.textContent = shipsGame.phase === 'finished' ? 'Neue Partie' : 'Partie neu starten';
      action.addEventListener('click', () => { if (window.confirm('Neue Partie starten? Der aktuelle Spielstand wird ersetzt.')) makeShipsGame(); });
      controls.append(action);
    }
  }
  document.querySelector('.gamebox-ships')?.addEventListener('click', () => {
    if (!shipsGame || shipsGame.phase === 'finished') makeShipsGame();
    else renderShipsGame();
    showView('ships-game-view');
  });
  $('#ships-back-button')?.addEventListener('click', () => showView('gamebox-view'));

  let installPrompt;
  window.addEventListener('resize', sizeSideScoreCards);
  window.addEventListener('orientationchange', () => requestAnimationFrame(sizeSideScoreCards));
  window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); installPrompt = event; $('#install-button').hidden = false; });
  $('#install-button').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $('#install-button').hidden = true;
  });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }

  renderSetupPlayers();
  // Always open on the landing page with the three main tabs visible.
  // The saved score game remains intact and is available from the Scoreboard tab.
  if (game) renderGame();
  showView('setup-view');
})();
