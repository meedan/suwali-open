import clsx from 'clsx';
import { FormattedMessage } from "react-intl";
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';

import type { Hub } from '@customTypes/hub';
import type { User } from '@customTypes/user';

import { fetchMe } from '@services/ProfileService';

import { useSession } from '@root/SessionContext';

import { useHubPath } from '@hooks/useHubPath';

import RadioButton from "@ui-components/input/RadioButton";

import styles from './EditorOnboardingChecklist.module.css';

const EditorOnboardingChecklist = () => {
  const session = useSession();
  const hubId = session.currentHubId();
  const hubPath = useHubPath();

  const { data, error, isPending } = useQuery({
    queryKey: ['/me'],
    queryFn: () => fetchMe(),
  });

  const currentUser = data as User;
  const hub = currentUser?.hubs?.find((h: Hub) => h.id === hubId);
  const onboardingTasks = hub?.hub_membership?.onboarding_tasks;

  if (error) return null;

  if (session.isSuperAdminGuest() || !hub || !onboardingTasks || isPending) return null;

  const onboardingTasksCompleted = onboardingTasks.profile_filled && onboardingTasks.internal_conversation_started && onboardingTasks.notebook_published;

  if (onboardingTasksCompleted) return null;

  return (
    <div className={styles.onboarding}>
      <hgroup>
        <FormattedMessage
          id="global.onboardingtitle"
          defaultMessage="Start using Suwali"
          description="Title for the onboarding tasks section"
          tagName="h3"
        />
      </hgroup>
      <ul>
        <li className={clsx({[styles.completed]: onboardingTasks.profile_filled})}>
          <RadioButton
            checked={onboardingTasks.profile_filled}
            disabled={onboardingTasks.profile_filled}
            id="onboardingProfile"
            label={
              <FormattedMessage
                id="global.onboardingonboardingProfile"
                defaultMessage="Update your profile"
                description="Title for onboarding step about updating your profile"
              />
            }
            themeMode
            value="profile"
          />
        </li>
        <li className={clsx({[styles.completed]: onboardingTasks.internal_conversation_started})}>
          <RadioButton
            checked={onboardingTasks.internal_conversation_started}
            disabled={onboardingTasks.internal_conversation_started}
            id="onboardingInternalConversation"
            label={
              <Link to={{ pathname: hubPath('/conversations/me') }}>
                <FormattedMessage
                  id="global.onboardingonboardingInternalConversation"
                  defaultMessage="Start a conversation"
                  description="Title for onboarding step about testing the chatbot"
                />
              </Link>
            }
            themeMode
            value="conversation"
          />
          <FormattedMessage
            id="global.onboardingonboardingInternalConversationDescription"
            defaultMessage="See how your chatbot answers questions using your data sources."
            description="Description text for this onboarding task"
            tagName="small"
          />
        </li>
        <li className={clsx({[styles.completed]: onboardingTasks.notebook_published})}>
          <RadioButton
            checked={onboardingTasks.notebook_published}
            disabled={onboardingTasks.notebook_published}
            id="onboardingPublish"
            label={
              <Link to={{ pathname: hubPath('/notebooks') }}>
                <FormattedMessage
                  id="global.onboardingonboardingPublish"
                  defaultMessage="Publish a notebook"
                  description="Title for onboarding step about publishing a notebook"
                />
              </Link>
            }
            themeMode
            value="publish"
          />
          <FormattedMessage
            id="global.onboardingonboardingPublishDescription"
            defaultMessage="Collect and answer questions from your audience by adding new knowledge for your chatbot."
            description="Description text for this onboarding task of publishing a noteboook"
            tagName="small"
          />
        </li>
      </ul>
    </div>
  );
};

export default EditorOnboardingChecklist;
