# Changelog

## 1.0.0

First public release, renamed from Git Working Tree Stats to Difflet. Available on the Visual Studio Marketplace and Open VSX.

- Count net saved changes against HEAD, including repositories without commits.
- Correct rename parsing; disclose binary, submodule, and untracked scan exclusions.
- Serialize refreshes, discard stale results, cancel obsolete work, and bound Git execution.
- Limit untracked reads to eight at a time, 500 files, and 2 MiB per file; skip symlinks.
- Use theme colors by default, stable status-bar identities, accessible labels, and safe tooltips.
- Preserve the selected repository when moving away from a repository editor.
- Add repository-scoped settings and a diagnostic Output command.
- Setting keys and command IDs keep the `gitWorkingTreeStats.` prefix, so existing settings carry over.

## 0.0.3

- Original local extension with separate addition/deletion indicators and configurable labels/colors.
