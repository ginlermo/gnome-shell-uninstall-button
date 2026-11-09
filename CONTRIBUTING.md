# Contributing

1. Fork and clone the repository.
2. `make install` to install into `~/.local/share/gnome-shell/extensions`.
3. Test in a nested shell: `make nested` (needs `mutter-devkit`), or relog.
4. Watch logs: `journalctl -f -o cat /usr/bin/gnome-shell`.
5. Keep `enable()`/`disable()` symmetric: anything created or connected in `enable()` must be destroyed in `disable()`.
6. Don't import Gtk/Adw in `extension.js` or Shell modules in `prefs.js`.

Please open an issue before large changes.

Releases: bump `version-name` in `metadata.json`, update `CHANGELOG.md`, run `make pack` and upload the zip to extensions.gnome.org.
