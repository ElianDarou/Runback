// Verlinkt die APKs des neuesten Test-Releases direkt. Alle Releases sind
// Prereleases, deshalb funktioniert /releases/latest nicht. Schlägt die Abfrage
// fehl, bleiben die Links auf der Release-Übersicht.
(async () => {
  try {
    const res = await fetch(
      'https://api.github.com/repos/GhostCodeByte/Runback/releases?per_page=5',
      { headers: { Accept: 'application/vnd.github+json' } },
    );
    if (!res.ok) return;
    const releases = await res.json();
    const release = releases.find(r => !r.draft && r.assets.length > 0);
    if (!release) return;

    const asset = prefix =>
      release.assets.find(
        a => a.name.startsWith(prefix) && a.name.endsWith('.apk'),
      );
    const targets = { phone: asset('runback-phone-'), wear: asset('runback-wear-') };
    for (const link of document.querySelectorAll('[data-download]')) {
      const file = targets[link.dataset.download];
      if (file) link.href = file.browser_download_url;
    }

    const version = (asset('runback-phone-')?.name.match(/runback-phone-([\d.]+)/) || [])[1];
    const date = new Date(release.published_at).toLocaleDateString('de-DE', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    if (!version) return;
    for (const line of document.querySelectorAll('[data-release-line]')) {
      line.textContent = `Version ${version} vom ${date} · Android 8 oder neuer · Wear OS 3 oder neuer · Testsoftware`;
    }
  } catch {
    // Offline oder Rate-Limit: Links zeigen weiter auf die Release-Übersicht.
  }
})();
