import clsx from 'clsx';
import { useState } from 'react';
import { FormattedMessage } from 'react-intl';
import { useNavigate } from 'react-router';

import { useHubPath } from '@hooks/useHubPath';

import Button from '@ui-components/input/Button';
import HintBox from '@ui-components/layout/HintBox';
import Icon from '@ui-components/layout/Icon';

import styles from './NotebookEmptyStatePanel.module.css';

interface NotebookEmptyStatePanelProps {
  className?: string;
};

const NotebookEmptyStatePanel = ({
  className,
}: NotebookEmptyStatePanelProps) => {
  const navigate = useNavigate();
  const hubPath = useHubPath();
  const [dismissHint, setDismissHint] = useState<boolean>(false);

  return !dismissHint ? (
    <div className={clsx(styles.ctaCards, className)}>
      <HintBox
        className={styles.ctaCard}
        iconId="unanswered_question"
        type="themeMode"
        body={
          <FormattedMessage
            id="notebook.addQuestionCta"
            defaultMessage="Add a recent unanswered question from your audience to this notebook"
            description="CTA shown in the notebook page when there are no questions yet."
          />
        }
        actions={
          <Button
            label={
              <FormattedMessage
                id="global.unansweredQuestions"
                defaultMessage="Unanswered questions"
                description="Label for the button that takes the user to the list of unanswered questions in the hub."
              />
            }
            themeMode
            size="small"
            onClick={() => navigate(hubPath('/dashboard'))}
          />
        }
      />
      <HintBox
        className={styles.ctaCard}
        iconId="conversations"
        type="themeMode"
        body={
          <FormattedMessage
            id="notebook.browseConversationsCta"
            defaultMessage="Browse conversations and add any message from your audience to this notebook"
            description="CTA shown in the notebook page when there are no questions yet."
          />
        }
        actions={
          <Button
            label={
              <FormattedMessage
                id="global.browseConversations"
                defaultMessage="Browse conversations"
                description="Label for the button that takes the user to the list of conversations in the hub."
              />
            }
            themeMode
            size="small"
            onClick={() => navigate(hubPath('/conversations/audience'))}
          />
        }
      />
      <Button
        iconLeft={<Icon id="x" />}
        onClick={() => setDismissHint(true)}
        themeMode
      />
    </div>
  ) : null;
};

export default NotebookEmptyStatePanel;
