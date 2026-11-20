import { FormattedMessage } from "react-intl";
import { useDebounce } from "use-debounce";
import { useQuery } from "@tanstack/react-query";

import { normalizeUrl } from "@helpers/forms";

import { detectWordpressSite } from "@services/SourcesService";

import { useSession } from "@root/SessionContext";

import Button from "@ui-components/input/Button";
import HintBox from "@ui-components/layout/HintBox";

const DETECT_DEBOUNCE_MS = 500;

type WordpressDetectedHintProps = {
  url: string;
  onSwitchToWordpress: (siteUrl: string) => void;
};

const WordpressDetectedHint = ({ url, onSwitchToWordpress }: WordpressDetectedHintProps) => {
  const hubId = useSession().currentHubId();
  const [debouncedUrl] = useDebounce(normalizeUrl(url), DETECT_DEBOUNCE_MS);

  const { data } = useQuery({
    queryKey: ["/sources/detect_wordpress", hubId, debouncedUrl],
    queryFn: () => detectWordpressSite({ hub_id: hubId, url: debouncedUrl! }),
    enabled: Boolean(hubId && debouncedUrl),
    retry: false,
    staleTime: Infinity,
  });

  const siteUrl = debouncedUrl && data?.site_url;
  if (!siteUrl) return null;

  return (
    <HintBox
      type="info"
      iconId="wordpress_source"
      title={
        <FormattedMessage
          id="dataSourceWizard.wordpressDetectedTitle"
          defaultMessage="This looks like a WordPress site"
          description="Title of the hint shown in the RSS feed and website wizards when the URL the user entered belongs to a WordPress site"
        />
      }
      body={
        <FormattedMessage
          id="dataSourceWizard.wordpressDetectedBody"
          defaultMessage="Connect it as a WordPress site instead. It takes fewer steps, imports your posts directly and updates automatically."
          description="Body of the hint shown in the RSS feed and website wizards when the URL the user entered belongs to a WordPress site"
        />
      }
      actions={
        <Button
          label={
            <FormattedMessage
              id="dataSourceWizard.continueWithWordpress"
              defaultMessage="Continue with WordPress"
              description="Button that moves the user from the RSS feed or website wizard to the WordPress wizard, keeping the URL they entered"
            />
          }
          size="small"
          variant="filled"
          onClick={() => onSwitchToWordpress(siteUrl)}
        />
      }
    />
  );
};

export default WordpressDetectedHint;
