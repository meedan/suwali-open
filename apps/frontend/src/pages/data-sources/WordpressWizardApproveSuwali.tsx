import { useEffect, useState } from "react";
import { FormattedMessage } from "react-intl";
import { useMutation } from "@tanstack/react-query";

import {
  authorizationStateOf,
  WORDPRESS_AUTHORIZATION_CHANNEL,
  type WordpressAuthorizationResult,
} from "@helpers/wordpressAuthorization";

import { verifySourceOwnership } from "@services/SourcesService";

import Button from "@ui-components/input/Button";
import HintBox from "@ui-components/layout/HintBox";
import { PollingLoading } from "@ui-components/layout/LoadingIndicator";

import styles from "./Wizard.module.css";

type Props = {
  authorizeUrl: string;
  payload: { source: object };
  onVerified: (receipt: string, passwordRevoked: boolean) => void;
};

type Outcome = "blocked" | "rejected" | "disabled" | null;

export const RevokeManuallyMessage = () => (
  <FormattedMessage
    id="wordpressWizard.revokeApplicationPasswordManually"
    defaultMessage="Suwali couldn’t remove the Application Password it was given. You can revoke “Suwali” under Application Passwords in your WordPress profile."
    description="Shown when Suwali could not revoke the WordPress Application Password it used to verify ownership"
  />
);

// Sends the site's admin to WordPress to approve Suwali, then checks the Application Password
// WordPress hands back. The approval page reports back from WordpressAuthorized.
const WordpressWizardApproveSuwali = ({ authorizeUrl, payload, onVerified }: Props) => {
  const [outcome, setOutcome] = useState<Outcome>(null);
  const expectedState = authorizationStateOf(authorizeUrl);

  const verifyMutation = useMutation({
    mutationFn: (result: Extract<WordpressAuthorizationResult, { status: "approved" }>) => verifySourceOwnership({
      ...payload,
      authorization: { state: result.state, user_login: result.userLogin, password: result.password },
    }),
    onSuccess: (data) => {
      if (data.verified && data.receipt) onVerified(data.receipt, data.password_revoked === true);
    },
  });
  const { mutate } = verifyMutation;

  useEffect(() => {
    const channel = new BroadcastChannel(WORDPRESS_AUTHORIZATION_CHANNEL);
    channel.onmessage = (event: MessageEvent<WordpressAuthorizationResult>) => {
      // Ignore results meant for another wizard, or for a site the user has since changed
      if (!expectedState || event.data?.state !== expectedState) return;

      if (event.data.status === "approved") {
        mutate(event.data);
      } else {
        setOutcome(event.data.status);
      }
    };
    return () => channel.close();
  }, [expectedState, mutate]);

  const openApproval = () => {
    setOutcome(null);
    verifyMutation.reset();
    // Opened blank and then pointed at the site, so the WordPress page cannot reach back into Suwali
    const popup = window.open("", "suwali-wordpress-authorization", "popup,width=640,height=760");
    if (!popup) {
      setOutcome("blocked");
      return;
    }
    popup.opener = null;
    popup.location.href = authorizeUrl;
  };

  const renderOutcome = () => {
    if (verifyMutation.isPending) {
      return (
        <PollingLoading
          size="medium"
          message={
            <FormattedMessage
              id="wordpressWizard.verifyingApproval"
              defaultMessage="Checking that Suwali is approved on your site…"
              description="Message shown next to a loading indicator while Suwali checks that it has been approved on the WordPress site"
            />
          }
        />
      );
    }

    if (verifyMutation.isError) {
      return (
        <HintBox
          type="error"
          title={
            <FormattedMessage
              id="global.thatDidntWorkAsExpected"
              defaultMessage="That didn’t work as expected"
              description="Label displayed when an error occurs in the app"
            />
          }
          body={verifyMutation.error.message}
        />
      );
    }

    const data = verifyMutation.data;
    if (data && !data.verified) {
      return (
        <HintBox
          type="warning"
          title={data.reason === "not_admin" ? (
            <FormattedMessage
              id="wordpressWizard.applicationPasswordNotAdmin"
              defaultMessage="Your WordPress account isn’t an administrator of this site"
              description="Shown when the WordPress user who approved Suwali is not an administrator of the site"
            />
          ) : (
            <FormattedMessage
              id="wordpressWizard.applicationPasswordRejected"
              defaultMessage="Your site didn’t accept the approval"
              description="Shown when the WordPress site refused the Application Password Suwali received"
            />
          )}
          body={
            <>
              {data.reason === "not_admin" ? (
                <FormattedMessage
                  id="wordpressWizard.applicationPasswordNotAdminHelp"
                  defaultMessage="Approve Suwali again while signed in as an administrator of the site."
                  description="Help shown when the WordPress user who approved Suwali is not an administrator of the site"
                  tagName="p"
                />
              ) : (
                <FormattedMessage
                  id="wordpressWizard.applicationPasswordRejectedHelp"
                  defaultMessage="Some hosts block this method. Use the option below to add a code to your site’s tagline instead."
                  description="Help shown when the WordPress site refused the Application Password Suwali received"
                  tagName="p"
                />
              )}
              {data.password_revoked === false && <p><RevokeManuallyMessage /></p>}
            </>
          }
        />
      );
    }

    if (outcome === "blocked") {
      return (
        <HintBox
          type="warning"
          title={
            <FormattedMessage
              id="wordpressWizard.approvalWindowBlocked"
              defaultMessage="Your browser blocked the WordPress window"
              description="Shown when the browser blocks the popup where the user approves Suwali on their WordPress site"
            />
          }
          body={
            <FormattedMessage
              id="wordpressWizard.approvalWindowBlockedHelp"
              defaultMessage="Allow pop-ups for Suwali and try again."
              description="Help shown when the browser blocks the popup where the user approves Suwali on their WordPress site"
            />
          }
        />
      );
    }

    if (outcome === "rejected" || outcome === "disabled") {
      return (
        <HintBox
          type="warning"
          title={outcome === "rejected" ? (
            <FormattedMessage
              id="wordpressWizard.approvalRejected"
              defaultMessage="Suwali wasn’t approved"
              description="Shown when the user rejects Suwali on their WordPress site’s approval page"
            />
          ) : (
            <FormattedMessage
              id="wordpressWizard.applicationPasswordsDisabled"
              defaultMessage="Application Passwords are turned off for your account"
              description="Shown when the WordPress site does not let the user create Application Passwords"
            />
          )}
          body={outcome === "rejected" ? (
            <FormattedMessage
              id="wordpressWizard.approvalAlternative"
              defaultMessage="Try again, or add a code to your site’s tagline instead."
              description="Help shown when the user rejected Suwali on their WordPress site’s approval page"
            />
          ) : (
            <FormattedMessage
              id="wordpressWizard.applicationPasswordsDisabledHelp"
              defaultMessage="Add a code to your site’s tagline instead, or ask your site’s administrator to turn Application Passwords on."
              description="Help shown when the WordPress site does not let the user create Application Passwords"
            />
          )}
        />
      );
    }

    return null;
  };

  return (
    <>
      <div className={styles.wizardReviewItem}>
        <FormattedMessage
          id="wordpressWizard.approveSuwaliTitle"
          defaultMessage="Approve Suwali on your site (recommended)"
          description="Heading for the recommended option to verify ownership of a WordPress site by approving Suwali there"
          tagName="strong"
        />
        <div className={styles.row}>
          <FormattedMessage
            id="wordpressWizard.approveSuwaliExplanation"
            defaultMessage="WordPress will ask you to sign in as an administrator and approve Suwali. We use the approval once to confirm you manage the site, then remove it."
            description="Explains what happens when the user approves Suwali on their WordPress site"
            tagName="span"
          />
        </div>
        <div className={styles.row}>
          <Button
            label={
              <FormattedMessage
                id="wordpressWizard.approveSuwaliButton"
                defaultMessage="Approve on WordPress"
                description="Button that opens the user’s WordPress site so they can approve Suwali"
              />
            }
            size="small"
            variant="filled"
            onClick={openApproval}
            disabled={verifyMutation.isPending}
          />
        </div>
      </div>
      {renderOutcome()}
    </>
  );
};

export default WordpressWizardApproveSuwali;
