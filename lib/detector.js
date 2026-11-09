import GLib from 'gi://GLib';

export const PackageType = Object.freeze({
    FLATPAK: 'flatpak',
    APPIMAGE: 'appimage',
    SNAP: 'snap',
    PACKAGE: 'package', // RPM or DEB, resolved by PackageKit / rpm / dpkg
    UNKNOWN: 'unknown',
});

const SYSTEM_APP_DIRS = ['/usr/share/applications', '/usr/local/share/applications'];

/**
 * Classify an application from its Gio.DesktopAppInfo.
 *
 * @param {Gio.DesktopAppInfo} info
 * @returns {{type: string, appId: string, scope?: 'user'|'system'}}
 */
export function detect(info) {
    const none = {type: PackageType.UNKNOWN, appId: ''};
    if (!info || typeof info.get_filename !== 'function')
        return none;

    const path = info.get_filename();
    if (!path)
        return none;

    const appId = GLib.path_get_basename(path).replace(/\.desktop$/, '');

    if (path.includes('/flatpak/exports/')) {
        const userDir = GLib.build_filenamev([GLib.get_user_data_dir(), 'flatpak']);
        return {
            type: PackageType.FLATPAK,
            appId: info.get_string('X-Flatpak') ?? appId,
            scope: path.startsWith(userDir) ? 'user' : 'system',
        };
    }

    if (path.startsWith('/var/lib/snapd/desktop/applications/') || info.has_key('X-SnapInstanceName')) {
        // Snap desktop files are named "<snap>_<app>.desktop"
        const snap = info.get_string('X-SnapInstanceName') ?? appId.split('_')[0];
        return {type: PackageType.SNAP, appId, snap};
    }

    if (info.has_key('X-AppImage-Version') || isAppImageExec(info))
        return {type: PackageType.APPIMAGE, appId};

    if (SYSTEM_APP_DIRS.some(d => path.startsWith(`${d}/`)))
        return {type: PackageType.PACKAGE, appId};

    return none;
}

function isAppImageExec(info) {
    const exec = info.get_string('Exec') ?? '';
    return /\.appimage\b/i.test(exec);
}

export function appImagePaths(info) {
    const paths = {binary: null, desktop: info.get_filename(), icons: []};

    try {
        const [, argv] = GLib.shell_parse_argv(info.get_string('Exec') ?? '');
        paths.binary = argv.find(a => /\.appimage$/i.test(a)) ?? argv[0] ?? null;
    } catch (_e) {
        paths.binary = null;
    }

    const icon = info.get_string('Icon');
    if (icon && GLib.path_is_absolute(icon)) {
        paths.icons.push(icon);
    } else if (icon) {
        const base = GLib.get_user_data_dir();
        for (const ext of ['png', 'svg', 'xpm']) {
            for (const sub of ['icons', 'pixmaps'])
                paths.icons.push(GLib.build_filenamev([base, sub, `${icon}.${ext}`]));
        }
    }
    return paths;
}
