# uniques/

Bundled uniques would live here, one folder each with a `unique.json`. The
engine ships **none**: mediums are separate repositories, and the ones every
install should have are listed in [`../defaults.json`](../defaults.json) and
installed into `~/.lets/uniques/` on first use (today: **graph**, from
https://github.com/offensiveadhd/lets-unique-graph).

Other places the registry scans, later ones winning on a name clash:

1. this folder (bundled)
2. `~/.lets/uniques/` (defaults and store installs)
3. every folder in `LETS_UNIQUES_DIRS` (path-separated; for developing a unique anywhere)
4. `<project>/.lets/uniques/` (project-local)
