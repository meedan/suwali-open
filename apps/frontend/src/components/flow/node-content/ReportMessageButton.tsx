import { useState } from "react";
import { FormattedMessage } from "react-intl";

import type { Message } from "@customTypes/message";

import Button from "@ui-components/input/Button";
import ReportMessageModal from "@ui-components/input/ReportMessageModal";
import Icon from "@ui-components/layout/Icon";

import styles from "./NodeContent.module.css";


type ReportMessageButtonProps = {
  messageId: Message['id'];
  messageBody: Message['body'];
};

const ReportMessageButton = ({ messageId, messageBody }: ReportMessageButtonProps) => {
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <>
      <div className={styles.reportButtonWrapper}>
        <Button
          size="small"
          variant="filled"
          themeMode
          iconLeft={<Icon id="error" />}
          label={
            <FormattedMessage
              id="reportMessage.triggerLabel"
              defaultMessage="Report a problem"
              description="Button label that opens a form to report a problem with a chatbot message"
            />
          }
          onClick={() => setReportOpen(true)}
        />
      </div>

      <ReportMessageModal
        messageId={messageId}
        messageBody={messageBody}
        open={reportOpen}
        onOpenChange={setReportOpen}
      />
    </>
  );
};

export default ReportMessageButton;
