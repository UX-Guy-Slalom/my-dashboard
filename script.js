'use strict';

// ── Theme Toggle ──────────────────────────────────────────────────────────────

const html        = document.documentElement;
const themeToggle = document.getElementById('themeToggle');
const THEME_KEY   = 'jv-theme';

/** Apply a theme and persist it to localStorage */
function setTheme(theme) {
  html.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}

// Initialise: use saved preference, or fall back to dark
const savedTheme = localStorage.getItem(THEME_KEY);
setTheme(savedTheme === 'light' ? 'light' : 'dark');

themeToggle.addEventListener('click', () => {
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  setTheme(next);
});

// ── Discord — copy handle to clipboard ───────────────────────────────────────

const discordBtn = document.getElementById('discordBtn');
const toast      = document.getElementById('toast');
let   toastTimer;

discordBtn.addEventListener('click', async () => {
  const handle = discordBtn.dataset.handle ?? '@theuxguy';

  try {
    await navigator.clipboard.writeText(handle);
    showToast(`Copied ${handle} to clipboard!`);
  } catch {
    // Clipboard API unavailable or permission denied — show handle instead
    showToast(`Discord: ${handle}`);
  }
});

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}


// Blob physics are handled by blob-physics.js
// See BLOBS / PHYSICS config objects in that file to tune behaviour.
