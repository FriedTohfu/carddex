// "Save for offline" for any group of cards (a set, wishlist, binder or one card).
import { toast, confirmDialog } from '../ui.js';
import { downloadImages, cardsMissingImages, deleteImages } from '../sync.js';
import { state } from '../store.js';
import { online } from '../api.js';

export const KB_PER_CARD = 22;

export function offlineSub(keys) {
  const withImg = keys.filter((k) => state.cards.get(k)?.image);
  const need = cardsMissingImages(withImg).length;
  if (!withImg.length) return 'No images available';
  return need ? `${withImg.length - need} of ${withImg.length} saved · about ${sizeText(need)} to save` : 'All saved on this phone ✓';
}

export function sizeText(n) {
  const kb = n * KB_PER_CARD;
  return kb < 1024 ? `${Math.max(1, Math.round(kb))} KB` : `${(kb / 1024).toFixed(kb < 10240 ? 1 : 0)} MB`;
}

export async function saveOffline(keys, name) {
  const need = cardsMissingImages(keys);
  if (!need.length) return toast('Already saved for offline ✓');
  if (!online()) return toast('Connect to the internet to save cards for offline');
  if (need.length > 60 && !(await confirmDialog(`Save ${need.length} cards from ${name} for offline? (about ${sizeText(need.length)})`, { ok: 'Save' }))) return;
  try {
    const r = await downloadImages(need, `Saving ${name} for offline`);
    toast(r.failed ? `Saved ${r.done - r.failed} cards (${r.failed} had no image)` : 'Saved for offline ✓');
  } catch (e) { toast(e.message); }
}

export async function removeOffline(keys, name) {
  const have = keys.filter((k) => state.imageKeys.has(k));
  if (!have.length) return toast('Nothing saved from this yet');
  if (!(await confirmDialog(`Remove ${have.length} saved images from ${name}? They’ll still show when you’re online.`, { ok: 'Remove', danger: true }))) return;
  await deleteImages(have);
  toast('Removed from offline');
}
