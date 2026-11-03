// Web/PWA fallback. The Android build replaces this file with a bundled Capacitor plugin proxy.
(function () {
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SafStorage) {
    window.SafStorage = window.Capacitor.Plugins.SafStorage;
  }
})();
