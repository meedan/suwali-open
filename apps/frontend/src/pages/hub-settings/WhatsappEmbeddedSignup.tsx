import { useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';

import type { MessagingIntegration } from '@customTypes/messaging-integration';

import { completeWhatsappSignup } from '@services/MessagingIntegrationsService';

import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';

import styles from './MessagingIntegrations.module.css';

interface WhatsappEmbeddedSignupProps {
  messagingIntegration: MessagingIntegration;
  onComplete: () => void;
}

// Type declarations for Facebook SDK
declare global {
  interface Window {
    FB: {
      init: (params: {
        appId: string;
        autoLogAppEvents: boolean;
        xfbml: boolean;
        version: string;
      }) => void;
      login: (callback: (response: FacebookLoginResponse) => void, params: {
        config_id: string;
        response_type: string;
        override_default_response_type: boolean;
        redirect_uri: string;
        state: string;
        extras: {
          setup: Record<string, unknown>;
        };
      }) => void;
    };
    fbAsyncInit: () => void;
  }
}

// Facebook login response type
interface FacebookLoginResponse {
  authResponse?: {
    code: string;
    accessToken?: string;
    expiresIn?: number;
    signedRequest?: string;
    userID?: string;
  };
  status?: string;
}

type ESUData = {
  data: {
    phone_number_id?: string;
    waba_id?: string;
    business_id?: string;
  };
  type: "WA_EMBEDDED_SIGNUP";
  event: string;
  version: string;
};

const WhatsappEmbeddedSignup = ({
  messagingIntegration,
  onComplete,
}: WhatsappEmbeddedSignupProps) => {
  const [isSDKLoaded, setIsSDKLoaded] = useState(false);
  const [esuData, setEsuData] = useState<ESUData | null>(null);
  const [esuCode, setEsuCode] = useState<string | null>(null);
  const intl = useIntl();
  const { toast } = useToast();

  // Facebook SDK initialization
  useEffect(() => {
    if (window.FB) {
      setIsSDKLoaded(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';

    window.fbAsyncInit = function() {
      window.FB.init({
        appId: messagingIntegration.whatsapp_signup.app_id,
        autoLogAppEvents: true,
        xfbml: true,
        version: messagingIntegration.whatsapp_signup.api_version,
      });
      setIsSDKLoaded(true);
    };

    document.head.appendChild(script);

    return () => {
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, [messagingIntegration.whatsapp_signup.app_id, messagingIntegration.whatsapp_signup.api_version]);

  // Message event listener for Whatsapp Embedded Signup
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.origin.endsWith('facebook.com')) return;

      let data = null;
      try {
        data = JSON.parse(event.data);
      } catch {
        data = null;
      }
      if (data && data.type === 'WA_EMBEDDED_SIGNUP') {
        if (!esuData) setEsuData(data);
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [esuData]);

  // Facebook login callback - handles the auth response
  const fbLoginCallback = (response: FacebookLoginResponse) => {
    if (response.authResponse) {
      if (!esuCode) setEsuCode(response.authResponse.code);
    }
  };

  // The capture guards ignore new events while these are set, so a failed attempt must clear them or the retry does nothing
  const resetSignup = () => {
    setEsuData(null);
    setEsuCode(null);
  };

  // Launch WhatsApp signup flow
  const launchWhatsAppSignup = () => {
    window.FB.login(fbLoginCallback, {
      config_id: messagingIntegration.whatsapp_signup.configuration_id,
      response_type: 'code',
      override_default_response_type: true,
      redirect_uri: messagingIntegration.whatsapp_signup.redirect_url,
      state: messagingIntegration.whatsapp_signup.state,
      extras: {
        setup: {},
      }
    });
  };

  useEffect(() => {
    // Call the backend when we have both the code and the data
    const whatsappCallback = async () => {
      if (esuData && esuCode) {
        const payload = {
          integration_id: messagingIntegration.id,
          code: esuCode,
          state: messagingIntegration.whatsapp_signup.state,
          phone_number_id: esuData.data.phone_number_id,
          waba_id: esuData.data.waba_id,
          business_id: esuData.data.business_id,
        };
        try {
          await completeWhatsappSignup(payload);
          onComplete();
        } catch {
          resetSignup();
          toast('error', intl.formatMessage({
            id: 'messagingIntegrations.whatsappConnectError',
            defaultMessage: 'Something went wrong while connecting WhatsApp. Please try again.',
            description: 'Fallback error message shown when connecting a WhatsApp integration fails'
          }));
        }
      }
    };

    if (esuData && esuCode) {
      if (esuData.data.phone_number_id && esuData.data.waba_id) {
        whatsappCallback();
      } else {
        resetSignup();
        toast('error', intl.formatMessage({
          id: 'messagingIntegrations.whatsappIncompleteSignup',
          defaultMessage: 'The setup finished without a WhatsApp phone number. Please start again and select a phone number to continue.',
          description: 'Error message shown when the WhatsApp signup flow completes without a phone number being selected'
        }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esuData, esuCode]); // Only re-run when esuData or esuCode changes

  return (
    <Button
      className={styles.facebookButton}
      disabled={!isSDKLoaded}
      onClick={launchWhatsAppSignup}
      size="small"
      label={
        <FormattedMessage
          id="global.whatsappEmbeddedSignuploginWithFacebook"
          defaultMessage="Sign in with Facebook to continue"
          description="Button label for WhatsApp embedded signup"
        />
      }
    />
  );
};

export default WhatsappEmbeddedSignup;
