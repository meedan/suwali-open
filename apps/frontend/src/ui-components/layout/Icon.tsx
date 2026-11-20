import clsx from 'clsx';
import { useEffect, useState } from 'react';

import { iconUrl } from '@helpers/icons';

type IconProps = {
  className?: string;
  // Fetches the icon and inlines its markup directly instead of referencing it via
  // <use href="external.svg#id">. Needed for icons using a gradient fill, since Safari
  // doesn't support paint server references (gradients, patterns) inside content cloned in
  // via <use> from an external file — the fill fails silently no matter how the reference
  // is written (https://bugs.webkit.org/show_bug.cgi?id=17004).
  inlineSvg?: boolean;
  id: string;
  title?: string;
};

type InlineIconMarkup = {
  innerHTML: string;
  viewBox: string;
};

const inlineIconCache = new Map<string, InlineIconMarkup>();

const useInlineIconMarkup = (id: string) => {
  const [markup, setMarkup] = useState<InlineIconMarkup | null>(() => inlineIconCache.get(id) ?? null);

  useEffect(() => {
    const cached = inlineIconCache.get(id);
    if (cached) {
      setMarkup(cached);
      return;
    }

    let cancelled = false;

    fetch(`/assets/icons/${id}.svg`)
      .then((response) => response.text())
      .then((text) => {
        const symbol = new DOMParser().parseFromString(text, 'image/svg+xml').querySelector('symbol');
        if (!symbol) return;

        const parsed = {
          innerHTML: symbol.innerHTML,
          viewBox: symbol.getAttribute('viewBox') ?? '0 0 24 24',
        };
        inlineIconCache.set(id, parsed);
        if (!cancelled) setMarkup(parsed);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [id]);

  return markup;
};

const InlineIcon = ({
  className,
  id,
  title,
  ...props
}: Omit<IconProps, 'inlineSvg'>) => {
  const markup = useInlineIconMarkup(id);

  if (!markup) return null;

  return (
    <svg
      className={clsx(className, 'suwali-icon')}
      viewBox={markup.viewBox}
      {...props}
    >
      {title && <title>{title}</title>}
      {/* nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml -- markup is fetched from our own bundled /assets/icons/*.svg files; `id` is always a literal string from callers, never user input */}
      <g dangerouslySetInnerHTML={{ __html: markup.innerHTML }} />
    </svg>
  );
};

const Icon = ({
  className,
  inlineSvg,
  id,
  title,
  ...props
}: IconProps) => {
  if (inlineSvg) {
    return (
      <InlineIcon
        className={className}
        id={id}
        title={title}
        {...props}
      />
    );
  }

  return (
    <svg
      className={clsx(className, 'suwali-icon')}
      {...props}
    >
      {title && <title>{title}</title>}
      <use href={`${iconUrl(id)}#icon`} />
    </svg>
  );
};

export default Icon;
