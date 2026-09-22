/**
 * The two things a menu item does that are not a request: open a link in
 * a new tab, and save a file. Both used to be `<a>` wrapped around a
 * `<button>`, which a menu item cannot be.
 */

export function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener');
}

export function downloadFile(path: string, filename: string): void {
  const a = document.createElement('a');
  a.href = path;
  a.download = filename;
  a.click();
}

export function go(hash: string): void {
  location.hash = hash;
}
