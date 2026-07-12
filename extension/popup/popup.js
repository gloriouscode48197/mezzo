const MEZZO_BASE_URL = 'https://mezzo-one.vercel.app';

document.getElementById('btn-open-monitoring').addEventListener('click', () => {
  // Explicit user click on the pinned icon's popup — always bring the
  // companion window to the foreground.
  chrome.runtime.sendMessage({ type: 'OPEN_MEZZO', mode: 'start', focused: true });
  window.close();
});

document.getElementById('link-privacy').addEventListener('click', (event) => {
  event.preventDefault();
  chrome.tabs.create({ url: `${MEZZO_BASE_URL}/privacy.html` });
  window.close();
});

document.getElementById('btn-settings').addEventListener('click', () => {
  document.getElementById('settings-panel').classList.toggle('hidden');
});
