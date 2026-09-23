import { TurnRefused } from './executor.js';

export interface Diagnosis {
  retryable: boolean;
  hint: string;
}

export function diagnose(error: unknown): Diagnosis {
  if (error instanceof TurnRefused) {
    return {
      retryable: false,
      hint: 'The model would not produce this department\'s output. '
        + 'Rewording the brief is more likely to help than running it again.',
    };
  }

  const status = statusOf(error);
  if (status === 401) {
    return {
      retryable: false,
      hint: 'The execution credentials were rejected. Check the model adapter configuration '
        + 'before retrying.',
    };
  }
  if (status === 403) {
    return {
      retryable: false,
      hint: 'The configured credentials cannot use this model. Check the model id and '
        + 'provider permissions.',
    };
  }
  if (status === 404) {
    return {
      retryable: false,
      hint: 'The model id was not found. Check it against the models the account can use.',
    };
  }
  if (status === 429) {
    return {
      retryable: true,
      hint: 'Rate limited. Wait a moment and run it again — completed departments are kept.',
    };
  }
  if (status === 400) {
    const message = error instanceof Error ? error.message : '';
    const outOfCredit = /credit|balance|quota/i.test(message);
    return {
      retryable: false,
      hint: outOfCredit
        ? 'The provider account is out of credit. Top it up and run it again — completed '
          + 'departments are kept, so this resumes rather than starting over.'
        : 'The request was rejected as malformed. This is a bug here, not '
          + 'something retrying will fix.',
    };
  }
  if (status !== undefined) {
    return status >= 500
      ? { retryable: true, hint: 'The model service had a problem. Run it again — it resumes.' }
      : { retryable: false, hint: `The model service refused the request (${status}).` };
  }

  return {
    retryable: true,
    hint: 'Something unexpected went wrong. Run it again — completed departments are kept.',
  };
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}
