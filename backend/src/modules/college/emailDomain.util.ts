// Helpers for matching a student's email to a college by domain.
// A college stores e.g. emailDomain "xaviertech.ac.in"; it covers that domain and every subdomain
// (student.xaviertech.ac.in, staff.xaviertech.ac.in), always splitting on a dot, so
// "evil-xaviertech.ac.in" and "xaviertech.ac.in.attacker.com" never match.

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

// Public mailbox providers can never identify a college.
const PUBLIC_EMAIL_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.in', 'yahoo.co.in', 'outlook.com', 'hotmail.com',
  'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'zoho.com',
  'gmx.com', 'mail.com', 'rediffmail.com', 'yandex.com',
];

// Two-label domains whose first label is a generic second-level label ("ac.in", "co.uk", "edu.au")
// are public suffixes: claiming one would claim every institution under it.
const GENERIC_SECOND_LEVEL = ['ac', 'edu', 'co', 'com', 'org', 'net', 'gov', 'nic', 'res', 'sch', 'mil'];

/** True when `domain` is `parent` itself or a subdomain of it. */
export const domainCoveredBy = (domain: string, parent: string): boolean =>
  domain === parent || domain.endsWith('.' + parent);

/** True when one domain covers the other (equal or nested) - two colleges must never overlap. */
export const domainsOverlap = (a: string, b: string): boolean => domainCoveredBy(a, b) || domainCoveredBy(b, a);

export const isPublicProviderDomain = (domain: string): boolean =>
  PUBLIC_EMAIL_DOMAINS.some((p) => domainCoveredBy(domain, p));

/**
 * Normalizes and validates a college email domain: trimmed, lowercased, a leading "@" is dropped.
 * Returns the clean domain, or an error message.
 */
export const parseCollegeEmailDomain = (input: unknown): { domain: string } | { error: string } => {
  if (typeof input !== 'string') return { error: 'emailDomain must be a string' };
  const domain = input.trim().toLowerCase().replace(/^@/, '');
  if (!DOMAIN_RE.test(domain)) return { error: 'emailDomain must be a valid domain like "college.ac.in" (no @, no spaces)' };
  const labels = domain.split('.');
  if (labels.length === 2 && GENERIC_SECOND_LEVEL.includes(labels[0])) {
    return { error: 'emailDomain is too broad: it must identify one institution, not a whole public suffix' };
  }
  if (isPublicProviderDomain(domain)) return { error: 'emailDomain cannot be a public email provider' };
  return { domain };
};

/** The domain part of an email address (lowercased), or null if it is not a plausible address. */
export const emailDomainOf = (email: unknown): string | null => {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at < 1 || at === trimmed.length - 1) return null;
  const domain = trimmed.slice(at + 1);
  return DOMAIN_RE.test(domain) ? domain : null;
};
