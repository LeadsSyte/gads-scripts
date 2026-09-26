// Sender for every email the suite sends (Resend). Kristan's choice: the
// automation@ mailbox, so replies reach a real inbox. Override with the
// EMAIL_FROM env var. Resend only sends once syte.co.za is verified there.
export const EMAIL_FROM = process.env.EMAIL_FROM || 'Syte SEO Suite <automation@syte.co.za>';
