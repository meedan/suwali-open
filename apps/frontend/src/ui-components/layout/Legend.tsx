import clsx from 'clsx';

import styles from './Legend.module.css';

export type LegendItem = {
  key: string;
  color: string;
  label: React.ReactNode;
};

const LegendDot = ({ color }: { color: string }) => (
  <span className={styles.legendDot} style={{ background: color }} />
);

// Dot-plus-label legend, shared so a chart's own legend (built from data colors, e.g. a recharts
// legend's content prop) matches the manually-built ones used elsewhere, like ExpandedWidget's.
const Legend = ({ items, className }: { items: LegendItem[], className?: string }) => (
  <div className={clsx(styles.legend, className)}>
    {items.map(({ key, color, label }) => (
      <span className={styles.legendItem} key={key}>
        <LegendDot color={color} />
        {label}
      </span>
    ))}
  </div>
);

Legend.Dot = LegendDot;

export default Legend;
