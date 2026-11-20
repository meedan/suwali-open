export function getCurrentSetupStep(hasHub: boolean, sourceCreated: boolean, documentSynced: boolean): 1 | 2 | 3 {
  if (!hasHub) return 1;
  if (!sourceCreated || !documentSynced) return 2;
  return 3;
}
