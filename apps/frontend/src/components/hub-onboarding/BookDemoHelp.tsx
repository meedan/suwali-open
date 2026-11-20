import { FormattedMessage } from 'react-intl';
import { useQuery } from '@tanstack/react-query';

import { fetchAbout } from '@services/AboutService';

const BookDemoHelp = () => {
  const { data: about } = useQuery({ queryKey: ['/about'], queryFn: fetchAbout });
  const demoLink = about?.schedule_demo_link;

  if (!demoLink) return null;

  return (
    <FormattedMessage
      id="global.setupOnboardingHelpDemo"
      defaultMessage="Need some guidance? <demoLink>Book a demo.</demoLink>"
      description="Text for the user to get help by scheduling a demo"
      tagName="p"
      values={{
        demoLink: msg => (
          <a key="demoLink" target="_blank" href={demoLink} rel="noopener noreferrer">
            {msg}
          </a>
        ),
      }}
    />
  );
};

export default BookDemoHelp;
