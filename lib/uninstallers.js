import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {PackageType, appImagePaths} from './detector.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');
Gio._promisify(Gio.DBusProxy, 'new_for_bus', 'new_for_bus_finish');
Gio._promisify(Gio.DBusProxy.prototype, 'call', 'call_finish');
Gio._promisify(Gio.File.prototype, 'delete_async', 'delete_finish');

const PK_NAME = 'org.freedesktop.PackageKit';
const PK_PATH = '/org/freedesktop/PackageKit';
const PK_FILTER_INSTALLED = 1 << 2;
const PK_TRANSACTION_FLAG_NONE = 0;

export class UninstallError extends Error {}

export class Cancelled extends Error {}

async function run(argv, cancellable) {
    const proc = new Gio.Subprocess({
        argv,
        flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    });
    proc.init(cancellable);

    let stdout, stderr;
    try {
        [stdout, stderr] = await proc.communicate_utf8_async(null, cancellable);
    } catch (e) {
        proc.force_exit();
        if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            throw new Cancelled();
        throw e;
    }

    if (!proc.get_successful()) {
        const msg = (stderr || stdout || '').trim();
        throw new UninstallError(msg || `${argv[0]} exited with status ${proc.get_exit_status()}`);
    }
    return stdout;
}

async function uninstallFlatpak(app, cancellable) {
    const scope = app.scope === 'user' ? '--user' : '--system';
    await run(['flatpak', 'uninstall', scope, '-y', '--noninteractive', app.appId], cancellable);
}

/* RPM via PackageKit: polkit shows the native authentication dialog. */
class PackageKitTransaction {
    constructor(proxy) {
        this._proxy = proxy;
        this._packages = [];
        this._error = null;
        this._resolve = null;
        this._signalId = proxy.connect('g-signal', (_p, _sender, signal, params) => {
            const args = params.deepUnpack();
            if (signal === 'Package') {
                this._packages.push(args[1]);
            } else if (signal === 'ErrorCode') {
                this._error = args[1];
            } else if (signal === 'Finished') {
                this._resolve?.();
            }
        });
    }

    static async create(cancellable) {
        const manager = await Gio.DBusProxy.new_for_bus(
            Gio.BusType.SYSTEM, Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES, null,
            PK_NAME, PK_PATH, PK_NAME, cancellable);
        const reply = await manager.call('CreateTransaction', null,
            Gio.DBusCallFlags.NONE, -1, cancellable);
        const [path] = reply.deepUnpack();
        const proxy = await Gio.DBusProxy.new_for_bus(
            Gio.BusType.SYSTEM, Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES, null,
            PK_NAME, path, `${PK_NAME}.Transaction`, cancellable);
        return new PackageKitTransaction(proxy);
    }

    async run(method, params, cancellable) {
        const finished = new Promise(resolve => {
            this._resolve = resolve;
        });
        const onCancel = cancellable?.connect(() => {
            this._proxy.call('Cancel', null, Gio.DBusCallFlags.NONE, -1, null).catch(() => {});
        });

        try {
            await this._proxy.call(method, params, Gio.DBusCallFlags.ALLOW_INTERACTIVE_AUTHORIZATION,
                -1, cancellable);
            await finished;
        } catch (e) {
            if (cancellable?.is_cancelled())
                throw new Cancelled();
            throw e;
        } finally {
            if (onCancel)
                cancellable.disconnect(onCancel);
        }

        if (cancellable?.is_cancelled())
            throw new Cancelled();
        if (this._error)
            throw new UninstallError(this._error);
        return this._packages;
    }

    destroy() {
        if (this._signalId) {
            this._proxy.disconnect(this._signalId);
            this._signalId = 0;
        }
        this._proxy = null;
    }
}

async function pkTransaction(method, params, cancellable) {
    const tx = await PackageKitTransaction.create(cancellable);
    try {
        return await tx.run(method, params, cancellable);
    } finally {
        tx.destroy();
    }
}

async function uninstallRpmPackageKit(info, cancellable) {
    const file = info.get_filename();
    const packages = await pkTransaction('SearchFiles',
        new GLib.Variant('(tas)', [PK_FILTER_INSTALLED, [file]]), cancellable);
    if (packages.length === 0)
        throw new UninstallError('No installed package owns this application.');

    await pkTransaction('RemovePackages',
        new GLib.Variant('(tasbb)', [PK_TRANSACTION_FLAG_NONE, packages, false, false]), cancellable);
}

async function uninstallRpmDnf(info, cancellable) {
    const file = info.get_filename();
    if (GLib.find_program_in_path('rpm')) {
        const name = (await run(['rpm', '-qf', '--qf', '%{NAME}', file], cancellable)).trim();
        if (!name)
            throw new UninstallError('No installed package owns this application.');
        await run(['pkexec', 'dnf', 'remove', '-y', name], cancellable);
    } else if (GLib.find_program_in_path('dpkg')) {
        const out = await run(['dpkg', '-S', file], cancellable);
        const name = out.split(':')[0].trim();
        if (!name)
            throw new UninstallError('No installed package owns this application.');
        await run(['pkexec', 'apt-get', 'remove', '-y', name], cancellable);
    } else {
        throw new UninstallError('No supported package manager found.');
    }
}

async function uninstallSnap(app, cancellable) {
    await run(['pkexec', 'snap', 'remove', app.snap], cancellable);
}

async function uninstallRpm(info, cancellable) {
    try {
        await uninstallRpmPackageKit(info, cancellable);
    } catch (e) {
        if (e instanceof Cancelled || e instanceof UninstallError)
            throw e;
        // PackageKit unavailable (no service / not activatable)
        const unavailable = e.matches?.(Gio.DBusError, Gio.DBusError.SERVICE_UNKNOWN) ||
            e.matches?.(Gio.DBusError, Gio.DBusError.NAME_HAS_NO_OWNER);
        if (!unavailable)
            throw new UninstallError(e.message);
        await uninstallRpmDnf(info, cancellable);
    }
}

async function uninstallAppImage(info, cancellable) {
    const {binary, desktop, icons} = appImagePaths(info);
    const home = GLib.get_home_dir();
    const targets = [binary, desktop, ...icons].filter(p => p && p.startsWith(`${home}/`));

    if (!binary || !targets.includes(binary))
        throw new UninstallError('Could not locate the AppImage file inside your home directory.');

    let deleted = 0;
    for (const path of targets) {
        try {
            await Gio.File.new_for_path(path).delete_async(GLib.PRIORITY_DEFAULT, cancellable);
            deleted++;
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                continue;
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw new Cancelled();
            throw new UninstallError(`${path}: ${e.message}`);
        }
    }
    if (deleted === 0)
        throw new UninstallError('Nothing to delete.');
}

export async function uninstall(app, info, cancellable) {
    switch (app.type) {
    case PackageType.FLATPAK:
        return uninstallFlatpak(app, cancellable);
    case PackageType.PACKAGE:
        return uninstallRpm(info, cancellable);
    case PackageType.SNAP:
        return uninstallSnap(app, cancellable);
    case PackageType.APPIMAGE:
        return uninstallAppImage(info, cancellable);
    default:
        throw new UninstallError('Unsupported package type.');
    }
}
