import { useState } from "react";
import { FormattedMessage } from "react-intl";
import { useMutation, useQuery } from "@tanstack/react-query";

import { fetchOwnershipCode, verifySourceOwnership } from "@services/SourcesService";

import { useSession } from "@root/SessionContext";

import Button from "@ui-components/input/Button";
import HintBox from "@ui-components/layout/HintBox";
import Icon from "@ui-components/layout/Icon";
import { PollingLoading } from "@ui-components/layout/LoadingIndicator";

import CopyToClipboardButton from "@components/CopyToClipboardButton";

import styles from "./Wizard.module.css";
import WizardStepFooter from "./WizardFooter";
import type { WordpressWizardStepProps } from "./WordpressWizard";
import WordpressWizardApproveSuwali, { RevokeManuallyMessage } from "./WordpressWizardApproveSuwali";

const WordpressWizardVerifyOwnership = ({
  source,
  isEditing,
  readOnly,
  onCancel,
  onStepChange,
  currentStep,
  wizardState,
  setWizardState,
}: WordpressWizardStepProps) => {
  const hubId = useSession().currentHubId();
  const siteUrl = wizardState.siteUrl || "";
  const savedSiteUrl = (source?.config as { site_url?: string } | undefined)?.site_url;

  // An existing source keeps its verification until its site changes
  const alreadyVerified = readOnly || (isEditing && siteUrl === savedSiteUrl);
  const verified = alreadyVerified || Boolean(wizardState.ownershipReceipt);
  const [useTagline, setUseTagline] = useState(false);

  const payload = {
    source: {
      hub_id: hubId,
      source_type: "wordpress_api",
      config: { site_url: siteUrl },
    },
  };

  const codeQuery = useQuery({
    queryKey: ["/sources/ownership_code", hubId, siteUrl],
    queryFn: () => fetchOwnershipCode(payload),
    enabled: !alreadyVerified && Boolean(siteUrl),
  });

  const verifyMutation = useMutation({
    mutationFn: () => verifySourceOwnership(payload),
    onSuccess: (data) => {
      if (data.verified && data.receipt) {
        setWizardState({ ...wizardState, ownershipReceipt: data.receipt, applicationPasswordRevoked: undefined });
      }
    },
  });

  const verifyButton = (
    <Button
      label={
        <FormattedMessage
          id="wordpressWizard.verifyOwnershipButton"
          defaultMessage="Verify"
          description="Button that checks whether the user added the ownership code to their WordPress site’s tagline"
        />
      }
      size="medium"
      variant="filled"
      onClick={() => verifyMutation.mutate()}
      disabled={!codeQuery.data || verifyMutation.isPending}
    />
  );

  const renderInstructions = () => {
    if (codeQuery.isPending) {
      return (
        <PollingLoading
          size="medium"
          message={
            <FormattedMessage
              id="wordpressWizard.loadingOwnershipCode"
              defaultMessage="Checking how to verify your site…"
              description="Message shown next to a loading indicator while Suwali checks which methods a WordPress site supports for verifying ownership"
            />
          }
        />
      );
    }

    if (codeQuery.isError) {
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
          body={codeQuery.error.message}
        />
      );
    }

    const authorizeUrl = codeQuery.data.authorize_url;
    if (authorizeUrl && !useTagline) {
      return (
        <>
          <WordpressWizardApproveSuwali
            authorizeUrl={authorizeUrl}
            payload={payload}
            onVerified={(receipt, passwordRevoked) => setWizardState({
              ...wizardState,
              ownershipReceipt: receipt,
              applicationPasswordRevoked: passwordRevoked,
            })}
          />
          <HintBox
            type="themeMode"
            title={
              <FormattedMessage
                id="wordpressWizard.otherWayToVerify"
                defaultMessage="Can’t approve Suwali on your site?"
                description="Title of the box offering the alternative to approving Suwali on a WordPress site, which is verifying ownership through the site’s tagline"
              />
            }
            body={
              <FormattedMessage
                id="wordpressWizard.otherWayToVerifyBody"
                defaultMessage="There’s another way to confirm that you manage this site."
                description="Body of the box offering the alternative to approving Suwali on a WordPress site, which is verifying ownership through the site’s tagline"
              />
            }
            actions={
              <Button
                label={
                  <FormattedMessage
                    id="wordpressWizard.useTaglineInstead"
                    defaultMessage="Add a code to your site’s tagline instead"
                    description="Button that switches from approving Suwali on WordPress to verifying ownership through the site’s tagline"
                  />
                }
                size="small"
                variant="filled"
                themeMode
                onClick={() => setUseTagline(true)}
              />
            }
          />
        </>
      );
    }

    return (
      <>
        <ol className={styles.wizardOrderedList}>
          <li>
            <FormattedMessage
              id="wordpressWizard.ownershipStepCopy"
              defaultMessage="Copy this code"
              description="First instruction for verifying ownership of a WordPress site"
              tagName="h4"
            />
            <div className={styles.taglineCode}>
              <span className={styles.highlight}>{codeQuery.data.code}</span>
              <CopyToClipboardButton
                iconLeft={<Icon id="clipboard" aria-hidden />}
                label={
                  <FormattedMessage
                    id="global.copy"
                    defaultMessage="Copy"
                    description="Reusable label for copy buttons"
                  />
                }
                size="small"
                variant="filled"
                themeMode
                value={codeQuery.data.code}
              />
            </div>
          </li>
          <li>
            <FormattedMessage
              id="wordpressWizard.ownershipStepPaste"
              defaultMessage="Add it to your site’s tagline"
              description="Second instruction for verifying ownership of a WordPress site"
              tagName="h4"
            />
            <FormattedMessage
              id="wordpressWizard.ownershipStepPasteDetails"
              defaultMessage="Open your site’s <link>General settings</link>, add the code to the end of the <strong>Tagline</strong> field, keeping the text that’s already there, then save."
              description="Explains where to paste the ownership code in WordPress. The link opens the site’s General Settings page, where the tagline is edited. Tagline is the label of the field in WordPress."
              values={{
                link: (chunks: React.ReactNode) => (
                  <a key="settingsLink" href={codeQuery.data.settings_url} target="_blank" rel="noopener noreferrer">
                    <strong>{chunks}</strong>
                  </a>
                ),
                strong: (chunks: React.ReactNode) => <strong key="strong">{chunks}</strong>,
              }}
              tagName="p"
            />
            <FormattedMessage
              id="wordpressWizard.ownershipStepPasteExplanation"
              defaultMessage="Only administrators can change a site’s tagline, so adding our code shows that you manage this site. You can remove it again once we have verified it."
              description="Explains why the user must add the ownership code to their WordPress site’s tagline, and that they can remove it afterwards"
              tagName="p"
            />
          </li>
          <li>
            <FormattedMessage
              id="wordpressWizard.ownershipStepVerify"
              defaultMessage="Come back and verify"
              description="Third instruction for verifying ownership of a WordPress site"
              tagName="h4"
            />
            {verifyButton}
          </li>
        </ol>
        {authorizeUrl && (
          <HintBox
            type="themeMode"
            title={
              <FormattedMessage
                id="wordpressWizard.otherApprovalWayToVerify"
                defaultMessage="Can’t add the code to your tagline?"
                description="Title of the box offering the alternative to approving Suwali on a WordPress site, which is verifying ownership through the the normal autorization path"
              />
            }
            actions={
              <Button
                label={
                  <FormattedMessage
                    id="wordpressWizard.useApprovalInstead"
                    defaultMessage="Approve Suwali on your site instead"
                    description="Button that switches from verifying ownership through the site’s tagline back to approving Suwali on WordPress"
                  />
                }
                size="small"
                themeMode
                onClick={() => setUseTagline(false)}
              />
            }
          />
        )}
        {verifyMutation.isPending && (
          <PollingLoading
            size="medium"
            message={
              <FormattedMessage
                id="wordpressWizard.verifyingOwnership"
                defaultMessage="Verifying ownership of your site…"
                description="Message shown next to a loading indicator while Suwali checks ownership of the WordPress site"
              />
            }
          />
        )}
        {verifyMutation.data?.verified === false && (
          <HintBox
            type="warning"
            title={
              <FormattedMessage
                id="wordpressWizard.ownershipCodeNotFound"
                defaultMessage="We couldn’t find the code yet"
                description="Shown when the ownership code is not in the WordPress site’s tagline"
              />
            }
            body={
              <FormattedMessage
                id="wordpressWizard.ownershipCodeNotFoundHelp"
                defaultMessage="Check that the full code is in your site’s tagline and that you saved your changes. If you just saved, your site may still be showing a cached copy, so wait a minute and try again."
                description="Help shown when the ownership code is not in the WordPress site’s tagline"
              />
            }
          />
        )}
        {verifyMutation.isError && (
          <HintBox
            type="error"
            title={
              <FormattedMessage
                id="wordpressWizard.ownershipVerificationFailed"
                defaultMessage="We couldn’t read your site’s tagline"
                description="Shown when the WordPress site could not be reached to verify ownership"
              />
            }
            body={verifyMutation.error.message}
          />
        )}
      </>
    );
  };

  return (
    <>
      <hgroup>
        <FormattedMessage
          id="wordpressWizard.verifyOwnership"
          defaultMessage="Confirm you manage this site"
          description="Title for the WordPress wizard step where the user proves they administer the site"
          tagName="h3"
        />
      </hgroup>
      <div className={styles.wizardCardBody}>
        <FormattedMessage
          id="wordpressWizard.verifyOwnershipSubtitle"
          defaultMessage="We must confirm that you manage this site before we can import its content."
          description="Explains why the WordPress wizard asks the user to change their site’s tagline"
          tagName="p"
        />
        {verified ? (
          <HintBox
            type="success"
            title={
              <FormattedMessage
                id="wordpressWizard.ownershipVerified"
                defaultMessage="Ownership verified"
                description="Shown when the user has proven they administer the WordPress site"
              />
            }
            body={
              alreadyVerified ? (
                <FormattedMessage
                  id="wordpressWizard.ownershipVerifiedEarlier"
                  defaultMessage="You verified this site when you added it."
                  description="Shown when editing a WordPress source whose site was already verified"
                  tagName="p"
                />
              ) : wizardState.applicationPasswordRevoked === true ? (
                <FormattedMessage
                  id="wordpressWizard.ownershipVerifiedApplicationPasswordRemoved"
                  defaultMessage="We removed the Application Password we used to check."
                  description="Shown after verifying ownership of a WordPress site with an Application Password that Suwali then revoked"
                  tagName="p"
                />
              ) : wizardState.applicationPasswordRevoked === false ? (
                <RevokeManuallyMessage />
              ) : (
                <FormattedMessage
                  id="wordpressWizard.ownershipVerifiedRemoveCode"
                  defaultMessage="You can remove the code from your site’s tagline now."
                  description="Shown after verifying ownership of a WordPress site"
                  tagName="p"
                />
              )
            }
          />
        ) : renderInstructions()}
      </div>
      <WizardStepFooter
        disableNext={!verified}
        isEditing={isEditing}
        onCancel={onCancel}
        onGoBack={() => onStepChange(currentStep - 1)}
        onGoNext={() => onStepChange(currentStep + 1)}
      />
    </>
  );
};

export default WordpressWizardVerifyOwnership;
