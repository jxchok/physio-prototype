// PhysioAlly prototype — all data is kept on this device via localStorage.
(() => {
  'use strict';

  // Keep the old key so existing users do not lose their first-draft exercises.
  const STORAGE_KEY = 'app_name_physio_first_draft_v1';
  // Supportive, locally stored messages for the header and notifications.
  const QUOTES = [
    'Small steps still count.',
    'Progress takes time. Be kind to yourself.',
    'Consistency matters more than perfection.',
    'Every effort is worth acknowledging.',
    'It is okay to pause when you need to.',
    'Your pace is valid, even when it changes.',
    'Recovery is personal, not a competition.',
    'A gentle routine can still make a difference.',
    'Rest is part of caring for yourself.',
    'Celebrate showing up, not just finishing.',
    'A missed session does not erase your efforts.',
    'You deserve time to look after yourself.',
    'Be patient with your body and yourself.',
    'It is okay to ask for support.',
    'Today may look different from yesterday, and that is okay.',
    'Self-care does not have to be all or nothing.',
    'You are more than an exercise streak.',
    'Notice what went well, however small.',
    'Taking a pause can be a thoughtful choice.',
    'Your well-being deserves space in your schedule.',
    'Progress can be slow and still be meaningful.',
    'You do not have to prove your pain to anyone.',
    'Give yourself credit for what you can do.',
    'Your routine can flex with your day.',
    'Take one manageable step at a time.',
    'Your progress is more than a number.',
    'It is fine to start small and adjust.',
    'Offer yourself the patience you give to others.',
    'Be proud of learning what your body needs.',
    'Some days call for effort; others call for rest.',
    'Small acts of care add up over time.',
    'Your goals should support your well-being.',
    'You can be determined and gentle with yourself.',
    'Choose care over pressure.',
    'It is okay to change plans when you need to.',
    'Your journey does not have to match anyone else\'s.',
    'A supportive routine leaves room for real life.',
    'Asking for help is a strength, not a setback.',
    'You deserve kindness on harder days, too.',
    'Consistency includes knowing when to pause.',
    'There is value in looking after yourself today.',
    'One session does not define your progress.',
    'You can celebrate the effort you made.',
    'Little by little, your habits can grow.',
    'Listen to your body as you plan your day.',
  ];
  // The header changes every three minutes while the page is open.
  const HEADER_QUOTE_INTERVAL_MS = 3 * 60 * 1000;
  const INITIAL_SESSIONS = [
    { id: 'morning', name: 'Morning', time: '09:00', enabled: false, start: '08:45', end: '10:00', interval: 15 },
    { id: 'evening', name: 'Evening', time: '20:00', enabled: false, start: '19:45', end: '21:00', interval: 15 }
  ];
  const DEFAULT = { exercises: [], log: {}, ratings: {}, contacts: [], sessions: INITIAL_SESSIONS, settings: { hourlyOn: false, finalOn: false, finalTime: '22:30' }, quoteIndex: 0, lastHourly: null, lastSent: {}, finalSent: '', paused: {}, snoozedUntil: {}, reasons: {} };
  const $ = id => document.getElementById(id);
  const clone = value => JSON.parse(JSON.stringify(value));
  const pad = n => String(n).padStart(2, '0');
  const dateKey = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const offsetKey = n => { const d = new Date(); return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); };
  const minutes = time => { const [h, m] = String(time).split(':').map(Number); return h * 60 + m; };
  const clockTime = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function createWindow(time) {
    const at = minutes(time);
    return { start: clockTime(Math.max(0, at - 15)), end: clockTime(Math.min(1439, at + 60)) };
  }

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!data || !Array.isArray(data.exercises)) return clone(DEFAULT);
      const loaded = { ...clone(DEFAULT), ...data, settings: { ...DEFAULT.settings, ...(data.settings || {}) } };

      // Migrate the original fixed morning/night reminder settings on first visit.
      if (!Array.isArray(data.sessions)) {
        loaded.sessions = clone(INITIAL_SESSIONS);
        for (const session of loaded.sessions) {
          const originalTime = data.settings?.[`${session.id}Time`] || session.time;
          const window = createWindow(originalTime);
          Object.assign(session, window, { time: originalTime, enabled: Boolean(data.settings?.[`${session.id}On`]) });
        }
      }
      if (!loaded.sessions.length) loaded.sessions = clone(INITIAL_SESSIONS);
      loaded.lastSent = data.lastSent && typeof data.lastSent === 'object' ? data.lastSent : {};
      loaded.paused = data.paused && typeof data.paused === 'object' ? data.paused : {};
      loaded.log = data.log && typeof data.log === 'object' ? data.log : {};
      loaded.ratings = data.ratings && typeof data.ratings === 'object' ? data.ratings : {};
      loaded.contacts = Array.isArray(data.contacts) ? data.contacts.filter(c => c && typeof c.id === 'string' && typeof c.name === 'string') : [];
      loaded.reasons = data.reasons && typeof data.reasons === 'object' ? data.reasons : {};
      loaded.snoozedUntil = data.snoozedUntil && typeof data.snoozedUntil === 'object' ? data.snoozedUntil : {};
      loaded.finalSent = typeof data.finalSent === 'string' ? data.finalSent : '';

      // Convert the original dropdown schedules into selectable session IDs.
      for (const ex of loaded.exercises) {
        if (!Array.isArray(ex.sessionIds)) {
          ex.sessionIds = ex.schedule === 'both' ? ['morning', 'evening'] : [ex.schedule || 'morning'];
        }
      }
      return loaded;
    } catch { return clone(DEFAULT); }
  }

  let state = load();
  let editingId = null;
  let editingContactId = null;
  let toastTimer;
  let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let calendarSelected = dateKey();
  let ratingTarget = null;
  let buddySessionId = null;
  let previewSessionId = null;
  const validVideoId = id => /^[a-zA-Z0-9_-]{11}$/.test(id);
  function youtubeVideoId(url) {
    if (!url) return '';
    try {
      const parsed = new URL(url.trim());
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
      const host = parsed.hostname.toLowerCase();
      let id = '';
      if (host === 'youtu.be' || host === 'www.youtu.be') id = parsed.pathname.split('/')[1];
      else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) {
        const parts = parsed.pathname.split('/').filter(Boolean);
        id = parts[0] === 'watch' ? parsed.searchParams.get('v') : (['shorts', 'embed', 'live'].includes(parts[0]) ? parts[1] : '');
      } else return null;
      return validVideoId(id) ? id : null;
    } catch { return null; }
  }
  function logKey(ex, session) { return `${ex}_${session}`; }
  function sessionIsPaused(id, day = dateKey()) { return Boolean(state.paused[`${day}_${id}`]); }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { showToast('Unable to save data in this browser.'); }
  }
  function activeExercises(day = dateKey()) {
    return state.exercises.filter(ex => ex.createdOn <= day && (!ex.archivedOn || ex.archivedOn > day));
  }
  function sessionExercises(id, day = dateKey()) {
    return activeExercises(day).filter(ex => ex.sessionIds.includes(id));
  }
  function done(day, exerciseId, sessionId) {
    return Boolean(state.log[day]?.[`${exerciseId}_${sessionId}`]);
  }
  function remaining(id, day = dateKey()) {
    return sessionExercises(id, day).filter(ex => !done(day, ex.id, id));
  }
  function counts(day) {
    let total = 0, completed = 0;
    for (const s of state.sessions) {
      for (const ex of sessionExercises(s.id, day)) {
        total++;
        if (done(day, ex.id, s.id)) completed++;
      }
    }
    return { total, completed };
  }
  function streak() {
    const today = counts(dateKey());
    const startingOffset = today.total && today.total === today.completed ? 0 : -1;
    let result = 0;
    for (let i = startingOffset; i > -365; i--) {
      const count = counts(offsetKey(i));
      if (!count.total || count.completed !== count.total) break;
      result++;
    }
    return result;
  }
  function showToast(message) {
    $('toast').textContent = message;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
  }

  function renderToday() {
    const day = dateKey();
    $('date-display').textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const { total, completed } = counts(day);
    $('done-count').textContent = `${completed}/${total}`;
    const days = streak();
    $('streak-count').textContent = `${days} ${days === 1 ? 'day' : 'days'}`;
    const percent = total ? Math.round(100 * completed / total) : 0;
    $('progress-percent').textContent = `${percent}%`;
    $('progress-bar').style.width = `${percent}%`;
    const hasHighPain = Object.values(state.ratings[day] || {}).some(r => r && Number(r.pain) >= 8);
    $('high-pain-support').hidden = !hasHighPain;

    $('today-sessions').innerHTML = state.sessions.map(session => {
      const exercises = sessionExercises(session.id, day);
      const completedHere = exercises.filter(ex => done(day, ex.id, session.id)).length;
      return `<div class="session" id="session-${escapeHtml(session.id)}">
        <div class="session-title">${escapeHtml(session.name)} <span class="session-count">${escapeHtml(session.time)} · ${completedHere}/${exercises.length}</span></div>
        ${exercises.length ? exercises.map(ex => {
          const complete = done(day, ex.id, session.id);
          const rating = state.ratings[day]?.[logKey(ex.id, session.id)];
          const ratingInfo = rating && (rating.pain !== null || rating.difficulty !== null)
            ? `<span class="exercise-rating">${rating.pain !== null ? `Pain ${rating.pain}/10` : ''}${rating.pain !== null && rating.difficulty !== null ? ' · ' : ''}${rating.difficulty !== null ? `Difficulty ${rating.difficulty}/10` : ''}</span>` : '';
          const video = youtubeVideoId(ex.video || '');
          return `<div class="exercise ${complete ? 'exercise-done' : ''}">
            <label class="exercise-main"><input type="checkbox" data-exercise="${escapeHtml(ex.id)}" data-session="${escapeHtml(session.id)}" ${complete ? 'checked' : ''} />
              <span class="exercise-body"><span class="exercise-name">${escapeHtml(ex.name)}</span>${ex.notes ? `<span class="exercise-instruction">${escapeHtml(ex.notes)}</span>` : ''}${ratingInfo}</span>
            </label>
            <div class="exercise-extras">${video ? `<button type="button" class="btn-quiet watch-video" data-video="${video}" data-name="${escapeHtml(ex.name)}">▶ Demo</button>` : ''}${complete ? `<button type="button" class="btn-quiet edit-rating" data-exercise="${escapeHtml(ex.id)}" data-session="${escapeHtml(session.id)}">${ratingInfo ? 'Edit score' : 'Rate'}</button>` : ''}</div>
          </div>`;
        }).join('') : '<div class="empty">No exercises scheduled.</div>'}
      </div>`;
    }).join('');
  }

  function renderCalendar() {
    const year = calendarCursor.getFullYear(), month = calendarCursor.getMonth();
    $('calendar-month').textContent = calendarCursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const first = new Date(year, month, 1);
    const firstWeekday = (first.getDay() + 6) % 7;
    const last = new Date(year, month + 1, 0).getDate();
    let html = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => `<span class="weekday">${d}</span>`).join('');
    for (let i=0; i<firstWeekday; i++) html += '<span class="calendar-blank"></span>';
    for (let day=1; day<=last; day++) {
      const key = `${year}-${pad(month + 1)}-${pad(day)}`;
      const tally = counts(key);
      const future = key > dateKey();
      const scheduled = state.sessions.filter(session => sessionExercises(session.id, key).length);
      const restOrComplete = scheduled.length > 0 && scheduled.every(session =>
        sessionIsPaused(session.id, key) || sessionExercises(session.id, key).every(ex => done(key, ex.id, session.id)));
      const kind = future || !tally.total ? 'empty' : tally.completed === tally.total ? 'completed'
        : restOrComplete ? 'paused' : tally.completed ? 'partial' : key < dateKey() ? 'missed' : 'empty';
      html += `<button type="button" class="calendar-day ${kind} ${key === dateKey() ? 'is-today' : ''} ${key === calendarSelected ? 'selected' : ''}" data-day="${key}" aria-label="${escapeHtml(key)}: ${tally.completed} of ${tally.total} exercises completed" aria-pressed="${key === calendarSelected}">${day}</button>`;
    }
    $('calendar-grid').innerHTML = html;
    const {total,completed} = counts(calendarSelected);
    const selectedLabel = new Date(`${calendarSelected}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
    const pausedCount = state.sessions.filter(s => sessionIsPaused(s.id, calendarSelected) && sessionExercises(s.id,calendarSelected).length).length;
    $('calendar-detail').textContent = `${selectedLabel}: ${total ? `${completed} of ${total} exercises logged` : 'No exercises scheduled'}${pausedCount ? ` · ${pausedCount} session${pausedCount===1?'':'s'} paused` : ''}.`;
    $('next-month').disabled = year === new Date().getFullYear() && month === new Date().getMonth();
  }

  function renderManage() {
    const exercises = activeExercises();
    $('manage-list').innerHTML = exercises.length ? exercises.map(ex => {
      const assigned = state.sessions.filter(s => ex.sessionIds.includes(s.id)).map(s => s.name).join(', ');
      return `<div class="exercise-manage"><div>
        <div class="manage-name">${escapeHtml(ex.name)}</div>
        <div class="manage-meta">${escapeHtml(assigned || 'No sessions')}${youtubeVideoId(ex.video || '') ? ' · Video available' : ''}</div>
        </div><div class="manage-actions">
        <button type="button" class="btn-quiet edit-exercise" data-id="${escapeHtml(ex.id)}">Edit</button>
        <button type="button" class="btn-quiet btn-danger remove-exercise" data-id="${escapeHtml(ex.id)}">Remove</button>
        </div></div>`;
    }).join('') : '<div class="empty">No exercises added yet.<br>Select “+ Add exercise” to begin.</div>';
  }

  function renderExerciseOptions(checkedIds = []) {
    $('exercise-session-options').innerHTML = state.sessions.map(s => `<label class="toggle-row">
      <input type="checkbox" name="exercise-session" value="${escapeHtml(s.id)}" ${checkedIds.includes(s.id) ? 'checked' : ''} />
      ${escapeHtml(s.name)} (${escapeHtml(s.time)})
    </label>`).join('');
  }

  function renderReminders() {
    $('reminder-sessions').innerHTML = state.sessions.map(s => {
      const paused = Boolean(state.paused[`${dateKey()}_${s.id}`]);
      const snoozed = Number(state.snoozedUntil[`${dateKey()}_${s.id}`] || 0) > Date.now();
      return `<form class="reminder-session" data-session="${escapeHtml(s.id)}">
        <div class="reminder-session-heading"><strong>${escapeHtml(s.name)}</strong>
          <button type="button" class="btn-quiet btn-danger remove-session" data-session="${escapeHtml(s.id)}" ${state.sessions.length === 1 ? 'disabled' : ''}>Remove</button>
        </div>
        <div class="two-fields form-grid">
          <label class="field">Name<input name="name" maxlength="40" required value="${escapeHtml(s.name)}" /></label>
          <label class="field">Exercise time<input type="text" class="clock-input" inputmode="none" readonly name="time" required aria-haspopup="dialog" title="Choose a time using the clock" value="${escapeHtml(s.time)}" /></label>
          <label class="field">Repeat from<input type="text" class="clock-input" inputmode="none" readonly name="start" required aria-haspopup="dialog" title="Choose a time using the clock" value="${escapeHtml(s.start)}" /></label>
          <label class="field">Last reminder by<input type="text" class="clock-input" inputmode="none" readonly name="end" required aria-haspopup="dialog" title="Choose a time using the clock" value="${escapeHtml(s.end)}" /></label>
          <label class="field">Repeat every<select name="interval">
            ${[5, 10, 15, 30, 60].map(n => `<option value="${n}" ${Number(s.interval) === n ? 'selected' : ''}>${n} minutes</option>`).join('')}
          </select></label>
        </div>
        <label class="toggle-row"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''} /> Enable reminders</label>
        <div class="form-actions reminder-actions">
          <button type="submit" class="btn btn-secondary">Save settings</button>
          <button type="button" class="btn-quiet toggle-pause" data-session="${escapeHtml(s.id)}">${paused ? 'Resume reminders today' : 'Pause reminders today'}</button>
        </div>
        ${paused ? '<p class="muted paused-note">Reminders are paused until tomorrow.</p>' : ''}
        ${snoozed && !paused ? `<p class="muted paused-note">Snoozed until ${new Date(state.snoozedUntil[`${dateKey()}_${s.id}`]).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}. <button type="button" class="btn-quiet clear-snooze" data-session="${escapeHtml(s.id)}">Resume now</button></p>` : ''}
      </form>`;
    }).join('');
  }

  function renderSettings() {
    $('hourly-on').checked = Boolean(state.settings.hourlyOn);
    $('final-on').checked = Boolean(state.settings.finalOn);
    $('final-time').value = state.settings.finalTime || '22:30';
    $('quote-text').textContent = QUOTES[(state.quoteIndex || 0) % QUOTES.length];
    renderReminders();
  }
  function render() { renderToday(); renderCalendar(); renderManage(); renderSettings(); renderContacts(); }

  function closeExerciseForm() {
    $('exercise-form').hidden = true;
    editingId = null;
    $('exercise-form').reset();
    $('save-btn').textContent = 'Save exercise';
  }
  function openExerciseForm(ex = null) {
    editingId = ex?.id ?? null;
    $('exercise-form').hidden = false;
    $('exercise-name').value = ex?.name ?? '';
    $('exercise-notes').value = ex?.notes ?? '';
    $('exercise-video').value = ex?.video ?? '';
    renderExerciseOptions(ex ? ex.sessionIds : state.sessions.map(s => s.id));
    $('save-btn').textContent = ex ? 'Update exercise' : 'Save exercise';
    $('exercise-name').focus();
  }
  $('add-btn').addEventListener('click', () => {
    if (!$('exercise-form').hidden && !editingId) closeExerciseForm();
    else openExerciseForm();
  });
  $('cancel-btn').addEventListener('click', closeExerciseForm);
  $('exercise-form').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('exercise-name').value.trim();
    const sessionIds = [...document.querySelectorAll('input[name="exercise-session"]:checked')].map(input => input.value);
    if (!name || !sessionIds.length) { showToast('Choose at least one session.'); return; }
    const notes = $('exercise-notes').value.trim();
    const video = $('exercise-video').value.trim();
    if (video && !youtubeVideoId(video)) {
      showToast('Please enter a valid YouTube video URL, or leave it blank.'); return;
    }
    if (editingId) {
      const ex = state.exercises.find(x => x.id === editingId);
      if (ex) Object.assign(ex, { name, notes, video, sessionIds });
    } else {
      state.exercises.push({ id: `ex_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name, notes, video, sessionIds, createdOn: dateKey(), archivedOn: null });
    }
    save(); closeExerciseForm(); render(); showToast('Exercise saved.');
  });
  $('manage-list').addEventListener('click', event => {
    const edit = event.target.closest('.edit-exercise');
    const remove = event.target.closest('.remove-exercise');
    if (!edit && !remove) return;
    const ex = state.exercises.find(x => x.id === (edit || remove).dataset.id);
    if (!ex) return;
    if (edit) openExerciseForm(ex);
    else if (confirm(`Remove “${ex.name}” from your plan?`)) {
      ex.archivedOn = dateKey();
      save(); render(); showToast('Exercise removed.');
    }
  });
  $('today-sessions').addEventListener('change', event => {
    const input = event.target;
    if (!input.matches('input[type="checkbox"]')) return;
    const day = dateKey();
    const key = `${input.dataset.exercise}_${input.dataset.session}`;
    if (!state.log[day]) state.log[day] = {};
    if (input.checked) state.log[day][key] = true;
    else delete state.log[day][key];
    if (!input.checked && state.ratings[day]) delete state.ratings[day][key];
    save(); renderToday(); renderCalendar();
    if (input.checked) openRating(day, key);
    if (input.checked && remaining(input.dataset.session).length === 0) {
      const session = state.sessions.find(s => s.id === input.dataset.session);
      showToast(`${session?.name || 'Session'} complete! No more reminders for this session today.`);
    }
  });

  // Optional per-exercise pain and difficulty rating (never required to check off an exercise).
  for (const id of ['rating-pain','rating-difficulty']) {
    $(id).innerHTML += Array.from({length:11}, (_, i) => `<option value="${i}">${i} / 10</option>`).join('');
  }
  function openRating(day, key) {
    ratingTarget = {day,key};
    const previous = state.ratings[day]?.[key];
    $('rating-pain').value = previous?.pain === null || previous?.pain === undefined ? '' : String(previous.pain);
    $('rating-difficulty').value = previous?.difficulty === null || previous?.difficulty === undefined ? '' : String(previous.difficulty);
    $('rating-dialog').showModal();
  }
  $('today-sessions').addEventListener('click', event => {
    const button = event.target.closest('.edit-rating');
    if (button) openRating(dateKey(), logKey(button.dataset.exercise, button.dataset.session));
  });
  $('rating-form').addEventListener('submit', event => {
    event.preventDefault();
    if (ratingTarget) {
      const {day,key} = ratingTarget;
      if (!state.ratings[day]) state.ratings[day] = {};
      state.ratings[day][key] = {
        pain: $('rating-pain').value === '' ? null : Number($('rating-pain').value),
        difficulty: $('rating-difficulty').value === '' ? null : Number($('rating-difficulty').value)
      };
      save(); renderToday();
    }
    $('rating-dialog').close();
  });
  $('skip-rating').addEventListener('click', () => $('rating-dialog').close());
  $('rating-dialog').addEventListener('close', () => { ratingTarget = null; });

  $('prev-month').addEventListener('click', () => {calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth()-1,1); renderCalendar();});
  $('next-month').addEventListener('click', () => {calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth()+1,1); renderCalendar();});
  $('calendar-grid').addEventListener('click', event => {
    const button = event.target.closest('[data-day]');
    if (button) { calendarSelected = button.dataset.day; renderCalendar(); }
  });

  // Embed only vetted YouTube IDs; do not store local video files or load remote content automatically.
  document.addEventListener('click', event => {
    const button = event.target.closest('.watch-video');
    if (!button || !validVideoId(button.dataset.video)) return;
    $('video-title').textContent = button.dataset.name || 'Exercise demonstration';
    $('video-iframe').src = `https://www.youtube-nocookie.com/embed/${button.dataset.video}`;
    $('video-dialog').showModal();
  });
  $('close-video').addEventListener('click', () => $('video-dialog').close());
  $('video-dialog').addEventListener('close', () => { $('video-iframe').removeAttribute('src'); });

  // Consistent clock-style time picker (no browser-native time input or external library).
  // Values remain HH:mm so existing reminders and locally saved settings are unchanged.
  const clockDialog = $('time-picker');
  const clockFace = $('clock-face');
  let chosenTime = null;

  function timeToParts(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value));
    const h = match ? Math.min(23, Number(match[1])) : 9;
    const m = match ? Math.min(59, Number(match[2])) : 0;
    return { hour: h % 12 || 12, minute: m, period: h < 12 ? 'am' : 'pm' };
  }
  function to24HourTime(t) {
    const h = (t.hour % 12) + (t.period === 'pm' ? 12 : 0);
    return `${pad(h)}:${pad(t.minute)}`;
  }
  function renderClock() {
    if (!chosenTime) return;
    $('pick-hour').textContent = pad(chosenTime.hour);
    $('pick-minute').textContent = pad(chosenTime.minute);
    $('pick-hour').classList.toggle('active', chosenTime.view === 'hour');
    $('pick-minute').classList.toggle('active', chosenTime.view === 'minute');
    $('pick-hour').setAttribute('aria-pressed', String(chosenTime.view === 'hour'));
    $('pick-minute').setAttribute('aria-pressed', String(chosenTime.view === 'minute'));
    for (const [period, id] of [['am', 'pick-am'], ['pm', 'pick-pm']]) {
      $(id).classList.toggle('active', chosenTime.period === period);
      $(id).setAttribute('aria-pressed', String(chosenTime.period === period));
    }
    const choosingHours = chosenTime.view === 'hour';
    $('time-picker-hint').textContent = choosingHours ? 'Choose an hour' : 'Choose a minute (tap between labels for exact minutes)';
    const indicator = choosingHours ? chosenTime.hour % 12 : chosenTime.minute;
    const angle = indicator * Math.PI / (choosingHours ? 6 : 30);
    const handX = 140 + 102 * Math.sin(angle), handY = 140 - 102 * Math.cos(angle);
    const nodes = Array.from({ length: 12 }, (_, index) => {
      const value = choosingHours ? (index || 12) : index * 5;
      const theta = index * Math.PI / 6;
      const x = 140 + 102 * Math.sin(theta), y = 140 - 102 * Math.cos(theta);
      const selected = choosingHours ? chosenTime.hour === value : chosenTime.minute === value;
      return `<button type="button" class="clock-number${selected ? ' selected' : ''}" data-clock-value="${value}" aria-label="${choosingHours ? 'Hour' : 'Minute'} ${value}" aria-pressed="${selected}" style="left:${x / 2.8}%;top:${y / 2.8}%">${choosingHours ? value : pad(value)}</button>`;
    }).join('');
    clockFace.innerHTML = `<svg class="clock-hand" viewBox="0 0 280 280" aria-hidden="true"><line x1="140" y1="140" x2="${handX}" y2="${handY}"/><circle cx="140" cy="140" r="4"/><circle cx="${handX}" cy="${handY}" r="4"/></svg>${nodes}`;
    clockFace.setAttribute('aria-label', choosingHours ? 'Select hour from clock face' : 'Select minute from clock face');
  }
  function chooseDialValue(value) {
    if (!chosenTime) return;
    if (chosenTime.view === 'hour') {
      chosenTime.hour = value || 12;
      chosenTime.view = 'minute';
    } else chosenTime.minute = value;
    renderClock();
  }
  function openClock(input) {
    const parts = timeToParts(input.value);
    chosenTime = { ...parts, view: 'hour', target: input };
    renderClock();
    clockDialog.showModal();
    $('pick-hour').focus();
  }
  // Event delegation also covers the session forms inserted dynamically later.
  document.addEventListener('click', event => {
    const input = event.target.closest('input.clock-input');
    if (input) openClock(input);
  });
  document.addEventListener('keydown', event => {
    if (event.target.matches('input.clock-input') && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openClock(event.target);
    }
  });
  $('pick-hour').addEventListener('click', () => { chosenTime.view = 'hour'; renderClock(); });
  $('pick-minute').addEventListener('click', () => { chosenTime.view = 'minute'; renderClock(); });
  for (const period of ['am', 'pm']) {
    $(`pick-${period}`).addEventListener('click', () => { chosenTime.period = period; renderClock(); });
  }
  clockFace.addEventListener('click', event => {
    const button = event.target.closest('.clock-number');
    if (button) chooseDialValue(Number(button.dataset.clockValue));
  });
  // The ring accepts arbitrary minutes, e.g. 08:47, rather than only multiples of 5.
  clockFace.addEventListener('pointerdown', event => {
    if (!chosenTime || event.target.closest('.clock-number')) return;
    const rect = clockFace.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const radius = Math.hypot(dx, dy);
    if (radius < rect.width * 0.17 || radius > rect.width * 0.5) return;
    const around = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI);
    const steps = chosenTime.view === 'hour' ? 12 : 60;
    let value = Math.round(around / (2 * Math.PI) * steps) % steps;
    if (chosenTime.view === 'hour' && value === 0) value = 12;
    chooseDialValue(value);
  });
  $('cancel-clock').addEventListener('click', () => clockDialog.close());
  $('save-clock').addEventListener('click', () => {
    if (!chosenTime?.target) return;
    chosenTime.target.value = to24HourTime(chosenTime);
    chosenTime.target.dispatchEvent(new Event('change', { bubbles: true }));
    clockDialog.close();
  });
  // Clicking the backdrop or pressing Escape cancels without changing the value.
  clockDialog.addEventListener('click', event => {
    if (event.target === clockDialog) clockDialog.close();
  });
  clockDialog.addEventListener('close', () => {
    const focusTarget = chosenTime?.target;
    chosenTime = null;
    if (focusTarget?.isConnected) focusTarget.focus();
  });

  // Each session can have its own time, repeat window, and reminder interval.
  $('add-session-btn').addEventListener('click', () => { $('add-session-form').hidden = !$('add-session-form').hidden; });
  $('cancel-session-btn').addEventListener('click', () => { $('add-session-form').hidden = true; });
  $('add-session-form').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('new-session-name').value.trim();
    const time = $('new-session-time').value;
    if (!name || !time) return;
    const window = createWindow(time);
    const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    state.sessions.push({ id, name, time, enabled: false, ...window, interval: 15 });
    state.sessions.sort((a, b) => a.time.localeCompare(b.time));
    save();
    $('add-session-form').hidden = true;
    $('new-session-name').value = '';
    render();
    if (!$('exercise-form').hidden) closeExerciseForm();
    showToast('Session added. Assign exercises to it using Edit.');
  });
  $('reminder-sessions').addEventListener('submit', event => {
    const form = event.target.closest('.reminder-session');
    if (!form) return;
    event.preventDefault();
    const session = state.sessions.find(s => s.id === form.dataset.session);
    if (!session) return;
    const fields = new FormData(form);
    const name = String(fields.get('name') || '').trim();
    const time = String(fields.get('time') || '');
    const start = String(fields.get('start') || '');
    const end = String(fields.get('end') || '');
    if (!name || !time || !start || !end || minutes(end) <= minutes(start)) {
      showToast('Choose a reminder end time later than its start time (same day).');
      return;
    }
    Object.assign(session, { name, time, start, end, interval: Number(fields.get('interval')), enabled: fields.has('enabled') });
    state.sessions.sort((a, b) => a.time.localeCompare(b.time));
    // Allow the current time slot to be checked again after an edit; never carry a stale slot.
    delete state.lastSent[`${dateKey()}_${session.id}`];
    save(); render();
    if (!$('exercise-form').hidden) closeExerciseForm();
    showToast('Reminder settings saved.');
  });
  $('reminder-sessions').addEventListener('click', event => {
    const remove = event.target.closest('.remove-session');
    const pause = event.target.closest('.toggle-pause');
    const resumeSnooze = event.target.closest('.clear-snooze');
    if (remove) {
      if (state.sessions.length <= 1) return;
      const session = state.sessions.find(s => s.id === remove.dataset.session);
      if (!session || !confirm(`Remove the ${session.name} session? Exercises will remain in other sessions.`)) return;
      state.sessions = state.sessions.filter(s => s.id !== session.id);
      for (const ex of state.exercises) ex.sessionIds = ex.sessionIds.filter(id => id !== session.id);
      save(); render();
      if (!$('exercise-form').hidden) closeExerciseForm();
      showToast('Session removed.');
    }
    if (resumeSnooze) {
      delete state.snoozedUntil[`${dateKey()}_${resumeSnooze.dataset.session}`];
      save(); renderReminders(); showToast('Snooze cleared.');
    }
    if (pause) {
      const key = `${dateKey()}_${pause.dataset.session}`;
      if (state.paused[key]) delete state.paused[key];
      else state.paused[key] = true;
      save(); renderReminders();
      showToast(state.paused[key] ? 'Reminders paused for today.' : 'Reminders resumed.');
    }
  });

  $('save-final-settings').addEventListener('click', () => {
    state.settings.finalOn = $('final-on').checked;
    state.settings.finalTime = $('final-time').value;
    save(); showToast('Evening check-in preferences saved.');
  });

  $('hourly-on').addEventListener('change', event => {
    state.settings.hourlyOn = event.target.checked;
    state.lastHourly = Date.now();
    save();
  });

  // The on-page pop-up works even if notifications are blocked.
  function previewNotification(title, body) {
    $('preview-title').textContent = title;
    $('preview-body').textContent = body;
    $('notification-preview').hidden = false;
  }
  $('close-preview').addEventListener('click', () => { $('notification-preview').hidden = true; });
  $('preview-open').addEventListener('click', () => {
    $('notification-preview').hidden = true;
    $('today-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  async function askForNotificationPermission() {
    if (!('Notification' in window) || !window.isSecureContext) {
      $('notification-status').textContent = 'System notifications require a supported browser and HTTPS (GitHub Pages is HTTPS). The in-page preview always works.';
      return false;
    }
    try {
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      $('notification-status').textContent = permission === 'granted'
        ? 'Notifications enabled. Timed reminders run while this website is open.'
        : 'System notifications are not enabled. The in-page notification preview still works.';
      return permission === 'granted';
    } catch {
      $('notification-status').textContent = 'Browser notifications are unavailable here. The in-page preview still works.';
      return false;
    }
  }
  function sendSystemNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body }); } catch { /* Some mobile browsers don't support this constructor. */ }
    }
  }
  function randomQuoteIndex(exclude = -1) {
    // Pick randomly, but avoid showing the same header message twice in a row.
    const previous = Number(exclude);
    const validPrevious = Number.isInteger(previous) && previous >= 0 && previous < QUOTES.length;
    if (!validPrevious || QUOTES.length < 2) return Math.floor(Math.random() * QUOTES.length);
    const choice = Math.floor(Math.random() * (QUOTES.length - 1));
    return choice >= previous ? choice + 1 : choice;
  }
  function rotateHeaderQuote() {
    state.quoteIndex = randomQuoteIndex(state.quoteIndex);
    $('quote-text').textContent = QUOTES[state.quoteIndex];
    save();
  }
  function nextQuote() {
    // Reminder messages can vary without changing the header between rotations.
    return QUOTES[randomQuoteIndex(state.quoteIndex)];
  }
  function sendReminder(session, pendingCount, isDemo = false, isLast = false) {
    previewSessionId = session.id || state.sessions[0]?.id || null;
    const title = `PhysioAlly · ${session.name} reminder${isDemo ? ' (demo)' : ''}`;
    const body = pendingCount
      ? `${pendingCount} exercise${pendingCount === 1 ? '' : 's'} left in this session.${isLast ? ' This is the last scheduled reminder for this session.' : ''} ${nextQuote()}`
      : `A sample reminder for your ${session.name.toLowerCase()} session. ${nextQuote()}`;
    previewNotification(title, body);
    sendSystemNotification(title, body);
  }
  $('notification-btn').addEventListener('click', async () => {
    const allowed = await askForNotificationPermission();
    showToast(allowed ? 'Browser notifications enabled.' : 'You can still use the on-page notification preview.');
  });
  $('test-notification-btn').addEventListener('click', async () => {
    const session = state.sessions[0];
    const pendingCount = session ? remaining(session.id).length : 0;
    // Show preview immediately; no scheduled time or exercise is required for a demo.
    sendReminder(session || { name: 'Physiotherapy' }, pendingCount, true);
    save();
    if ('Notification' in window && Notification.permission === 'default') {
      const allowed = await askForNotificationPermission();
      if (allowed) sendSystemNotification(`PhysioAlly · ${session?.name || 'Physiotherapy'} reminder (demo)`, $('preview-body').textContent);
    }
  });

  // Adaptive Ally: a choice-driven response, not an algorithm that tells people to exercise through pain.
  function openBuddy(id = null) {
    buddySessionId = state.sessions.find(s => s.id === id)?.id || state.sessions.find(s => remaining(s.id).length)?.id || state.sessions[0]?.id;
    const session = state.sessions.find(s => s.id === buddySessionId);
    $('buddy-subtitle').textContent = `${session?.name || 'Your'} session · What is getting in the way today?`;
    $('buddy-reasons').hidden = false;
    $('buddy-response').hidden = true;
    $('buddy-response').innerHTML = '';
    $('buddy-back').hidden = true;
    $('notification-preview').hidden = true;
    $('buddy-dialog').showModal();
  }
  $('preview-adapt').addEventListener('click', () => openBuddy(previewSessionId));
  $('buddy-demo-btn').addEventListener('click', () => openBuddy());
  $('buddy-close').addEventListener('click', () => $('buddy-dialog').close());
  $('buddy-back').addEventListener('click', () => {
    $('buddy-reasons').hidden = false;
    $('buddy-response').hidden = true;
    $('buddy-back').hidden = true;
  });
  $('buddy-reasons').addEventListener('click', event => {
    const button = event.target.closest('[data-reason]');
    if (!button) return;
    const reason = button.dataset.reason;
    const key = `${dateKey()}_${buddySessionId}`;
    state.reasons[key] = reason;
    save();
    $('buddy-reasons').hidden = true;
    $('buddy-response').hidden = false;
    $('buddy-back').hidden = false;
    const panel = $('buddy-response');
    if (reason === 'busy') {
      panel.innerHTML = `<strong>Let's find a better time.</strong><p>Pause reminders for a little while instead of receiving repeated alerts.</p><div class="buddy-buttons">${[15,30,60].map(n => `<button type="button" class="btn btn-secondary buddy-snooze" data-minutes="${n}">Snooze ${n} min</button>`).join('')}</div>`;
    } else if (reason === 'forgot') {
      panel.innerHTML = `<strong>Ready when you are.</strong><p>Your prescribed exercises are waiting in Today's exercises.</p><button type="button" class="btn buddy-view">View my exercises</button>`;
    } else if (reason === 'pain') {
      panel.innerHTML = `<strong>Your well-being comes first.</strong><p>You can pause reminders for today or contact someone you trust. Follow your physiotherapist's advice for pain or symptom changes; this app cannot decide whether exercise is safe.</p><div class="buddy-buttons"><button type="button" class="btn buddy-pause">Pause reminders for today</button><button type="button" class="btn btn-secondary buddy-contact">Contact someone</button></div>`;
    } else {
      panel.innerHTML = '<strong>Asking for help is okay.</strong><p>Choose a saved contact and preview a help request. The Send button only simulates sending for this demo.</p><button type="button" class="btn buddy-contact">Contact someone</button>';
    }
  });
  $('buddy-response').addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.classList.contains('buddy-snooze')) {
      const amount = Number(button.dataset.minutes);
      state.snoozedUntil[`${dateKey()}_${buddySessionId}`] = Date.now() + amount * 60000;
      save(); $('buddy-dialog').close(); showToast(`Reminders snoozed for ${amount} minutes.`);
    } else if (button.classList.contains('buddy-pause')) {
      state.paused[`${dateKey()}_${buddySessionId}`] = true;
      save(); renderReminders(); $('buddy-dialog').close(); showToast('Reminders paused for this session today.');
    } else if (button.classList.contains('buddy-view')) {
      $('buddy-dialog').close(); $('today-card').scrollIntoView({behavior:'smooth',block:'start'});
    } else if (button.classList.contains('buddy-contact')) {
      const preference = state.reasons[`${dateKey()}_${buddySessionId}`] === 'pain' ? 'pain' : 'checkin';
      $('buddy-dialog').close(); openHelp(null, preference);
    }
  });

  // Trusted contacts are stored in the current browser, alongside the user's exercise data.
  // Demo only: no SMS, WhatsApp or email is sent from the browser.
  const HELP_TEMPLATES = {
    checkin: 'Hi, I am having a difficult day with my pain. Could you please check in on me when you can? Thank you.',
    pain: 'Hi, I am experiencing significant pain and need some assistance. Please contact me as soon as you can.',
    tasks: 'Hi, my pain is making some tasks difficult today. Could you please help me with something? Thank you.'
  };
  function normalizedPhone(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (!/^\+?[0-9()\s.-]+$/.test(raw)) return null;
    const normalized = raw.replace(/[()\s.-]/g, '');
    const digits = normalized.replace(/\D/g, '');
    return /^\+?\d+$/.test(normalized) && digits.length >= 7 && digits.length <= 15 ? normalized : null;
  }
  function renderContacts() {
    $('contacts-list').innerHTML = state.contacts.length ? state.contacts.map(c => `
      <div class="contact-item">
        <div class="contact-info">
          <div class="contact-name">${escapeHtml(c.name)}</div>
          <div class="contact-detail">${c.phone ? escapeHtml(c.phone) : ''}${c.phone && c.email ? ' · ' : ''}${c.email ? escapeHtml(c.email) : ''}</div>
        </div>
        <div class="contact-buttons">
          <button class="btn-quiet contact-help" data-id="${escapeHtml(c.id)}" type="button">Send demo</button>
          <button class="btn-quiet contact-edit" data-id="${escapeHtml(c.id)}" type="button">Edit</button>
          <button class="btn-quiet btn-danger contact-remove" data-id="${escapeHtml(c.id)}" type="button">Remove</button>
        </div>
      </div>`).join('') : '<div class="empty">No trusted contacts added yet.</div>';
    $('request-help-btn').disabled = !state.contacts.length;
    $('help-contact').innerHTML = state.contacts.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
  }
  function closeContactForm() {
    editingContactId = null;
    $('contact-form').hidden = true;
    $('contact-form').reset();
    $('save-contact-btn').textContent = 'Save contact';
  }
  function openContactForm(contact = null) {
    editingContactId = contact?.id || null;
    $('contact-form').hidden = false;
    $('contact-name').value = contact?.name || '';
    $('contact-phone').value = contact?.phone || '';
    $('contact-email').value = contact?.email || '';
    $('save-contact-btn').textContent = contact ? 'Update contact' : 'Save contact';
    $('contact-name').focus();
  }
  $('add-contact-btn').addEventListener('click', () => {
    if (!$('contact-form').hidden && !editingContactId) closeContactForm();
    else openContactForm();
  });
  $('cancel-contact-btn').addEventListener('click', closeContactForm);
  $('contact-form').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('contact-name').value.trim();
    const phone = $('contact-phone').value.trim();
    const email = $('contact-email').value.trim();
    if (!name) return;
    if (!phone && !email) return showToast('Enter a phone number or an email address.');
    if (phone && normalizedPhone(phone) === null) return showToast('Use a valid phone number, ideally with a country code (e.g. +65).');
    const update = {name,phone,email};
    if (editingContactId) {
      const contact = state.contacts.find(c => c.id === editingContactId);
      if (contact) Object.assign(contact,update);
    } else {
      state.contacts.push({id:`contact_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,...update});
    }
    save(); closeContactForm(); renderContacts(); showToast('Trusted contact saved in this browser.');
  });
  $('contacts-list').addEventListener('click',event => {
    const button = event.target.closest('[data-id]');
    if (!button) return;
    const contact = state.contacts.find(c => c.id === button.dataset.id);
    if (!contact) return;
    if (button.classList.contains('contact-help')) openHelp(contact.id);
    if (button.classList.contains('contact-edit')) openContactForm(contact);
    if (button.classList.contains('contact-remove') && confirm(`Remove “${contact.name}” from support contacts?`)) {
      state.contacts = state.contacts.filter(c => c.id !== contact.id);
      save(); renderContacts(); showToast('Contact removed.');
    }
  });
  function openHelp(contactId = null, template = 'checkin') {
    if (!state.contacts.length) {
      $('contacts-card').scrollIntoView({behavior:'smooth',block:'center'});
      openContactForm();
      showToast('Add a trusted contact first.');
      return;
    }
    $('help-contact').innerHTML = state.contacts.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
    const selected = state.contacts.some(c => c.id === contactId) ? contactId : state.contacts[0].id;
    $('help-contact').value = selected;
    $('help-template').value = Object.hasOwn(HELP_TEMPLATES,template) ? template : 'checkin';
    $('help-message').value = HELP_TEMPLATES[$('help-template').value];
    $('help-compose').hidden = false;
    $('help-success').hidden = true;
    $('help-dialog').showModal();
  }
  $('request-help-btn').addEventListener('click', () => openHelp());
  $('high-pain-help').addEventListener('click', () => openHelp(null,'pain'));
  $('help-template').addEventListener('change', () => {
    $('help-message').value = HELP_TEMPLATES[$('help-template').value];
  });
  $('help-cancel').addEventListener('click', () => $('help-dialog').close());
  $('help-success-close').addEventListener('click', () => $('help-dialog').close());
  $('help-send').addEventListener('click', () => {
    const contact = state.contacts.find(c => c.id === $('help-contact').value);
    const message = $('help-message').value.trim();
    if (!contact) return showToast('Choose a saved contact first.');
    if (!message) return showToast('Please enter a message.');
    // This is a deliberately simulated send for the classroom prototype.
    // Never claim real delivery, or trigger a phone or messaging app.
    $('help-success-recipient').textContent = `To: ${contact.name}`;
    $('help-compose').hidden = true;
    $('help-success').hidden = false;
    $('help-success-title').focus();
  });
  // Preview messages should remain opt-in; never send texts based solely on a pain score.
  $('help-dialog').addEventListener('click',event => { if (event.target === $('help-dialog')) $('help-dialog').close(); });

  function checkReminders() {
    const now = new Date(), day = dateKey(now);
    const at = now.getHours() * 60 + now.getMinutes();
    let changed = false;
    for (const session of state.sessions) {
      if (!session.enabled || sessionIsPaused(session.id, day) || !remaining(session.id, day).length) continue;
      if (Date.now() < Number(state.snoozedUntil[`${day}_${session.id}`] || 0)) continue;
      const from = minutes(session.start), until = minutes(session.end);
      const gap = Number(session.interval);
      if (!gap || !Number.isFinite(from) || !Number.isFinite(until) || at < from || at > until) continue;
      const key = `${day}_${session.id}`;
      // Deliver an explicit last reminder at the cutoff, even if it falls between repeat intervals.
      if (at === until) {
        if (state.lastSent[`${key}_last`]) continue;
        state.lastSent[`${key}_last`] = true;
        sendReminder(session, remaining(session.id, day).length, false, true);
        changed = true;
        continue;
      }
      const slot = Math.floor((at - from) / gap);
      if (state.lastSent[key] === slot) continue;
      state.lastSent[key] = slot;
      sendReminder(session, remaining(session.id, day).length);
      changed = true;
    }
    // One optional bedtime check-in for unfinished sessions that have already been scheduled.
    if (state.settings.finalOn && state.finalSent !== day) {
      const finalAt = minutes(state.settings.finalTime || '22:30');
      if (at >= finalAt && at <= finalAt + 15) {
        const pending = state.sessions.filter(s => minutes(s.time) <= at && !sessionIsPaused(s.id,day))
          .reduce((sum,s) => sum + remaining(s.id, day).length, 0);
        state.finalSent = day;
        if (pending) {
          const body = `${pending} scheduled exercise${pending===1?' is':'s are'} still unchecked today. If you can follow your prescribed plan safely, there's time to review it. It is also okay to rest when needed.`;
          previewSessionId = state.sessions.find(s => remaining(s.id,day).length)?.id || state.sessions[0]?.id;
          previewNotification('PhysioAlly · Evening check-in', body);
          sendSystemNotification('PhysioAlly · Evening check-in',body);
        }
        changed = true;
      }
    }
    if (state.settings.hourlyOn && (!state.lastHourly || Date.now() - state.lastHourly >= 60 * 60 * 1000)) {
      state.lastHourly = Date.now();
      const body = nextQuote();
      previewNotification('PhysioAlly · A little motivation', body);
      sendSystemNotification('PhysioAlly · A little motivation', body);
      changed = true;
    }
    if (changed) save();
  }

  render();
  rotateHeaderQuote(); // New quote on each visit, including a refresh.
  setInterval(rotateHeaderQuote, HEADER_QUOTE_INTERVAL_MS);
  checkReminders();
  setInterval(checkReminders, 15000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { renderToday(); checkReminders(); }
  });
})();
