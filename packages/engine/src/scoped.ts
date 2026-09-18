import {
  can, require as requirePermission, scopeOf, scopeAllows,
  type Action, type Principal, type Resource, type ResourceKind,
} from '@edsai/auth';
import type { RunStore } from './store.js';
import type { Client, Contact, Project } from './entities.js';
import type { Onboarding } from './onboarding.js';
import type { BrandValue } from './brand.js';
import type { Asset } from './assets.js';
import type { Run } from './types.js';

/**
 * The data boundary.
 *
 * `@edsai/auth` decides *whether* a principal may do something; this is *where*
 * that decision is applied. The split matters: a policy that route handlers are
 * trusted to call is a policy that stops being applied the first time someone
 * adds a route and forgets, and the brief is explicit that hiding something in
 * the interface is not authorization.
 *
 * Anything serving a request goes through here. `RunStore` itself stays
 * unscoped because the CLI is the machine's owner operating on their own
 * database file — a check there would protect nothing they could not bypass by
 * opening the file. The API never holds a `RunStore`; it holds one of these.
 *
 * Reads **filter**, writes **throw**. A read that threw would tell a caller
 * that something exists at an id they are not allowed to know about, which is
 * the same disclosure the policy refuses to make in its refusal messages.
 */
export class ScopedStore {
  constructor(
    private readonly store: RunStore,
    readonly principal: Principal,
  ) {}

  private resource(kind: ResourceKind, clientId: string, collection?: string): Resource {
    return { kind, clientId, ...(collection ? { collection } : {}) };
  }

  private mayRead(kind: ResourceKind, clientId: string): boolean {
    return can(this.principal, 'read', this.resource(kind, clientId)).allowed;
  }

  private mustWrite(kind: ResourceKind, clientId: string, action: Action = 'write'): void {
    requirePermission(this.principal, action, this.resource(kind, clientId));
  }

  /** Which clients this principal can see at all — used to scope list queries. */
  private visibleClientIds(): readonly string[] | 'all' {
    const scope = scopeOf(this.principal);
    return scope === 'all' ? 'all' : scope.clientIds;
  }

  /* ----------------------------------------------------------------- clients */

  listClients(): Client[] {
    const scope = this.visibleClientIds();
    return this.store.listClients().filter((client) =>
      (scope === 'all' || scope.includes(client.id)) && this.mayRead('client', client.id));
  }

  getClient(id: string): Client | undefined {
    const client = this.store.getClient(id);
    if (!client || !this.mayRead('client', client.id)) return undefined;
    return client;
  }

  getClientBySlug(slug: string): Client | undefined {
    const client = this.store.getClientBySlug(slug);
    if (!client || !this.mayRead('client', client.id)) return undefined;
    return client;
  }

  saveClient(client: Client): void {
    this.mustWrite('client', client.id);
    this.store.saveClient(client);
  }

  /* ---------------------------------------------------------------- contacts */

  listContacts(clientId: string): Contact[] {
    if (!this.mayRead('contact', clientId)) return [];
    return this.store.listContacts(clientId);
  }

  saveContact(contact: Contact): void {
    this.mustWrite('contact', contact.clientId);
    this.store.saveContact(contact);
  }

  /* ---------------------------------------------------------------- projects */

  listProjects(clientId?: string): Project[] {
    const scope = this.visibleClientIds();
    // A portal asking for "all projects" gets its own, not an error: the scope
    // is a property of the session, so there is nothing to refuse.
    const projects = clientId === undefined
      ? (scope === 'all'
        ? this.store.listProjects()
        : scope.flatMap((id) => this.store.listProjects(id)))
      : this.store.listProjects(clientId);
    return projects.filter((project) => this.mayRead('project', project.clientId));
  }

  getProject(id: string): Project | undefined {
    const project = this.store.getProject(id);
    if (!project || !this.mayRead('project', project.clientId)) return undefined;
    return project;
  }

  saveProject(project: Project): void {
    this.mustWrite('project', project.clientId);
    this.store.saveProject(project);
  }

  /* -------------------------------------------------------------------- runs */

  listRuns(): Run[] {
    const scope = this.visibleClientIds();
    const runs = scope === 'all'
      ? this.store.listRuns()
      : scope.flatMap((id) => this.store.listRuns(id));
    return runs.filter((run) => this.mayRead('run', run.clientId));
  }

  getRun(id: string): Run | undefined {
    const run = this.store.getRun(id);
    if (!run || !this.mayRead('run', run.clientId)) return undefined;
    return run;
  }

  /* ----------------------------------------------------------------- assets */

  /**
   * Assets this principal may see.
   *
   * A studio sees everything the client has. A portal sees only what has been
   * approved — an unapproved asset is the studio's working copy, and a client
   * finding it in their own portal is the kind of leak that is embarrassing
   * rather than dangerous, which makes it easy to forget.
   */
  listAssets(clientId: string): Asset[] {
    // The coarse gate is the client scope, not `read` on a collection-less
    // resource: a `limited` session is defined by which collections it may see,
    // so asking whether it can read "assets in general" is a question with no
    // true answer, and the first version of this returned nothing at all.
    if (!this.inScope(clientId)) return [];

    return this.store.listAssets(clientId).filter((asset) => {
      if (this.principal.kind !== 'studio' && !asset.approved) return false;
      return can(this.principal, 'read',
        this.resource('asset', clientId, asset.collection ?? 'default')).allowed;
    });
  }

  getAsset(id: string): Asset | undefined {
    const asset = this.store.getAsset(id);
    if (!asset) return undefined;
    // Resolved through the same list, so the approval and collection rules
    // cannot be bypassed by knowing an id.
    return this.listAssets(asset.clientId).find((candidate) => candidate.id === id);
  }

  saveAsset(asset: Asset): void {
    this.mustWrite('asset', asset.clientId);
    this.store.saveAsset(asset);
  }

  /* ----------------------------------------------------------- brand values */

  listBrandValues(clientId: string): BrandValue[] {
    if (!this.mayRead('brand', clientId)) return [];
    return this.store.listBrandValues(clientId);
  }

  saveBrandValue(value: BrandValue): void {
    this.mustWrite('brand', value.clientId);
    this.store.saveBrandValue(value);
  }

  /* ------------------------------------------------------------- onboarding */

  listOnboardings(clientId: string): Onboarding[] {
    if (!this.mayRead('client', clientId)) return [];
    return this.store.listOnboardings(clientId);
  }

  getOnboarding(id: string): Onboarding | undefined {
    const onboarding = this.store.getOnboarding(id);
    if (!onboarding || !this.mayRead('client', onboarding.clientId)) return undefined;
    return onboarding;
  }

  saveOnboarding(onboarding: Onboarding): void {
    this.mustWrite('client', onboarding.clientId, 'write');
    this.store.saveOnboarding(onboarding);
  }

  /**
   * The unscoped store, for a caller that has already checked.
   *
   * Named so it reads as a decision at the call site rather than as a getter.
   * Every use is a place where the scope was established some other way — a run
   * fetched through `getRun` above, for instance, is already proven visible, so
   * reading its outputs needs no second check.
   */
  unscopedAfterCheck(): RunStore {
    return this.store;
  }

  /** Whether this principal could write to a client, without doing it. */
  canWrite(kind: ResourceKind, clientId: string): boolean {
    return can(this.principal, 'write', this.resource(kind, clientId)).allowed;
  }

  /** Whether a client id is inside this session's scope at all. */
  inScope(clientId: string): boolean {
    return scopeAllows(scopeOf(this.principal), clientId);
  }
}
