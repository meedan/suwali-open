import styles from './DataSourcesDocumentsPanel.module.css';

type CollapsibleItemsSectionProps = React.PropsWithChildren<{
  // The hidden header cells keep the nested table's columns the width of the main table's
  columns: React.ReactNode;
  columnCount: number;
  summary: React.ReactNode;
}>;

const CollapsibleItemsSection = ({ columns, columnCount, summary, children }: CollapsibleItemsSectionProps) => (
  <tbody className={styles.subBody}>
    <tr>
      <td colSpan={columnCount}>
        <details>
          {summary}
          <table>
            <thead>
              <tr>{columns}</tr>
            </thead>
            <tbody>
              {children}
            </tbody>
          </table>
        </details>
      </td>
    </tr>
  </tbody>
);

export default CollapsibleItemsSection;
