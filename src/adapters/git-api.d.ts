import { Uri, Event } from 'vscode';

/** Minimal built-in Git extension contract consumed by this adapter. */
export interface GitExtension {
  enabled: boolean;
  onDidChangeEnablement: Event<boolean>;

  /** Request the supported version of the built-in Git API. */
  getAPI(version: 1): GitAPI;
}

/** Repository discovery and executable information exposed by Git API version 1. */
export interface GitAPI {
  git: { path: string };
  repositories: Repository[];
  onDidOpenRepository: Event<Repository>;
  onDidCloseRepository: Event<Repository>;

  /** Find the repository containing a URI, or return null if none matches. */
  getRepository(uri: Uri): Repository | null;
}

/** Repository fields needed for selection and refresh subscriptions. */
export interface Repository {
  rootUri: Uri;
  state: { onDidChange: Event<void> };
}
