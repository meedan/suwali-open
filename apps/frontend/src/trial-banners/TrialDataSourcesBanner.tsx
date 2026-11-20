import { FormattedMessage } from 'react-intl';

import { APP_NAME } from '@constants/App';

import { isRestricted } from '@helpers/trial';

import { useSession } from '@root/SessionContext';

import Icon from '@ui-components/layout/Icon';

import styles from './TrialDataSourcesBanner.module.css';

const TrialDataSourcesBanner = () => {
  const session = useSession();
  const hub = session.currentHub();

  if (!hub || !isRestricted(hub) || hub.max_documents_for_plan === null) {
    return null;
  }

  return (
    <div className={styles.banner}>
      <Icon id="error_filled" className={styles.icon} aria-hidden />
      <FormattedMessage
        id="global.trialDataSourcesBannerDescription"
        defaultMessage="<strong>Free trial:</strong> During the {appName} free trial your data sources are limited to <strong>{maxDocuments} entries</strong>."
        description="Banner shown below the data sources title during a free trial, informing the user of the entry limit"
        values={{
          appName: APP_NAME,
          maxDocuments: hub.max_documents_for_plan,
          strong: msg => <strong key="strong">{msg}</strong>,
        }}
        tagName="span"
      />
    </div>
  );
};

export default TrialDataSourcesBanner;
