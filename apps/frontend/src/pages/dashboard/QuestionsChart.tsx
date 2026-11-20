import clsx from 'clsx';
import { useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { useQuery } from '@tanstack/react-query';

import type { MessageCluster } from '@customTypes/message-cluster';

import { formatDay } from '@helpers/chart';
import { lastReportedDay, MONTH_WEEKS } from '@helpers/dashboardWidgets';
import { askedIn } from '@helpers/questions';

import { useSession } from '@root/SessionContext';

import { ExpandedWidget } from '@ui-components/layout/ExpandedWidget';

import AddToNotebookModal from '@components/AddToNotebookModal';
import DataSourceItemActionsMenu from '@components/DataSourceItemActionsMenu';
import EndUserQuestionPreviewModal from '@components/EndUserQuestionPreviewModal';
import QuestionsByAnsweredChart from '@components/QuestionsByAnsweredChart';

import styles from './QuestionsChart.module.css';
import { questionsQuery, TOP_QUESTIONS_LIMIT, unansweredQuestionsQuery } from './questionsQuery';

const CHART_HEIGHT = 260;

const QuestionsChart = ({ onClose, onSendToTop }: {
  onClose?: () => void,
  onSendToTop?: () => void,
}) => {
  const hubId = useSession().currentHubId();
  const intl = useIntl();

  const [clusterToPreview, setClusterToPreview] = useState<MessageCluster | null>(null);
  const [clusterToAddToNotebook, setClusterToAddToNotebook] = useState<MessageCluster | null>(null);

  const { data: stats, isPending } = useQuery({
    ...questionsQuery(hubId),
    enabled: Boolean(hubId),
  });

  // The month the collapsed card reports on, out of the series it already fetched
  const month = (stats?.questions_by_answered ?? []).slice(-MONTH_WEEKS);
  const monthStart = month[0]?.date;

  const { data: topQuestions } = useQuery({
    ...unansweredQuestionsQuery(hubId, monthStart, TOP_QUESTIONS_LIMIT),
    enabled: Boolean(hubId && monthStart),
  });

  if (isPending) return null;

  const questions = topQuestions?.data ?? [];

  const today = lastReportedDay();
  const title = (
    <FormattedMessage
      id="questionsChart.title"
      defaultMessage="Answers per week: {from} – {to}"
      description="Title of the expanded answer rate chart, with the period it covers"
      values={{ from: formatDay(monthStart ?? today, intl), to: formatDay(today, intl) }}
    />
  );

  if (!month.some(week => askedIn(week) > 0)) {
    return (
      <ExpandedWidget.Empty title={title} onClose={onClose} onSendToTop={onSendToTop} icon="question_dashed">
        <FormattedMessage
          id="questionsChart.noQuestions"
          defaultMessage="Your audience has not asked your chatbot anything in this period."
          description="Message shown when the chart has no questions to plot"
        />
      </ExpandedWidget.Empty>
    );
  }

  return (
    <ExpandedWidget title={title} onClose={onClose} onSendToTop={onSendToTop} className={styles.questionsChart}>
      <AddToNotebookModal
        assetId={clusterToAddToNotebook?.id}
        assetTitle={clusterToAddToNotebook?.last_message_body.substring(0, 60)}
        assetType="MessageCluster"
        open={Boolean(clusterToAddToNotebook)}
        onOpenChange={() => setClusterToAddToNotebook(null)}
      />
      <EndUserQuestionPreviewModal
        cluster={clusterToPreview}
        answered={false}
        open={Boolean(clusterToPreview)}
        onOpenChange={() => setClusterToPreview(null)}
      />

      <ExpandedWidget.Columns>
        <ExpandedWidget.Column>
          <QuestionsByAnsweredChart data={month} height={CHART_HEIGHT} />
        </ExpandedWidget.Column>

        <ExpandedWidget.Column tableContainer>
          { questions.length === 0 ? (
            <ExpandedWidget.Message>
              <FormattedMessage
                id="questionsChart.everythingAnswered"
                defaultMessage="Your chatbot answered every question this month."
                description="Message shown when no question was left unanswered"
              />
            </ExpandedWidget.Message>
          ) : (
            <ExpandedWidget.Table>
              <thead>
                <tr>
                  <th scope="col">
                    <FormattedMessage
                      id="questionsChart.topUnanswered"
                      defaultMessage="Top {limit} unanswered questions this month"
                      description="Title of the table ranking the questions most often left unanswered"
                      tagName="h4"
                      values={{ limit: TOP_QUESTIONS_LIMIT }}
                    />
                  </th>
                  <th scope="col" className="table-count-cell">
                    <FormattedMessage
                      id="questionsChart.timesAsked"
                      defaultMessage="Times asked"
                      description="Column header for how many times a question was asked"
                    />
                  </th>
                  <th scope="col" className="table-row-actions" />
                </tr>
              </thead>
              <tbody>
                {questions.map(question => (
                  <tr key={question.id}>
                    <td className={styles.rowPreview} onClick={() => setClusterToPreview(question)}>
                      {question.last_message_body}
                    </td>
                    <td className={clsx('table-count-cell', styles.rowPreview)} onClick={() => setClusterToPreview(question)}>
                      {intl.formatNumber(question.question_count)}
                    </td>
                    <td className="table-row-actions">
                      <DataSourceItemActionsMenu
                        item={question}
                        onPreview={setClusterToPreview}
                        onAddToNotebook={setClusterToAddToNotebook}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </ExpandedWidget.Table>
          )}
        </ExpandedWidget.Column>
      </ExpandedWidget.Columns>
    </ExpandedWidget>
  );
};

export default QuestionsChart;
