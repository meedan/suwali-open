import { FormattedMessage, useIntl } from "react-intl";
import { Link, useNavigate } from "react-router";

import type { Message } from "@customTypes/message";

import { formatElapsedTime } from "@helpers/dates";

import { useHubPath } from "@hooks/useHubPath";

import Button from "@ui-components/input/Button";
import Icon from "@ui-components/layout/Icon";

import styles from "./NodeContent.module.css";
import NodeContentTitle from "./NodeContentTitle";
import NodeQuote from "./NodeQuote";
import ReportMessageButton from "./ReportMessageButton";
import TimestampField from "./TimestampField";

const intentScenarioLabels: Partial<Record<Message['metadata']['router_intent'], React.ReactNode>> = {
  speak_to_person: (
    <FormattedMessage
      id="global.speakToPersonLabel"
      defaultMessage="Speak to a person"
      description="Label for speak to a person scenario"
    />
  ),
  purchase_subscribe: (
    <FormattedMessage
      id="global.purchaseSubscribeLabel"
      defaultMessage="Purchase or subscribe to services"
      description="Label for purchase or subscribe scenario"
    />
  ),
};

const intentQuestionLabels: Partial<Record<Message['metadata']['router_intent'], React.ReactNode>> = {
  question: (
    <FormattedMessage
      id="global.questionIntent"
      defaultMessage="Question"
      description="Label to represent a question intent"
    />
  ),
  non_question: (
    <FormattedMessage
      id="global.nonQuestion"
      defaultMessage="Non-question"
      description="Label to represent a non-question intent"
    />
  ),
  location_noted: (
    <FormattedMessage
      id="global.locationNoted"
      defaultMessage="Location noted"
      description="Label for a reply that only acknowledges where the user is"
    />
  ),
};

type BotMessageProps = {
  message: Message;
};

const BotMessage = ({ message }: BotMessageProps) => {
  const intl = useIntl();
  const hubPath = useHubPath();
  const navigate = useNavigate();

  const { body, metadata, id } = message;

  let responseGenerationTime = null;
  if (metadata?.total_duration_ms) {
    responseGenerationTime =
      formatElapsedTime(intl.locale, Number(metadata?.total_duration_ms) / 1000);
  }

  const yes = <FormattedMessage id="global.yes" defaultMessage="Yes" description="Generic Yes label" />;
  const no = <FormattedMessage id="global.no" defaultMessage="No" description="Generic No label" />;

  return (
    <>
      <NodeContentTitle iconId="bot">
        <FormattedMessage
          id="global.botMessageNodetitle"
          defaultMessage="Chatbot message details"
          description="Label that represents a message originated from the chatbot"
          tagName="span"
        />
      </NodeContentTitle>

      <div className={styles.nodeContent}>
        <NodeQuote body={body} />
        <dl>
          <TimestampField message={message} />
          { metadata?.router_intent &&
            intentScenarioLabels[metadata.router_intent] && (
            <div>
              <FormattedMessage
                id="global.scenario"
                defaultMessage="Scenario"
                description="Label for detected scenario"
                tagName="dt"
              />
              <dd>
                <Link to={hubPath('/personalization')}>
                  {intentScenarioLabels[metadata.router_intent]}
                </Link>
              </dd>
            </div>
          )}
          { metadata?.router_intent &&
            intentQuestionLabels[metadata.router_intent] && (
            <div>
              <FormattedMessage
                id="global.intent"
                defaultMessage="Intent"
                description="Label for detected intent"
                tagName="dt"
              />
              <dd>
                {intentQuestionLabels[metadata.router_intent]}
              </dd>
            </div>
          )}
          { typeof metadata?.answerable === 'boolean' && (
            <>
              <div>
                <FormattedMessage
                  id="global.answerableMessage"
                  defaultMessage="Answerable"
                  description="Label for whether a message holds an answerable content"
                  tagName="dt"
                />
                <dd>
                  { metadata.answerable ? yes: no }
                </dd>
              </div>
              <div>
                <FormattedMessage
                  id="global.answeredMessage"
                  defaultMessage="Answered"
                  description="Label for whether a message holds an actual answer"
                  tagName="dt"
                />
                <dd>
                  { message.answered ? yes : no }
                </dd>
              </div>
            </>
          )}
          { responseGenerationTime && (
            <div>
              <FormattedMessage
                id="global.generatedIn"
                defaultMessage="Generated in"
                description="Label for the time it took to generate a message"
                tagName="dt"
              />
              <dd>
                {responseGenerationTime}
              </dd>
            </div>
          )}
        </dl>
        <ReportMessageButton messageId={id} messageBody={body} />
        { metadata.answerable && !message.answered && (
          <Button
            className={styles.viewSourcesButton}
            iconRight={<Icon id="chevron_right" className="icon-flip-rtl" />}
            size="small"
            label={
              <FormattedMessage
                id="global.dataSources"
                defaultMessage="Data sources"
                description="Reusable label for Data Sources page or list title"
              />
            }
            onClick={() => { navigate(hubPath('/data-sources'))}}
            themeMode
          />
        )}
      </div>
    </>
  );
};

export default BotMessage;
