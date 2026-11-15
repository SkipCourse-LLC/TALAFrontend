"use strict";
// Real email adapter: sends plain-text mail from TALA's Google Workspace account
// through the Gmail API (users.messages.send). Only the gmail.send permission is
// used, so TALA can send mail but never read the mailbox.
const { object, email, text, paragraph } = require("./security.cjs");
const { integrationUnavailable, ProviderError } = require("./providerHttp.cjs");

const encodeHeader = (value) => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`);
const wrap = (base64) => base64.match(/.{1,76}/g)?.join("\r\n") ?? "";

/** Validates a message and returns its checked fields. Shared by every email mode. */
function emailMessage(message) {
  object(message, ["to", "subject", "text"]);
  // text() refuses CR, LF and other control characters, so headers cannot be injected.
  return { to: email(message.to), subject: text(message.subject, "email subject", 200), text: paragraph(message.text, "email text", 20000) };
}

/** Builds an RFC 5322 message. Headers carry only checked single-line values. */
function buildMime({ from, to, subject, text: body }) {
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(Buffer.from(body.replace(/\n/g, "\r\n"), "utf8").toString("base64")),
    "",
  ].join("\r\n");
}

function createGmailAdapter({ tokens, apiBase, sender }) {
  let from;
  try { from = email(sender ?? ""); } catch { throw new Error("TALA_GMAIL_SENDER must be the email address of the Google account that approved access."); }
  const sendUrl = `${apiBase}/gmail/v1/users/me/messages/send`;
  return {
    mode: "gmail",
    async send(message) {
      const checked = emailMessage(message);
      let sent;
      try {
        sent = await tokens.call("Gmail", sendUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ raw: Buffer.from(buildMime({ from, ...checked }), "utf8").toString("base64url") }),
        });
      } catch (error) {
        throw integrationUnavailable("email", error);
      }
      if (typeof sent?.id !== "string") throw integrationUnavailable("email", new ProviderError("Gmail", 200, "no_message_id"));
      return { id: sent.id, status: "sent" };
    },
  };
}

module.exports = { createGmailAdapter, emailMessage, buildMime };
