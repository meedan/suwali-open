import { defineMessages } from 'react-intl';

import type { Tone } from '@customTypes/hub';

export const toneLabels = defineMessages({
  journalist: {
    id: 'global.toneJournalistLabel',
    defaultMessage: 'Journalist',
    description: 'Label for journalist tone option',
  },
  advocate: {
    id: 'global.toneAdvocateLabel',
    defaultMessage: 'Advocate',
    description: 'Label for advocate tone option',
  },
  executive: {
    id: 'global.toneExecutiveLabel',
    defaultMessage: 'Executive',
    description: 'Label for executive tone option',
  },
});

export const toneDescriptions = defineMessages({
  journalist: {
    id: 'global.toneJournalistDescription',
    defaultMessage: 'Investigative and factual. Presents information clearly using a “who, what, when, where, why” approach. Direct, neutral, and analytical in tone. Notes gaps or uncertainties rather than speculating.',
    description: 'Description for journalist tone option',
  },
  advocate: {
    id: 'global.toneAdvocateDescription',
    defaultMessage: 'Warm and empathetic. Prioritizes emotional understanding and validation. Reflects feelings, offers gentle guidance, and creates a supportive space for processing thoughts and emotions.',
    description: 'Description for advocate tone option',
  },
  executive: {
    id: 'global.toneExecutiveDescription',
    defaultMessage: 'Polished and results-focused. Communicates with professional clarity and strategic framing. Provides actionable takeaways and decisive guidance, as if in a leadership setting.',
    description: 'Description for executive tone option',
  },
});

export const tones: Tone[] = ['journalist', 'advocate', 'executive'];

// The tone the chatbot uses until one is chosen. Keep it in step with Hub#tone in the CMS API and DEFAULT_TONE in the knowledge service
export const DEFAULT_TONE: Tone = 'journalist';
