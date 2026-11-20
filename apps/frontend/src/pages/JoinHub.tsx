import { useEffect, useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';

import type { JoinableHub } from '@customTypes/hub';
import type { User } from '@customTypes/user';

import { createHubMembership, fetchJoinableHubs, leaveHub } from '@services/HubService';
import { fetchMe } from '@services/ProfileService';

import { useSession } from '@root/SessionContext';

import { useHubPath } from '@hooks/useHubPath';
import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import RadioButton from '@ui-components/input/RadioButton';
import Icon from '@ui-components/layout/Icon';

import layoutStyles from '@layouts/InterstitialLayout.module.css';

import styles from '@pages/JoinHub.module.css';

const CREATE_NEW = 'new';

const messages = defineMessages({
  membersCount: {
    id: 'global.hubMembersCount',
    defaultMessage: '{count, plural, one {1 member} other {# members}}',
    description: 'Member count for a hub in the join hub list',
  },
  createdBy: {
    id: 'global.hubCreatedBy',
    defaultMessage: 'created {date} by {email}',
    description: 'Hub creation info shown under hub name in join hub list',
  },
  somethingWentWrong: {
    id: 'global.somethingWentWrong',
    defaultMessage: 'Something went wrong. Please try again.',
    description: 'Error toast message shown when the request fails',
  },
});

type PendingMembership = {
  hubId: number;
  hubName: string;
  membershipId: number;
} | null ;

const getPendingMembership = (user: User) => {
  const hubPendingMembership = user.pending_hubs ? user.pending_hubs[0] : null;

  if (!hubPendingMembership) return null;

  return {
    hubId: hubPendingMembership.id,
    hubName: hubPendingMembership.name,
    membershipId: hubPendingMembership.hub_membership!.id!,
  };
};

const JoinHub = () => {
  const intl = useIntl();
  const navigate = useNavigate();
  const session = useSession();
  const hubPath = useHubPath();
  const { toast } = useToast();

  const [selectedValue, setSelectedValue] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmationPending, setConfirmationPending] = useState<PendingMembership>(getPendingMembership(session.user!));

  const { data: user } = useQuery({
    queryKey: ['/me'],
    queryFn: fetchMe,
    enabled: !!confirmationPending,
    refetchInterval: 3000,
  });

  useEffect(() => {
    if (!user) return;

    const isApproved = user.hubs?.some(
      (h) =>
        h.id === confirmationPending?.hubId &&
        h.hub_membership?.approved
    );

    if (isApproved) {
      session.setUser(user);
      navigate(hubPath('/dashboard'));
    }
  }, [user, confirmationPending?.hubId, session, navigate, hubPath]);

  const userEmail = session.user?.email ?? '';
  const emailDomain = userEmail.split('@')[1] ?? '';

  const { data: hubs, isLoading } = useQuery<JoinableHub[]>({
    queryKey: ['/hubs/joinable'],
    queryFn: fetchJoinableHubs,
    retry: false,
  });

  if (isLoading || !hubs) {
    return null;
  }

  if (!confirmationPending && hubs.length === 0) {
    navigate('/hub/setup');
    return null;
  }

  const handleContinue = () => {
    if (!selectedValue) return;

    if (selectedValue === CREATE_NEW) {
      navigate('/hub/setup', { state: { canGoBack: true } });
      return;
    }

    setIsSubmitting(true);

    createHubMembership(Number(selectedValue))
      .then((membership) => {
        const hub = hubs.find(h => h.id === Number(selectedValue));
        setConfirmationPending({
          hubId: Number(selectedValue),
          hubName: hub?.name ?? '',
          membershipId: membership.id,
        });
      })
      .catch(() => {
        toast('error', intl.formatMessage(messages.somethingWentWrong));
      })
      .finally(() => setIsSubmitting(false));
  };

  const handleCancelRequest = () => {
    if (!confirmationPending) return;

    leaveHub(confirmationPending.hubId).then((user: User) => {
      session.setUser(user);
      setConfirmationPending(null);
      setSelectedValue(null);
    });
  };

  if (confirmationPending) {
    return (
      <div className={styles.joinHubWrapper}>
        <hgroup>
          <Icon id="hand_waving_color" className={layoutStyles.interstitialIcon} />
          <FormattedMessage
            id="global.joinHubRequestSent"
            defaultMessage="A request to join <strong>{hubName}</strong> has been sent to the system admin."
            description="Confirmation message shown after the user requests to join a hub, with the hub name bolded"
            values={{
              hubName: confirmationPending.hubName,
              strong: (msg) => <strong key="strong">{msg}</strong>,
            }}
            tagName="h1"
          />
          <FormattedMessage
            id="global.joinHubRequestPending"
            defaultMessage="Once approved you will automatically join."
            description="Secondary message on the join hub confirmation screen explaining that approval is required before access is granted"
            tagName="p"
          />
        </hgroup>
        <hr className={styles.divider} />
        <div className={styles.footerStart}>
          <Button
            iconLeft={<Icon id="x" />}
            label={
              <FormattedMessage
                id="global.cancelRequestToJoinHub"
                defaultMessage="Cancel request to join"
                description="Button label to cancel a pending request to join a hub"
              />
            }
            variant="text"
            size="small"
            themeMode
            onClick={handleCancelRequest}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.joinHubWrapper}>
      <hgroup>
        <FormattedMessage
          id="global.joinHubTitle"
          defaultMessage="We found organizations with <strong>…@{domain}</strong> email addresses."
          description="Heading on the join hub page showing the user’s email domain, indicating organizations were found for that domain"
          values={{
            domain: emailDomain,
            strong: (msg) => <strong key="strong">{msg}</strong>,
          }}
          tagName="h1"
        />
        <p className={styles.subtitle}>
          <FormattedMessage
            id="global.joinHubSubtitle"
            defaultMessage="Request to join an existing organization or create a new Suwali organization."
            description="Subheading on the join hub page prompting the user to select an organization to join or create a new one"
          />
        </p>
      </hgroup>
      <div className={styles.options}>
        {hubs.map((hub) => {
          const createdDate = intl.formatDate(hub.created_at, { month: 'long', year: 'numeric' });
          const description = `${intl.formatMessage(messages.membersCount, { count: hub.users_count })}, ${intl.formatMessage(messages.createdBy, { date: createdDate, email: hub.admin_email })}`;

          return (
            <RadioButton
              className={styles.hubRadio}
              key={hub.id}
              id={`hub-${hub.id}`}
              name="hubSelection"
              value={String(hub.id)}
              checked={selectedValue === String(hub.id)}
              label={
                <>
                  {hub.name}
                  <span className={styles.hubDescription}>{description}</span>
                </>
              }
              size="large"
              onChange={() => setSelectedValue(String(hub.id))}
            />
          );
        })}

        <hr className={styles.divider} />

        <RadioButton
          id="hub-new"
          name="hubSelection"
          value={CREATE_NEW}
          checked={selectedValue === CREATE_NEW}
          size="large"
          label={
            <FormattedMessage
              id="global.createNewHub"
              defaultMessage="Create a new organization"
              description="Radio button option on the join hub page that lets the user create a new organization instead of joining an existing one"
              tagName="span"
            />
          }
          onChange={() => setSelectedValue(CREATE_NEW)}
        />

        <hr className={styles.divider} />
      </div>

      <div className={styles.footerEnd}>
        <Button
          iconRight={<Icon id="chevron_right" />}
          size="small"
          label={
            <FormattedMessage
              id="global.continue"
              defaultMessage="Continue"
              description="Primary action button label to continue after completing form data"
            />
          }
          disabled={!selectedValue || isSubmitting}
          variant="filled"
          onClick={handleContinue}
        />
      </div>
    </div>
  );
};

export default JoinHub;
