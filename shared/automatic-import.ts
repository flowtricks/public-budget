// Older imports used this internal tag. Strip it as records are updated.
export const AUTOMATICALLY_ADDED_TAG = "Automatically added";

export function isAutomaticTag(tag: string) {
  return (
    tag.trim().toLocaleLowerCase() ===
    AUTOMATICALLY_ADDED_TAG.toLocaleLowerCase()
  );
}

export function withoutAutomaticTag(tags: readonly string[]) {
  return tags.filter((tag) => !isAutomaticTag(tag));
}
