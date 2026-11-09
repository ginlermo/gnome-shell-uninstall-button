import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension, InjectionManager, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {detect, PackageType} from './lib/detector.js';
import {uninstall, Cancelled} from './lib/uninstallers.js';

async function loadAppMenu() {
    // AppMenu lives in appMenu.js on recent shells and in appDisplay.js on older ones.
    for (const path of ['appMenu.js', 'appDisplay.js']) {
        try {
            const mod = await import(`resource:///org/gnome/shell/ui/${path}`);
            if (mod.AppMenu)
                return mod.AppMenu;
        } catch (_e) {
            // try next
        }
    }
    return null;
}

const ConfirmDialog = GObject.registerClass(
class UninstallConfirmDialog extends ModalDialog.ModalDialog {
    _init(title, description, onConfirm) {
        super._init({styleClass: 'prompt-dialog'});

        const content = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'message-dialog-content'});
        content.add_child(new St.Label({
            text: title,
            style_class: 'message-dialog-title',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        const body = new St.Label({
            text: description,
            style_class: 'message-dialog-description',
        });
        body.clutter_text.line_wrap = true;
        content.add_child(body);
        this.contentLayout.add_child(content);

        this.setButtons([
            {
                label: _('Cancel'),
                action: () => this.close(),
                key: Clutter.KEY_Escape,
            },
            {
                label: _('Uninstall'),
                action: () => {
                    this.close();
                    onConfirm();
                },
                default: true,
            },
        ]);
    }
});

export default class UninstallButtonExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._injections = new InjectionManager();
        this._items = new Set();
        this._cancellable = new Gio.Cancellable();
        this._busy = new Set();
        this._dialog = null;
        this._enabled = true;

        loadAppMenu().then(AppMenu => {
            if (!this._enabled || !AppMenu)
                return;
            const ext = this;
            this._injections.overrideMethod(AppMenu.prototype, 'setApp',
                original => function (app) {
                    original.call(this, app);
                    try {
                        ext._syncItem(this, app);
                    } catch (e) {
                        console.error(`${ext.metadata.uuid}: ${e}`);
                    }
                });
        }).catch(e => console.error(`${this.metadata.uuid}: ${e}`));
    }

    disable() {
        this._enabled = false;
        this._cancellable?.cancel();
        this._injections?.clear();
        this._dialog?.destroy();

        for (const item of [...this._items])
            item.destroy();

        this._items?.clear();
        this._busy?.clear();
        this._injections = null;
        this._items = null;
        this._busy = null;
        this._cancellable = null;
        this._dialog = null;
        this._settings = null;
    }

    _syncItem(menu, app) {
        if (!menu._uninstallItem) {
            const item = new PopupMenu.PopupMenuItem(_('Uninstall'));
            item.connect('activate', () => this._onActivate(item._app));
            item.connect('destroy', () => {
                this._items?.delete(item);
                if (menu._uninstallItem === item)
                    menu._uninstallItem = null;
            });
            menu.addMenuItem(item);
            menu._uninstallItem = item;
            this._items.add(item);
        }

        const item = menu._uninstallItem;
        item._app = app;
        item.visible = this._isEligible(app);
    }

    _isEligible(app) {
        const info = app?.app_info;
        if (!info || !app.get_id())
            return false;
        if (this._settings.get_strv('protected-apps').includes(app.get_id()))
            return false;
        return detect(info).type !== PackageType.UNKNOWN;
    }

    _onActivate(app) {
        try {
            this._confirmAndRun(app);
        } catch (e) {
            console.error(`${this.metadata.uuid}: ${e}`);
            Main.notifyError(_('Uninstall failed'), `${e.message ?? e}`);
        }
    }

    _confirmAndRun(app) {
        const info = app?.app_info;
        if (!info)
            return;
        Main.overview.hide();

        const name = app.get_name();
        const details = detect(info);
        const messages = {
            [PackageType.FLATPAK]: _('The Flatpak application will be removed.'),
            [PackageType.PACKAGE]: _('The system package will be removed. You may be asked to authenticate.'),
            [PackageType.SNAP]: _('The Snap application will be removed. You may be asked to authenticate.'),
            [PackageType.APPIMAGE]: _('The AppImage file, its launcher and icon will be permanently deleted.'),
        };

        const go = () => this._run(app, info, details, name);

        if (!this._settings.get_boolean('confirm-before-uninstall')) {
            go();
            return;
        }

        this._dialog?.destroy();
        const dialog = new ConfirmDialog(
            _('Uninstall “%s”?').format(name), messages[details.type] ?? '', go);
        dialog.connect('destroy', () => {
            if (this._dialog === dialog)
                this._dialog = null;
        });
        this._dialog = dialog;
        dialog.open();
    }

    async _run(app, info, details, name) {
        const id = app.get_id();
        if (this._busy.has(id))
            return;
        this._busy.add(id);

        const cancellable = this._cancellable;
        Main.notify(_('Uninstalling %s').format(name),
            details.type === PackageType.PACKAGE || details.type === PackageType.SNAP
                ? _('Waiting for authorization and package manager…')
                : _('Please wait…'));

        try {
            await uninstall(details, info, cancellable);
            Main.notify(_('Uninstalled'), _('%s was removed.').format(name));
        } catch (e) {
            if (e instanceof Cancelled || !this._enabled)
                return;
            console.error(`${this.metadata.uuid}: ${e}`);
            Main.notifyError(_('Could not uninstall %s').format(name), `${e.message ?? e}`);
        } finally {
            this._busy?.delete(id);
        }
    }
}
