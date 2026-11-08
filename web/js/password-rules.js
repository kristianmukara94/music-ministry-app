// What the choose-a-password screen asks of a new password. These are browser-side rules: the server's own minimum is
// checkNewPassword in server/lib/rules.js. No DOM here, so the rules can be tested in Node.

export const MIN_NEW_PASSWORD_LENGTH = 10;

// Any character that is not a letter or a space: digits and punctuation, from any alphabet.
const NUMBER_OR_SYMBOL = /[^\p{L}\p{M}\s]/u;

/** One answer per item of the on-screen checklist. */
export function passwordChecks(password) {
  return {
    length: password.length >= MIN_NEW_PASSWORD_LENGTH,
    numberOrSymbol: NUMBER_OR_SYMBOL.test(password),
  };
}

/** 0 for nothing typed, 1 weak (a requirement is unmet), 2 fair (requirements met), 3 strong. */
export function passwordStrength(password) {
  if (!password) return 0;
  const { length, numberOrSymbol } = passwordChecks(password);
  if (!length || !numberOrSymbol) return 1;
  const kinds = [/\p{Ll}/u, /\p{Lu}/u, /\p{N}/u, /[^\p{L}\p{M}\p{N}\s]/u].filter((kind) => kind.test(password)).length;
  // Repeating a few characters adds length without adding much to guess, so it never counts as strong.
  const varied = new Set(password).size >= 8;
  return varied && (password.length >= 16 || (password.length >= 12 && kinds >= 3)) ? 3 : 2;
}

/** Everything the screen shows for the current values of its three fields. */
export function passwordFormState({ currentPassword, newPassword, confirmPassword }) {
  const checks = passwordChecks(newPassword);
  const matches = newPassword === confirmPassword;
  return {
    checks,
    strength: passwordStrength(newPassword),
    // Nothing to compare until the person starts typing in the confirm field.
    mismatch: confirmPassword !== '' && !matches,
    canSubmit: currentPassword !== '' && checks.length && checks.numberOrSymbol && matches,
  };
}
