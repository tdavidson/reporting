import crypto from 'crypto'

// The public deal-submission token is a bearer credential for the /submit/<token> form. We store
// only its SHA-256 hash, so a database leak doesn't hand out working links. The plaintext is shown
// once, at mint time, and never again.
export function hashSubmissionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}
