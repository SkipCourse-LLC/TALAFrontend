
"use strict";

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]
  );
}

//google meet url
function getMeetUrl(value) {
  try {
    const url = new URL(value);

    if (
      url.protocol === "https:" &&
      url.hostname === "meet.google.com"
    ) {
      return url.href;
    }
  } catch {}

  return "";
}
//google meet url is used in meeting confirmation email template and enrollment confirmation email template

function getStudentFormUrl() {
  const rawUrl =
    process.env.TALA_STUDENT_FORM_URL?.trim() || "";

  try {
    const url = new URL(rawUrl);

    const isGoogleForm =
      url.hostname === "docs.google.com" &&
      url.pathname.startsWith("/forms/");

    const isShortForm =
      url.hostname === "forms.gle";

    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (isGoogleForm || isShortForm)
    ) {
      return url.href;
    }
  } catch {}

  console.warn(
    "[TALA] Student information form URL is missing or invalid."
  );

  return "";
}

//shared email layout for all TALA emails

function emailLayout(subtitle, content) {
  return `
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="utf-8">

  <meta name="viewport"
    content="width=device-width, initial-scale=1.0">
</head>

<body style="
  margin:0;
  padding:0;
  background:#f9fafb;
  font-family:Arial,Helvetica,sans-serif;
">

<table width="100%" cellspacing="0" cellpadding="0"
  style="background:#f9fafb;">

<tr>
<td align="center" style="padding:40px 16px;">

<table width="100%" cellspacing="0" cellpadding="0"
  style="
    max-width:600px;
    background:#ffffff;
    border:1px solid #e5e7eb;
    border-radius:12px;
  ">

<!-- HEADER -->

<tr>
<td style="
  background:#1a3c34;
  padding:32px;
  text-align:center;
  border-radius:12px 12px 0 0;
">

<h1 style="
  color:#ffffff;
  font-family:Georgia,serif;
  font-size:28px;
  font-weight:normal;
  margin:0;
">
  Tucson Adaptive Learning Academy
</h1>

<p style="
  color:#86efac;
  font-size:14px;
  letter-spacing:1px;
  margin:12px 0 0;
">
  ${escapeHtml(subtitle)}
</p>

</td>
</tr>

<!-- CONTENT -->

<tr>
<td style="
  padding:32px;
  color:#4b5563;
  font-size:16px;
  line-height:1.6;
">

${content}

<p style="margin-top:32px;">
  We look forward to meeting you!
  <br>
  <strong>The TALA Team</strong>
</p>

</td>
</tr>

<!-- FOOTER -->

<tr>
<td style="
  background:#f3f4f6;
  padding:24px;
  text-align:center;
  color:#6b7280;
  font-size:12px;
  border-radius:0 0 12px 12px;
">

  <strong>Tucson Adaptive Learning Academy</strong>

  <br>

  Room to learn. Space to become yourself.

</td>
</tr>

</table>
</td>
</tr>
</table>

</body>
</html>`;
}

//shared email button design

function emailButton(label, url) {
  return `
    <table cellspacing="0" cellpadding="0"
      align="center" style="margin:20px auto;">

      <tr>
        <td bgcolor="#1a3c34"
          style="border-radius:6px;">

          <a href="${escapeHtml(url)}"
            target="_blank"
            style="
              display:inline-block;
              background:#1a3c34;
              color:#ffffff;
              padding:14px 26px;
              border-radius:6px;
              text-decoration:none;
              font-weight:bold;
              font-size:15px;
            ">

            ${escapeHtml(label)}

          </a>

        </td>
      </tr>

    </table>
  `;
}

//meeting confirmation template

function meetingConfirmation({
  parentName,
  startsAt,
  endsAt,
  meetingLink
}) {
  const name = escapeHtml(parentName);

  const meetingDate = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: "America/Phoenix",
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    }
  ).format(new Date(startsAt));

  const formatter = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: "America/Phoenix",
      hour: "numeric",
      minute: "2-digit"
    }
  );

  const meetingTime =
    `${formatter.format(new Date(startsAt))} - ` +
    `${formatter.format(new Date(endsAt))}`;

  const validLink = getMeetUrl(meetingLink);

  const content = `

    <h2 style="
      font-family:Georgia,serif;
      color:#111827;
    ">
      Hi ${name},
    </h2>

    <p>
      Thank you for starting the enrollment process
      for your student at Tucson Adaptive Learning
      Academy.
    </p>

    <p>
      Your meeting with Tina has been
      successfully scheduled.
    </p>

    <div style="
      background:#f0fdf4;
      border:1px solid #bbf7d0;
      border-radius:8px;
      padding:24px;
      margin:24px 0;
    ">

      <h3 style="
        color:#166534;
        margin-top:0;
        text-align:center;
      ">
        Your Enrollment Meeting
      </h3>

      <p>
        <strong>Date:</strong>
        ${meetingDate}
      </p>

      <p>
        <strong>Time:</strong>
        ${meetingTime}
      </p>

      <p>
        <strong>Time Zone:</strong>
        Arizona (MST)
      </p>

      ${validLink ? `

        ${emailButton(
          "Join Google Meet",
          validLink
        )}

        <p style="
          font-size:12px;
          color:#6b7280;
          overflow-wrap:anywhere;
        ">
          If the button does not work,
          use the following link:

          <br>

          <a href="${escapeHtml(validLink)}"
            style="color:#166534;">

            ${escapeHtml(validLink)}

          </a>
        </p>

      ` : `

        <p>
          TALA will provide your meeting link
          before the interview.
        </p>

      `}

    </div>

    <p>
      Please check your inbox for a separate email
      explaining how to prepare for your
      enrollment meeting.
    </p>

    <p>
      If you need to reschedule, please return
      to your application on the TALA website.
    </p>

  `;

  return {
    subject:
      "Your TALA Enrollment Meeting Confirmation",

    text: [
      `Hi ${parentName},`,
      "",
      "Your enrollment meeting with Tina is confirmed.",
      "",
      `Date: ${meetingDate}`,
      `Time: ${meetingTime} (Arizona MST)`,
      "",
      validLink
        ? `Join Google Meet: ${validLink}`
        : "TALA will provide your meeting link.",
      "",
      "Please check your inbox for the preparation email.",
      "",
      "If you need to reschedule, return to your application on the TALA website.",
      "",
      "The TALA Team"
    ].join("\n"),

    html: emailLayout(
      "ENROLLMENT MEETING CONFIRMED",
      content
    )
  };
}

//check document checklist for enrollment meeting

function documentChecklist() {
  return `

    <h3 style="
      font-family:Georgia,serif;
      color:#111827;
    ">
      Required Enrollment Documents
    </h3>

    <p>
      Please have the following documents ready,
      as applicable:
    </p>

    <ul style="
      color:#374151;
      line-height:1.8;
      padding-left:20px;
    ">

      <li style="margin-bottom:12px;">
        <strong>Proof of Residency:</strong>
        A recent utility bill, lease agreement,
        or mortgage statement.
      </li>

      <li style="margin-bottom:12px;">
        <strong>Student Identity:</strong>
        Birth certificate or passport.
      </li>

      <li style="margin-bottom:12px;">
        <strong>Medical &amp; Health Records:</strong>
        Immunization records and applicable
        IEP or 504 plans.
      </li>

      <li style="margin-bottom:12px;">
        <strong>Guardian Identification:</strong>
        A valid state-issued ID or driver's license.
      </li>

    </ul>

    <div style="
      background:#f9fafb;
      border:1px solid #e5e7eb;
      border-radius:8px;
      padding:20px;
      margin:24px 0;
    ">

      <strong>Document Submission</strong>

      <p style="margin-bottom:0;">
        Please use a school-approved secure process
        to submit sensitive documents, or arrange
        to provide them securely during your meeting.

        Do not send sensitive documents by email.
      </p>

    </div>

  `;
}

//email preparation template

function meetingPreparation({ parentName }) {
  const name = escapeHtml(parentName);

  const formUrl = getStudentFormUrl();

  const content = `

    <h2 style="
      font-family:Georgia,serif;
      color:#111827;
    ">
      Hi ${name},
    </h2>

    <p>
      To help us prepare for a smooth enrollment
      meeting, please review the following
      information before meeting with Tina.
    </p>

    <!-- STUDENT INFORMATION FORM -->

    <div style="
      background:#f0fdf4;
      border:1px solid #bbf7d0;
      border-radius:8px;
      padding:24px;
      margin:24px 0;
      text-align:center;
    ">

      <h3 style="
        color:#166534;
        margin-top:0;
      ">
        Student Information Form
      </h3>

      ${formUrl ? `

        <p>
          Please complete the student information
          form before your enrollment meeting.
        </p>

        ${emailButton(
          "Complete Student Information",
          formUrl
        )}

        <p style="
          font-size:12px;
          color:#6b7280;
          overflow-wrap:anywhere;
        ">

          If the button does not work,
          copy and paste this link into your browser:

          <br>

          <a href="${escapeHtml(formUrl)}"
            style="color:#166534;">

            ${escapeHtml(formUrl)}

          </a>

        </p>

      ` : `

        <p>
          TALA will provide instructions for
          completing the student information form.
        </p>

      `}

    </div>

    <!-- REQUIRED DOCUMENTS -->

    ${documentChecklist()}

    <p>
      Thank you for taking the time to prepare
      for your enrollment meeting.
    </p>

    <p>
      If you have any questions, please contact
      TALA Admissions.
    </p>

  `;

  return {
    subject:
      "TALA: Preparing for Your Enrollment Meeting",

    text: [
      `Hi ${parentName},`,
      "",
      "Please prepare for your enrollment meeting with Tina.",
      "",
      formUrl
        ? `Complete the student information form: ${formUrl}`
        : "TALA will provide student form instructions.",
      "",
      "Required Enrollment Documents:",
      "",
      "- Proof of Residency",
      "- Student Identity",
      "- Medical and Health Records",
      "- Guardian Identification",
      "",
      "Please submit sensitive documents through a school-approved secure process.",
      "Do not send sensitive documents by email.",
      "",
      "The TALA Team"
    ].join("\n"),

    html: emailLayout(
      "PREPARING FOR YOUR MEETING",
      content
    )
  };
}


function getEnrollmentConfirmationEmail({
  parentName,
  parentEmail,
  parentPhone,
  parentAddress,
  meetingDate,
  meetingTime,
  meetingLink
}) {
  const validLink = getMeetUrl(meetingLink);

  const formUrl = getStudentFormUrl();

  const content = `

    <h2 style="
      font-family:Georgia,serif;
      color:#111827;
    ">
      Hi ${escapeHtml(parentName)},
    </h2>

    <p>
      Thank you for starting the enrollment process
      for your student.
    </p>

    <p>
      We have successfully received your
      registration details.
    </p>

    <div style="
      background:#f0fdf4;
      border:1px solid #bbf7d0;
      border-radius:8px;
      padding:24px;
      margin:24px 0;
    ">

      <h3 style="color:#166534;">
        Your Enrollment Meeting
      </h3>

      <p>
        <strong>Date:</strong>
        ${escapeHtml(meetingDate)}
      </p>

      <p>
        <strong>Time:</strong>
        ${escapeHtml(meetingTime)}
      </p>

      ${validLink
        ? emailButton("Join Google Meet", validLink)
        : "<p>TALA will provide your meeting link.</p>"
      }

    </div>

    ${formUrl ? `

      <div style="
        background:#f0fdf4;
        border:1px solid #bbf7d0;
        border-radius:8px;
        padding:24px;
        margin:24px 0;
        text-align:center;
      ">

        <h3 style="color:#166534;">
          Student Information Form
        </h3>

        <p>
          Please complete the student information
          form before your meeting.
        </p>

        ${emailButton(
          "Complete Student Information",
          formUrl
        )}

      </div>

    ` : ""}

    ${documentChecklist()}

    <p>
      If you need to reschedule or have any questions,
      please contact TALA Admissions.
    </p>

  `;

  return emailLayout(
    "ENROLLMENT REGISTRATION RECEIVED",
    content
  );
}


module.exports = {
  getEnrollmentConfirmationEmail,
  meetingConfirmation,
  meetingPreparation
};