
"use strict";

const { randomUUID } = require("node:crypto");

const {
  object,
  email,
  text,
  paragraph
} = require("./security.cjs");

const {
  integrationUnavailable,
  ProviderError
} = require("./providerHttp.cjs");

const encodeHeader = (value) =>
  /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;

const wrap = (base64) =>
  base64.match(/.{1,76}/g)?.join("\r\n") ?? "";

function encodeBody(value) {
  return wrap(
    Buffer.from(
      value.replace(/\r?\n/g, "\r\n"),
      "utf8"
    ).toString("base64")
  );
}

// Validate both plain-text and HTML emails.
function emailMessage(message) {
  object(message, [
    "to",
    "subject",
    "text",
    "html"
  ]);

  return {
    to: email(message.to),

    subject: text(
      message.subject,
      "email subject",
      200
    ),

    text: paragraph(
      message.text,
      "email text",
      20000
    ),

    ...(message.html !== undefined
      ? {
          html: paragraph(
            message.html,
            "email html",
            20000
          )
        }
      : {})
  };
}

// Build an RFC 5322 MIME message.
function buildMime({
  from,
  to,
  subject,
  text: body,
  html
}) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0"
  ];

  // Preserve support for existing plain-text emails.
  if (!html) {
    return [
      ...headers,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      encodeBody(body),
      ""
    ].join("\r\n");
  }

  // HTML email with plain-text fallback.
  const boundary = `tala-${randomUUID()}`;

  return [
    ...headers,

    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",

    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeBody(body),
    "",

    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeBody(html),
    "",

    `--${boundary}--`,
    ""
  ].join("\r\n");
}

function createGmailAdapter({
  tokens,
  apiBase,
  sender
}) {
  let from;

  try {
    from = email(sender ?? "");
  } catch {
    throw new Error(
      "TALA_GMAIL_SENDER must be the email address of the Google account that approved access."
    );
  }

  const sendUrl =
    `${apiBase}/gmail/v1/users/me/messages/send`;

  return {
    mode: "gmail",

    async send(message) {
      let checked;

      // Log validation failures separately.
      try {
        checked = emailMessage(message);
      } catch (error) {
        console.error("[GMAIL VALIDATION FAILED]", {
          name: error?.name,
          code: error?.code,
          status: error?.status
        });

        throw error;
      }

      let sent;

      try {
        const mime = buildMime({
          from,
          ...checked
        });

        sent = await tokens.call(
          "Gmail",
          sendUrl,
          {
            method: "POST",

            headers: {
              "content-type": "application/json"
            },

            body: JSON.stringify({
              raw: Buffer.from(
                mime,
                "utf8"
              ).toString("base64url")
            })
          }
        );

      } catch (error) {
        console.error("[TALA Gmail Error]", {
          status: error?.status,
          reason: error?.reason,
          code: error?.code,
          type: error?.name
        });

        throw integrationUnavailable(
          "email",
          error
        );
      }

      if (typeof sent?.id !== "string") {
        throw integrationUnavailable(
          "email",
          new ProviderError(
            "Gmail",
            200,
            "no_message_id"
          )
        );
      }

      console.log("[GMAIL SEND SUCCESS]", {
        subject: checked.subject,
        format: checked.html ? "HTML" : "TEXT",
        messageId: sent.id,
        threadId: sent.threadId,
        labelIds: sent.labelIds,
        sentAt: new Date().toISOString()
      });

      return {
        id: sent.id,
        status: "sent"
      };
    }
  };
}

module.exports = {
  createGmailAdapter,
  emailMessage,
  buildMime
};