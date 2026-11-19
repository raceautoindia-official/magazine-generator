// Pure module, used on the server and in the browser.

type Placed = { section: string; type: string };
type Ordering = { sections: string[]; types: string[] };

/**
 * Where an article joining a list belongs: inside its own section, after the
 * articles of its type and of the types printed before it. The list itself is
 * not sorted, so an order the person arranged by hand stays as it is.
 *
 * Returns the index to insert at. Without this an added article went to the
 * very end, which put a National article after the International ones and made
 * its section heading appear a second time.
 */
export function indexInOrder<T extends Placed>(list: T[], item: Placed, ordering: Ordering): number {
  const rank = (type: string) => (ordering.types.includes(type) ? ordering.types.indexOf(type) : ordering.types.length);
  const sectionRank = (section: string) => (ordering.sections.includes(section) ? ordering.sections.indexOf(section) : ordering.sections.length);

  let firstOfSection = -1;
  let afterSameOrEarlierType = -1;
  for (const [index, entry] of list.entries()) {
    if (entry.section !== item.section) continue;
    if (firstOfSection < 0) firstOfSection = index;
    if (rank(entry.type) <= rank(item.type)) afterSameOrEarlierType = index;
  }
  if (afterSameOrEarlierType >= 0) return afterSameOrEarlierType + 1;
  if (firstOfSection >= 0) return firstOfSection;

  // The section has no articles yet: it starts before the first section that is printed after it.
  const later = list.findIndex((entry) => sectionRank(entry.section) > sectionRank(item.section));
  return later >= 0 ? later : list.length;
}

export function insertInOrder<T extends Placed>(list: T[], item: T, ordering: Ordering): T[] {
  const index = indexInOrder(list, item, ordering);
  return [...list.slice(0, index), item, ...list.slice(index)];
}
