UUID := uninstall-button@ginlermo.github.io
SCHEMA_DIR := schemas
ZIP := $(UUID).shell-extension.zip
INSTALL_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: all schemas pack install uninstall clean nested

all: pack

schemas:
	glib-compile-schemas $(SCHEMA_DIR)

pack: schemas
	gnome-extensions pack --force --schema=$(SCHEMA_DIR)/org.gnome.shell.extensions.uninstall-button.gschema.xml \
		--extra-source=lib --out-dir=. .

install: pack
	gnome-extensions install --force $(ZIP)
	@echo "Installed. Log out/in (Wayland) then: gnome-extensions enable $(UUID)"

uninstall:
	gnome-extensions uninstall $(UUID)

nested:
	dbus-run-session -- gnome-shell --devkit --wayland

clean:
	rm -f $(ZIP) $(SCHEMA_DIR)/gschemas.compiled
