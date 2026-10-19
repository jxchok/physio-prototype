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
  const DEFAULT = { exercises: [], log: {}, ratings: {}, contacts: [], friendMessages: {}, sessions: INITIAL_SESSIONS, scheduleOverrides: {}, settings: { hourlyOn: false, finalOn: false, finalTime: '22:30' }, quoteIndex: 0, lastHourly: null, lastSent: {}, finalSent: '', paused: {}, snoozedUntil: {}, reasons: {} };
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
      loaded.friendMessages = data.friendMessages && typeof data.friendMessages === 'object' && !Array.isArray(data.friendMessages) ? data.friendMessages : {};
      loaded.reasons = data.reasons && typeof data.reasons === 'object' ? data.reasons : {};
      loaded.snoozedUntil = data.snoozedUntil && typeof data.snoozedUntil === 'object' ? data.snoozedUntil : {};
      loaded.scheduleOverrides = data.scheduleOverrides && typeof data.scheduleOverrides === 'object' && !Array.isArray(data.scheduleOverrides) ? data.scheduleOverrides : {};
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
  let cheerTimer;
  let activeFriendId = null;
  let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let calendarSelected = dateKey();
  let ratingTarget = null;
  let ratingNewCompletion = false;
  let buddySessionId = null;
  let editingOccurrence = null;
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

  // Install the sample items for new visitors, or migrate V12 sample items.
  // Existing users keep their own exercises, contacts, and reminder times.
  function seedV13DemoItems() {
    if (state.demoSeededV13) return;
    const sampleContactId = 'demo_contact_mother';
    const formerDemoSessionId = 'demo_session_afternoon';
    const sampleExerciseId = 'demo_exercise_seated_rotations';

    // Seed the examples once for users who never received the V12 sample.
    if (!state.demoSeededV12) {
      if (!state.contacts.some(c => c.id === sampleContactId ||
          (c.name.trim().toLowerCase() === 'mother' && c.phone === '12345678'))) {
        state.contacts.push({
          id: sampleContactId, name: 'Mother', phone: '12345678', email: '', isDemo: true
        });
      }
      if (!state.exercises.some(ex => ex.id === sampleExerciseId)) {
        state.exercises.push({
          id: sampleExerciseId,
          name: 'Seated Rotations (Demo)',
          notes: 'Demonstration only. Not a personalised exercise recommendation; follow your physiotherapist\'s instructions.',
          // YouTube demonstration linked by an NHS hospital.
          video: 'https://www.youtube.com/watch?v=Lm7GDqIGa-I',
          sessionIds: ['morning'],
          createdOn: dateKey(), archivedOn: null
        });
      }
      state.demoSeededV12 = true;
    }

    // Migrate any V12 exercise (including user-assigned exercises) that used
    // the old standalone demo session into the existing Morning session.
    for (const ex of state.exercises) {
      if (!Array.isArray(ex.sessionIds) || !ex.sessionIds.includes(formerDemoSessionId)) continue;
      ex.sessionIds = [...new Set(ex.sessionIds.map(id =>
        id === formerDemoSessionId ? 'morning' : id))];
    }

    // Preserve completed-exercise history and optional scores from the old
    // sample session, without overwriting any Morning entries already saved.
    for (const dailyLog of [state.log, state.ratings]) {
      for (const entries of Object.values(dailyLog)) {
        if (!entries || typeof entries !== 'object') continue;
        for (const oldKey of Object.keys(entries)) {
          const suffix = `_${formerDemoSessionId}`;
          if (!oldKey.endsWith(suffix)) continue;
          const newKey = `${oldKey.slice(0, -suffix.length)}_morning`;
          if (!Object.hasOwn(entries, newKey)) entries[newKey] = entries[oldKey];
          delete entries[oldKey];
        }
      }
    }

    // The extra demo session is no longer needed; Morning keeps its own
    // timing and reminder settings, unchanged.
    state.sessions = state.sessions.filter(s => s.id !== formerDemoSessionId);
    state.demoSeededV13 = true;
    save();
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { showToast('Unable to save data in this browser.'); }
  }
  function activeExercises(day = dateKey()) {
    return state.exercises.filter(ex => ex.createdOn <= day && (!ex.archivedOn || ex.archivedOn > day));
  }
  // Recurrences use local calendar dates, not a fixed number of milliseconds,
  // so weekdays and month-end rules remain stable across clock changes.
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weekdayOf = day => (new Date(`${day}T12:00:00`).getDay() + 6) % 7;
  const scheduleOverrideKey = (day, id) => `${day}_${id}`;
  const getScheduleOverride = (id, day) => state.scheduleOverrides[scheduleOverrideKey(day, id)] || {};
  function isRecurringOccurrence(s, day) {
    const start = s.startDate || '2000-01-01'; // Legacy daily sessions keep their old dates.
    if (day < start) return Boolean(s.pastDailyBefore); // Preserve old progress before the series was edited.
    const repeat = s.repeat || 'daily';
    if (repeat === 'once') return day === start;
    if (repeat === 'daily') return true;
    const weekday = weekdayOf(day);
    if (repeat === 'weekly') return weekday === weekdayOf(start);
    if (repeat === 'custom') return Array.isArray(s.weekdays) && s.weekdays.includes(weekday);
    if (repeat === 'monthly') return Number(day.slice(8)) === Number(start.slice(8));
    if (repeat === 'yearly') return day.slice(5) === start.slice(5);
    return true;
  }
  function sessionOccurs(s, day = dateKey()) {
    if (!s || !isRecurringOccurrence(s, day)) return false;
    return !getScheduleOverride(s.id, day).skipped;
  }
  function sessionTimeFor(s, day = dateKey()) {
    return getScheduleOverride(s.id, day).time || s.time;
  }
  function occurrenceWindow(s, day = dateKey()) {
    const delta = minutes(sessionTimeFor(s, day)) - minutes(s.time);
    return { start: clockTime(Math.max(0, Math.min(1439, minutes(s.start) + delta))),
             end: clockTime(Math.max(0, Math.min(1439, minutes(s.end) + delta))) };
  }
  function sessionExercises(id, day = dateKey()) {
    const s = state.sessions.find(s => s.id === id);
    if (!sessionOccurs(s, day)) return [];
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

  // Celebrate the act of logging an exercise without suggesting anyone should push through pain.
  const COMPLETION_MESSAGES = [
    'Good job! You made time for your prescribed exercise.',
    'Nice work! Every effort deserves recognition.',
    'Well done! Take a moment to appreciate your effort.',
    'You did it! Remember to be kind to yourself along the way.',
    'Great job logging your exercise today!'
  ];
  let cheerIndex = 0;
  function showCompletionCheer(sessionFinished = false) {
    const panel = $('completion-cheer');
    panel.textContent = sessionFinished
      ? '🌟 Great work! You completed this session. Take care of yourself and rest as advised.'
      : `🌟 ${COMPLETION_MESSAGES[cheerIndex++ % COMPLETION_MESSAGES.length]}`;
    panel.hidden = false;
    clearTimeout(cheerTimer);
    cheerTimer = setTimeout(() => { panel.hidden = true; }, 7500);
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

    $('today-sessions').innerHTML = state.sessions.filter(session => sessionOccurs(session, day)).sort((a,b) => sessionTimeFor(a,day).localeCompare(sessionTimeFor(b,day))).map(session => {
      const exercises = sessionExercises(session.id, day);
      const completedHere = exercises.filter(ex => done(day, ex.id, session.id)).length;
      return `<div class="session" id="session-${escapeHtml(session.id)}">
        <div class="session-title">${escapeHtml(session.name)} <span class="session-count">${escapeHtml(sessionTimeFor(session, day))} · ${completedHere}/${exercises.length}</span></div>
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
            <div class="exercise-extras">${video ? `<button type="button" class="btn-quiet watch-video" data-video="${video}" data-name="${escapeHtml(ex.name)}">▶ Video</button>` : ''}${complete ? `<button type="button" class="btn-quiet edit-rating" data-exercise="${escapeHtml(ex.id)}" data-session="${escapeHtml(session.id)}">${ratingInfo ? 'Edit score' : 'Rate'}</button>` : ''}</div>
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
      // A paused session should be visible even if other sessions remain unfinished.
      const anyPaused = scheduled.some(session => sessionIsPaused(session.id, key));
      const kind = future || !tally.total ? 'empty' : anyPaused ? 'paused'
        : tally.completed === tally.total ? 'completed'
        : tally.completed ? 'partial' : key < dateKey() ? 'missed' : 'empty';
      const daySessions = state.sessions.filter(s => sessionOccurs(s,key)).sort((a,b)=>sessionTimeFor(a,key).localeCompare(sessionTimeFor(b,key)));
      const eventList = daySessions.slice(0,2).map(s => `<span class="calendar-event">${escapeHtml(sessionTimeFor(s,key))} ${escapeHtml(s.name)}</span>`).join('');
      html += `<button type="button" class="calendar-day ${kind} ${key === dateKey() ? 'is-today' : ''} ${key === calendarSelected ? 'selected' : ''}" data-day="${key}" aria-label="${escapeHtml(key)}: ${daySessions.length} scheduled sessions, ${tally.completed} of ${tally.total} exercises completed" aria-pressed="${key === calendarSelected}"><span class="calendar-number">${day}</span><span class="calendar-events">${eventList}${daySessions.length>2?`<span class="calendar-event-more">+${daySessions.length-2} more</span>`:''}</span></button>`;
    }
    $('calendar-grid').innerHTML = html;
    const {total,completed} = counts(calendarSelected);
    const selectedLabel = new Date(`${calendarSelected}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
    const pausedCount = state.sessions.filter(s => sessionIsPaused(s.id, calendarSelected) && sessionExercises(s.id,calendarSelected).length).length;
    $('calendar-detail').textContent = `${selectedLabel}: ${total ? `${completed} of ${total} exercises logged` : 'No exercises scheduled'}${pausedCount ? ` · ${pausedCount} session${pausedCount===1?'':'s'} paused` : ''}.`;
    $('next-month').disabled = false;
    renderDayPlan();
  }


  function friendlyDate(day) { return new Date(`${day}T12:00:00`).toLocaleDateString(undefined,{ weekday:'short', month:'short', day:'numeric', year:'numeric' }); }
  function repeatDescription(s) {
    const kind = s.repeat || 'daily';
    if (kind === 'once') return 'One-time';
    if (kind === 'daily') return 'Every day';
    if (kind === 'weekly') return 'Every week';
    if (kind === 'monthly') return 'Every month';
    if (kind === 'yearly') return 'Every year';
    return `Weekly · ${(s.weekdays || []).map(i=>WEEKDAYS[i]).join(', ')}`;
  }
  function renderDayPlan() {
    $('day-plan-date').textContent = friendlyDate(calendarSelected);
    const sessions = state.sessions.filter(s => isRecurringOccurrence(s,calendarSelected)).sort((a,b)=>sessionTimeFor(a,calendarSelected).localeCompare(sessionTimeFor(b,calendarSelected)));
    $('day-plan-list').innerHTML = sessions.length ? sessions.map(s=>{
      const override = getScheduleOverride(s.id,calendarSelected);
      const skipped = Boolean(override.skipped);
      const total = skipped ? 0 : sessionExercises(s.id,calendarSelected).length;
      const completed = skipped ? 0 : total - remaining(s.id,calendarSelected).length;
      return `<div class="day-plan-item ${skipped?'skipped':''}"><div class="day-plan-info"><strong>${escapeHtml(s.name)}</strong><span>${escapeHtml(sessionTimeFor(s,calendarSelected))} · ${escapeHtml(repeatDescription(s))}${skipped?' · Skipped':` · ${completed}/${total} logged`}${override.time && !skipped?' · Changed for this date':''}</span></div><div class="day-plan-actions">${skipped?`<button type="button" class="btn btn-secondary restore-occurrence" data-id="${escapeHtml(s.id)}">Restore</button>`:`<button type="button" class="btn btn-secondary edit-occurrence" data-id="${escapeHtml(s.id)}">Edit this day</button>`}</div></div>`;
    }).join('') : '<div class="day-plan-empty">No sessions scheduled. Add one to this date.</div>';
  }
  function populateWeekdayPicker(containerId, values=[0,1,2,3,4]) {
    const picker=$(containerId).querySelector('.weekday-choices');
    picker.innerHTML=WEEKDAYS.map((d,i)=>`<label><input type="checkbox" value="${i}" ${values.includes(i)?'checked':''}/><span>${d}</span></label>`).join('');
  }
  function selectedWeekdays(container) { return [...container.querySelectorAll('input[type=checkbox]:checked')].map(i=>Number(i.value)); }
  function showWeekdays(repeatInput, weekdaysEl) {
    weekdaysEl.hidden=repeatInput.value!=='custom';
  }
  function openAddSession(date = dateKey()) {
    $('add-session-form').hidden=false;
    $('new-session-date').value=date;
    $('new-session-repeat').value='daily';
    $('new-session-weekdays').hidden=true;
    const options=activeExercises(date);
    $('new-session-exercises').innerHTML=options.length?options.map(ex=>`<label class="toggle-row"><input type="checkbox" name="new-session-exercise" value="${escapeHtml(ex.id)}" checked/> ${escapeHtml(ex.name)}</label>`).join(''):'<p class="muted">Add exercises under My exercises to assign them here.</p>';
    $('add-session-form').scrollIntoView({behavior:'smooth',block:'center'});
    $('new-session-name').focus({preventScroll:true});
  }
  function openOccurrence(id, day) {
    const s=state.sessions.find(s=>s.id===id);
    if (!s || !sessionOccurs(s,day)) return;
    editingOccurrence={id,day};
    $('occurrence-subtitle').textContent=`${s.name} · ${friendlyDate(day)}`;
    $('occurrence-time').value=sessionTimeFor(s,day);
    $('occurrence-dialog').showModal();
  }
  function refreshScheduleView() { save(); renderToday(); renderCalendar(); renderReminders(); }

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
      ${escapeHtml(s.name)} (${escapeHtml(s.time)} · ${escapeHtml(repeatDescription(s))})
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
          <label class="field">First date<input name="startDate" type="date" required value="${escapeHtml(s.startDate || dateKey())}" /></label>
          <label class="field">Schedule repeats<select name="repeat" class="repeat-select">${[
            ['once','Does not repeat'],['daily','Every day'],['weekly','Every week'],['monthly','Every month'],['yearly','Every year'],['custom','Custom weekdays']
          ].map(([value,label])=>`<option value="${value}" ${(s.repeat || 'daily')===value?'selected':''}>${label}</option>`).join('')}</select></label>
          <label class="field">Exercise time<input type="text" class="clock-input" inputmode="none" readonly name="time" required aria-haspopup="dialog" title="Choose a time using the clock" value="${escapeHtml(s.time)}" /></label>
          <label class="field">First reminder<input type="text" class="clock-input" inputmode="none" readonly name="start" required aria-haspopup="dialog" title="Choose a time using the clock" value="${escapeHtml(s.start)}" /></label>
          <label class="field">Last reminder by<input type="text" class="clock-input" inputmode="none" readonly name="end" required aria-haspopup="dialog" title="Choose a time using the clock" value="${escapeHtml(s.end)}" /></label>
          <label class="field">Reminder interval<select name="interval">
            ${[5, 10, 15, 30, 60].map(n => `<option value="${n}" ${Number(s.interval) === n ? 'selected' : ''}>${n} minutes</option>`).join('')}
          </select></label>
        </div>
        <fieldset class="weekday-picker" ${(s.repeat || 'daily')==='custom'?'':'hidden'}><legend>Repeat on these days</legend><div class="weekday-choices">${WEEKDAYS.map((d,i)=>`<label><input type="checkbox" name="weekday" value="${i}" ${(s.weekdays || [0,1,2,3,4]).includes(i)?'checked':''} /><span>${d}</span></label>`).join('')}</div></fieldset>
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
  function render() { renderToday(); renderCalendar(); renderManage(); renderSettings(); renderContacts(); renderFriends(); }

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
    if (input.checked) {
      const sessionFinished = remaining(input.dataset.session).length === 0;
      showCompletionCheer(sessionFinished);
      openRating(day, key, true);
      if (sessionFinished) {
        const session = state.sessions.find(s => s.id === input.dataset.session);
        showToast(`${session?.name || 'Session'} complete! No more reminders for this session today.`);
      }
    }
  });

  // Optional per-exercise pain and difficulty rating (never required to check off an exercise).
  for (const id of ['rating-pain','rating-difficulty']) {
    $(id).innerHTML += Array.from({length:11}, (_, i) => `<option value="${i}">${i} / 10</option>`).join('');
  }
  function openRating(day, key, justCompleted = false) {
    ratingTarget = {day,key};
    ratingNewCompletion = justCompleted;
    $('rating-title').textContent = justCompleted ? 'Good job! Exercise logged 🌟' : 'Optional exercise check-in';
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
  $('rating-dialog').addEventListener('close', () => {
    if (ratingNewCompletion) showToast('Good job! Your exercise was logged. 🌟');
    ratingTarget = null;
    ratingNewCompletion = false;
  });

  $('prev-month').addEventListener('click', () => {calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth()-1,1); renderCalendar();});
  $('next-month').addEventListener('click', () => {calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth()+1,1); renderCalendar();});
  $('calendar-grid').addEventListener('click', event => {
    const button = event.target.closest('[data-day]');
    if (button) { calendarSelected = button.dataset.day; renderCalendar(); }
  });
  $('day-plan-list').addEventListener('click',event=>{
    const edit=event.target.closest('.edit-occurrence');
    if (edit) return openOccurrence(edit.dataset.id,calendarSelected);
    const restore=event.target.closest('.restore-occurrence');
    if (restore) {
      const key=scheduleOverrideKey(calendarSelected,restore.dataset.id);
      delete state.scheduleOverrides[key];
      refreshScheduleView();
      showToast('Session restored for this date.');
    }
  });
  $('occurrence-cancel').addEventListener('click',()=> $('occurrence-dialog').close());
  $('occurrence-dialog').addEventListener('close',()=> {editingOccurrence=null;});
  $('occurrence-save').addEventListener('click',()=>{
    if (!editingOccurrence) return;
    const {id,day}=editingOccurrence;
    const time=$('occurrence-time').value;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return showToast('Choose a valid time.');
    const s=state.sessions.find(s=>s.id===id);
    if (!s) return;
    const key=scheduleOverrideKey(day,id);
    if (time===s.time) delete state.scheduleOverrides[key];
    else state.scheduleOverrides[key]={time};
    $('occurrence-dialog').close();
    refreshScheduleView();
    showToast('Updated only this date.');
  });
  $('occurrence-skip').addEventListener('click',()=>{
    if (!editingOccurrence) return;
    const {id,day}=editingOccurrence;
    state.scheduleOverrides[scheduleOverrideKey(day,id)]={skipped:true};
    $('occurrence-dialog').close();
    refreshScheduleView();
    showToast('Skipped this date. Other repetitions are unchanged.');
  });

  // Embed only vetted YouTube IDs; do not store local video files or load remote content automatically.
  document.addEventListener('click', event => {
    const button = event.target.closest('.watch-video');
    if (!button || !validVideoId(button.dataset.video)) return;
    $('video-title').textContent = button.dataset.name || 'Exercise demonstration';
    $('video-iframe').src = `https://www.youtube-nocookie.com/embed/${button.dataset.video}`;
    $('video-youtube-link').href = `https://www.youtube.com/watch?v=${button.dataset.video}`;
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
    $('time-picker-hint').textContent = choosingHours ? 'Drag the hand or tap to choose an hour' : 'Drag the hand or tap to choose a minute (even between labels)';
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
  // Both mouse and touch can drag the hand. Pointer capture stays on the stable
  // clock-face element even while its dial labels are re-rendered during a drag.
  let activeClockDrag = null;
  function valueFromPointer(event, allowOutside = false) {
    const rect = clockFace.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const radius = Math.hypot(dx, dy);
    // Don't start a drag in the middle or far outside the clock face.
    if (!allowOutside && (radius < rect.width * 0.10 || radius > rect.width * 0.53)) return null;
    if (radius < rect.width * 0.06) return null;
    const angle = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI);
    const steps = chosenTime.view === 'hour' ? 12 : 60;
    const value = Math.round(angle / (2 * Math.PI) * steps) % steps;
    return chosenTime.view === 'hour' ? (value || 12) : value;
  }
  function previewClockPointer(event, allowOutside = false) {
    if (!chosenTime) return;
    const value = valueFromPointer(event, allowOutside);
    if (value === null) return;
    const field = chosenTime.view === 'hour' ? 'hour' : 'minute';
    if (chosenTime[field] !== value) {
      chosenTime[field] = value;
      renderClock();
    }
  }
  clockFace.addEventListener('pointerdown', event => {
    if (!chosenTime || activeClockDrag || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const value = valueFromPointer(event);
    if (value === null) return;
    activeClockDrag = {
      pointerId: event.pointerId,
      field: chosenTime.view === 'hour' ? 'hour' : 'minute',
      originalValue: chosenTime[chosenTime.view === 'hour' ? 'hour' : 'minute']
    };
    clockFace.setPointerCapture(event.pointerId);
    clockFace.classList.add('dragging');
    event.preventDefault(); // Prevent text selection and synthetic clicks.
    previewClockPointer(event);
  });
  clockFace.addEventListener('pointermove', event => {
    if (activeClockDrag?.pointerId !== event.pointerId) return;
    previewClockPointer(event, true);
  });
  clockFace.addEventListener('pointerup', event => {
    if (activeClockDrag?.pointerId !== event.pointerId) return;
    previewClockPointer(event, true);
    const wasHour = activeClockDrag.field === 'hour';
    activeClockDrag = null;
    clockFace.classList.remove('dragging');
    if (clockFace.hasPointerCapture(event.pointerId)) clockFace.releasePointerCapture(event.pointerId);
    // Let the user drag for hours, then drag for minutes. Minutes can be exact 0–59.
    if (wasHour) chosenTime.view = 'minute';
    renderClock();
  });
  clockFace.addEventListener('pointercancel', event => {
    if (activeClockDrag?.pointerId !== event.pointerId) return;
    chosenTime[activeClockDrag.field] = activeClockDrag.originalValue;
    activeClockDrag = null;
    clockFace.classList.remove('dragging');
    renderClock();
  });
  // Preserve keyboard accessibility for the 12 hour/minute label buttons.
  clockFace.addEventListener('click', event => {
    if (event.detail !== 0 || activeClockDrag) return; // Pointer input is handled above.
    const button = event.target.closest('.clock-number');
    if (button) chooseDialValue(Number(button.dataset.clockValue));
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
    activeClockDrag = null;
    clockFace.classList.remove('dragging');
    const focusTarget = chosenTime?.target;
    chosenTime = null;
    if (focusTarget?.isConnected) focusTarget.focus();
  });

  // Each session can have its own time, repeat window, and reminder interval.
  populateWeekdayPicker('new-session-weekdays');
  $('new-session-repeat').addEventListener('change',()=>showWeekdays($('new-session-repeat'),$('new-session-weekdays')));
  $('reminder-sessions').addEventListener('change',event=>{
    const select=event.target.closest('.repeat-select');
    if (select) showWeekdays(select,select.closest('.reminder-session').querySelector('.weekday-picker'));
  });
  $('day-add-session').addEventListener('click',()=>openAddSession(calendarSelected));
  $('add-session-btn').addEventListener('click', () => {
    if (!$('add-session-form').hidden) $('add-session-form').hidden=true;
    else openAddSession(dateKey());
  });
  $('cancel-session-btn').addEventListener('click', () => { $('add-session-form').hidden = true; });
  $('add-session-form').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('new-session-name').value.trim();
    const time = $('new-session-time').value;
    if (!name || !time) return;
    const window = createWindow(time);
    const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const startDate = $('new-session-date').value || dateKey();
    const repeat = $('new-session-repeat').value;
    const weekdays=selectedWeekdays($('new-session-weekdays'));
    if (repeat==='custom' && !weekdays.length) return showToast('Choose at least one weekday.');
    const session={ id, name, time, enabled: false, ...window, interval: 15, startDate, repeat, weekdays };
    state.sessions.push(session);
    for (const checkbox of $('new-session-exercises').querySelectorAll('input:checked')) {
      const ex=state.exercises.find(ex=>ex.id===checkbox.value);
      if (ex && !ex.sessionIds.includes(id)) ex.sessionIds.push(id);
    }
    state.sessions.sort((a, b) => a.time.localeCompare(b.time));
    save();
    $('add-session-form').hidden = true;
    $('new-session-name').value = '';
    calendarSelected=startDate;
    calendarCursor=new Date(`${startDate.slice(0,7)}-01T12:00:00`);
    render();
    if (!$('exercise-form').hidden) closeExerciseForm();
    showToast('Session added to your calendar.');
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
    const repeat=String(fields.get('repeat') || 'daily');
    const weekdays=fields.getAll('weekday').map(Number);
    if (repeat==='custom' && !weekdays.length) return showToast('Choose at least one weekday.');
    const startDate=String(fields.get('startDate') || dateKey());
    if (!session.startDate) session.pastDailyBefore = startDate; // Old sessions were daily before this edit.
    Object.assign(session, { name, time, start, end, interval: Number(fields.get('interval')), enabled: fields.has('enabled'), repeat, weekdays, startDate });
    state.sessions.sort((a, b) => a.time.localeCompare(b.time));
    // Allow the current time slot to be checked again after an edit; never carry a stale slot.
    delete state.lastSent[`${dateKey()}_${session.id}`];
    save(); render();
    if (!$('exercise-form').hidden) closeExerciseForm();
    showToast('Session schedule saved.');
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
      save(); renderReminders(); renderCalendar();
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
    const title = `PhysioAlly · ${session.name} reminder`; 
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
      if (allowed) sendSystemNotification(`PhysioAlly · ${session?.name || 'Physiotherapy'} reminder`, $('preview-body').textContent);
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
      panel.innerHTML = '<strong>Asking for help is okay.</strong><p>Choose a saved contact and prepare a help request.</p><button type="button" class="btn buddy-contact">Contact someone</button>';
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
      save(); renderReminders(); renderCalendar(); $('buddy-dialog').close(); showToast('Reminders paused for this session today.');
    } else if (button.classList.contains('buddy-view')) {
      $('buddy-dialog').close(); $('today-card').scrollIntoView({behavior:'smooth',block:'start'});
    } else if (button.classList.contains('buddy-contact')) {
      const preference = state.reasons[`${dateKey()}_${buddySessionId}`] === 'pain' ? 'pain' : 'checkin';
      $('buddy-dialog').close(); openHelp(null, preference);
    }
  });

  // Social feature for presentation only. These two identities and their progress
  // are fictional, deterministic, and are not synced with another account.
  const DEMO_FRIENDS = [
    { id: 'bob', name: 'Bob', handle: '@bob_moves', initials: 'B', motto: 'Finding my rhythm, one day at a time.' },
    { id: 'kirkinator', name: 'Kirkinator9000', handle: '@kirkinator9000', initials: 'K', motto: 'Some days are harder, and that is okay.' }
  ];
  const FRIEND_MESSAGES = {
    gentle: 'Hey! Just checking in. Hope you are doing okay today. No pressure to reply 💙',
    celebrate: 'I noticed your recent progress — nice work! Remember that every step counts 🌟',
    support: 'Hope your day is going okay! If you need someone to listen or help, I am here 💛'
  };
  function demoFriendDays(friendId) {
    const results = [];
    // Most recent day always shows at the end; the fixtures remain stable on reload.
    for (let back = 27; back >= 0; back--) {
      const d = new Date();
      d.setHours(12,0,0,0);
      d.setDate(d.getDate()-back);
      let status;
      if (friendId === 'bob') status = back === 23 || back === 15 ? 'paused' : back === 22 ? 'partial' : 'completed';
      else status = [26,15,7].includes(back) ? 'completed'
        : [24,18,14,5,2].includes(back) ? 'partial'
        : [22,12,8,1].includes(back) ? 'paused' : 'missed';
      results.push({day:dateKey(d),status});
    }
    return results;
  }
  function friendMetrics(days) {
    const completed = days.filter(d => d.status === 'completed').length;
    const paused = days.filter(d => d.status === 'paused').length;
    const partial = days.filter(d => d.status === 'partial').length;
    let streak = 0;
    for (let i=days.length-1; i>=0 && days[i].status === 'completed'; i--) streak++;
    return { completed, paused, partial, streak };
  }
  function renderFriends() {
    $('friends-list').innerHTML = DEMO_FRIENDS.map(f => {
      const m = friendMetrics(demoFriendDays(f.id));
      const messages = Array.isArray(state.friendMessages[f.id]) ? state.friendMessages[f.id].length : 0;
      return `<div class="friend-item">
        <div class="friend-avatar" aria-hidden="true">${f.initials}</div>
        <div class="friend-summary">
          <div class="friend-name">${escapeHtml(f.name)}</div>
          <div class="friend-handle">${escapeHtml(f.handle)} · ${m.streak} day streak</div>
          <div class="friend-subtext">${m.completed}/28 complete days · ${m.paused} pause days</div>
          ${messages ? `<div class="friend-message-count">${messages} encouragement${messages === 1 ? '' : 's'} prepared</div>` : ''}
        </div>
        <div class="friend-actions">
          <button type="button" class="btn btn-secondary friend-view" data-friend="${f.id}">View progress</button>
        </div>
      </div>`;
    }).join('');
  }
  function openFriend(friendId, focusMessage = false) {
    const friend = DEMO_FRIENDS.find(f => f.id === friendId);
    if (!friend) return;
    activeFriendId = friend.id;
    const days = demoFriendDays(friend.id), metrics = friendMetrics(days);
    $('friend-title').textContent = friend.name;
    $('friend-caption').textContent = `${friend.handle} · ${friend.motto}`;
    $('friend-stats').innerHTML = `
      <div><strong>${metrics.streak}</strong><small>Current-day streak</small></div>
      <div><strong>${metrics.completed}/28</strong><small>Completed days</small></div>
      <div><strong>${metrics.paused}</strong><small>Paused days</small></div>`;
    const start = new Date(`${days[0].day}T12:00:00`);
    const end = new Date(`${days.at(-1).day}T12:00:00`);
    $('friend-range').textContent = `${start.toLocaleDateString(undefined, {month:'short',day:'numeric'})} – ${end.toLocaleDateString(undefined, {month:'short',day:'numeric'})}`;
    $('friend-calendar').innerHTML = days.map(d => {
      const dayNum = Number(d.day.slice(-2));
      const text = d.status === 'missed' ? 'Not logged' : d.status === 'completed' ? 'Completed' : d.status === 'partial' ? 'Partially completed' : 'Paused';
      return `<div class="friend-day ${d.status}" title="${escapeHtml(d.day)}: ${text}" aria-label="${escapeHtml(d.day)}: ${text}">${dayNum}</div>`;
    }).join('');
    $('friend-message').value = FRIEND_MESSAGES.gentle;
    $('friend-demo-status').textContent = '';
    $('friend-dialog').showModal();
    if (focusMessage) $('friend-message').focus();
  }
  $('friends-list').addEventListener('click', event => {
    const button = event.target.closest('[data-friend]');
    if (!button) return;
    openFriend(button.dataset.friend, button.classList.contains('friend-encourage'));
  });
  $('friend-close').addEventListener('click', () => $('friend-dialog').close());
  $('friend-dialog').addEventListener('click', event => {
    if (event.target === $('friend-dialog')) $('friend-dialog').close();
  });
  $('friend-presets').addEventListener('click', event => {
    const button = event.target.closest('[data-kind]');
    if (button && Object.hasOwn(FRIEND_MESSAGES,button.dataset.kind)) {
      $('friend-message').value = FRIEND_MESSAGES[button.dataset.kind];
      $('friend-demo-status').textContent = '';
    }
  });
  $('friend-send').addEventListener('click', () => {
    if (!activeFriendId) return;
    const message = $('friend-message').value.trim();
    if (!message) { $('friend-demo-status').textContent = 'Please write a message first.'; return; }
    if (!Array.isArray(state.friendMessages[activeFriendId])) state.friendMessages[activeFriendId] = [];
    state.friendMessages[activeFriendId].push({ message, at: new Date().toISOString() });
    save(); renderFriends();
    $('friend-demo-status').textContent = '✓ Message prepared (preview only — not delivered).';
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
          <button class="btn-quiet contact-help" data-id="${escapeHtml(c.id)}" type="button">Request help</button>
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
      if (!sessionOccurs(session,day) || !session.enabled || sessionIsPaused(session.id, day) || !remaining(session.id, day).length) continue;
      if (Date.now() < Number(state.snoozedUntil[`${day}_${session.id}`] || 0)) continue;
      const window=occurrenceWindow(session,day);
      const from = minutes(window.start), until = minutes(window.end);
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
        const pending = state.sessions.filter(s => sessionOccurs(s,day) && minutes(sessionTimeFor(s,day)) <= at && !sessionIsPaused(s.id,day))
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

  seedV13DemoItems();
  render();
  rotateHeaderQuote(); // New quote on each visit, including a refresh.
  setInterval(rotateHeaderQuote, HEADER_QUOTE_INTERVAL_MS);
  checkReminders();
  setInterval(checkReminders, 15000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { renderToday(); checkReminders(); }
  });
})();
