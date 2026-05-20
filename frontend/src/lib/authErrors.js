// Map Supabase auth error codes / messages to user-friendly copy.
// Falls back to original message when no mapping matches.
const MAP = [
  { match: /Invalid login credentials/i, msg: 'That email or password didn’t match. Try again.' },
  { match: /Email not confirmed/i, msg: 'Check your inbox to confirm your email before signing in.' },
  { match: /User already registered/i, msg: 'An account with that email already exists. Try signing in.' },
  { match: /rate limit/i, msg: 'Too many attempts. Wait a minute and try again.' },
  { match: /Password should be at least/i, msg: 'Password needs at least 6 characters.' },
  { match: /Unable to validate email address/i, msg: 'That email address doesn’t look right.' },
  { match: /network|fetch/i, msg: 'Network hiccup. Check your connection and retry.' },
];

export function mapAuthError(err) {
  if (!err) return null;
  const msg = typeof err === 'string' ? err : (err.message ?? String(err));
  for (const entry of MAP) {
    if (entry.match.test(msg)) return entry.msg;
  }
  return msg;
}
