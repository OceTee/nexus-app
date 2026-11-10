// Shared by /verify and /reset: hands the token in the address to the NEXUS
// app (nexus://<action>?token=…) and offers a copyable fallback. Android
// Chrome needs a tap to leave for an app, so this sets up a button rather
// than redirecting on load.
(function () {
  const action = document.body.dataset.action; // "verify" or "reset"
  const token = new URLSearchParams(location.search).get('token');
  const missing = document.getElementById('missing');
  const ready = document.getElementById('ready');

  if (!token) {
    missing.classList.remove('hidden');
    return;
  }
  ready.classList.remove('hidden');

  const query = `token=${encodeURIComponent(token)}`;
  const release = 'https://github.com/OceTee/nexus-app/releases/latest';
  // The Android intent opens the installed app, or the download page if it
  // isn't installed. Release builds use the ".preview" package id.
  const intent =
    `intent://${action}?${query}#Intent;scheme=nexus;package=com.gladprosper.nexus.preview;` +
    `S.browser_fallback_url=${encodeURIComponent(release)};end`;
  const isAndroid = /Android/i.test(navigator.userAgent);
  document.getElementById('open').href = isAndroid ? intent : `nexus://${action}?${query}`;

  const copy = document.getElementById('copy');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      copy.textContent = 'Link copied';
    } catch {
      copy.textContent = 'Copy failed: copy the address from the address bar';
    }
  });
})();
