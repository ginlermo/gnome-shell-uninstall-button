import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class UninstallButtonPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;

        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'dialog-information-symbolic',
        });
        window.add(page);

        const general = new Adw.PreferencesGroup({title: _('Behavior')});
        page.add(general);

        const confirm = new Adw.SwitchRow({
            title: _('Confirm before uninstalling'),
            subtitle: _('Show a confirmation dialog first'),
        });
        settings.bind('confirm-before-uninstall', confirm, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        general.add(confirm);

        const protectedGroup = new Adw.PreferencesGroup({
            title: _('Protected applications'),
            description: _('Desktop file IDs, one per line, that never show Uninstall.'),
        });
        page.add(protectedGroup);

        const view = new Gtk.TextView({
            top_margin: 8,
            bottom_margin: 8,
            left_margin: 8,
            right_margin: 8,
            monospace: true,
            wrap_mode: Gtk.WrapMode.NONE,
        });
        const buffer = view.get_buffer();
        buffer.set_text(settings.get_strv('protected-apps').join('\n'), -1);
        buffer.connect('changed', () => {
            const [s, e] = buffer.get_bounds();
            const list = buffer.get_text(s, e, false)
                .split('\n').map(l => l.trim()).filter(Boolean);
            settings.set_strv('protected-apps', list);
        });

        const scroll = new Gtk.ScrolledWindow({
            min_content_height: 160,
            hscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
            child: view,
        });
        scroll.add_css_class('card');
        protectedGroup.add(scroll);
    }
}
