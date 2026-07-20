// ── BRAND MARK ──────────────────────────────────────────────────────────────
// Shared Extella mark for toolbar panels rendered in the host document.

ETB.brand = {
  icon: function (width, extraStyle) {
    var w = width || 18;
    var h = Math.round(w * 356 / 558);
    return '<img src="' + _ETB_BRAND_LOGO + '" alt="" aria-hidden="true" style="' +
      'display:block;width:' + w + 'px;height:' + h + 'px;object-fit:contain;flex-shrink:0;' +
      (extraStyle || '') + '">';
  }
};
