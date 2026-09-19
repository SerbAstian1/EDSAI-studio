import Anthropic from '@anthropic-ai/sdk';
import { TurnRefused } from './executor.js';

/**
 * What kind of failure this is, and therefore what to do about it.
 *
 * The distinction that matters is **retry or change something**, and getting it
 * wrong wastes either money or time. The first version of this asked one
 * question — "was it a refusal?" — and told somebody with an invalid API key to
 * run the command again. It would have failed identically every time.
 *
 * Found by running the real thing with a bad key rather than reasoning about
 * it: the request reached Anthropic, came back 401, and the advice underneath
 * the error was wrong.
 */

export interface Diagnosis {
  /** Whether running the same thing again could plausibly work. */
  retryable: boolean;
  /** What a person should do, in the words they would use. */
  hint: string;
}

export function diagnose(error: unknown): Diagnosis {
  // The model declined this department. It will decline it again.
  if (error instanceof TurnRefused) {
    return {
      retryable: false,
      hint: 'The model would not produce this department\'s output. '
        + 'Rewording the brief is more likely to help than running it again.',
    };
  }

  // Most specific first, as the SDK's own guidance has it.
  if (error instanceof Anthropic.AuthenticationError) {
    return {
      retryable: false,
      hint: 'The API key was rejected. Check ANTHROPIC_API_KEY — running this '
        + 'again with the same key will fail the same way.',
    };
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return {
      retryable: false,
      hint: 'That key is not allowed to use this model. Check the model id and '
        + 'what the key is scoped to.',
    };
  }
  if (error instanceof Anthropic.NotFoundError) {
    return {
      retryable: false,
      hint: 'The model id was not found. Check it against the models the account can use.',
    };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return {
      retryable: true,
      hint: 'Rate limited. Wait a moment and run it again — completed departments are kept.',
    };
  }
  if (error instanceof Anthropic.BadRequestError) {
    // Includes the out-of-credit case, which reads as a bad request and is the
    // single most likely thing to stop a run in this project.
    const outOfCredit = /credit|balance|quota/i.test(error.message);
    return {
      retryable: false,
      hint: outOfCredit
        ? 'The account is out of credit. Top it up and run it again — completed '
          + 'departments are kept, so this resumes rather than starting over.'
        : 'The request was rejected as malformed. This is a bug here, not '
          + 'something retrying will fix.',
    };
  }
  if (error instanceof Anthropic.InternalServerError) {
    return { retryable: true, hint: 'The API had a problem. Run it again — it resumes.' };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { retryable: true, hint: 'Could not reach the API. Check the network and run it again.' };
  }
  if (error instanceof Anthropic.APIError) {
    // An unrecognised status: 5xx is worth retrying, 4xx is ours to fix.
    const status = error.status ?? 0;
    return status >= 500
      ? { retryable: true, hint: 'The API failed. Run it again — it resumes.' }
      : { retryable: false, hint: `The API refused the request (${status}).` };
  }

  return {
    retryable: true,
    hint: 'Something unexpected went wrong. Run it again — completed departments are kept.',
  };
}
