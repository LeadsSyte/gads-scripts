import { Resend } from 'resend';

let resend = null;

function getResend() {
  if (!resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error('RESEND_API_KEY not configured');
    resend = new Resend(apiKey);
  }
  return resend;
}

/**
 * Send articles as .docx email attachments.
 *
 * @param {string} recipientEmail
 * @param {string} clientName
 * @param {string} month - e.g. "March 2026"
 * @param {Array<{filename: string, buffer: Buffer}>} docxFiles
 */
export async function sendArticles(recipientEmail, clientName, month, docxFiles) {
  const attachments = docxFiles.map(file => ({
    filename: file.filename,
    content: file.buffer.toString('base64'),
  }));

  const fromAddress = process.env.EMAIL_FROM || 'Syte Content Machine <noreply@resend.dev>';

  const result = await getResend().emails.send({
    from: fromAddress,
    to: recipientEmail,
    subject: `${clientName} — SEO Content for ${month}`,
    html: `<p>Hi,</p>
<p>Please find this month's SEO content for <strong>${clientName}</strong> attached.</p>
<p>${docxFiles.length} article${docxFiles.length === 1 ? '' : 's'} generated and attached as .docx files.</p>
<p>Best regards,<br>Syte Content Machine</p>`,
    attachments,
  });

  return result;
}
