// server/googleMeet.cjs
require('dotenv').config(); // Load the .env file
const { google } = require('googleapis');

// 1. Setup the OAuth client
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'https://developers.google.com/oauthplayground' // Matches the Playground
);

// 2. Set the refresh token so it doesn't expire
oauth2Client.setCredentials({ 
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN 
});

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

// 3. The function to create the meeting
async function createMeetLink(startTime, endTime, parentEmail, parentName) {
  try {
    const event = {
      summary: `TALA Enrollment Meeting with ${parentName}`,
      start: { dateTime: startTime, timeZone: 'America/Phoenix' },
      end: { dateTime: endTime, timeZone: 'America/Phoenix' },
      attendees: [{ email: parentEmail }],
      conferenceData: {
        createRequest: {
          requestId: `tala-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      conferenceDataVersion: 1,
      sendUpdates: 'all', 
    });

    return response.data.conferenceData.entryPoints[0].uri; 
  } catch (error) {
    console.error('Error creating Google Meet:', error.message);
    return null; 
  }
}

module.exports = { createMeetLink };