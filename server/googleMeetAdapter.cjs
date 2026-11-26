"use strict";
// Real meeting-link adapter: creates a Google Calendar event with a Google Meet
// conference through the Calendar API (events.insert, conferenceDataVersion=1).
// Google sends no invitations (sendUpdates=none); TALA sends its own email.
const { randomUUID } = require("node:crypto");
const { fail, object, text } = require("./security.cjs");
const { integrationUnavailable, ProviderError } = require("./providerHttp.cjs");

const MEET_URL = /^https:\/\/meet\.google\.com\/[a-z0-9-]{3,64}$/;
const SCHOOL_TIME_ZONE = "America/Phoenix";

function createGoogleMeetAdapter({ tokens, apiBase, calendarId }) {
  const eventBase = `${apiBase}/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const eventsUrl = `${eventBase}?conferenceDataVersion=1&sendUpdates=none`;
  return {
    mode: "google-meet",
    async createMeeting(input) {
      object(input, ["title", "startsAt", "endsAt"]);
      const starts = Date.parse(input.startsAt), ends = Date.parse(input.endsAt);
      if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts) fail(400, "INVALID_INPUT", "Choose a valid meeting time.");
      const title = text(input.title, "meeting title", 120);
      let event;
      try {
        event = await tokens.call("Google Calendar", eventsUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            summary: title,
            start: { dateTime: new Date(starts).toISOString(), timeZone: SCHOOL_TIME_ZONE },
            end: { dateTime: new Date(ends).toISOString(), timeZone: SCHOOL_TIME_ZONE },
            conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
          }),
        });
      } catch (error) {
        throw integrationUnavailable("meeting", error);
      }
      if (typeof event?.id !== "string") throw integrationUnavailable("meeting", new ProviderError("Google Calendar", 200, "no_event_id"));
      const base = { provider: "google-meet", meetingId: event.id, title, startsAt: new Date(starts).toISOString(), endsAt: new Date(ends).toISOString() };
      const statusCode = event.conferenceData?.createRequest?.status?.statusCode;
      // Google may finish creating the conference later. Never invent a link meanwhile.
      if (statusCode === "pending") return { ...base, status: "pending", joinUrl: null };
      const video = Array.isArray(event.conferenceData?.entryPoints)
        ? event.conferenceData.entryPoints.find((entry) => entry?.entryPointType === "video")
        : undefined;
      const joinUrl = typeof video?.uri === "string" ? video.uri : event.hangoutLink;
      if (statusCode === "failure" || typeof joinUrl !== "string" || !MEET_URL.test(joinUrl))
        throw integrationUnavailable("meeting", new ProviderError("Google Calendar", 200, "no_meet_link"));
      return { ...base, status: "ready", joinUrl };
    },
    /** Removes a meeting TALA created. An event that is already gone counts as removed. Sends no Google notices. */
    async deleteMeeting(meetingId) {
      if (typeof meetingId !== "string" || !/^[A-Za-z0-9_-]{1,1024}$/.test(meetingId)) fail(400, "INVALID_INPUT", "This meeting cannot be removed.");
      try {
        await tokens.call("Google Calendar", `${eventBase}/${encodeURIComponent(meetingId)}?sendUpdates=none`, { method: "DELETE" });
      } catch (error) {
        if (error instanceof ProviderError && (error.status === 404 || error.status === 410)) return { removed: true };
        throw integrationUnavailable("meeting", error);
      }
      return { removed: true };
    },
  };
}

module.exports = { createGoogleMeetAdapter };
