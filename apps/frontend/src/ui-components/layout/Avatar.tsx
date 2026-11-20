import clsx from 'clsx';
import { Avatar as RadixAvatar } from "radix-ui";

import styles from './Avatar.module.css'

interface AvatarProps {
  editor?: boolean;
  iconLayout?: boolean;
  picture?: string | null;
  name?: string;
  fallback?: string;
  className?: string;
}

const Avatar: React.FC<AvatarProps> = ({
  className,
  editor,
  iconLayout = false,
  name,
  fallback,
  picture,
}) => {
  return (
    <RadixAvatar.Root
      className={clsx(
        [styles.avatar],
        [className],
        {
          [styles.editor]: editor,
          [styles.iconLayout]: iconLayout,
        },
      )}
      title={name}
    >
      <RadixAvatar.Image
        src={picture ?? undefined}
        alt={name}
      />
      <RadixAvatar.Fallback className={styles.avatarFallback}>
        {fallback}
      </RadixAvatar.Fallback>
    </RadixAvatar.Root>
  );
};

export default Avatar;
