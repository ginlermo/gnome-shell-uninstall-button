# App Grid Uninstall Button

A GNOME Shell extension that adds an **Uninstall** entry to the context menu of application icons in the app grid (and dash), so you can remove apps without opening a software center or a terminal.

- Supports GNOME Shell **45 – 51** (ES modules)
- Detects the package type automatically
- Native confirmation dialog and GNOME notifications for progress, success and errors
- Asynchronous (never blocks the shell) and fully cleaned up on disable

<!-- Add a screenshot: ![Uninstall menu](screenshots/menu.png) -->

## How it works

| Package type | Detected by | Removal method |
|--------------|-------------|----------------|
| Flatpak | `.desktop` file under a `flatpak/exports` directory | `flatpak uninstall -y --noninteractive` (`--user` or `--system`) via `Gio.Subprocess` |
| System package (RPM / DEB) | `.desktop` file in `/usr/share/applications` | PackageKit D-Bus: `SearchFiles` → `RemovePackages`; polkit shows the native authentication dialog. Fallback if PackageKit is unavailable: `pkexec dnf remove -y` or `pkexec apt-get remove -y` |
| Snap | `/var/lib/snapd/desktop/applications` or `X-SnapInstanceName` | `pkexec snap remove <name>` |
| AppImage | `X-AppImage-Version` key or an `.AppImage` in `Exec=` | Deletes the AppImage, its `.desktop` file and icon (only paths inside `$HOME`) |

Apps that cannot be classified, and apps in the **protected list**, get no Uninstall entry. The protected list defaults to core apps (Files, Settings, Software, Terminal, ...) and is editable in the preferences.

## Security notes

- Nothing is executed until you confirm (the confirmation dialog can be turned off in preferences).
- Commands are run with argument vectors (no shell), and app identifiers come from the app's `.desktop` file.
- Removing system packages and Snaps needs administrator rights; authentication is handled by polkit (`pkexec` / PackageKit), never by the extension.
- AppImage deletion is restricted to files inside your home directory.
- Failures (for example dependency conflicts) are reported in a notification.

## Install

### From extensions.gnome.org

Search for **App Grid Uninstall Button** (link will be added once published).

### From source

```sh
git clone https://github.com/ginlermo/gnome-shell-uninstall-button.git
cd gnome-shell-uninstall-button
make install
```

Log out and back in (Wayland; on X11 press <kbd>Alt</kbd>+<kbd>F2</kbd>, `r`), then:

```sh
gnome-extensions enable uninstall-button@ginlermo.github.io
```

Makefile targets: `make pack` (build zip), `make install`, `make uninstall`, `make clean`, `make nested` (try it in a nested shell).

## Preferences

Open with `gnome-extensions prefs uninstall-button@ginlermo.github.io`:

- **Confirm before uninstalling** (default: on)
- **Protected applications**: desktop IDs, one per line, that never show Uninstall

## Troubleshooting

```sh
journalctl -f -o cat /usr/bin/gnome-shell
```

- Menu item missing: the app is protected or its package type is unknown.
- Nothing changes after updating the extension: restart the session so the shell reloads the code.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
