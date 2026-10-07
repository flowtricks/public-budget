import { payeeLogo } from "./payee-logos";

// Keep decoded images available across tab changes, without retaining the
// entire logo catalog as users browse older transactions.
const images = new Map<string, HTMLImageElement>();
const MAX_IMAGES = 100;

export function preloadPayeeLogos(names: readonly string[]) {
  for (const name of names) {
    const src = payeeLogo(name);
    const cached = images.get(src);
    if (cached) {
      images.delete(src);
      images.set(src, cached);
      continue;
    }
    const image = new Image();
    image.decoding = "async";
    images.set(src, image);
    image.src = src;
    void image.decode().catch(() => {
      // Offline/missing assets must not block navigation, and can retry later.
      if (images.get(src) === image) images.delete(src);
    });
    if (images.size > MAX_IMAGES) images.delete(images.keys().next().value!);
  }
}
