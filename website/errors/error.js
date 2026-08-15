/**
 * DocVault V2 — Error Page Interaction Engine (error.js)
 */
document.addEventListener('DOMContentLoaded', () => {
  // Bind Action Buttons
  const goHomeBtn = document.getElementById('btn-go-home');
  const goBackBtn = document.getElementById('btn-go-back');
  const searchBtn = document.getElementById('btn-search');
  const tryAgainBtn = document.getElementById('btn-try-again');

  if (goHomeBtn) {
    goHomeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = '/#/';
    });
  }

  if (goBackBtn) {
    goBackBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.href = '/#/';
      }
    });
  }

  if (searchBtn) {
    searchBtn.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = '/#/';
      setTimeout(() => {
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
          searchInput.focus();
        }
      }, 300);
    });
  }

  if (tryAgainBtn) {
    tryAgainBtn.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.reload();
    });
  }
});
