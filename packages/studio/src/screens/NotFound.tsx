import type { ReactElement } from 'react';
import { ErrorPage } from '../components/ErrorPanel.js';

export default function NotFound(): ReactElement {
  return (
    <ErrorPage
      title="That page is not here"
      description="The link may be incomplete, expired, or point to a page that no longer exists."
      backHref="#/"
      backLabel="Go to overview"
    />
  );
}
