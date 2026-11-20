import clsx from 'clsx';
import { FormattedMessage } from 'react-intl';

import { CHART_VISUAL_CONSTANTS, TOOLTIP_STYLES } from '@helpers/chart';

import Button from '@ui-components/input/Button';
import EmptyState from "@ui-components/layout/EmptyState";
import Icon from '@ui-components/layout/Icon';
import type { LegendItem } from '@ui-components/layout/Legend';
import Legend from '@ui-components/layout/Legend';

import styles from './ExpandedWidget.module.css';

type ExpandedWidgetProps = {
  children: React.ReactNode;
  className?: string;
  onClose?: () => void;
  onSendToTop?: () => void;
  style?: React.CSSProperties;
  title: React.ReactNode;
};

// The panel a dashboard Widget expands into: its frame, its title and the way out of it. Lay the
// content out with Columns/Column, which stack until the panel is wide enough for two of them.
export const ExpandedWidget = ({ children, className, onClose, onSendToTop, style, title }: ExpandedWidgetProps) => (
  <div className={clsx(styles.expandedWidget, className)} style={style}>
    <div className={styles.titleWrapper}>
      <h3>{title}</h3>
      <div className={styles.actions}>
        { onSendToTop &&
          <Button
            iconLeft={<Icon id="arrow_up" aria-hidden />}
            label={
              <FormattedMessage
                id="global.sendToTop"
                defaultMessage="Send to top"
                description="Button that moves an expanded dashboard panel above the other expanded panels"
              />
            }
            themeMode
            size="small"
            onClick={onSendToTop}
          />
        }
        { onClose &&
          <Button
            iconLeft={<Icon id="x" aria-hidden />}
            label={
              <FormattedMessage
                id="global.closeDetails"
                defaultMessage="Close details"
                description="Generic close details panel button label"
              />
            }
            themeMode
            size="small"
            onClick={onClose}
          />
        }
      </div>
    </div>
    {children}
  </div>
);

const ExpandedWidgetColumns = ({ children, className }: {
  children: React.ReactNode,
  className?: string,
}) => (
  <div className={clsx(styles.columns, className)}>{children}</div>
);

ExpandedWidget.Columns = ExpandedWidgetColumns;

const ExpandedWidgetColumn = ({ children, className, tableContainer }: {
  children: React.ReactNode,
  className?: string,
  tableContainer?: boolean,
}) => (
  <div
    className={clsx(
      styles.column,
      className,
      {
        [styles.tableContainer]: tableContainer,
      })
    }
  >
    {children}
  </div>
);

ExpandedWidget.Column = ExpandedWidgetColumn;

const ExpandedWidgetMessage = ({ children }: { children: React.ReactNode }) => (
  <p className={styles.message}>{children}</p>
);

ExpandedWidget.Message = ExpandedWidgetMessage;

// What a panel shows when the period it reports on holds nothing. Every expanded chart needs one:
// expanding is only offered from a card that has data, but the panel stays expanded across
// sessions, so any of them can mount on an empty period — and without this the reader gets an
// empty plot, or nothing at all and no way back out of it.
const ExpandedWidgetEmpty = ({ actions, children, icon, onClose, onSendToTop, title }: {
  actions?: React.ReactNode;
  children: React.ReactNode;
  icon?: string;
  onClose?: () => void,
  onSendToTop?: () => void,
  title: React.ReactNode,
}) => (
  <ExpandedWidget title={title} onClose={onClose} onSendToTop={onSendToTop} className={styles.empty}>
    <EmptyState
      icon={icon}
      message={children}
      layout="block"
      size="small"
      actions={actions}
    />
  </ExpandedWidget>
);

ExpandedWidget.Empty = ExpandedWidgetEmpty;

const ExpandedWidgetSeparator = () => <span aria-hidden className={styles.separator}>•</span>;

ExpandedWidget.Separator = ExpandedWidgetSeparator;

const ExpandedWidgetFilters = ({ children }: { children: React.ReactNode }) => (
  <div className={styles.filters}>{children}</div>
);

ExpandedWidget.Filters = ExpandedWidgetFilters;

ExpandedWidget.LegendDot = Legend.Dot;

const ExpandedWidgetLegend = ({ items }: { items: LegendItem[] }) => (
  <Legend items={items} className={styles.legendPlacement} />
);

ExpandedWidget.Legend = ExpandedWidgetLegend;

const ExpandedWidgetTable = ({ children }: { children: React.ReactNode }) => (
  <table className={styles.table}>{children}</table>
);

ExpandedWidget.Table = ExpandedWidgetTable;

// One ranked row: a name that truncates, and however many values the chart reports about it
const ExpandedWidgetRow = ({ name, children }: {
  name: React.ReactNode,
  children: React.ReactNode,
}) => (
  <tr>
    <td className={styles.rowName}>{name}</td>
    <td className={styles.rowValues}>{children}</td>
  </tr>
);

ExpandedWidget.Row = ExpandedWidgetRow;

// A scatter plot, the corner labels naming what each of its quadrants means, and the horizontal
// axis label. The axis label is rendered here rather than inside the chart because the corner
// labels are tucked into the same band and a long one collides with them.
const ExpandedWidgetPlot = ({ top, bottom, axisLabel, children }: {
  top: React.ReactNode,
  bottom: React.ReactNode,
  axisLabel: React.ReactNode,
  children: React.ReactNode,
}) => (
  <div style={{ '--axis-width': `${CHART_VISUAL_CONSTANTS.AXIS_WIDTH}px` } as React.CSSProperties}>
    <div className={styles.quadrants}>{top}</div>
    <div className={styles.chart}>{children}</div>
    <div className={clsx(styles.quadrants, styles.quadrantsBottom)}>{bottom}</div>
    <div className={styles.axisLabel}>{axisLabel}</div>
  </div>
);

ExpandedWidget.Plot = ExpandedWidgetPlot;

const ExpandedWidgetTooltip = ({ color, title, children }: {
  color: string,
  title: React.ReactNode,
  children: React.ReactNode,
}) => (
  <div className={styles.tooltip} style={TOOLTIP_STYLES.CONTENT}>
    <strong className={styles.tooltipTitle}>
      <Legend.Dot color={color} />
      {title}
    </strong>
    <ul className={styles.tooltipStats}>{children}</ul>
  </div>
);

ExpandedWidget.Tooltip = ExpandedWidgetTooltip;
