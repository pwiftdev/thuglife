export function nativeMedia(type) {
  const element = document.createElement(type);
  element.preload = "auto";
  element.playsInline = true;
  element.preservesPitch = false;
  let url;
  let current;
  return {
    element,
    set(file) {
      if (file === current) return;
      this.clear();
      if (!file) return;
      current = file;
      url = URL.createObjectURL(file);
      element.src = url;
    },
    clear() {
      if (!url) return;
      element.pause();
      element.removeAttribute("src");
      element.load();
      URL.revokeObjectURL(url);
      url = current = undefined;
    },
  };
}

export function nativeTime(asset, relative) {
  return Math.max(0, asset.origin + relative);
}
