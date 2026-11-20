export const getUserInitials = (name: string): string => {
  const words = name.trim().split(/\s+/);
  const first = [...words[0]][0] ?? '';
  if (words.length === 1) return first.toUpperCase();
  const last = [...words[words.length - 1]][0] ?? '';
  return (first + last).toUpperCase();
};

export const getUserFallback = (name: string | undefined, email: string | undefined): string | undefined => {
  if (name?.trim()) return getUserInitials(name);
  return email?.substring(0, 1);
};
