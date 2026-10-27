// Sign in, phase 1: there is no account service yet, so signing in opens the Plans page with the sample data.
// Phase 2 replaces this with a call to the cloud sync API.
document.getElementById('sign-in').addEventListener('submit', (event) => {
  event.preventDefault();
  window.location.href = 'index.html';
});
