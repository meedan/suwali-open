type FormValidationRule = {
  id: string;
  value: string;
  setter: (value: string) => void;
  validator: (value: string) => boolean;
  errorMessage: string;
  requiredMessage?: string | null;
};

export const isValidUrl = (value: string): boolean => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

// Dotted labels of letters, digits and hyphens ending in a top-level domain (letters, or xn-- for those in other scripts),
// or an IPv4 address, or localhost. The URL parser is looser than that and lets a comma through, for one, so www.google,asdf is a host to it
const hostRegex = /^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,}|xn--[a-z0-9-]+)|\d{1,3}(?:\.\d{1,3}){3})$/;

// A web address a person typed, as a full http(s) address, or null when it is not one. Without a scheme https is assumed.
// It needs a real host name, such as example.com, or localhost, which rules out words that parse as a host (asdf), junk the
// parser lets through (www.google,asdf) and other schemes (ftp://x.com, mailto:a@b.co) that would otherwise be read as part
// of an https address.
export const normalizeUrl = (value: string): string | null => {
  const url = withScheme(value);
  if (!isValidUrl(url)) return null;

  const { hostname, username, password } = new URL(url);
  return hostRegex.test(hostname) && !username && !password ? url : null;
};

export type FormValidationRules = FormValidationRule[];

export const validateForm = (formValidationRules: FormValidationRules, validateRequired = true) => {
  const errors: string[] = [];

  formValidationRules.forEach(({
    value,
    validator,
    setter,
    errorMessage,
    requiredMessage,
  }) => {
    if (value && !validator(value)) {
      setter(errorMessage);
      errors.push(errorMessage);
    } else if (!value && requiredMessage && validateRequired) {
      setter(requiredMessage ?? '');
      errors.push(requiredMessage ?? '');
    } else if (value) {
      setter('');
    }
  });

  return errors;
};

export const validateField = (formValidationRules: FormValidationRules, fieldId: string) => {
  const rule = formValidationRules.find(rule => rule.id === fieldId);
  if (!rule) return [];
  return validateForm([rule], false);
};

export const validateEmail = (email: string) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
};

export const validatePassword = (password: string) => {
  const re = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[^\w\s]).{8,}$/;
  return re.test(password);
};

export const validateInviteCode = (inviteCode: string) => {
  const re = /^[a-zA-Z0-9]{6}$/;
  return inviteCode.trim() === '' || re.test(inviteCode);
};

export const validatePasswordStrength = (password: string) => {
    let score = 0;
    // Check password length
    if (password.length >= 8) score += 1;
    // Contains letters
    if (/[a-zA-Z]/.test(password)) score += 1;
    // Contains numbers
    if (/\d/.test(password)) score += 1;
    // Contains special characters
    if (/[^A-Za-z0-9]/.test(password)) score += 1;

    return score;
};

export const withScheme = (url: string) => {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};
