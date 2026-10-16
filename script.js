(() => {
      'use strict';
      const STORAGE_KEY = 'app_name_physio_first_draft_v1';
      const QUOTES = [
        'Small steps still count.',
        'Progress takes time. Be kind to yourself.',
        'Consistency matters more than perfection.',
        'Every effort is worth acknowledging.',
        'It is okay to pause when you need to.'
      ];
      const DEFAULT = {exercises: [], log: {}, settings: {morningOn:false, morningTime:'09:00', eveningOn:false, eveningTime:'20:00', hourlyOn:false}, quoteIndex:0, lastHourly:null, lastReminder:{}};
      function load(){try {let data=JSON.parse(localStorage.getItem(STORAGE_KEY)); return data && Array.isArray(data.exercises) && data.settings ? {...structuredClone(DEFAULT),...data,settings:{...DEFAULT.settings,...data.settings}} : structuredClone(DEFAULT);} catch {return structuredClone(DEFAULT);}}
      let state=load(), editingId=null, toastTimer;
      const el=id=>document.getElementById(id);
      function save(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch{showToast('Could not save to browser storage.');}}
      function pad(n){return String(n).padStart(2,'0');}
      function dayKey(date=new Date()){return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;}
      function dayOffset(n){const now=new Date();return dayKey(new Date(now.getFullYear(),now.getMonth(),now.getDate()+n));}
      function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
      function activeOn(ex,d){return ex.createdOn<=d && (!ex.archivedOn || ex.archivedOn>d);}
      function scheduled(ex,session){return ex.schedule==='both'||ex.schedule===session;}
      function activeExercises(d=dayKey()){return state.exercises.filter(x=>activeOn(x,d));}
      function sessionExercises(session,d=dayKey()){return activeExercises(d).filter(x=>scheduled(x,session));}
      function isDone(d,id,session){return Boolean(state.log[d]?.[`${id}_${session}`]);}
      function countsFor(d){let total=0,done=0;for(const session of ['morning','evening'])for(const ex of sessionExercises(session,d)){total++;if(isDone(d,ex.id,session))done++;}return {total,done};}
      function streak(){let start=0;const today=countsFor(dayKey());if(!(today.total>0&&today.total===today.done))start=-1;let n=0;for(let i=start;i>-365;i--){const c=countsFor(dayOffset(i));if(c.total===0||c.done!==c.total)break;n++;}return n;}
      function showToast(msg){const target=el('toast');target.textContent=msg;target.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>target.hidden=true,5000);}
      function renderToday(){
        const today=new Date();el('date-display').textContent=today.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
        let {total,done}=countsFor(dayKey());el('done-count').textContent=`${done}/${total}`;
        const s=streak();el('streak-count').textContent=`${s} ${s===1?'day':'days'}`;
        const percent=total?Math.round(done/total*100):0;el('progress-percent').textContent=`${percent}%`;el('progress-bar').style.width=`${percent}%`;
        for(const session of ['morning','evening']){
          const exercises=sessionExercises(session);const completed=exercises.filter(x=>isDone(dayKey(),x.id,session)).length;
          el(`${session}-count`).textContent=`${completed}/${exercises.length}`;
          el(`${session}-exercises`).innerHTML=exercises.length?exercises.map(ex=>`
            <label class="exercise ${isDone(dayKey(),ex.id,session)?'exercise-done':''}">
              <input type="checkbox" data-id="${esc(ex.id)}" data-session="${session}" ${isDone(dayKey(),ex.id,session)?'checked':''} />
              <span class="exercise-body"><span class="exercise-name">${esc(ex.name)}</span>${ex.notes?`<span class="exercise-instruction">${esc(ex.notes)}</span>`:''}</span>
            </label>`).join(''):'<div class="empty">No exercises scheduled.</div>';
        }
      }
      function renderManage(){const list=activeExercises();el('manage-list').innerHTML=list.length?list.map(ex=>`<div class="exercise-manage">
        <div><div class="manage-name">${esc(ex.name)}</div><div class="manage-meta">${ex.schedule==='both'?'Morning & evening':ex.schedule==='morning'?'Morning only':'Evening only'}</div></div>
        <div class="manage-actions"><button type="button" class="btn-quiet edit-exercise" data-id="${esc(ex.id)}">Edit</button><button type="button" class="btn-quiet btn-danger remove-exercise" data-id="${esc(ex.id)}">Remove</button></div></div>`).join(''):'<div class="empty">No exercises added yet.<br />Select “+ Add exercise” to begin.</div>';}
      function renderSettings(){for(const session of ['morning','evening']){el(`${session}-on`).checked=state.settings[`${session}On`];el(`${session}-time`).value=state.settings[`${session}Time`];}el('hourly-on').checked=state.settings.hourlyOn;el('quote-text').textContent=QUOTES[state.quoteIndex%QUOTES.length];}
      function render(){renderToday();renderManage();renderSettings();}
      function closeForm(){el('exercise-form').hidden=true;editingId=null;el('exercise-form').reset();el('save-btn').textContent='Save exercise';}
      function openForm(ex){editingId=ex?.id??null;el('exercise-form').hidden=false;el('exercise-name').value=ex?.name??'';el('exercise-notes').value=ex?.notes??'';el('exercise-schedule').value=ex?.schedule??'both';el('save-btn').textContent=editingId?'Update exercise':'Save exercise';el('exercise-name').focus();}
      el('add-btn').addEventListener('click',()=>{if(!el('exercise-form').hidden&&!editingId){closeForm();return;}openForm(null);});
      el('cancel-btn').addEventListener('click',closeForm);
      el('exercise-form').addEventListener('submit',event=>{
        event.preventDefault();const name=el('exercise-name').value.trim();if(!name)return;
        const schedule=el('exercise-schedule').value,notes=el('exercise-notes').value.trim();
        if(editingId){const ex=state.exercises.find(x=>x.id===editingId);if(ex){ex.name=name;ex.notes=notes;ex.schedule=schedule;}}
        else state.exercises.push({id:'ex_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),name,schedule,notes,createdOn:dayKey(),archivedOn:null});
        save();closeForm();render();showToast('Exercise saved.');
      });
      el('manage-list').addEventListener('click',event=>{
        const edit=event.target.closest('.edit-exercise'),remove=event.target.closest('.remove-exercise');if(!edit&&!remove)return;
        const ex=state.exercises.find(x=>x.id===(edit||remove).dataset.id);if(!ex)return;
        if(edit)openForm(ex);else if(confirm(`Remove “${ex.name}” from your plan?`)){ex.archivedOn=dayKey();save();render();showToast('Exercise removed.');}
      });
      for(const session of ['morning','evening']){
        el(`${session}-exercises`).addEventListener('change',event=>{
          if(!event.target.matches('input[type=checkbox]'))return;
          const id=event.target.dataset.id,key=`${id}_${session}`,date=dayKey();if(!state.log[date])state.log[date]={};
          if(event.target.checked)state.log[date][key]=true;else delete state.log[date][key];
          save();renderToday();
        });
        el(`${session}-on`).addEventListener('change',event=>{state.settings[`${session}On`]=event.target.checked;save();});
        el(`${session}-time`).addEventListener('change',event=>{state.settings[`${session}Time`]=event.target.value;save();});
      }
      el('new-quote').addEventListener('click',()=>{state.quoteIndex=(state.quoteIndex+1)%QUOTES.length;save();el('quote-text').textContent=QUOTES[state.quoteIndex];});
      el('hourly-on').addEventListener('change',event=>{state.settings.hourlyOn=event.target.checked;state.lastHourly=Date.now();save();});
      el('notification-btn').addEventListener('click',async()=>{
        if(!('Notification' in window)){showToast('Browser notifications are not supported here.');return;}
        try {const permission=await Notification.requestPermission();showToast(permission==='granted'?'Browser notifications enabled. Keep this page open for reminders.':'Notification permission not granted. In-page reminders still work.');}
        catch {showToast('Could not enable browser notifications here. In-page reminders still work.');}
      });
      function notify(message){showToast(message);if('Notification'in window&&Notification.permission==='granted'){try{new Notification('APP_NAME',{body:message});}catch{}}}
      function checkReminders(){
        const now=new Date(),time=`${pad(now.getHours())}:${pad(now.getMinutes())}`,today=dayKey(now);
        for(const session of ['morning','evening']){
          const key=`${today}_${session}`;
          if(state.settings[`${session}On`]&&state.settings[`${session}Time`]===time&&state.lastReminder[session]!==key){
            state.lastReminder[session]=key;save();
            const pending=sessionExercises(session,today).filter(x=>!isDone(today,x.id,session));
            if(pending.length)notify(`Your ${session} physiotherapy session is scheduled. ${pending.length} exercise${pending.length!==1?'s':''} remaining.`);
          }
        }
        if(state.settings.hourlyOn&&(!state.lastHourly||Date.now()-state.lastHourly>=60*60*1000)){
          state.lastHourly=Date.now();state.quoteIndex=(state.quoteIndex+1)%QUOTES.length;save();el('quote-text').textContent=QUOTES[state.quoteIndex];notify(QUOTES[state.quoteIndex]);
        }
      }
      render();checkReminders();setInterval(checkReminders,15000);
      document.addEventListener('visibilitychange',()=>{if(!document.hidden){renderToday();checkReminders();}});
    })();
