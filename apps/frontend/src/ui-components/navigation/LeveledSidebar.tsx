import clsx from 'clsx';

type LeveledSidebarProps = {
  levelVisible?: number; // 0 for base level, 1 for nested level
  topLevelContent?: React.ReactNode;
  nestedLevelContent?: React.ReactNode;
};

const LeveledSidebar = ({
  levelVisible = 0,
  topLevelContent,
  nestedLevelContent,
}: LeveledSidebarProps) => (
  <>
    <div
      className={clsx(
        'layout-left-column-content',
        'layout-left-column-content-panel',
        {
          'slide-out': levelVisible === 1,
        }
      )}
    >
      {topLevelContent}
    </div>
    <div
      className={clsx(
        'layout-left-column-content',
        'layout-left-column-content-panel',
        {
          'slide-in': levelVisible === 1,
        }
      )}
    >
      {nestedLevelContent}
    </div>
  </>
);

export default LeveledSidebar;
