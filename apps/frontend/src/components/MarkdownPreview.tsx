import { lazy, Suspense, useState } from "react";
import { FormattedMessage } from "react-intl";

import HintBox from '@ui-components/layout/HintBox';
import { PanelLoading } from "@ui-components/layout/LoadingIndicator";
import ParsedText from "@ui-components/layout/ParsedText";

import styles from './MarkdownPreview.module.css';

const MarkdownEditor = lazy(() => import('@components/MarkdownEditor'));

const MarkdownPreview = ({ className, content }: { className?: string, content: string }) => {
  const [parseFailed, setParseFailed] = useState(false);

  if (parseFailed) {
    return (
      <div className={styles.markdownFallback}>
        <HintBox
          type="warning"
          body={
            <FormattedMessage
              id="markdownPreview.parseFailed"
              defaultMessage="This content could not be displayed with formatting and is shown as plain text instead."
              description="Warning shown when markdown content could not be parsed for rich rendering"
            />
          }
        />
        <p><ParsedText text={content} /></p>
      </div>
    );
  }

  return (
    <Suspense fallback={<PanelLoading />}>
      <MarkdownEditor className={className} initialValue={content} onError={() => setParseFailed(true)} />
    </Suspense>
  );
};

export default MarkdownPreview;
