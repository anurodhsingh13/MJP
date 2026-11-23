/** Profile photo the user chose. It stays in this browser only; without one a neutral user icon is shown. */
const EVENT = 'terrascope-avatar';
const keyFor = (accountId: string) => `terrascope.avatar.${accountId}`;

/** The user's own photo as a data URL, or '' when none is set (a neutral user icon is shown then). */
export function readAvatar(accountId: string): string {
  try { return localStorage.getItem(keyFor(accountId)) || ''; } catch { return ''; }
}
export function hasCustomAvatar(accountId: string): boolean { return readAvatar(accountId) !== ''; }

export function clearAvatar(accountId: string): void {
  try { localStorage.removeItem(keyFor(accountId)); } catch { /* default is shown anyway */ }
  window.dispatchEvent(new Event(EVENT));
}

/** Centre-crops the picked image to a 256px square JPEG so it is small enough to store. Throws a readable message on failure. */
export async function saveAvatarFile(accountId: string, file: File): Promise<void> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file (JPG, PNG or WebP).');
  if (file.size > 10 * 1024 * 1024) throw new Error('That photo is too large. Choose one under 10 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('That file could not be read as a photo.')); img.src = url; });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Photos cannot be processed in this browser.');
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    const data = canvas.toDataURL('image/jpeg', 0.85);
    try { localStorage.setItem(keyFor(accountId), data); } catch { throw new Error('This browser blocked saving the photo. Check that site data is allowed.'); }
    window.dispatchEvent(new Event(EVENT));
  } finally { URL.revokeObjectURL(url); }
}

export function subscribeAvatar(callback: () => void): () => void {
  window.addEventListener(EVENT, callback); window.addEventListener('storage', callback);
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener('storage', callback); };
}
