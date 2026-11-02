function getEnrollmentConfirmationEmail({
  parentName,
  parentEmail,
  parentPhone,
  parentAddress,
  meetingDate,
  meetingTime,
  meetingLink,
}) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>TALA Enrollment Confirmation</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f9fafb; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
      
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f9fafb; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table width="100%" max-width="600" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
              
              <!-- Header -->
              <tr>
                <td style="background-color: #1a3c34; padding: 32px; text-align: center;">
                  <h1 style="color: #ffffff; font-family: Georgia, serif; font-size: 28px; margin: 0; font-weight: normal;">Tucson Adaptive Learning Academy</h1>
                  <p style="color: #86efac; margin: 8px 0 0 0; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Enrollment Registration Received</p>
                </td>
              </tr>

              <!-- Content -->
              <tr>
                <td style="padding: 40px 32px;">
                  <h2 style="font-family: Georgia, serif; font-size: 22px; color: #111827; margin-top: 0;">Hi ${parentName},</h2>
                  <p style="color: #4b5563; font-size: 16px; line-height: 1.6;">
                    Thank you for starting the enrollment process for your student. We have successfully received your registration details and your request to meet with Tina.
                  </p>

                  <!-- Meeting Details Box -->
                  <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 24px; margin: 32px 0;">
                    <h3 style="color: #166534; font-size: 18px; margin-top: 0; margin-bottom: 16px;">📅 Your Enrollment Meeting</h3>
                    <p style="color: #111827; margin: 0 0 8px 0; font-size: 16px;"><strong>Date:</strong> ${meetingDate}</p>
                    <p style="color: #111827; margin: 0 0 16px 0; font-size: 16px;"><strong>Time:</strong> ${meetingTime}</p>
                    
                    <a href="${meetingLink}" style="display: inline-block; background-color: #1a3c34; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; font-size: 16px; margin-top: 8px;">
                      Join Google Meet
                    </a>
                    <p style="color: #6b7280; font-size: 12px; margin-top: 12px;">If the button doesn't work, copy and paste this link into your browser:<br/> <a href="${meetingLink}" style="color: #166534;">${meetingLink}</a></p>
                  </div>

                  <!-- Required Documents Section -->
                  <h3 style="font-family: Georgia, serif; font-size: 20px; color: #111827; margin-top: 32px;">📄 Required Enrollment Documents</h3>
                  <p style="color: #4b5563; font-size: 15px; line-height: 1.6;">
                    To ensure a smooth meeting and complete the enrollment process, please have digital copies of the following documents ready. You can reply to this email with attachments, or Tina can securely collect them during your meeting.
                  </p>
                  <ul style="color: #374151; font-size: 15px; line-height: 1.8; padding-left: 20px;">
                    <li><strong>Proof of Residency:</strong> A recent utility bill, lease agreement, or mortgage statement.</li>
                    <li><strong>Student Identity:</strong> Birth certificate or passport.</li>
                    <li><strong>Medical & Health Records:</strong> Most recent immunization records and any Individualized Education Programs (IEP) or 504 plans.</li>
                    <li><strong>Guardian Identification:</strong> A valid state-issued ID or driver's license.</li>
                  </ul>

                  <!-- Contact Info Recap -->
                  <h3 style="font-family: Georgia, serif; font-size: 20px; color: #111827; margin-top: 32px;">📋 Your Submitted Details</h3>
                  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border-top: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; margin-bottom: 24px;">
                    <tr>
                      <td style="padding: 12px 0; color: #6b7280; font-size: 14px; width: 100px;">Phone:</td>
                      <td style="padding: 12px 0; color: #111827; font-size: 14px; font-weight: 500;">${parentPhone}</td>
                    </tr>
                    <tr>
                      <td style="padding: 12px 0; color: #6b7280; font-size: 14px; width: 100px; border-top: 1px solid #f3f4f6;">Email:</td>
                      <td style="padding: 12px 0; color: #111827; font-size: 14px; font-weight: 500; border-top: 1px solid #f3f4f6;">${parentEmail}</td>
                    </tr>
                    <tr>
                      <td style="padding: 12px 0; color: #6b7280; font-size: 14px; width: 100px; border-top: 1px solid #f3f4f6;">Address:</td>
                      <td style="padding: 12px 0; color: #111827; font-size: 14px; font-weight: 500; border-top: 1px solid #f3f4f6;">${parentAddress}</td>
                    </tr>
                  </table>

                  <p style="color: #4b5563; font-size: 16px; line-height: 1.6;">
                    If you need to reschedule, or if you have any questions before we meet, please reply directly to this email.
                  </p>
                  <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin-bottom: 0;">
                    We look forward to meeting you!<br/>
                    <strong>The TALA Team</strong>
                  </p>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="background-color: #f3f4f6; padding: 24px 32px; text-align: center; border-top: 1px solid #e5e7eb;">
                  <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                    Tucson Adaptive Learning Academy<br/>
                    Room to learn. Space to become yourself.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

module.exports = { getEnrollmentConfirmationEmail };