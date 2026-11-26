"use strict";
const {randomUUID}=require("node:crypto");
const {transaction}=require("./database.cjs");
const STEP=30*60000;
// Synchronize only a bounded forward window. Never delete a reserved appointment.
function createAdmissionsGoogleSync(db,meeting) {
  async function refresh(days=30) {
    if(typeof meeting?.getAvailabilityEvents!=="function"||typeof meeting?.getBusyTimes!=="function")throw new Error("Google Calendar availability integration is not configured");
    const now=Date.now(),end=now+days*86400000;
    const events=await meeting.getAvailabilityEvents(new Date(now).toISOString(),new Date(end).toISOString());
    const busy=await meeting.getBusyTimes(new Date(now).toISOString(),new Date(end).toISOString());
    const candidates=new Map();
    for(const e of events){
      const start=Date.parse(e.startsAt),finish=Date.parse(e.endsAt);
      if(!Number.isFinite(start)||!Number.isFinite(finish)||finish<=start)continue;
      // Only aligned half-hour slots; don't invent availability outside the event.
      for(let t=Math.ceil(start/STEP)*STEP;t+STEP<=Math.min(finish,end);t+=STEP){
        if(t<=now)continue;
        if(busy.some(b=>t<Date.parse(b.endsAt)&&t+STEP>Date.parse(b.startsAt)))continue;
        candidates.set(`${t}:${t+STEP}`,{start:t,end:t+STEP,eventId:e.googleEventId});
      }
    }
    return transaction(db,()=>{
      const managed=db.prepare("SELECT slot_id FROM admissions_google_slots").all();
      const active=new Set();
      const find=db.prepare("SELECT id FROM slots WHERE starts_at=? AND ends_at=?");
      const add=db.prepare("INSERT OR IGNORE INTO slots(id,starts_at,ends_at,label,created_at) VALUES(?,?,?,?,?)");
      const purpose=db.prepare("INSERT OR IGNORE INTO admissions_slots(slot_id) VALUES(?)");
      const state=db.prepare("INSERT INTO availability_state(slot_id,status,updated_at,updated_by) VALUES(?,'published',?,NULL) ON CONFLICT(slot_id) DO UPDATE SET status='published',updated_at=excluded.updated_at");
      const map=db.prepare("INSERT INTO admissions_google_slots(slot_id,google_event_id) VALUES(?,?) ON CONFLICT(slot_id) DO UPDATE SET google_event_id=excluded.google_event_id");
      for(const c of candidates.values()){
        // Do not repurpose existing unrelated slots into admissions slots.
        let row=find.get(c.start,c.end);
        if(row&&!db.prepare("SELECT 1 FROM admissions_slots WHERE slot_id=?").get(row.id))continue;
        if(!row){const id=randomUUID();add.run(id,c.start,c.end,"Meeting with Tina",now);row=find.get(c.start,c.end);}
        purpose.run(row.id);state.run(row.id,now);map.run(row.id,c.eventId);active.add(row.id);
      }
      const withdraw=db.prepare("UPDATE availability_state SET status='withdrawn',updated_at=? WHERE slot_id=?");
      for(const old of managed)if(!active.has(old.slot_id))withdraw.run(now,old.slot_id);
      return {available:active.size};
    });
  }
  return {refresh};
}
module.exports={createAdmissionsGoogleSync};