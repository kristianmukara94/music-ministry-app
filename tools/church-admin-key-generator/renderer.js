'use strict';
const TOAST_MS = 1800;
const HINT = 'Up to 4 letters. Leave blank for a fully random code.';
const LOOK_ALIKE_ERROR = 'O, I and L can’t appear in a code. Please use other letters.';

const form = document.getElementById('generate-form');
const prefixInput = document.getElementById('prefix');
const prefixHint = document.getElementById('prefix-hint');
const generateButton = document.getElementById('generate');
const toast = document.getElementById('toast');
const outputs = [...document.querySelectorAll('[data-output]')];

let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('toast-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('toast-visible'), TOAST_MS);
}

function refreshPrefix() {
  const caret = prefixInput.selectionStart;
  const clean = prefixInput.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  if (clean !== prefixInput.value) {
    prefixInput.value = clean;
    prefixInput.setSelectionRange(caret, caret);
  }
  const hasLookAlike = /[OIL]/.test(clean);
  prefixHint.textContent = hasLookAlike ? LOOK_ALIKE_ERROR : HINT;
  prefixHint.classList.toggle('text-error', hasLookAlike);
  prefixHint.classList.toggle('text-muted', !hasLookAlike);
  prefixInput.setAttribute('aria-invalid', String(hasLookAlike));
  generateButton.disabled = hasLookAlike;
}

function showOutput(card, value) {
  card.querySelector('[data-value]').textContent = value;
  card.querySelector('[data-value]').classList.replace('text-muted', 'text-main');
  card.querySelector('[data-copy]').disabled = false;
  // Removing the class and forcing a layout lets the animation play again on every Generate.
  card.classList.remove('card-focus');
  void card.offsetWidth;
  card.classList.add('card-focus');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (generateButton.disabled) return;
  const result = await window.keyGenerator.generate(prefixInput.value);
  if (result.error) {
    showToast(result.error);
    return;
  }
  for (const card of outputs) showOutput(card, result[card.dataset.output]);
});

for (const card of outputs) {
  card.querySelector('[data-copy]').addEventListener('click', async () => {
    const copied = await window.keyGenerator.copy(card.querySelector('[data-value]').textContent);
    showToast(copied ? 'Copied to clipboard!' : 'That couldn’t be copied. Please generate a new one.');
  });
}

prefixInput.addEventListener('input', refreshPrefix);
