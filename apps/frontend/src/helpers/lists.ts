// The items of a filter that holds several, as the address has them: separated by commas
export const splitList = (value?: string) => value?.split(',').filter(Boolean) ?? [];

// Whether two lists have the same items, in whatever order
export const sameItems = (a: string[], b: string[]) => a.length === b.length && a.every(item => b.includes(item));
