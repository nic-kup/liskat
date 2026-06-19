// Feedback handling: every submission is appended to a local file (so nothing
// is ever lost and it works with zero configuration), and — if SMTP credentials
// are provided via env — also emailed.
//
// Hostinger SMTP example (set these in the server's environment):
//   SMTP_HOST=smtp.hostinger.com  (default)
//   SMTP_PORT=465                 (default; SSL)
//   SMTP_USER=feedback@liskat.com
//   SMTP_PASS=<the mailbox password>
//   FEEDBACK_TO=feedback@liskat.com  (default = SMTP_USER)

import nodemailer from 'nodemailer';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const FILE = join(DATA_DIR, 'feedback.jsonl');

export interface Feedback {
  message: string;
  contact?: string; // optional email/name the submitter left
  ip?: string;
}

let transporter: nodemailer.Transporter | null | undefined;

function mailer(): nodemailer.Transporter | null {
  if (transporter !== undefined) return transporter;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    transporter = null; // not configured — file storage only
    return null;
  }
  const port = Number(process.env.SMTP_PORT ?? 465);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'smtp.hostinger.com',
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return transporter;
}

export async function recordFeedback(fb: Feedback): Promise<void> {
  const entry = { ts: new Date().toISOString(), ...fb };
  await mkdir(DATA_DIR, { recursive: true });
  await appendFile(FILE, JSON.stringify(entry) + '\n', 'utf8');

  const t = mailer();
  if (!t) return;
  const to = process.env.FEEDBACK_TO ?? process.env.SMTP_USER!;
  try {
    await t.sendMail({
      from: process.env.FEEDBACK_FROM ?? process.env.SMTP_USER!,
      to,
      replyTo: fb.contact || undefined,
      subject: 'Liskat feedback',
      text: `From: ${fb.contact || 'anonymous'}\nIP: ${fb.ip ?? 'unknown'}\nWhen: ${entry.ts}\n\n${fb.message}`,
    });
  } catch (e) {
    // Email is best-effort; the file copy is the source of truth.
    console.error('feedback email failed:', (e as Error).message);
  }
}
