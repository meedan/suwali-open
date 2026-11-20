import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';

import { downloadExport } from '@services/AdminService';

import { HttpError } from '@root/NetworkLayer';

const messages = defineMessages({
  exportFailed: {
    id: 'admin.exportFailed',
    defaultMessage: 'Export failed',
    description: 'Default error message when export fails'
  },
});

const useAdminExport = () => {
  const intl = useIntl();
  const [exportingPath, setExportingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async (path: string, filenamePrefix: string) => {
    setExportingPath(path);
    setError(null);

    try {
      const blob = await downloadExport(path);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filenamePrefix}-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: unknown) {
      if (err instanceof HttpError) {
        setError(err.data?.error ?? intl.formatMessage(messages.exportFailed));
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setExportingPath(null);
    }
  };

  return { exportingPath, error, handleExport };
};

export default useAdminExport;
