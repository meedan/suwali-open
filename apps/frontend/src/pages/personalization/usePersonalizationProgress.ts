import { availablePersonalizationSections, isSectionSetUp } from './personalizationSections';
import { usePersonalizationHub } from './usePersonalizationHub';

// How many of the sections a hub has are set up, out of how many there are
export const usePersonalizationProgress = () => {
  const { hub, resources } = usePersonalizationHub();
  const sections = availablePersonalizationSections(hub);

  return {
    setUp: sections.filter(section => isSectionSetUp(section, hub, resources.length)).length,
    total: sections.length,
  };
};
