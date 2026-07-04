// ── PLUGIN VIEW PANEL ─────────────────────────────────────────────────────
// Wraps ETB.router with plugin-specific metadata rendering.
// Currently a thin layer; extend here for plugin settings, uninstall, etc.
// Exposes: ETB.pluginView.open(plugin), ETB.pluginView.close()

ETB.pluginView = (function () {
  return {
    open: function (plugin) {
      ETB.router.open(plugin);
    },

    openById: function (id) {
      var plugin = ETB.registry.getById(id);
      if (plugin) ETB.router.open(plugin);
    },

    close: function () {
      ETB.router.close();
    }
  };
})();
