import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import type { HubPlanFilter, HubStatusFilter } from '@helpers/platform-admin';

import { Select, SelectItem } from '@ui-components/input/SelectInput';
import TextInput from '@ui-components/input/TextInput';
import { ToggleGroup, ToggleGroupItem } from '@ui-components/input/ToggleGroup';
import Icon from '@ui-components/layout/Icon';

import styles from './HubFilterControls.module.css';

const messages = defineMessages({
  statusFilterLabel: {
    id: 'admin.statusFilterLabel',
    defaultMessage: 'Filter by status',
    description: 'Accessible label for the hub status filter toggle on the admin dashboard',
  },
  hubSearchPlaceholder: {
    id: 'admin.hubSearchPlaceholder',
    defaultMessage: 'Find by hub name…',
    description: 'Placeholder for the hub search input on the admin dashboard',
  },
});

interface HubFilterControlsProps {
  hubsCount: number;
  hubStatusFilter: HubStatusFilter;
  onStatusFilterChange: (v: HubStatusFilter) => void;
  hubPlanFilter: HubPlanFilter;
  onPlanFilterChange: (v: HubPlanFilter) => void;
  hubSearch: string;
  onSearchChange: (v: string) => void;
  statusCounts: { green: number; yellow: number; pink: number };
  planCounts: { free: number; free_unrestricted: number; subsidized: number; standard: number; pro: number; enterprise: number; expired_trial: number };
}

const HubFilterControls = ({
  hubsCount,
  hubStatusFilter,
  onStatusFilterChange,
  hubPlanFilter,
  onPlanFilterChange,
  hubSearch,
  onSearchChange,
  statusCounts,
  planCounts,
}: HubFilterControlsProps) => {
  const intl = useIntl();

  return (
    <div className={styles.filterControls}>
      <TextInput
        id="hub-search"
        className={styles.hubSearch}
        label={
          <FormattedMessage
            id="admin.hubFindHubs"
            defaultMessage="Find hubs"
            description="Label for the hub search input on the admin dashboard"
          />
        }
        placeholder={intl.formatMessage(messages.hubSearchPlaceholder)}
        value={hubSearch}
        onChange={e => onSearchChange(e.target.value)}
      />
      <Select
        id="plan-filter"
        className={styles.planSelect}
        label={
          <FormattedMessage
            id="admin.hubsTablePlan"
            defaultMessage="Plan"
            description="Column header for hub plan in the hubs table"
          />
        }
        value={hubPlanFilter}
        onValueChange={v => onPlanFilterChange(v as HubPlanFilter)}
        size="small"
      >
        <SelectItem value="all">
          <FormattedMessage
            id="admin.filterPlanAll"
            defaultMessage="All plans ({count})"
            description="Plan filter option showing all hubs"
            values={{ count: hubsCount }}
          />
        </SelectItem>
        <SelectItem value="free">
          <FormattedMessage
            id="admin.filterPlanFree"
            defaultMessage="Trial — free ({count})"
            description="Plan filter option for free trial hubs"
            values={{ count: planCounts.free }}
          />
        </SelectItem>
        <SelectItem value="free_unrestricted">
          <FormattedMessage
            id="admin.filterPlanFreeUnrestricted"
            defaultMessage="Trial — free, unrestricted ({count})"
            description="Plan filter option for free unrestricted trial hubs"
            values={{ count: planCounts.free_unrestricted }}
          />
        </SelectItem>
        <SelectItem value="subsidized">
          <FormattedMessage
            id="admin.filterPlanSubsidized"
            defaultMessage="Subsidized ({count})"
            description="Plan filter option for subsidized plan hubs"
            values={{ count: planCounts.subsidized }}
          />
        </SelectItem>
        <SelectItem value="standard">
          <FormattedMessage
            id="admin.filterPlanStandard"
            defaultMessage="Standard ({count})"
            description="Plan filter option for standard plan hubs"
            values={{ count: planCounts.standard }}
          />
        </SelectItem>
        <SelectItem value="pro">
          <FormattedMessage
            id="admin.filterPlanPro"
            defaultMessage="Pro ({count})"
            description="Plan filter option for pro plan hubs"
            values={{ count: planCounts.pro }}
          />
        </SelectItem>
        <SelectItem value="enterprise">
          <FormattedMessage
            id="admin.filterPlanEnterprise"
            defaultMessage="Enterprise ({count})"
            description="Plan filter option for enterprise plan hubs"
            values={{ count: planCounts.enterprise }}
          />
        </SelectItem>
        <SelectItem value="expired_trial">
          <FormattedMessage
            id="admin.filterPlanExpiredTrial"
            defaultMessage="Expired trial ({count})"
            description="Plan filter option for hubs with an expired trial"
            values={{ count: planCounts.expired_trial }}
          />
        </SelectItem>
      </Select>
      <ToggleGroup
        aria-label={intl.formatMessage(messages.statusFilterLabel)}
        size="small"
        type="single"
        value={hubStatusFilter}
        onValueChange={v => onStatusFilterChange((v || 'all') as HubStatusFilter)}
      >
        <ToggleGroupItem value="all">
          <FormattedMessage
            id="admin.filterStatusAll"
            defaultMessage="All ({count})"
            description="Status filter pill showing all hubs with count"
            values={{ count: hubsCount }}
          />
        </ToggleGroupItem>
        <ToggleGroupItem value="green" iconLeft={<Icon aria-hidden className={styles.iconGreen} id="check_filled" />}>
          <FormattedMessage
            id="admin.filterStatusGreen"
            defaultMessage="All good ({count})"
            description="Status filter pill for hubs with no issues, with count"
            values={{ count: statusCounts.green }}
          />
        </ToggleGroupItem>
        <ToggleGroupItem value="yellow" iconLeft={<Icon aria-hidden className={styles.iconYellow} id="countdown_filled" />}>
          <FormattedMessage
            id="admin.filterStatusYellow"
            defaultMessage="Worth checking ({count})"
            description="Status filter pill for hubs with yellow status indicators, with count"
            values={{ count: statusCounts.yellow }}
          />
        </ToggleGroupItem>
        <ToggleGroupItem value="pink" iconLeft={<Icon aria-hidden className={styles.iconPink} id="error_filled" />}>
          <FormattedMessage
            id="admin.filterStatusPink"
            defaultMessage="Look into this ({count})"
            description="Status filter pill for hubs with pink status indicators, with count"
            values={{ count: statusCounts.pink }}
          />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
};

export default HubFilterControls;
