# Contributing to Velvet Mobile

Thanks for your interest. Velvet Mobile is **proprietary software** (see [LICENSE](LICENSE)), so contribution works a little differently from a typical open-source project.

## What's welcome

- **Bug reports** — the most valuable contribution. Use the [bug report template](https://github.com/gmredvelvet-rgb/velvet-mobile/issues/new?template=bug_report.yml).
- **Feature requests** — via the [feature request template](https://github.com/gmredvelvet-rgb/velvet-mobile/issues/new?template=feature_request.yml).
- **Documentation fixes** — typos, unclear steps, broken links.

## Code contributions

Because the module is proprietary, **code pull requests are accepted only by prior arrangement.** Open an issue describing the fix first; if it's accepted, we'll coordinate the PR. Merged code is contributed under the project's proprietary licence, not an open-source one — do not submit code you cannot license this way.

## Development

No build step — it's plain ES modules.

```bash
git clone https://github.com/gmredvelvet-rgb/velvet-mobile.git
# link or copy into {userData}/Data/modules/velvet-mobile   (folder name is required to match)
```

- Source: `scripts/` (entry `scripts/main.mjs`), `styles/`, localisation in `lang/`.
- Match the surrounding code style. `.editorconfig` enforces LF, UTF-8, 2-space indent.
- Don't introduce new dependencies on undocumented Foundry internals — see the 0.13.0 CHANGELOG for why.
- Add a `## <next-version>` entry to [CHANGELOG.md](CHANGELOG.md) for any user-visible change.

## Release process

Maintainers only:

1. Update `CHANGELOG.md` with a `## X.Y.Z` heading at the top.
2. `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. The [release workflow](.github/workflows/release.yml) rewrites `module.json` to match the tag, validates the manifest, builds `module.zip`, and publishes the GitHub Release with `module.json` + `module.zip`. Release notes are extracted from the matching CHANGELOG section.

Follow [Semantic Versioning](https://semver.org/).
