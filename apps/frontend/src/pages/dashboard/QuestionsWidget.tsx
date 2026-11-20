import { FormattedMessage, FormattedNumber } from "react-intl";
import { useQuery } from "@tanstack/react-query";

import { getPastMonthTotal, getSeriesAverage, getThisMonthTotal, getTrendColor, getTrendDateRange, getTrendDirection, getTrendLabel, MONTH_WEEKS } from "@helpers/dashboardWidgets";
import { askedIn, rateOf, unansweredRate } from "@helpers/questions";

import { useSession } from "@root/SessionContext";

import HintBox from "@ui-components/layout/HintBox";
import { Widget } from "@ui-components/layout/Widget";

import { questionsQuery, TOP_QUESTIONS_LIMIT, unansweredQuestionsQuery } from './questionsQuery';
import RequireMessagingPlatform from './RequireMessagingPlatform';

const QuestionsWidget = ({ onExpand, onHide }: {
  onExpand?: () => void,
  onHide?: () => void,
}) => {
  const hubId = useSession().currentHub()?.id;

  const { data: stats, isPending } = useQuery({
    ...questionsQuery(hubId),
    enabled: Boolean(hubId),
  });

  const series = stats?.questions_by_answered ?? [];
  const asked = series.map(week => ({ value: askedIn(week) }));
  const unanswered = series.map(week => ({ value: week.unanswered }));

  // Pooled over the month rather than averaging the weekly rates, so a quiet week does not weigh
  // as much as a busy one
  const askedThisMonth = getThisMonthTotal(asked);
  const unansweredThisMonth = getThisMonthTotal(unanswered);
  const thisMonth = rateOf(unansweredThisMonth, askedThisMonth);
  const pastMonth = rateOf(getPastMonthTotal(unanswered), getPastMonthTotal(asked));

  const monthStart = series.slice(-MONTH_WEEKS)[0]?.date;
  const { data: topQuestions } = useQuery({
    // The same ranking the expanded panel lists, so opening it costs no extra request
    ...unansweredQuestionsQuery(hubId, monthStart, TOP_QUESTIONS_LIMIT),
    enabled: Boolean(hubId && monthStart && unansweredThisMonth > 0),
  });

  if (isPending) return null;

  // A month with no questions has no rate to report, let alone one to compare
  const hasData = askedThisMonth > 0;

  const sparkLineData = series.map(week => ({ value: unansweredRate(week), date: week.date }));
  const direction = getTrendDirection(thisMonth, pastMonth);
  const mostAsked = topQuestions?.data[0];

  return (
    <Widget>
      <Widget.Title
        title={
          <FormattedMessage
            id="global.answerRate"
            defaultMessage="Answer rate"
            description="Reusable label for how much of what the audience asked the chatbot could answer"
          />
        }
        onExpand={hasData ? onExpand : undefined}
        onHide={onHide}
      />
      <Widget.Headline
        title={hasData ? <FormattedNumber value={thisMonth / 100} style="percent" maximumFractionDigits={0} /> : 0}
        context={hasData ? (
          <FormattedMessage
            id="questionsWidget.unansweredThisMonth"
            defaultMessage="of questions unanswered this month"
            description="Label under the percentage of questions the chatbot could not answer this month"
          />
        ) : (
          <FormattedMessage
            id="questionsWidget.questionsThisMonth"
            defaultMessage="questions this month"
            description="Label under the number of questions asked this month, when there were none"
          />
        )}
      />
      <RequireMessagingPlatform>
        <Widget.Body>
          <Widget.Trend
            // Inverted: fewer unanswered questions is the good outcome here
            color={getTrendColor(pastMonth, thisMonth)}
            data={sparkLineData}
            dateRange={getTrendDateRange(sparkLineData.map(({ date }) => date), MONTH_WEEKS)}
            direction={direction}
            // Percentage points, not a percentage of a percentage — the headline is already a rate
            label={hasData && getTrendLabel('month', direction, thisMonth - pastMonth)}
            referenceValue={hasData ? getSeriesAverage(sparkLineData) : 0}
            noData={!hasData}
          />
          { mostAsked ? (
            <HintBox
              iconId="unanswered_question"
              type="themeMode"
              body={
                <FormattedMessage
                  id="questionsWidget.mostCommonUnansweredQuestion"
                  defaultMessage="Most common unanswered question this month is <strong>“{question}”</strong>."
                  description="Hint naming the question the audience asked most often without getting an answer"
                  values={{
                    question: mostAsked.last_message_body,
                    strong: msg => <strong key="strong">{msg}</strong>,
                  }}
                  tagName="span"
                />
              }
            />
          ) : !hasData && (
            <HintBox
              iconId="question"
              type="themeMode"
              body={
                <FormattedMessage
                  id="global.noQuestionsYetHint"
                  defaultMessage="Questions, both <strong>answered</strong> and <strong>unanswered</strong>, will be available when received from your audience."
                  description="Hint shown when the audience has not asked any questions yet"
                  values={{ strong: msg => <strong key="strong">{msg}</strong> }}
                  tagName="span"
                />
              }
            />
          )}
        </Widget.Body>
      </RequireMessagingPlatform>
    </Widget>
  );
};

export default QuestionsWidget;
