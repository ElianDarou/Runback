// Links the APKs of the latest test release directly. All releases are
// prereleases, so /releases/latest does not work. If the query fails,
// the links stay on the release overview.
(async () => {
  const en = document.documentElement.lang === 'en';
  try {
    const res = await fetch(
      'https://api.github.com/repos/GhostCodeByte/Runback/releases?per_page=20',
      { headers: { Accept: 'application/vnd.github+json' } },
    );
    if (!res.ok) return;
    const releases = await res.json();

    // Only a release with both APKs fully uploaded counts; a half-uploaded
    // newest release falls back to the previous one.
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

    const version = (phone.name.match(/runback-phone-(\d+(?:\.\d+)*)/) || [])[1];
    const date = new Date(release.published_at).toLocaleDateString(
      en ? 'en-GB' : 'de-DE',
      { day: 'numeric', month: 'long', year: 'numeric' },
    );
    if (!version) return;
    const text = en
      ? `Version ${version} from ${date} · Android 8 or newer · Wear OS 3 or newer · Test build`
      : `Version ${version} vom ${date} · Android 8 oder neuer · Wear OS 3 oder neuer · Testsoftware`;
    for (const line of document.querySelectorAll('[data-release-line]')) {
      line.textContent = text;
    }
  } catch {
    // Offline or rate limit: links keep pointing to the release overview.
  }
})();
