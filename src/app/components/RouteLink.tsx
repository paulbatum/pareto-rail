import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react';

type RouteLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'> & {
  href: string;
  onNavigate: (path: string) => void;
  children: ReactNode;
};

export function RouteLink({ href, onNavigate, children, className, ...attributes }: RouteLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(href);
  }

  return <a {...attributes} className={className} href={href} onClick={handleClick}>{children}</a>;
}
