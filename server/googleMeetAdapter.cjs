"use strict";
const { randomUUID } = require("node:crypto");
const { fail, object, text } = require("./security.cjs");
const { integrationUnavailable, ProviderError } = require("./providerHttp.cjs");
const MEET_URL = /^https:\/\/meet\.google\.com\/[a-z0-9-]{3,64}$/;
const ZONE = "America/Phoenix";
const AVAILABILITY_TITLE = "TALA Available";
function validRange(a,b) {
  const start=Date.parse(a), end=Date.parse(b);
  if (!Number.isFinite(start)||!Number.isFinite(end)||end<=start) fail(400,"INVALID_INPUT","Choose a valid date range.");
  return {start,end};
}
function createGoogleMeetAdapter({tokens,apiBase,calendarId}) {
  const eventBase=`${apiBase}/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const eventUrl=id=>`${eventBase}/${encodeURIComponent(id)}`;
  const call=async (purpose,url,options)=>{
    try {return await tokens.call("Google Calendar",url,options);}
    catch(error){throw integrationUnavailable(purpose,error);}
  };
  async function getAvailabilityEvents(startsAt,endsAt) {
    validRange(startsAt,endsAt);
    const events=[]; let pageToken;
    do {
      const q=new URLSearchParams({timeMin:new Date(startsAt).toISOString(),timeMax:new Date(endsAt).toISOString(),singleEvents:"true",orderBy:"startTime",maxResults:"250"});
      if(pageToken) q.set("pageToken",pageToken);
      const result=await call("availability",`${eventBase}?${q}`,{method:"GET"});
      if(!Array.isArray(result?.items)) throw integrationUnavailable("availability",new ProviderError("Google Calendar",200,"invalid_events_response"));
      events.push(...result.items); pageToken=result.nextPageToken;
    }while(pageToken);
    return events.filter(e=>e.status!=="cancelled"&&e.summary===AVAILABILITY_TITLE&&e.start?.dateTime&&e.end?.dateTime&&e.transparency==="transparent")
      .map(e=>({googleEventId:e.id,recurringEventId:e.recurringEventId??null,startsAt:e.start.dateTime,endsAt:e.end.dateTime,updatedAt:e.updated??null}));
  }
  async function getBusyTimes(startsAt,endsAt) {
    const {start,end}=validRange(startsAt,endsAt);
    const result=await call("availability",`${apiBase}/calendar/v3/freeBusy`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({timeMin:new Date(start).toISOString(),timeMax:new Date(end).toISOString(),timeZone:ZONE,items:[{id:calendarId}]})});
    const calendar=result?.calendars?.[calendarId];
    if(!calendar||calendar.errors?.length||!Array.isArray(calendar.busy))throw integrationUnavailable("availability",new ProviderError("Google Calendar",200,"invalid_availability_response"));
    return calendar.busy.map(p=>({startsAt:p.start,endsAt:p.end}));
  }
  async function createAvailabilityEvent(input) {
    object(input, ["startsAt", "endsAt", "label", "requestId"]);
    const { start, end } = validRange(input.startsAt, input.endsAt);
    const event=await call("availability",eventBase,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({summary:AVAILABILITY_TITLE,transparency:"transparent",start:{dateTime:new Date(start).toISOString(),timeZone:ZONE},end:{dateTime:new Date(end).toISOString(),timeZone:ZONE},extendedProperties:{private:{talaAvailability:"1"}}})});
    if(!event?.id)throw integrationUnavailable("availability",new ProviderError("Google Calendar",200,"missing_event_id"));
    return {googleEventId:event.id,startsAt:event.start?.dateTime??input.startsAt,endsAt:event.end?.dateTime??input.endsAt};
  }
  async function ownedAvailability(id) {
    if(typeof id!=="string"||!/^[A-Za-z0-9_-]{1,1024}$/.test(id))fail(400,"INVALID_INPUT","Invalid event ID.");
    const e=await call("availability",eventUrl(id),{method:"GET"});
    if(e?.extendedProperties?.private?.talaAvailability!=="1"||e.summary!==AVAILABILITY_TITLE)fail(403,"FORBIDDEN","Only availability created by TALA Admin can be edited here.");
    return e;
  }
  async function updateAvailabilityEvent(id,input) {
    object(input,["startsAt","endsAt"]);const {start,end}=validRange(input.startsAt,input.endsAt);
    await ownedAvailability(id);
    const e=await call("availability",eventUrl(id),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({start:{dateTime:new Date(start).toISOString(),timeZone:ZONE},end:{dateTime:new Date(end).toISOString(),timeZone:ZONE},transparency:"transparent"})});
    return {googleEventId:e.id,startsAt:e.start?.dateTime,endsAt:e.end?.dateTime};
  }
  async function deleteAvailabilityEvent(id) {
    await ownedAvailability(id);
    await call("availability",eventUrl(id),{method:"DELETE"});
    return {deleted:true};
  }
  async function createMeeting(input) {
    object(input,["title","startsAt","endsAt"]);const {start,end}=validRange(input.startsAt,input.endsAt);
    const title=text(input.title,"meeting title",120);
    const e=await call("meeting",`${eventBase}?conferenceDataVersion=1&sendUpdates=none`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({summary:title,start:{dateTime:new Date(start).toISOString(),timeZone:ZONE},end:{dateTime:new Date(end).toISOString(),timeZone:ZONE},conferenceData:{createRequest:{requestId:randomUUID(),conferenceSolutionKey:{type:"hangoutsMeet"}}}})});
    if(typeof e?.id!=="string")throw integrationUnavailable("meeting",new ProviderError("Google Calendar",200,"no_event_id"));
    const base={provider:"google-meet",meetingId:e.id,title,startsAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString()};
    const statusCode=e.conferenceData?.createRequest?.status?.statusCode;
    if(statusCode==="pending")return {...base,status:"pending",joinUrl:null};
    const video=e.conferenceData?.entryPoints?.find(p=>p?.entryPointType==="video");
    const joinUrl=video?.uri??e.hangoutLink;
    if(statusCode==="failure"||typeof joinUrl!=="string"||!MEET_URL.test(joinUrl))throw integrationUnavailable("meeting",new ProviderError("Google Calendar",200,"no_meet_link"));
    return {...base,status:"ready",joinUrl};
  }
  async function deleteMeeting(id) {
    if(typeof id!=="string"||!/^[A-Za-z0-9_-]{1,1024}$/.test(id))fail(400,"INVALID_INPUT","Invalid meeting ID.");
    try{await tokens.call("Google Calendar",`${eventUrl(id)}?sendUpdates=none`,{method:"DELETE"});}
    catch(e){if(e instanceof ProviderError&&(e.status===404||e.status===410))return {removed:true};throw integrationUnavailable("meeting",e);}
    return {removed:true};
  }
  return {mode:"google-meet",getBusyTimes,getAvailabilityEvents,createAvailabilityEvent,updateAvailabilityEvent,deleteAvailabilityEvent,createMeeting,deleteMeeting};
}
module.exports={createGoogleMeetAdapter};
