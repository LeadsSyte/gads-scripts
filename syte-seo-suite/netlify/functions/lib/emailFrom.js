// Sender for every email the suite sends (lib/sendMail.js). Kristan's choice: the
// automation@ mailbox, so replies reach a real inbox. Override with the
// EMAIL_FROM env var. Via Gmail the address is always the signed-in account.
export const EMAIL_FROM = process.env.EMAIL_FROM || 'Syte SEO Suite <automation@syte.co.za>';
