import { useEffect } from 'react';
import { FormattedMessage } from 'react-intl';

import { parseWordpressAuthorization, WORDPRESS_AUTHORIZATION_CHANNEL } from '@helpers/wordpressAuthorization';

import Icon from '@ui-components/layout/Icon';

import layoutStyles from '@layouts/InterstitialLayout.module.css';

// Opened in a popup by the WordPress wizard. It is rendered instead of the app, whose session and
// onboarding redirects would otherwise navigate away before the result is read.
const WordpressAuthorized = () => {
  useEffect(() => {
    const result = parseWordpressAuthorization(window.location.search);
    // The query holds a password: keep it out of the history even when the window cannot close
    window.history.replaceState(null, '', window.location.pathname);
    if (!result) return;

    const channel = new BroadcastChannel(WORDPRESS_AUTHORIZATION_CHANNEL);
    channel.postMessage(result);
    channel.close();
    window.close();
  }, []);

  return (
    <div className={layoutStyles.interstitialWrapper}>
      <div className={layoutStyles.interstitialHeaderLogo}>
        <Icon id="suwali_logo_theme" aria-label="Suwali" />
      </div>
      <div className={layoutStyles.interstitialDialog}>
        <FormattedMessage
          id="wordpressAuthorized.closeWindow"
          defaultMessage="You can close this window and go back to Suwali."
          description="Shown in the window WordPress opens after the user approves or rejects Suwali, if it does not close by itself"
          tagName="p"
        />
      </div>
    </div>
  );
};

export default WordpressAuthorized;
