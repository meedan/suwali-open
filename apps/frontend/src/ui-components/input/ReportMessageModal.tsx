import { useState } from "react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";

import type { Message } from "@customTypes/message";

import { mutateCreateMessageReport } from "@services/ConversationsService";

import { useToast } from "@hooks/useToast";

import Button from "@ui-components/input/Button";
import Icon from "@ui-components/layout/Icon";
import { Modal } from "@ui-components/layout/Modal";

import styles from './ReportMessageModal.module.css';
import TextArea from "./TextArea";

const messages = defineMessages({
  placeholder: {
    id: "reportMessage.describePlaceholder",
    defaultMessage: "Describe what went wrong",
    description: "Placeholder text inside the textarea asking the user to describe the problem with a chatbot response",
  },
  success: {
    id: "reportMessage.success",
    defaultMessage: "Problem report submitted.",
    description: "Toast notification shown when a report about a chatbot response is successfully submitted",
  },
  error: {
    id: 'reportMessage.error',
    defaultMessage: 'Failed to submit problem report. Please try again.',
    description: 'Toast shown when submitting report fails',
  },
});

type Props = {
  messageId: Message['id'];
  messageBody: Message['body'];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export default function ReportMessageModal({ messageId, messageBody, open, onOpenChange }: Props) {
  const intl = useIntl();
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async () => {
    setSubmitting(true);

    try {
      await mutateCreateMessageReport(messageId, comment);
      toast('success', intl.formatMessage(messages.success));
      setComment("");
      onOpenChange?.(false);
    } catch {
      toast('error', intl.formatMessage(messages.error));
    } finally {
      setSubmitting(false);
    }
  };

  const Body = (
    <div className={styles.body}>
      <FormattedMessage
        id="reportMessage.intro"
        defaultMessage="We’ll flag this message for review. Adding context helps us understand what went wrong."
        description="Introduction in the modal for reporting a problem with a chatbot response, explaining what happens when it is submitted"
        tagName="p"
      />

      <TextArea
        id="report-textarea"
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        helpContent={
          <FormattedMessage
            id="reportMessage.help"
            defaultMessage="Helpful details include the wrong language, a missing or misread source, links that don’t match your settings, or an unanswered question. If the wrong section or timespan was used, tell us which one you expected."
            description="Help text under the optional context field when reporting a chatbot response, listing examples of problems worth describing"
          />
        }
        label={<FormattedMessage id="reportMessage.fieldLabel" defaultMessage="Additional context" description="Label for the textarea where the user can write optional context for the report" />}
        placeholder={intl.formatMessage(messages.placeholder)}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        size="large"
        rows={3}
      />
    </div>
  );

  const Actions = (
    <>
      <Button
        variant="text"
        label={<FormattedMessage id="global.cancel" defaultMessage="Cancel" description="Reusable label for cancel buttons" />}
        onClick={() => {
          setComment("");
          onOpenChange?.(false);
        }}
        disabled={submitting}
        size="small"
        themeMode
      />
      <Button
        variant="filled"
        label={<FormattedMessage id="reportMessage.submit" defaultMessage="Submit report" description="Label for the button that submits the report about a chatbot response" />}
        onClick={handleSubmit}
        disabled={submitting}
        size="small"
      />
    </>
  );

  return (
    <>
      <Modal
        size="medium"
        title={<FormattedMessage id="reportMessage.title" defaultMessage="Report a problem with a chatbot response?" description="Title of the modal for reporting an issue with a chatbot response" />}
        titleContext={messageBody &&
          <>
            <Icon id="bot" aria-hidden />
            <strong title={messageBody}>{messageBody}</strong>
          </>
        }
        body={Body}
        open={open}
        onOpenChange={onOpenChange}
        actions={Actions}
      />
    </>
  );
}
