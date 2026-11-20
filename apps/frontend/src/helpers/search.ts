// Lower case, without accents, so "cote" finds Côte d’Ivoire
export const plainText = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
