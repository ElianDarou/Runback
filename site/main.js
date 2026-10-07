// Verlinkt die APKs des neuesten Test-Releases direkt. Alle Releases sind
// Prereleases, deshalb funktioniert /releases/latest nicht. Schlägt die Abfrage
// fehl, bleiben die Links auf der Release-Übersicht.
(async () => {
  try {
    const res = await fetch(
      'https://api.github.com/repos/GhostCodeByte/Runback/releases?per_page=20',
      { headers: { Accept: 'application/vnd.github+json' } },
    );
    if (!res.ok) return;
    const releases = await res.json();

    // Nur ein Release mit beiden fertig hochgeladenen APKs zählt; ein
    // halb hochgeladenes neuestes Release fällt auf das vorherige zurück.
    const apk = (release, prefix) =>
      release.assets.find(
        a =>
          a.state === 'uploaded' &&
          a.name.startsWith(prefix) &&
          a.name.endsWith('.apk'),
      );
    let phone;
    let wear;
    const release = releases.find(r => {
      if (r.draft) return false;
      phone = apk(r, 'runback-phone-');
      wear = apk(r, 'runback-wear-');
      return phone && wear;
    });
    if (!release) return;

    const targets = { phone, wear };
    for (const link of document.querySelectorAll('[data-download]')) {
      link.href = targets[link.dataset.download].browser_download_url;
    }

    const version = (phone.name.match(/runback-phone-([\d.]+)/) || [])[1];
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
