import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api, figmaFailureFrom, figmaFailureOf, type FigmaFailure, type FigmaReading, type FigmaStatus,
} from './api.js';

/**
 * Getting from "a Figma link" to "a list of frames".
 *
 * **The one part of this feature that is not obvious.** Reading a Figma file
 * needs a credential, and the studio does not have one and must never have one —
 * so every frame in EDSAI arrives through the server, and this hook is the whole
 * of the browser side: ask for the status, offer to connect, send the link,
 * receive a manifest.
 *
 * It is a hook and not a component because the same three states are needed in
 * two places that look nothing alike — the "add document" dialog, where a
 * designer is choosing frames for the first time, and the frames panel inside
 * the viewer, where they are changing a document that already exists. Keeping
 * the state machine in one place is what stops the two from disagreeing about
 * what a 403 means.
 */

/** What the panel is doing right now. */
export type DiscoveryPhase =
  /** Nothing asked for yet. */
  | 'idle'
  /** Off to Figma's authorize page. */
  | 'connecting'
  /** Reading the file. */
  | 'reading'
  /** A file, and its frames. */
  | 'ready'
  /** It went wrong, and we know how. */
  | 'failed';

export interface DiscoveryState {
  phase: DiscoveryPhase;
  /** Set only in `failed`, and switched on to choose the message and the remedy. */
  failure: FigmaFailure | null;
  /** The server's sentence, shown beneath ours. Never the whole message. */
  detail: string;
  reading: FigmaReading | null;
  /**
   * The last link that was sent, kept so a retry can send it again.
   *
   * A "Try again" that only clears the error message is worse than no button:
   * the designer is left with a link they know was refused, a panel that is
   * empty, and no way to ask again. Holding the URL is what makes the offer
   * honest. It is a link the designer pasted in this tab, never a credential.
   */
  lastUrl: string;
}

/**
 * What a failure means, said in the studio's voice.
 *
 * **Remedies live here, not in the components.** "Not connected" and "forbidden"
 * are the two that look identical from inside the studio — an empty frames list —
 * and the difference between them is the whole difference between a designer
 * being told to sign in and being told to fix a file's sharing. Each entry is
 * (what to say, whether the remedy is to connect, whether to offer a retry) so
 * the panel cannot show a retry button for a refusal that retrying cannot fix.
 */
export interface FailureAdvice {
  title: string;
  detail: string;
  /** Show the "Connect Figma" button. */
  connect: boolean;
  /** Show "Try again". */
  retry: boolean;
}

export function adviseFailure(failure: FigmaFailure): FailureAdvice {
  switch (failure) {
    case 'not_connected':
      return {
        title: 'Figma is not connected',
        detail: 'EDSAI reads your file with your own access, so nothing is stored '
          + 'that you have not granted. Connecting takes one click at Figma.',
        connect: true, retry: false,
      };
    case 'forbidden':
      return {
        title: 'EDSAI cannot see that file',
        detail: 'It is private, or it is shared with a different account. Give the '
          + 'account EDSAI is connected as access on the file, or connect that account.',
        connect: true, retry: true,
      };
    case 'not_found':
      return {
        title: 'No such file',
        detail: 'The link points at a file that has moved or been deleted. Check the '
          + 'link, and that it is a file rather than a comment.',
        connect: false, retry: false,
      };
    case 'rate_limited':
      return {
        title: 'Figma is rate-limiting EDSAI',
        detail: 'Wait a moment and read it again. Nothing is lost; the file has not '
          + 'been changed.',
        connect: false, retry: true,
      };
    case 'no_frames':
      return {
        title: 'No frames to show',
        detail: 'This file has no top-level frames. A presentation is made of frames '
          + 'laid out on a Figma page — components, groups and sections inside them are '
          + 'not pages of their own.',
        connect: false, retry: false,
      };
    case 'bad_request':
      return {
        title: 'That is not a Figma link',
        detail: 'Paste a link to a Figma file, like the one in your browser when the '
          + 'file is open.',
        connect: false, retry: false,
      };
    case 'figma_error':
      return {
        title: 'Figma could not answer',
        detail: 'Figma refused the read or changed its API. This is usually a problem '
          + 'at Figma rather than with the link.',
        connect: false, retry: true,
      };
    case 'network':
      return {
        title: 'Could not reach Figma',
        detail: 'The request to Figma did not come back. Check the connection and try again.',
        connect: false, retry: true,
      };
    case 'unknown':
      return {
        title: 'Something went wrong',
        detail: 'EDSAI could not read that file, and does not know why. Try again, and '
          + 'if it keeps happening it is worth telling whoever runs this server.',
        connect: false, retry: true,
      };
  }
}

/** Whether a failure is worth offering a plain retry for, in one place. */
export function canRetry(failure: FigmaFailure): boolean {
  return adviseFailure(failure).retry;
}

export interface FigmaDiscovery {
  /** Whether this server can read Figma at all, once asked. */
  status: FigmaStatus | null;
  /** True while the status is still unknown, so panels can hold their shape. */
  asking: boolean;
  state: DiscoveryState;
  /** Send a pasted link off to be read. */
  read: (url: string) => Promise<FigmaReading | null>;
  /** Go to Figma to connect. Resolves false if the server cannot do it. */
  connect: () => Promise<boolean>;
  /** Forget the connection. */
  disconnect: () => Promise<void>;
  /** Clear a failure so the designer can correct the link and try again. */
  reset: () => void;
  /** Ask for the last link again, after a failure worth retrying. */
  retry: () => Promise<FigmaReading | null>;
  /** Adopt a reading that came from somewhere else, without a second request. */
  adopt: (reading: FigmaReading) => void;
}

const IDLE: DiscoveryState = {
  phase: 'idle', failure: null, detail: '', reading: null, lastUrl: '',
};

export function useFigmaDiscovery(): FigmaDiscovery {
  const [status, setStatus] = useState<FigmaStatus | null>(null);
  const [asking, setAsking] = useState(false);
  const [state, setState] = useState<DiscoveryState>(IDLE);

  /**
   * The status is asked for on mount and after every connect, but a failure
   * leaves it alone — a 403 says nothing about the connection, and re-asking
   * would overwrite a perfectly good "connected" with a null and make the
   * Connect button reappear over a working setup.
   */
  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.figmaStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    setAsking(true);
    void refreshStatus().finally(() => setAsking(false));
  }, [refreshStatus]);

  const read = useCallback(async (url: string): Promise<FigmaReading | null> => {
    setState({ phase: 'reading', failure: null, detail: '', reading: null, lastUrl: url });
    try {
      const reading = await api.discoverFigma(url);
      setState({ phase: 'ready', failure: null, detail: '', reading, lastUrl: url });
      return reading;
    } catch (error) {
      const failure = figmaFailureOf(error);
      const detail = error instanceof Error ? error.message : '';
      setState({ phase: 'failed', failure, detail, reading: null, lastUrl: url });
      return null;
    }
  }, []);

  /**
   * Send the last link again.
   *
   * Held in state rather than captured from a closure so it survives the failure
   * that replaced the reading: the `read` callback that was given the URL is not
   * the one on screen once the panel is showing an error. Resolves `null` with
   * no request when there is nothing to retry, so a button that fires early
   * cannot invent a read of an empty string.
   */
  const retry = useCallback((): Promise<FigmaReading | null> => (
    state.lastUrl === '' ? Promise.resolve(null) : read(state.lastUrl)
  ), [state.lastUrl, read]);

  const connect = useCallback(async (): Promise<boolean> => {
    setState((s) => ({
      phase: 'connecting', failure: null, detail: '', reading: null, lastUrl: s.lastUrl,
    }));
    try {
      const url = await api.figmaConnect();
      // The browser leaves the studio and comes back to `/api/figma/callback`,
      // which redirects on to `/?figma=connected#/`. Nothing after this line
      // runs in this tab, so the state is not cleared and the panel is intact
      // if the designer comes back.
      window.location.assign(url);
      return true;
    } catch (error) {
      const failure = figmaFailureOf(error);
      const detail = error instanceof Error ? error.message : '';
      setState((s) => ({ phase: 'failed', failure, detail, reading: null, lastUrl: s.lastUrl }));
      return false;
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await api.disconnectFigma();
    } catch {
      // Refusing a disconnect leaves the connection intact, which is the safe
      // direction to be wrong in. The status is re-read below either way, so a
      // grant that really was deleted does not keep showing as connected.
    }
    await refreshStatus();
  }, [refreshStatus]);

  return useMemo<FigmaDiscovery>(() => ({
    status,
    asking,
    state,
    read,
    retry,
    connect,
    disconnect,
    reset: () => setState(IDLE),
    adopt: (reading) => setState((s) => ({
      phase: 'ready', failure: null, detail: '', reading, lastUrl: s.lastUrl,
    })),
  }), [status, asking, state, read, retry, connect, disconnect]);
}

/* -------------------------------------------------------- coming back */

/** What the callback left in the URL when it sent the designer back here. */
export type FigmaReturn =
  | { outcome: 'connected' }
  | { outcome: 'cancelled'; reason: FigmaFailure };

const CANCELLED: Partial<Record<FigmaFailure, string>> = {
  bad_request: 'Figma did not send the callback back in a shape EDSAI recognised.',
  unknown: 'The connection could not be completed.',
};

/**
 * The result of a connect, read once and then scrubbed.
 *
 * **A query flag that removes itself.** The callback has to be a navigation —
 * the browser arrives from figma.com, and the studio is a single-page app whose
 * router reads the hash — so it answers with a redirect carrying one flag. That
 * flag is read here, once, and then taken out of the URL: left in place it would
 * survive a reload and announce a connection that happened yesterday, and it
 * would be the kind of thing a person pastes to a colleague to ask why their
 * studio opened a banner.
 *
 * Nothing about the grant is in the URL. What comes back is one word and, at
 * worst, a reason drawn from a fixed set — the token never passes through
 * something a person can copy.
 */
export function useFigmaReturn(): FigmaReturn | null {
  const [outcome, setOutcome] = useState<FigmaReturn | null>(null);

  useEffect(() => {
    const search = new URLSearchParams(location.search);
    const flag = search.get('figma');
    if (!flag) return;

    const reason = search.get('reason');
    const next: FigmaReturn = flag === 'connected'
      ? { outcome: 'connected' }
      : { outcome: 'cancelled', reason: figmaFailureFrom(reason) };

    // `replaceState` rather than assigning: the hash must survive, because that
    // is where the studio keeps its route, and a full navigation would throw
    // away the page the designer was on before they went to Figma.
    search.delete('figma');
    search.delete('reason');
    const rest = search.toString();
    history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);

    setOutcome(next);
  }, []);

  return outcome;
}

/** The sentence for a return, in the studio's voice. */
export function returnAdvice(back: FigmaReturn | null): { title: string; detail: string } | null {
  if (!back) return null;
  if (back.outcome === 'connected') {
    return {
      title: 'Figma connected',
      detail: 'Figma frames can be read now. Open a document and its pages are '
        + 'discovered from the file.',
    };
  }
  const failure = back.reason;
  return {
    title: failure === 'bad_request' ? 'The connection was not completed' : 'Figma was not connected',
    detail: CANCELLED[failure] ?? 'Nothing was changed. You can connect again from a '
      + 'document’s Frames panel whenever you like.',
  };
}
