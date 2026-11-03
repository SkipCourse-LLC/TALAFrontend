const path = require('path');

// Explicitly tell dotenv to look in the server folder for the .env file
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { google } = require('googleapis');

// 1. Verify credentials loaded
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REFRESH_TOKEN) {
  console.error("ERROR: Missing Google credentials in .env file.");
} else {
  console.log("Google API credentials loaded from .env");
}

// 2. Setup the OAuth2 client using variables from .env
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || "https://developers.google.com/oauthplayground"
);

// 3. Set the Refresh Token
oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

// 4. The function that creates the meeting
async function createMeetLink(startTime, endTime, parentEmail, parentName) {
  try {
    console.log(`Creating Google Meet for ${parentEmail}...`);

    const event = {
      summary: `TALA Enrollment Meeting with ${parentName}`,
      description: "Enrollment discussion for your student.",
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
      conferenceDataVersion: 1, // Required to get the link back
      sendUpdates: 'all',       // Sends an email invite to the parent
    });

    // Extract the actual Meet link from the response
    const meetLink = response.data.conferenceData.entryPoints[0].uri;
    console.log(`Successfully created link: ${meetLink}`);
    
    return meetLink;

  } catch (error) {
    console.error("Error creating Google Meet:", error.message);
    
    if (error.message.includes("unauthorized_client") || error.message.includes("invalid_grant")) {
      console.error("The Refresh Token is invalid or doesn't match the Client ID. Generate a new one in the Playground.");
    }

    return null; 
  }
}

module.exports = { createMeetLink };