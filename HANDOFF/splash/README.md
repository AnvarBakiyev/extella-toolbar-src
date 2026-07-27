# Заставка приложения (по решению Эллы)

Замена стартовой заставки Extella: маленькая анимация-узел по центру, без надписи, чёрный фон.

- loading-overlay.html → кладётся в app.asar как src/renderer/loading-overlay.html
- splash.mp4 → рядом, src/renderer/splash.mp4

Механика окна (onThemeChanged / onHide) сохранена один в один — контракт preload-loading.js не тронут.
Просьба к Анвару: вшить в сборку клиента, чтобы обновления приложения заставку не затирали.
